import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { inviteMessage } from '../discord/crew-messages';
import { MembersService } from '../discord/members.service';
import { NotifyService } from '../discord/notify.service';
import { checkCount, checkIp, until, Window } from '../limits';
import { type Said, voice } from '../discord/voice';
import { GigsService, toCard } from '../gigs/gigs.service';
import { LibraryService } from '../library/library.service';
import { stringList } from '../prisma/json';
import { PrismaService } from '../prisma/prisma.service';
import { canCreateCrew, canManageCrew, isFounderRank } from '../shared/permissions';
import { type CrewInput, type CrewInvite, type CrewMember, type CrewView, DEFAULT_RANKS, type HqInput, type Me, type NewCrewInput } from '../shared/schemas';
import { gigRef, isFreeSlugWord, isUuid, toSlug } from '../shared/slug';

const CREW_INCLUDE = {
    members: { include: { runner: true } },
    allies: { include: { runner: true } },
    invites: { include: { runner: true }, orderBy: { createdAt: 'asc' } },
    // Gigs with slots for the crew. Only posted ones, so nobody sees an unposted gig they shouldn't
    slots: { where: { gig: { status: { notIn: ['draft', 'pending', 'rejected'] } } }, select: { gig: true } },
    hqEntries: { include: { gig: true }, orderBy: { createdAt: 'desc' } },
} as const satisfies Prisma.CrewInclude;

/** How much of a crew's HQ IP record its page shows. */
const HQ_LOG = 50;
type CrewRow = Prisma.CrewGetPayload<{ include: typeof CREW_INCLUDE }>;

/**
 * Crews are groups of runners with ranks. Whoever holds the first rank (Founder unless
 * renamed) runs the crew, along with admins. There's always at least one founder.
 * Founders invite runners (their player answers by DM or on the web) and keep a list of
 * allies. Crew slots on gigs go to the crew's runners.
 */
@Injectable()
export class CrewsService {
    /** Logo frame changes per crew in the last day, for MAX_FRAME_CHANGES_PER_DAY. */
    private readonly frameChanges = new Window(86_400_000);

    constructor(
        private readonly prisma: PrismaService,
        private readonly members: MembersService,
        private readonly gigs: GigsService,
        private readonly notify: NotifyService,
        private readonly library: LibraryService,
    ) {}

    /** A crew's ID from a URL part: its link (the name) or its UUID. */
    async resolve(ref: string): Promise<string> {
        const crew = await this.prisma.crew.findFirst({ where: isUuid(ref) ? { id: ref.toLowerCase() } : { slug: toSlug(ref) }, select: { id: true } });
        if (!crew) throw new NotFoundException('No such crew.');
        return crew.id;
    }

    async list(): Promise<CrewView[]> {
        const rows = await this.prisma.crew.findMany({ include: CREW_INCLUDE, orderBy: { name: 'asc' } });
        return rows.map((c) => toView(c));
    }

    async get(id: string): Promise<CrewView> {
        const crew = await this.prisma.crew.findUnique({ where: { id }, include: CREW_INCLUDE });
        if (!crew) throw new NotFoundException('No such crew.');
        return toView(crew);
    }

    /** The founding runner gets the founder rank. Players found crews with their own runners. */
    async create(user: Me, input: NewCrewInput): Promise<CrewView> {
        if (!canCreateCrew(user)) throw new ForbiddenException();
        const slug = await this.nameSlug(input.name);
        const runner = await this.runner(input.runnerId);
        if (!runner.ownerId || (!user.isAdmin && runner.ownerId !== user.id)) throw new BadRequestException('Found the crew with one of your own runners.');
        if (runner.status !== 'active') throw new BadRequestException(`${runner.handle} is ${runner.status}.`);
        if (!user.isAdmin) {
            const founded = await this.prisma.crew.count({ where: { ownerId: runner.ownerId } });
            checkCount(founded, config.MAX_CREWS_FOUNDED, `you've founded ${config.MAX_CREWS_FOUNDED} crews, the most a player can.`);
            await this.checkRunnerCrews(runner.id, runner.handle);
        }

        const crew = await this.prisma.crew.create({
            data: {
                name: input.name,
                slug,
                tagline: input.tagline,
                ownerId: runner.ownerId,
                ranks: DEFAULT_RANKS,
                members: { create: { runnerId: runner.id, rank: DEFAULT_RANKS[0] } },
            },
        });
        return this.get(crew.id);
    }

