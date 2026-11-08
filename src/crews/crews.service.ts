import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { inviteMessage } from '../discord/crew-messages';
import { MembersService } from '../discord/members.service';
import { linked, NotifyService } from '../discord/notify.service';
import { type Said, voice } from '../discord/voice';
import { GigsService, toCard } from '../gigs/gigs.service';
import { stringList } from '../prisma/json';
import { PrismaService } from '../prisma/prisma.service';
import { canCreateCrew, canManageCrew, isFounderRank } from '../shared/permissions';
import { type CrewInput, type CrewInvite, type CrewMember, type CrewView, DEFAULT_RANKS, type Me, type NewCrewInput } from '../shared/schemas';
import { gigRef, isFreeSlugWord, isUuid, toSlug } from '../shared/slug';

const CREW_INCLUDE = {
    members: { include: { runner: true } },
    allies: { include: { runner: true } },
    invites: { include: { runner: true }, orderBy: { createdAt: 'asc' } },
    // Gigs with slots for the crew. Only posted ones, so nobody sees an unposted gig they shouldn't
    slots: { where: { gig: { status: { notIn: ['draft', 'pending', 'rejected'] } } }, select: { gig: true } },
} as const satisfies Prisma.CrewInclude;
type CrewRow = Prisma.CrewGetPayload<{ include: typeof CREW_INCLUDE }>;

/**
 * Crews are groups of runners with ranks. Whoever holds the first rank (Founder unless
 * renamed) runs the crew, along with admins. There's always at least one founder.
 * Founders invite runners (their player answers by DM or on the web) and keep a list of
 * allies. Crew slots on gigs go to the crew's runners.
 */
