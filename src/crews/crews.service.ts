import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { config } from '../config';
import { DB, Db } from '../db/db';
import { crewAllies, crewInvites, crewMembers, crews, runners } from '../db/schema';
import { inviteMessage } from '../discord/crew-messages';
import { MembersService } from '../discord/members.service';
import { voice } from '../discord/voice';
import { GigsService, toCard } from '../gigs/gigs.service';
import { canCreateCrew, canManageCrew, isFounderRank } from '../shared/permissions';
import { type CrewInput, type CrewInvite, type CrewMember, type CrewView, DEFAULT_RANKS, type Me, type NewCrewInput } from '../shared/schemas';

/**
 * Crews are groups of runners with ranks. Whoever holds the first rank (Founder unless
 * renamed) runs the crew, along with admins. There's always at least one founder.
 * Founders invite runners (their player answers by DM or on the web) and keep a list of
 * allies. Crew slots on gigs go to the crew's runners.
 */
@Injectable()
export class CrewsService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly members: MembersService,
        private readonly gigs: GigsService,
    ) {}

    list(): CrewView[] {
        return this.db.query.crews
            .findMany({ with: WITH, orderBy: crews.name })
            .sync()
            .map((c) => this.toView(c));
    }

    get(id: number): CrewView {
        const crew = this.db.query.crews.findFirst({ where: eq(crews.id, id), with: WITH }).sync();
        if (!crew) throw new NotFoundException('No such crew.');
        return this.toView(crew);
    }

    /** The founding runner gets the founder rank. Players found crews with their own runners. */
    create(user: Me, input: NewCrewInput): CrewView {
        if (!canCreateCrew(user)) throw new ForbiddenException();
        this.checkName(input.name);
        const runner = this.runner(input.runnerId);
        if (!runner.ownerId || (!user.isAdmin && runner.ownerId !== user.id)) throw new BadRequestException('Found the crew with one of your own runners.');

        const id = this.db.transaction((tx) => {
            const [crew] = tx.insert(crews).values({ name: input.name, tagline: input.tagline, ownerId: runner.ownerId!, ranks: DEFAULT_RANKS }).returning().all();
            tx.insert(crewMembers).values({ crewId: crew.id, runnerId: runner.id, rank: DEFAULT_RANKS[0] }).run();
            return crew.id;
        });
        return this.get(id);
    }

    /** Name, tagline and ranks. Renamed ranks keep their runners. Runners in a removed rank drop to the lowest. */
    update(user: Me, id: number, input: CrewInput): CrewView {
        const crew = this.manage(user, id);
        this.checkName(input.name, id);
        if (input.ranks[0].was !== crew.ranks[0]) throw new BadRequestException(`${crew.ranks[0]} stays the top rank. You can rename it.`);

        const ranks = input.ranks.map((r) => r.name);
        const renamed = new Map(input.ranks.filter((r) => r.was).map((r) => [r.was!, r.name]));
        const lowest = ranks[ranks.length - 1];
        this.db.transaction((tx) => {
            tx.update(crews).set({ name: input.name, tagline: input.tagline, ranks }).where(eq(crews.id, id)).run();
            for (const m of crew.members) {
                const rank = renamed.get(m.rank) ?? lowest;
                if (rank !== m.rank) tx.update(crewMembers).set({ rank }).where(and(eq(crewMembers.crewId, id), eq(crewMembers.runnerId, m.id))).run();
            }
        });
        if (input.name !== crew.name) this.gigs.refresh(this.gigs.gigsForCrew(id));
        return this.get(id);
    }

    delete(user: Me, id: number) {
        this.manage(user, id);
        const affected = this.gigs.gigsForCrew(id);
        // Their gig slots become open to anyone (ON DELETE SET NULL)
        this.db.delete(crews).where(eq(crews.id, id)).run();
        this.gigs.refill(affected);
    }

    /** Admins only: puts a runner straight in. Founders invite instead. */
    addMember(user: Me, id: number, runnerId: number): CrewView {
        if (!user.isAdmin) throw new ForbiddenException();
        const crew = this.get(id);
        if (!this.runner(runnerId).ownerId) throw new BadRequestException("NPCs can't join a crew.");
        this.join(crew, runnerId);
        return this.get(id);
    }

    setRank(user: Me, id: number, runnerId: number, rank: string): CrewView {
        const crew = this.manage(user, id);
        const member = crew.members.find((m) => m.id === runnerId);
        if (!member) throw new NotFoundException("That runner isn't in the crew.");
        if (!crew.ranks.includes(rank)) throw new BadRequestException('No such rank.');
        if (isFounderRank(crew, member.rank) && !isFounderRank(crew, rank)) this.checkFounderLeaving(user, crew, member);

        this.db
            .update(crewMembers)
            .set({ rank })
            .where(and(eq(crewMembers.crewId, id), eq(crewMembers.runnerId, runnerId)))
            .run();
        return this.get(id);
    }

    /** Founders and admins remove anyone. A runner's own player can take them out, unless they're a founder. */
    removeMember(user: Me, id: number, runnerId: number): CrewView {
        const crew = this.get(id);
        const member = crew.members.find((m) => m.id === runnerId);
        if (!member) return crew;
        if (!canManageCrew(user, crew) && member.ownerId !== user.id) throw new ForbiddenException();
        if (isFounderRank(crew, member.rank)) this.checkFounderLeaving(user, crew, member);

        this.db
            .delete(crewMembers)
            .where(and(eq(crewMembers.crewId, id), eq(crewMembers.runnerId, runnerId)))
            .run();
        return this.get(id);
    }

    // Allies: runners the crew knows and trusts, without them being members

    addAlly(user: Me, id: number, runnerId: number): CrewView {
        const crew = this.manage(user, id);
        this.runner(runnerId);
        if (crew.members.some((m) => m.id === runnerId)) throw new ConflictException("They're already in the crew.");
        this.db.insert(crewAllies).values({ crewId: id, runnerId }).onConflictDoNothing().run();
        return this.get(id);
    }

    /** Founders and admins, or the runner's own player. */
    removeAlly(user: Me, id: number, runnerId: number): CrewView {
        const crew = this.get(id);
        if (!canManageCrew(user, crew) && this.runner(runnerId).ownerId !== user.id) throw new ForbiddenException();
        this.db
            .delete(crewAllies)
            .where(and(eq(crewAllies.crewId, id), eq(crewAllies.runnerId, runnerId)))
            .run();
        return this.get(id);
    }

    // Invites

    /** Asks a player's runner to join, by DM. `dm` is false when their DMs are closed: they'll still see it on the web. */
    async invite(user: Me, id: number, runnerId: number): Promise<{ dm: boolean }> {
        const crew = this.manage(user, id);
        const runner = this.runner(runnerId);
        if (!runner.ownerId) throw new BadRequestException("NPCs can't join a crew.");
        if (crew.members.some((m) => m.id === runnerId)) throw new ConflictException("They're already in the crew.");
        if (crew.invites.some((r) => r.id === runnerId)) throw new ConflictException('They already have an invite.');

        this.db.insert(crewInvites).values({ crewId: id, runnerId, invitedBy: user.id }).run();
        const failed = await this.members.dm([runner.ownerId], inviteMessage(crew, toCard(runner), user.name, config.PUBLIC_URL));
        return { dm: !failed.length };
    }

    /** Founders and admins cancel. The runner's player declines. */
    cancelInvite(user: Me, id: number, runnerId: number) {
        const crew = this.get(id);
        if (!canManageCrew(user, crew) && this.runner(runnerId).ownerId !== user.id) throw new ForbiddenException();
        this.db
            .delete(crewInvites)
            .where(and(eq(crewInvites.crewId, id), eq(crewInvites.runnerId, runnerId)))
            .run();
    }

    /** The runner's player says yes. Used by the web and the DM button, so it takes a user ID. */
    accept(userId: string, id: number, runnerId: number): string {
        const crew = this.get(id);
        this.checkInvite(userId, crew, runnerId);
        this.join(crew, runnerId);
        return voice.crewJoined(crew.name, this.runner(runnerId).handle);
    }

    decline(userId: string, id: number, runnerId: number): string {
        const crew = this.get(id);
        this.checkInvite(userId, crew, runnerId);
        this.db
            .delete(crewInvites)
            .where(and(eq(crewInvites.crewId, id), eq(crewInvites.runnerId, runnerId)))
            .run();
        return voice.crewDeclined(crew.name);
    }

    /** Invites waiting on one of the player's runners. */
    invitesFor(userId: string): CrewInvite[] {
        const mine = this.db.select().from(runners).where(eq(runners.ownerId, userId)).all();
        if (!mine.length) return [];
        const byId = new Map(mine.map((r) => [r.id, r]));
        return this.db.query.crewInvites
            .findMany({ where: inArray(crewInvites.runnerId, [...byId.keys()]), with: { crew: true } })
            .sync()
            .map((i) => ({
                crew: { id: i.crew.id, name: i.crew.name, tagline: i.crew.tagline },
                runner: toCard(byId.get(i.runnerId)!),
                invitedBy: this.members.member(i.invitedBy),
                createdAt: i.createdAt.getTime(),
            }));
    }

    /** Crews a runner is in. Read before deleting the runner, for keepFounders. */
    crewsOf(runnerId: number): number[] {
        return this.db.select({ id: crewMembers.crewId }).from(crewMembers).where(eq(crewMembers.runnerId, runnerId)).all().map((r) => r.id);
    }

    /** After a runner is deleted: a crew left without a founder promotes its highest ranked runner. */
    keepFounders(crewIds: number[]) {
        for (const id of crewIds) {
            const crew = this.get(id);
            if (!crew.members.length || crew.members.some((m) => isFounderRank(crew, m.rank))) continue;
            this.db
                .update(crewMembers)
                .set({ rank: crew.ranks[0] })
                .where(and(eq(crewMembers.crewId, id), eq(crewMembers.runnerId, crew.members[0].id)))
                .run();
        }
    }

    /** Adds a member at the lowest rank, clearing any ally entry or invite. */
    private join(crew: CrewView, runnerId: number) {
        const where = <T extends typeof crewAllies | typeof crewInvites>(t: T) => and(eq(t.crewId, crew.id), eq(t.runnerId, runnerId));
        this.db.transaction((tx) => {
            tx.insert(crewMembers)
                .values({ crewId: crew.id, runnerId, rank: crew.ranks[crew.ranks.length - 1] })
                .onConflictDoNothing()
                .run();
            tx.delete(crewAllies).where(where(crewAllies)).run();
            tx.delete(crewInvites).where(where(crewInvites)).run();
        });
        // They may now fit a crew slot they were waiting on
        this.gigs.refill(this.gigs.gigsForCrew(crew.id));
    }

    /** A founder can't step down or leave on their own, and the last one can't go at all. */
    private checkFounderLeaving(user: Me, crew: CrewView, member: CrewMember) {
        const founder = crew.ranks[0];
        if (!user.isAdmin && member.ownerId === user.id) throw new BadRequestException(`You can't stop being ${founder} yourself. Another ${founder} can do it.`);
        if (crew.members.filter((m) => isFounderRank(crew, m.rank)).length <= 1) throw new BadRequestException(`A crew needs at least one ${founder}.`);
    }

    private checkInvite(userId: string, crew: CrewView, runnerId: number) {
        if (!crew.invites.some((r) => r.id === runnerId)) throw new NotFoundException('That invite is gone.');
        if (this.runner(runnerId).ownerId !== userId) throw new ForbiddenException();
    }

    /** The crew, if the user can run it. */
    private manage(user: Me, id: number): CrewView {
        const crew = this.get(id);
        if (!canManageCrew(user, crew)) throw new ForbiddenException();
        return crew;
    }

    private runner(id: number) {
        const runner = this.db.query.runners.findFirst({ where: eq(runners.id, id) }).sync();
        if (!runner) throw new NotFoundException('No such runner.');
        return runner;
    }

    private checkName(name: string, id?: number) {
        const taken = this.db.query.crews.findFirst({ where: eq(crews.name, name) }).sync();
        if (taken && taken.id !== id) throw new ConflictException('That name is taken.');
    }

    private toView(crew: CrewRow): CrewView {
        const ids = [...crew.members, ...crew.allies, ...crew.invites].map((m) => m.runnerId);
        const cards = new Map((ids.length ? this.db.query.runners.findMany({ where: inArray(runners.id, ids) }).sync() : []).map((r) => [r.id, toCard(r)]));
        const known = <T extends { runnerId: number }>(rows: T[]) => rows.filter((r) => cards.has(r.runnerId));
        const byHandle = (a: { handle: string }, b: { handle: string }) => a.handle.localeCompare(b.handle);
        // Ranks that no longer exist sort last
        const order = (rank: string) => (crew.ranks.includes(rank) ? crew.ranks.indexOf(rank) : crew.ranks.length);

        return {
            id: crew.id,
            name: crew.name,
            tagline: crew.tagline,
            ranks: crew.ranks,
            members: known(crew.members)
                .map((m) => ({ ...cards.get(m.runnerId)!, rank: m.rank }))
                .sort((a, b) => order(a.rank) - order(b.rank) || byHandle(a, b)),
            allies: known(crew.allies)
                .map((a) => cards.get(a.runnerId)!)
                .sort(byHandle),
            invites: known(crew.invites).map((i) => cards.get(i.runnerId)!),
        };
    }
}

const WITH = { members: true, allies: true, invites: true } as const;

type CrewRow = typeof crews.$inferSelect & {
    members: { runnerId: number; rank: string }[];
    allies: { runnerId: number }[];
    invites: { runnerId: number }[];
};