    /** Name, tagline, logo and ranks. Renamed ranks keep their runners. Runners in a removed rank drop to the lowest. */
    async update(user: Me, id: string, input: CrewInput): Promise<CrewView> {
        const crew = await this.manage(user, id);
        // A new name means a new link
        const slug = await this.nameSlug(input.name, id);
        if (input.ranks[0].was !== crew.ranks[0]) throw new BadRequestException(`${crew.ranks[0]} stays the top rank. You can rename it.`);
        if (input.imageId && !(await this.library.exists(input.imageId))) throw new BadRequestException('That picture is gone. Upload it again.');

        const ranks = input.ranks.map((r) => r.name);
        const renamed = new Map(input.ranks.filter((r) => r.was).map((r) => [r.was!, r.name]));
        const lowest = ranks[ranks.length - 1];
        await this.prisma.$transaction(async (tx) => {
            await tx.crew.update({ where: { id }, data: { name: input.name, slug, tagline: input.tagline, imageId: input.imageId, ranks } });
            for (const m of crew.members) {
                const rank = renamed.get(m.rank) ?? lowest;
                if (rank !== m.rank) await tx.crewMember.update({ where: { crewId_runnerId: { crewId: id, runnerId: m.id } }, data: { rank } });
            }
        });
        await this.library.refreshUsage([input.imageId, crew.imageId]);
        if (input.name !== crew.name) this.gigs.refresh(await this.gigs.gigsForCrew(id));
        return this.get(id);
    }

    async delete(user: Me, id: string) {
        const crew = await this.manage(user, id);
        const affected = await this.gigs.gigsForCrew(id);
        // Their gig slots become open to anyone (ON DELETE SET NULL)
        await this.prisma.crew.delete({ where: { id } });
        await this.library.refreshUsage([crew.imageId]);
        await this.gigs.refill(affected);
    }