@Injectable()
export class CrewsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly members: MembersService,
        private readonly gigs: GigsService,
        private readonly notify: NotifyService,
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

    /** Name, tagline and ranks. Renamed ranks keep their runners. Runners in a removed rank drop to the lowest. */
    async update(user: Me, id: string, input: CrewInput): Promise<CrewView> {
        const crew = await this.manage(user, id);
        // A new name means a new link
        const slug = await this.nameSlug(input.name, id);
        if (input.ranks[0].was !== crew.ranks[0]) throw new BadRequestException(`${crew.ranks[0]} stays the top rank. You can rename it.`);

        const ranks = input.ranks.map((r) => r.name);
        const renamed = new Map(input.ranks.filter((r) => r.was).map((r) => [r.was!, r.name]));
        const lowest = ranks[ranks.length - 1];
        await this.prisma.$transaction(async (tx) => {
            await tx.crew.update({ where: { id }, data: { name: input.name, slug, tagline: input.tagline, ranks } });
            for (const m of crew.members) {
                const rank = renamed.get(m.rank) ?? lowest;
                if (rank !== m.rank) await tx.crewMember.update({ where: { crewId_runnerId: { crewId: id, runnerId: m.id } }, data: { rank } });
            }
        });
        if (input.name !== crew.name) this.gigs.refresh(await this.gigs.gigsForCrew(id));
        return this.get(id);
    }

    async delete(user: Me, id: string) {
        await this.manage(user, id);
        const affected = await this.gigs.gigsForCrew(id);
        // Their gig slots become open to anyone (ON DELETE SET NULL)
        await this.prisma.crew.delete({ where: { id } });
        await this.gigs.refill(affected);
    }

    /** Admins only: puts a runner straight in. Founders invite instead. */
    async addMember(user: Me, id: string, runnerId: string): Promise<CrewView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const crew = await this.get(id);
        const runner = await this.runner(runnerId);
        if (!runner.ownerId) throw new BadRequestException("NPCs can't join a crew.");
        if (runner.status !== 'active') throw new BadRequestException(`${runner.handle} is ${runner.status}.`);
        await this.join(crew, runnerId, user.id);
        return this.get(id);
    }

    async setRank(user: Me, id: string, runnerId: string, rank: string): Promise<CrewView> {
        const crew = await this.manage(user, id);
        const member = crew.members.find((m) => m.id === runnerId);
        if (!member) throw new NotFoundException("That runner isn't in the crew.");
        if (!crew.ranks.includes(rank)) throw new BadRequestException('No such rank.');
        if (isFounderRank(crew, member.rank) && !isFounderRank(crew, rank)) checkFounderLeaving(user, crew, member);

        await this.prisma.crewMember.update({ where: { crewId_runnerId: { crewId: id, runnerId } }, data: { rank } });
        if (member.ownerId !== user.id && member.rank !== rank) {
            this.notify.fire('crewChanges', [member.ownerId], linked(voice.crewRank(crew.name, member.handle, rank), 'See the crew', crewLink(crew)));
        }
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
        // Taken out by someone else, or left
        const others = crew.members.filter((m) => m.id !== runnerId).map((m) => m.ownerId);
        const removed = member.ownerId !== user.id;
        const said = removed ? voice.crewRemoved(crew.name, member.handle) : voice.crewMemberLeft(crew.name, member.handle);
        this.notify.fire('crewChanges', [...others, ...(removed ? [member.ownerId] : [])].filter((o) => o !== user.id), linked(said, 'See the crew', crewLink(crew)));
        return this.get(id);
    }

    // Allies: runners the crew knows and trusts, without them being members

    async addAlly(user: Me, id: string, runnerId: string): Promise<CrewView> {
        const crew = await this.manage(user, id);
        await this.runner(runnerId);
        if (crew.members.some((m) => m.id === runnerId)) throw new ConflictException("They're already in the crew.");
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
        await this.join(crew, runnerId, userId);
        return voice.crewJoined(crew.name, (await this.runner(runnerId)).handle);
    }

    async decline(userId: string, id: string, runnerId: string): Promise<Said> {
        const crew = await this.get(id);
        await this.checkInvite(userId, crew, runnerId);
        const invite = await this.prisma.crewInvite.findUnique({ where: { crewId_runnerId: { crewId: id, runnerId } }, include: { runner: true } });
        await this.prisma.crewInvite.deleteMany({ where: { crewId: id, runnerId } });
        if (invite && invite.invitedBy !== userId) {
            this.notify.fire('crewChanges', [invite.invitedBy], linked(voice.inviteDeclined(crew.name, invite.runner.handle), 'See the crew', crewLink(crew)));
        }
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

    /** Adds a member at the lowest rank, clearing any ally entry or invite. */
    /** `by`: who did it, the runner's player accepting or an admin putting them in. They don't hear about it. */
    private async join(crew: CrewView, runnerId: string, by: string) {
        await this.prisma.$transaction(async (tx) => {
            await tx.crewMember.createMany({ data: [{ crewId: crew.id, runnerId, rank: crew.ranks[crew.ranks.length - 1] }], skipDuplicates: true });
            await tx.crewAlly.deleteMany({ where: { crewId: crew.id, runnerId } });
            await tx.crewInvite.deleteMany({ where: { crewId: crew.id, runnerId } });
        });
        // They may now fit a crew slot they were waiting on
        await this.gigs.refill(await this.gigs.gigsForCrew(crew.id));

        const runner = await this.runner(runnerId);
        const others = crew.members.map((m) => m.ownerId).filter((o) => o !== runner.ownerId && o !== by);
        this.notify.fire('crewChanges', others, linked(voice.crewMemberJoined(crew.name, runner.handle), 'See the crew', crewLink(crew)));
        if (by !== runner.ownerId) this.notify.fire('crewChanges', [runner.ownerId], linked(voice.crewAdded(crew.name, runner.handle), 'See the crew', crewLink(crew)));
    }

    private async checkInvite(userId: string, crew: CrewView, runnerId: string) {
        if (!crew.invites.some((r) => r.id === runnerId)) throw new NotFoundException('That invite is gone.');
        if ((await this.runner(runnerId)).ownerId !== userId) throw new ForbiddenException();
    }

    /** The crew, if the user can run it. */
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
        ranks,
        members: crew.members.map((m) => ({ ...toCard(m.runner), rank: m.rank })).sort((a, b) => order(a.rank) - order(b.rank) || byHandle(a, b)),
        allies: crew.allies.map((a) => toCard(a.runner)).sort(byHandle),
        invites: crew.invites.map((i) => toCard(i.runner)),
        gigs: [...new Map(crew.slots.map((s) => [s.gig.id, s.gig])).values()]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((g) => ({ id: g.id, ref: gigRef(g), name: g.name, status: g.status, sessionAt: g.sessionAt?.getTime() ?? null })),
    };
}

/** A crew's page on the board. */
const crewLink = (crew: { slug: string }) => `${config.PUBLIC_URL}/crews/${crew.slug}`;