    /** Admins only: puts a runner straight in. Founders invite instead. */
    async addMember(user: Me, id: string, runnerId: string): Promise<CrewView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const crew = await this.get(id);
        const runner = await this.runner(runnerId);
        if (!runner.ownerId) throw new BadRequestException("NPCs can't join a crew.");
        if (runner.status !== 'active') throw new BadRequestException(`${runner.handle} is ${runner.status}.`);
        await this.join(crew, runnerId);
        return this.get(id);
    }

    async setRank(user: Me, id: string, runnerId: string, rank: string): Promise<CrewView> {
        const crew = await this.manage(user, id);
        const member = crew.members.find((m) => m.id === runnerId);
        if (!member) throw new NotFoundException("That runner isn't in the crew.");
        if (!crew.ranks.includes(rank)) throw new BadRequestException('No such rank.');
        if (isFounderRank(crew, member.rank) && !isFounderRank(crew, rank)) checkFounderLeaving(user, crew, member);

        await this.prisma.crewMember.update({ where: { crewId_runnerId: { crewId: id, runnerId } }, data: { rank } });
        return this.get(id);
    }

    /** Founders and admins remove anyone. A runner's own player can take them out, unless they're a founder. */
    async removeMember(user: Me, id: string, runnerId: string): Promise<CrewView> {
        const crew = await this.get(id);
        const member = crew.members.find((m) => m.id === runnerId);
        if (!member) return crew;
        if (!canManageCrew(user, crew) && member.ownerId !== user.id) throw new ForbiddenException();
        if (isFounderRank(crew, member.rank)) checkFounderLeaving(user, crew, member);

        await this.prisma.crewMember.delete({ where: { crewId_runnerId: { crewId: id, runnerId } } });
        return this.get(id);
    }

    // Allies: runners the crew knows and trusts, without them being members

    async addAlly(user: Me, id: string, runnerId: string): Promise<CrewView> {
        const crew = await this.manage(user, id);
        await this.runner(runnerId);
        if (crew.members.some((m) => m.id === runnerId)) throw new ConflictException("They're already in the crew.");
        if (!user.isAdmin && !crew.allies.some((a) => a.id === runnerId)) {
            checkCount(crew.allies.length, config.MAX_CREW_ALLIES, `a crew can have ${config.MAX_CREW_ALLIES} allies at most.`);
        }
        await this.prisma.crewAlly.createMany({ data: [{ crewId: id, runnerId }], skipDuplicates: true });
        return this.get(id);
    }

    /** Founders and admins, or the runner's own player. */
    async removeAlly(user: Me, id: string, runnerId: string): Promise<CrewView> {
        const crew = await this.get(id);
        if (!canManageCrew(user, crew) && (await this.runner(runnerId)).ownerId !== user.id) throw new ForbiddenException();
        await this.prisma.crewAlly.deleteMany({ where: { crewId: id, runnerId } });
        return this.get(id);
    }

    // Invites

    /** Asks a player's runner to join, by DM. `dm` is false when their DMs are closed: they'll still see it on the web. */
    async invite(user: Me, id: string, runnerId: string): Promise<{ dm: boolean }> {
        const crew = await this.manage(user, id);
        const runner = await this.runner(runnerId);
        if (!runner.ownerId) throw new BadRequestException("NPCs can't join a crew.");
        if (runner.status !== 'active') throw new BadRequestException(`${runner.handle} is ${runner.status}.`);
        if (crew.members.some((m) => m.id === runnerId)) throw new ConflictException("They're already in the crew.");
        if (crew.invites.some((r) => r.id === runnerId)) throw new ConflictException('They already have an invite.');
        if (!user.isAdmin) {
            checkCount(crew.invites.length, config.MAX_PENDING_INVITES, `the crew has ${config.MAX_PENDING_INVITES} invites waiting. let some get answered first.`);
            checkCount(crew.members.length, config.MAX_CREW_MEMBERS, `the crew is full: ${config.MAX_CREW_MEMBERS} runners at most.`);
            await this.checkRunnerCrews(runner.id, runner.handle);
            const declined = await this.prisma.crewInviteDecline.findUnique({ where: { crewId_runnerId: { crewId: id, runnerId } } });
            const again = declined && config.INVITE_COOLDOWN_DAYS ? declined.declinedAt.getTime() + config.INVITE_COOLDOWN_DAYS * 86_400_000 : 0;
            if (again > Date.now()) throw new BadRequestException(`${runner.handle} turned down an invite recently. you can ask again ${until(again)}.`);
        }

        await this.prisma.crewInvite.create({ data: { crewId: id, runnerId, invitedBy: user.id } });
        const sent = await this.notify.send('crewInvites', [runner.ownerId], inviteMessage(crew, toCard(runner), user.name, config.PUBLIC_URL));
        return { dm: sent.length > 0 };
    }

    /** Founders and admins cancel. The runner's player declines. */
    async cancelInvite(user: Me, id: string, runnerId: string) {
        const crew = await this.get(id);
        if (!canManageCrew(user, crew) && (await this.runner(runnerId)).ownerId !== user.id) throw new ForbiddenException();
        await this.prisma.crewInvite.deleteMany({ where: { crewId: id, runnerId } });
    }

    /** The runner's player says yes. Used by the web and the DM button, so it takes a user ID. */
    async accept(userId: string, id: string, runnerId: string): Promise<Said> {
        const crew = await this.get(id);
        await this.checkInvite(userId, crew, runnerId);
        const runner = await this.runner(runnerId);
        checkCount(crew.members.length, config.MAX_CREW_MEMBERS, `${crew.name} is full: ${config.MAX_CREW_MEMBERS} runners at most.`);
        await this.checkRunnerCrews(runnerId, runner.handle);
        await this.join(crew, runnerId);
        return voice.crewJoined(crew.name, (await this.runner(runnerId)).handle);
    }

    async decline(userId: string, id: string, runnerId: string): Promise<Said> {
        const crew = await this.get(id);
        await this.checkInvite(userId, crew, runnerId);
        await this.prisma.crewInvite.deleteMany({ where: { crewId: id, runnerId } });
        // The crew waits INVITE_COOLDOWN_DAYS before asking again
        await this.prisma.crewInviteDecline.upsert({
            where: { crewId_runnerId: { crewId: id, runnerId } },
            create: { crewId: id, runnerId },
            update: { declinedAt: new Date() },
        });
        return voice.crewDeclined(crew.name);
    }

    /** Invites waiting on one of the player's runners. */
    async invitesFor(userId: string): Promise<CrewInvite[]> {
        const rows = await this.prisma.crewInvite.findMany({ where: { runner: { ownerId: userId } }, include: { crew: true, runner: true }, orderBy: { createdAt: 'asc' } });
        return rows.map((i) => ({
            crew: { id: i.crew.id, slug: i.crew.slug, name: i.crew.name, tagline: i.crew.tagline },
            runner: toCard(i.runner),
            invitedBy: this.members.member(i.invitedBy),
            createdAt: i.createdAt.getTime(),
        }));
    }

    /** Crews a runner is in. Read before deleting the runner, for keepFounders. */
    async crewsOf(runnerId: string): Promise<string[]> {
        return (await this.prisma.crewMember.findMany({ where: { runnerId }, select: { crewId: true } })).map((m) => m.crewId);
    }

    /** After a runner is deleted: a crew left without a founder promotes its highest ranked runner. */
    async keepFounders(crewIds: string[]) {
        for (const id of crewIds) {
            const crew = await this.get(id);
            if (!crew.members.length || crew.members.some((m) => isFounderRank(crew, m.rank))) continue;
            await this.prisma.crewMember.update({ where: { crewId_runnerId: { crewId: id, runnerId: crew.members[0].id } }, data: { rank: crew.ranks[0] } });
        }
    }

    /** Adds a member at the lowest rank, clearing any ally entry or invite. Nobody is told: the crew page shows it. */
    private async join(crew: CrewView, runnerId: string) {
        await this.prisma.$transaction(async (tx) => {
            await tx.crewMember.createMany({ data: [{ crewId: crew.id, runnerId, rank: crew.ranks[crew.ranks.length - 1] }], skipDuplicates: true });
            await tx.crewAlly.deleteMany({ where: { crewId: crew.id, runnerId } });
            await tx.crewInvite.deleteMany({ where: { crewId: crew.id, runnerId } });
        });
        // They may now fit a crew slot they were waiting on
        await this.gigs.refill(await this.gigs.gigsForCrew(crew.id));
    }

    private async checkInvite(userId: string, crew: CrewView, runnerId: string) {
        if (!crew.invites.some((r) => r.id === runnerId)) throw new NotFoundException('That invite is gone.');
        if ((await this.runner(runnerId)).ownerId !== userId) throw new ForbiddenException();
    }

    /** The crew, if the user can run it. */
    /**
     * The crew's logo (or one just uploaded for it) in another frame, for the edit form to save.
     * Founders and admins only.
     */
    async frame(user: Me, id: string, imageId: string, variant: number): Promise<{ imageId: string }> {
        const crew = await this.manage(user, id);
        const image = await this.prisma.image.findUnique({ where: { id: imageId }, select: { createdBy: true } });
        if (!image || (imageId !== crew.imageId && image.createdBy !== user.id)) throw new ForbiddenException();
        if (!user.isAdmin) {
            checkCount(this.frameChanges.count(id), config.MAX_FRAME_CHANGES_PER_DAY, `that's ${config.MAX_FRAME_CHANGES_PER_DAY} frame changes today. try again tomorrow.`);
        }
        const copy = await this.library.reframe(user, imageId, variant);
        if (copy !== imageId) this.frameChanges.hit(id);
        return { imageId: copy };
    }

    /** MAX_CREWS_PER_RUNNER, checked before they join or are asked to. */
    /**
     * Founders spend the crew's HQ IP (a negative amount), saying what on. Admins can also add
     * some (positive) or take it away. Nobody can spend more than the crew has.
     */
    async hq(user: Me, id: string, input: HqInput): Promise<CrewView> {
        const crew = await this.manage(user, id);
        if (input.amount > 0 && !user.isAdmin) throw new ForbiddenException('Crews earn HQ IP on gigs. Only admins can add it.');
        checkIp(Math.abs(input.amount), 'HQ IP');
        await this.prisma.$transaction(async (tx) => {
            const { _sum } = await tx.crewHqEntry.aggregate({ where: { crewId: id }, _sum: { amount: true } });
            const balance = _sum.amount ?? 0;
            if (balance + input.amount < 0) throw new BadRequestException(`${crew.name} has ${balance} HQ IP to spend.`);
            await tx.crewHqEntry.create({ data: { crewId: id, amount: input.amount, note: input.note, byUserId: user.id, byName: user.name } });
        });
        return this.get(id);
    }

    private async checkRunnerCrews(runnerId: string, handle: string) {
        const crews = await this.prisma.crewMember.count({ where: { runnerId } });
        checkCount(crews, config.MAX_CREWS_PER_RUNNER, `${handle} is in ${config.MAX_CREWS_PER_RUNNER} crews already, the most a runner can be.`);
    }

    private async manage(user: Me, id: string): Promise<CrewView> {
        const crew = await this.get(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();
        return crew;
    }

    private async runner(id: string) {
        const runner = await this.prisma.runner.findUnique({ where: { id } });
        if (!runner) throw new NotFoundException('No such runner.');
        return runner;
    }

    /**
     * A crew name's link. Names are one of a kind, so two that would make the same link
     * ("Static Wolves" and "static wolves!") can't both exist. `except` is the crew being renamed.
     */
    private async nameSlug(name: string, except?: string): Promise<string> {
        const slug = toSlug(name);
        if (!isFreeSlugWord(slug)) throw new BadRequestException("That name can't be used. It needs a letter in it, and can't be new, edit, mine or invites.");
        const other = await this.prisma.crew.findUnique({ where: { slug }, select: { id: true } });
        if (other && other.id !== except) throw new ConflictException("That name's taken. Crew names are one of a kind.");
        return slug;
    }
}

/** A founder can't step down or leave on their own, and the last one can't go at all. */
function checkFounderLeaving(user: Me, crew: CrewView, member: CrewMember) {
    const founder = crew.ranks[0];
    if (!user.isAdmin && member.ownerId === user.id) throw new BadRequestException(`You can't stop being ${founder} yourself. Another ${founder} can do it.`);
    if (crew.members.filter((m) => isFounderRank(crew, m.rank)).length <= 1) throw new BadRequestException(`A crew needs at least one ${founder}.`);
}

function toView(crew: CrewRow): CrewView {
    const ranks = stringList(crew.ranks);
    const byHandle = (a: { handle: string }, b: { handle: string }) => a.handle.localeCompare(b.handle);
    // Ranks that no longer exist sort last
    const order = (rank: string) => (ranks.includes(rank) ? ranks.indexOf(rank) : ranks.length);

    return {
        id: crew.id,
        slug: crew.slug,
        name: crew.name,
        tagline: crew.tagline,
        imageId: crew.imageId,
        ranks,
        members: crew.members.map((m) => ({ ...toCard(m.runner), rank: m.rank })).sort((a, b) => order(a.rank) - order(b.rank) || byHandle(a, b)),
        allies: crew.allies.map((a) => toCard(a.runner)).sort(byHandle),
        invites: crew.invites.map((i) => toCard(i.runner)),
        gigs: [...new Map(crew.slots.map((s) => [s.gig.id, s.gig])).values()]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((g) => ({ id: g.id, ref: gigRef(g), name: g.name, status: g.status, sessionAt: g.sessionAt?.getTime() ?? null, imageId: g.imageId })),
        hqIp: crew.hqEntries.reduce((sum, e) => sum + e.amount, 0),
        hqLog: crew.hqEntries.slice(0, HQ_LOG).map((e) => ({ id: e.id, amount: e.amount, gig: e.gig && { ref: gigRef(e.gig), name: e.gig.name }, note: e.note, by: e.byName, at: e.createdAt.getTime() })),
    };
}

