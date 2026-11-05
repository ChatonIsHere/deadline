import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Once } from 'necord';
import { PrefsService } from '../auth/prefs.service';
import { config } from '../config';
import { DB, Db } from '../db/db';
import { crewMembers, crews, fixerRatings, gigObjectives, gigReserves, gigRewards, gigs, gigSlots, runners } from '../db/schema';
import { GigPostService } from '../discord/gig-post.service';
import { MembersService } from '../discord/members.service';
import { voice } from '../discord/voice';
import { LibraryService } from '../library/library.service';
import { canCreateGig, canDeleteGig, canEditGig, canSeeGig, NEXT_STATUSES } from '../shared/permissions';
import { type GigInput, type GigStatus, type GigView, LIVE_STATUSES, type Me, type RunnerCard, type RunnerState } from '../shared/schemas';
import { SettingsService } from '../settings/settings.service';
import { confirmDeadline, sessionWork } from './sessions';
import { diffSlots, fillFromReserves, pickSlot } from './slots';

export const ACTIVE = LIVE_STATUSES;
const SWEEP_MS = 6 * 60 * 60 * 1000;
/** How often reminders, nudges and no-response drops are checked. */
const CLOCK_MS = 60 * 1000;

/** A slot's fields for a runner who has just been asked to confirm. */
const asked = () => ({ state: 'awaiting' as const, askedAt: new Date(), nudged: false });
/** A slot's fields once its runner is gone. */
const emptied = { userId: null, runnerId: null, state: 'interested' as const, askedAt: null, nudged: false };
const GIG_WITH = { objectives: true, slots: { with: { crew: true } }, reserves: true, rewards: true } as const;

type Runner = typeof runners.$inferSelect;

export const toCard = (r: Runner): RunnerCard => ({
    id: r.id,
    // Old rows get one on startup (RunnersService); the numeric ID works in URLs too
    slug: r.slug ?? String(r.id),
    handle: r.handle,
    role: r.role,
    extraRoles: r.extraRoles,
    imageId: r.imageId,
    ownerId: r.ownerId,
});

/**
 * Every change to a gig goes through here, from the web and from Discord buttons.
 * Players sign up with one of their runners; the player (userId) is who gets DMs and
 * the "one runner per player" check, the runner is who shows on the gig.
 */
@Injectable()
export class GigsService {
    private readonly logger = new Logger(GigsService.name);
    /** Post updates per gig, run one at a time so an older state never lands last. */
    private readonly postQueue = new Map<number, Promise<void>>();
    private readonly timers: NodeJS.Timeout[] = [];

    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly members: MembersService,
        private readonly posts: GigPostService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        private readonly prefs: PrefsService,
    ) {}

    list(user: Me): GigView[] {
        const rows = this.db.query.gigs.findMany({ with: GIG_WITH }).sync();
        return rows
            .filter((g) => canSeeGig(user, g))
            .map((g) => this.toView(g, user.id))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    get(user: Me, id: number): GigView {
        const gig = this.view(id, user.id);
        if (!canSeeGig(user, { ...gig, createdBy: gig.createdBy.id })) throw new NotFoundException();
        return gig;
    }

    create(user: Me, input: GigInput): GigView {
        if (!canCreateGig(user)) throw new ForbiddenException();
        const status: GigStatus = user.isAdmin ? 'open' : 'pending';

        const id = this.db.transaction((tx) => {
            const { objectives, slots, ...fields } = this.prepare(user, input);
            const [gig] = tx
                .insert(gigs)
                .values({ ...fields, status, createdBy: user.id })
                .returning({ id: gigs.id })
                .all();
            this.writeObjectives(tx, gig.id, objectives);
            this.writeSlots(tx, gig.id, slots);
            return gig.id;
        });

        this.post(id);
        return this.view(id, user.id);
    }

    update(user: Me, id: number, input: GigInput): GigView {
        const gig = this.row(id);
        if (!canEditGig(user, gig)) throw new ForbiddenException();

        this.db.transaction((tx) => {
            const { objectives, slots, ...fields } = this.prepare(user, input);
            tx.update(gigs).set(fields).where(eq(gigs.id, id)).run();
            tx.delete(gigObjectives).where(eq(gigObjectives.gigId, id)).run();
            this.writeObjectives(tx, id, objectives);
            this.writeSlots(tx, id, slots);
        });

        // More slots can mean room for reserves
        this.afterRemoval(id);
        return this.view(id, user.id);
    }

    delete(user: Me, id: number) {
        const gig = this.row(id);
        if (!canDeleteGig(user, gig)) throw new ForbiddenException();
        this.db.delete(gigs).where(eq(gigs.id, id)).run();
    }

    approve(user: Me, id: number, approved: boolean): GigView {
        const gig = this.row(id);
        if (!user.isAdmin) throw new ForbiddenException();
        if (gig.status !== 'pending') throw new BadRequestException('Only pending gigs can be approved or rejected.');

        this.db
            .update(gigs)
            .set({ status: approved ? 'open' : 'rejected' })
            .where(eq(gigs.id, id))
            .run();
        this.post(id);
        return this.view(id, user.id);
    }

    /** Lock or reopen sign-ups, or cancel. Completing goes through DebriefService. */
    setStatus(user: Me, id: number, status: GigStatus): GigView {
        const gig = this.row(id);
        if (!user.isAdmin) throw new ForbiddenException();
        if (status === 'completed') throw new BadRequestException('Complete a gig with its debrief form.');
        if (!NEXT_STATUSES[gig.status].includes(status)) throw new BadRequestException(`Can't go from ${gig.status} to ${status}.`);

        this.db.update(gigs).set({ status }).where(eq(gigs.id, id)).run();
        if (status === 'cancelled') this.clearReserves(id);
        this.post(id, { note: voice.statusChanged[status] });
        return this.view(id, user.id);
    }

    /** A finished gig has no one waiting for a slot. */
    clearReserves(id: number) {
        this.db.delete(gigReserves).where(eq(gigReserves.gigId, id)).run();
    }

    // Runners and sessions
    //
    // Before a session time is set, joining marks a runner interested and takes a slot.
    // Once a time is set, everyone in a slot is asked to confirm (awaiting) and new
    // runners are confirmed as they join. Full gigs put people on reserves, and any
    // slot that frees up goes to the oldest reserve who can take it.

    /**
     * A player signs up (from the post's button or the web). Confirms them if they were
     * asked to. A player with several runners has to say which one.
     */
    async join(userId: string, id: number, runnerId?: number): Promise<string> {
        const me = await this.members.me(userId);
        if (!me?.isEdgerunner) throw new ForbiddenException(voice.notRunner);

        const slot = this.slotOf(id, userId);
        if (slot?.state === 'awaiting') return this.confirm(userId, id);
        if (this.row(id).status !== 'open') throw new BadRequestException(voice.notOpen);

        const added = this.add(this.pickRunner(userId, runnerId), id, false);
        if (added.reserve) return voice.reserve(added.reserve);
        return added.state === 'interested' ? voice.interested() : voice.joined(added.left);
    }

    /**
     * The player's runners, when they need to pick one to sign up with. Empty means no
     * choice is needed (or joining will fail anyway, which join() then explains).
     */
    runnerChoices(userId: string, id: number): RunnerCard[] {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.id, id) }).sync();
        if (gig?.status !== 'open' || !this.members.isEdgerunner(userId)) return [];
        if (this.slotOf(id, userId) || this.isReserve(id, userId)) return [];
        const mine = this.runnersOf(userId);
        return mine.length > 1 ? mine.map(toCard) : [];
    }

    /** Admin puts a runner on a gig. Same as them joining, except they're asked to confirm a set time. */
    async assign(user: Me, id: number, runnerId: number): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const runner = this.db.query.runners.findFirst({ where: eq(runners.id, runnerId) }).sync();
        const player = runner?.ownerId ? await this.members.me(runner.ownerId) : null;
        if (!runner || !player?.isEdgerunner) throw new BadRequestException("Only runners whose player has the edgerunner role can go on a gig.");
        this.add(runner, id, true);
        return this.view(id, user.id);
    }

    confirm(userId: string, id: number): string {
        const gig = this.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException(voice.notActive);
        if (!gig.sessionAt) throw new BadRequestException(voice.nothingToConfirm);

        const slot = this.slotOf(id, userId);
        if (!slot) throw new BadRequestException(this.isReserve(id, userId) ? voice.alreadyReserve : voice.notIn);
        if (slot.state === 'confirmed') throw new BadRequestException(voice.alreadyConfirmed);

        this.db.update(gigSlots).set({ state: 'confirmed' }).where(eq(gigSlots.id, slot.id)).run();
        this.post(id, { note: voice.runnerConfirmed(this.handle(slot.runnerId)) });
        return voice.confirmed();
    }

    /** Drops a player's runner from their slot or the reserves. Works after sign-ups lock too. */
    leave(userId: string, id: number) {
        const gig = this.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException(voice.notActive);

        const slot = this.slotOf(id, userId);
        const reserve = this.db.query.gigReserves.findFirst({ where: and(eq(gigReserves.gigId, id), eq(gigReserves.userId, userId)) }).sync();
        if (slot) this.db.update(gigSlots).set(emptied).where(eq(gigSlots.id, slot.id)).run();
        else if (reserve) this.removeReserve(id, userId);
        else throw new BadRequestException(voice.notIn);

        this.afterRemoval(id, voice.runnerOut(this.handle(slot?.runnerId ?? reserve?.runnerId ?? null)));
    }

    /** Admin removes a runner from a slot. */
    kick(user: Me, id: number, slotId: number): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!ACTIVE.includes(this.row(id).status)) throw new BadRequestException(voice.notActive);
        const slot = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.id, slotId), eq(gigSlots.gigId, id)) }).sync();
        if (!slot?.userId) throw new NotFoundException();

        this.db.update(gigSlots).set(emptied).where(eq(gigSlots.id, slotId)).run();
        this.afterRemoval(id, voice.runnerOut(this.handle(slot.runnerId)));
        return this.view(id, user.id);
    }

    /** Admin removes a player's runner from the reserves. */
    unreserve(user: Me, id: number, userId: string): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!ACTIVE.includes(this.row(id).status)) throw new BadRequestException(voice.notActive);
        if (!this.removeReserve(id, userId)) throw new NotFoundException();
        this.post(id);
        return this.view(id, user.id);
    }

    /** Sets or clears the session time. Everyone in a slot is asked to confirm, again if it changed. */
    setSession(user: Me, id: number, sessionAt: number | null): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        const gig = this.row(id);
        if (!ACTIVE.includes(gig.status) && gig.status !== 'pending') throw new BadRequestException(voice.notActive);

        const players = this.db.transaction((tx) => {
            tx.update(gigs)
                .set({ sessionAt: sessionAt ? new Date(sessionAt) : null, remindedDay: false, remindedSoon: false })
                .where(eq(gigs.id, id))
                .run();
            const filled = and(eq(gigSlots.gigId, id), isNotNull(gigSlots.userId));
            tx.update(gigSlots)
                .set(sessionAt ? asked() : { state: 'interested', askedAt: null })
                .where(filled)
                .run();
            return tx
                .select({ userId: gigSlots.userId })
                .from(gigSlots)
                .where(filled)
                .all()
                .map((s) => s.userId!);
        });

        this.post(id, sessionAt ? { note: voice.sessionSet(sessionAt), ask: players } : { note: voice.sessionCleared() });
        return this.view(id, user.id);
    }

    /** Lifts a crew's hold on its slots in this gig, so any runner can take them. */
    openCrewSlots(user: Me, id: number, crewId: number): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!ACTIVE.includes(this.row(id).status)) throw new BadRequestException(voice.notActive);
        const crew = this.db.query.crews.findFirst({ where: eq(crews.id, crewId) }).sync();
        const changed = this.db
            .update(gigSlots)
            .set({ crewId: null })
            .where(and(eq(gigSlots.gigId, id), eq(gigSlots.crewId, crewId)))
            .run().changes;
        if (!changed) throw new NotFoundException();

        this.afterRemoval(id, voice.slotsOpened(crew?.name ?? 'The crew'));
        return this.view(id, user.id);
    }

    /** Takes a runner off every unfinished gig before it's deleted. Finished gigs keep their record. */
    dropRunner(runnerId: number) {
        const live = this.db
            .selectDistinct({ id: gigs.id })
            .from(gigs)
            .innerJoin(gigSlots, eq(gigSlots.gigId, gigs.id))
            .where(and(eq(gigSlots.runnerId, runnerId), inArray(gigs.status, [...ACTIVE, 'pending'])))
            .all();
        const handle = this.handle(runnerId);

        this.db.update(gigSlots).set(emptied).where(and(eq(gigSlots.runnerId, runnerId), inArray(gigSlots.gigId, live.map((g) => g.id)))).run();
        // Older gigs just lose the link to the runner
        this.db.update(gigSlots).set({ runnerId: null }).where(eq(gigSlots.runnerId, runnerId)).run();
        this.db.delete(gigReserves).where(eq(gigReserves.runnerId, runnerId)).run();
        this.db.update(gigs).set({ fixerRunnerId: null }).where(eq(gigs.fixerRunnerId, runnerId)).run();

        for (const { id } of live) this.afterRemoval(id, voice.runnerOut(handle));
    }

    /** Takes a slot or a place on the reserves. */
    private add(runner: Runner, id: number, assigned: boolean): { state?: RunnerState; left: number; reserve?: number } {
        const userId = runner.ownerId!;
        const result = this.db.transaction((tx) => {
            const gig = this.row(id);
            // Admins can still add runners once sign-ups are locked
            if (assigned ? !ACTIVE.includes(gig.status) : gig.status !== 'open') throw new BadRequestException(assigned ? voice.notActive : voice.notOpen);

            const slots = tx.select().from(gigSlots).where(eq(gigSlots.gigId, id)).all();
            if (slots.some((s) => s.userId === userId)) throw new BadRequestException(assigned ? voice.playerAlreadyIn : voice.alreadyIn);
            if (this.isReserve(id, userId)) throw new BadRequestException(assigned ? voice.playerAlreadyReserve : voice.alreadyReserve);

            const slot = pickSlot(slots, this.crewIds(runner.id));
            if (!slot) {
                tx.insert(gigReserves).values({ gigId: id, userId, runnerId: runner.id }).run();
                return { left: 0, reserve: tx.select({ n: count() }).from(gigReserves).where(eq(gigReserves.gigId, id)).get()!.n };
            }

            const state: RunnerState = !gig.sessionAt ? 'interested' : assigned ? 'awaiting' : 'confirmed';
            tx.update(gigSlots)
                .set({ userId, runnerId: runner.id, ...(state === 'awaiting' ? asked() : { state }) })
                .where(eq(gigSlots.id, slot.id))
                .run();
            return { state, left: slots.filter((s) => s.userId === null).length - 1 };
        });

        if (result.reserve) this.post(id, { note: voice.reserveIn(runner.handle, result.reserve) });
        else this.post(id, { note: voice.runnerIn(runner.handle, result.state!), ask: result.state === 'awaiting' ? [userId] : [] });
        return result;
    }

    /**
     * After someone leaves (or slots change): fill gaps from the reserves and update the
     * post. Not once the session has happened: removing a no-show shouldn't pull a
     * reserve into a job they weren't on.
     */
    private afterRemoval(id: number, note?: string) {
        const gig = this.row(id);
        const played = !!gig.sessionAt && gig.sessionAt.getTime() <= Date.now();
        const promoted = ACTIVE.includes(gig.status) && !played ? this.promote(id) : [];
        const notes = [note, promoted.length ? voice.promoted(promoted.map((p) => this.handle(p.runnerId))) : ''].filter(Boolean).join('\n');
        this.post(id, { note: notes || undefined, ask: gig.sessionAt ? promoted.map((p) => p.userId) : [] });
    }

    /** Moves reserves into any empty slots they can take. Returns who moved up. */
    private promote(id: number): { userId: string; runnerId: number | null }[] {
        return this.db.transaction((tx) => {
            const gig = this.row(id);
            const slots = tx.select().from(gigSlots).where(eq(gigSlots.gigId, id)).all();
            const reserves = tx.select().from(gigReserves).where(eq(gigReserves.gigId, id)).orderBy(gigReserves.joinedAt).all();
            const moves = fillFromReserves(
                slots,
                reserves.map((r) => ({ userId: r.userId, crewIds: r.runnerId ? this.crewIds(r.runnerId) : [] })),
            );
            return moves.map(({ slotId, userId }) => {
                const runnerId = reserves.find((r) => r.userId === userId)!.runnerId;
                tx.update(gigSlots)
                    .set({ userId, runnerId, ...(gig.sessionAt ? asked() : { state: 'interested' }) })
                    .where(eq(gigSlots.id, slotId))
                    .run();
                tx.delete(gigReserves)
                    .where(and(eq(gigReserves.gigId, id), eq(gigReserves.userId, userId)))
                    .run();
                return { userId, runnerId };
            });
        });
    }

    /** Which of the player's runners is signing up. One runner means no need to ask. */
    private pickRunner(userId: string, runnerId?: number): Runner {
        const mine = this.runnersOf(userId);
        if (runnerId !== undefined) {
            const runner = mine.find((r) => r.id === runnerId);
            if (!runner) throw new BadRequestException("That runner isn't yours.");
            return runner;
        }
        if (mine.length === 1) return mine[0];
        throw new BadRequestException(mine.length ? voice.pickRunner : voice.noRunner(config.PUBLIC_URL));
    }

    private runnersOf(userId: string): Runner[] {
        return this.db.query.runners.findMany({ where: eq(runners.ownerId, userId), orderBy: runners.handle }).sync();
    }

    private crewIds(runnerId: number): number[] {
        return this.db
            .select()
            .from(crewMembers)
            .where(eq(crewMembers.runnerId, runnerId))
            .all()
            .map((m) => m.crewId);
    }

    private slotOf(id: number, userId: string) {
        return this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.gigId, id), eq(gigSlots.userId, userId)) }).sync();
    }

    private isReserve(id: number, userId: string): boolean {
        return !!this.db.query.gigReserves.findFirst({ where: and(eq(gigReserves.gigId, id), eq(gigReserves.userId, userId)) }).sync();
    }

    private removeReserve(id: number, userId: string): number {
        return this.db
            .delete(gigReserves)
            .where(and(eq(gigReserves.gigId, id), eq(gigReserves.userId, userId)))
            .run().changes;
    }

    /** A runner's handle for the bot's messages. */
    handle(runnerId: number | null): string {
        const runner = runnerId ? this.db.query.runners.findFirst({ where: eq(runners.id, runnerId) }).sync() : undefined;
        return runner?.handle ?? 'A runner';
    }

    /** Active gigs with slots for this crew. Look them up before deleting a crew, then refresh them. */
    gigsForCrew(crewId: number): number[] {
        return this.db
            .selectDistinct({ id: gigs.id })
            .from(gigs)
            .innerJoin(gigSlots, eq(gigSlots.gigId, gigs.id))
            .where(and(eq(gigSlots.crewId, crewId), inArray(gigs.status, ACTIVE)))
            .all()
            .map((r) => r.id);
    }

    /** Fills open slots from the reserves (after crew changes) and updates the posts. */
    refill(ids: number[]) {
        for (const id of ids) this.afterRemoval(id);
    }

    /** Re-posts gigs after something they show changes (a crew renamed, a runner edited). */
    refresh(ids: number[]) {
        for (const id of ids) this.post(id);
    }

    /** Gigs that are live (open or locked), newest first. For /gig suggestions. */
    live(): { id: number; name: string }[] {
        return this.db.select({ id: gigs.id, name: gigs.name }).from(gigs).where(inArray(gigs.status, ACTIVE)).orderBy(desc(gigs.createdAt)).all();
    }

    /** Live gigs where the player has a runner in a slot or on the reserves. For /mygigs. */
    forPlayer(userId: string): GigView[] {
        const inSlot = this.db.select({ id: gigSlots.gigId }).from(gigSlots).where(eq(gigSlots.userId, userId)).all();
        const reserved = this.db.select({ id: gigReserves.gigId }).from(gigReserves).where(eq(gigReserves.userId, userId)).all();
        const ids = [...new Set([...inSlot, ...reserved].map((r) => r.id))];
        return ids
            .map((id) => this.view(id, userId))
            .filter((g) => ACTIVE.includes(g.status))
            .sort((a, b) => (a.sessionAt ?? Infinity) - (b.sessionAt ?? Infinity));
    }

    countOpen(): number {
        return this.db.select({ n: count() }).from(gigs).where(eq(gigs.status, 'open')).get()?.n ?? 0;
    }

    /** Brings back the post of a live gig that Discord archived or someone closed. */
    keepOpen(threadId: string) {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.threadId, threadId) }).sync();
        if (gig && ACTIVE.includes(gig.status)) this.post(gig.id);
    }

    /** Refreshes every live post: on startup (so format changes reach old posts) and every few hours. */
    @Once('clientReady')
    refreshAll() {
        const live = this.db.select({ id: gigs.id }).from(gigs).where(inArray(gigs.status, ACTIVE)).all();
        for (const { id } of live) this.post(id);
        if (!this.timers.length) {
            this.timers.push(
                setInterval(() => this.refreshAll(), SWEEP_MS),
                setInterval(() => this.tick(), CLOCK_MS),
            );
            this.timers.forEach((t) => t.unref());
            this.tick();
        }
    }

    /** Sends whatever reminders, nudges and no-response drops are due. Runs every minute. */
    tick(now = Date.now()) {
        const { reminderHours, confirmHours } = this.settings.get();
        const upcoming = this.db.query.gigs
            .findMany({ where: and(inArray(gigs.status, ACTIVE), gt(gigs.sessionAt, new Date(now))), with: { slots: true } })
            .sync();

        for (const gig of upcoming) {
            const sessionAt = gig.sessionAt!.getTime();
            const awaiting = gig.slots.filter((s) => s.userId && s.state === 'awaiting');
            const work = sessionWork({
                now,
                sessionAt,
                reminderHours,
                confirmHours,
                remindedDay: gig.remindedDay,
                remindedSoon: gig.remindedSoon,
                awaiting: awaiting.map((s) => ({ userId: s.userId!, askedAt: s.askedAt?.getTime() ?? now, nudged: s.nudged })),
            });

            if (work.remind) {
                this.db
                    .update(gigs)
                    // The 30-minute reminder covers the day-of one too, so that never comes after it
                    .set(work.remind === 'soon' ? { remindedDay: true, remindedSoon: true } : { remindedDay: true })
                    .where(eq(gigs.id, gig.id))
                    .run();
                const confirmed = gig.slots.filter((s) => s.userId && s.state === 'confirmed').map((s) => s.userId!);
                const wanting = confirmed.filter((userId) => this.prefs.get(userId).reminders);
                const kind = work.remind;
                this.post(gig.id, { after: (view, threadId) => this.posts.remind(view, threadId, wanting, kind) });
            }

            for (const userId of work.nudge) {
                const slot = awaiting.find((s) => s.userId === userId)!;
                this.db.update(gigSlots).set({ nudged: true }).where(eq(gigSlots.id, slot.id)).run();
                const confirmBy = confirmDeadline(slot.askedAt?.getTime() ?? now, sessionAt, confirmHours);
                this.post(gig.id, { after: (view, threadId) => this.posts.askToConfirm(view, threadId, [userId], confirmBy, true) });
            }

            if (work.drop.length) {
                const handles = awaiting.filter((s) => work.drop.includes(s.userId!)).map((s) => this.handle(s.runnerId));
                this.db
                    .update(gigSlots)
                    .set(emptied)
                    .where(and(eq(gigSlots.gigId, gig.id), inArray(gigSlots.userId, work.drop)))
                    .run();
                const dropped = work.drop;
                this.afterRemoval(gig.id, voice.noAnswer(handles));
                this.post(gig.id, { after: (view) => this.posts.notifyDropped(view, dropped) });
            }
        }
    }

    // Helpers

    /**
     * Fills in the fixer and picture. A fixer's gig comes from one of their fixer
     * characters. Admins pick any fixer character or type a name. No picture means a
     * random one for the location.
     */
    private prepare(user: Me, input: GigInput) {
        const fixer = this.resolveFixer(user, input);
        if (input.imageId && !this.library.exists(input.imageId)) throw new BadRequestException('That picture is gone. Pick another.');
        const imageId = input.imageId ?? this.library.pick(input.location);
        return { ...input, fixerName: fixer.name, fixerRunnerId: fixer.runnerId, fixerId: fixer.userId, imageId };
    }

    private resolveFixer(user: Me, input: GigInput): { name: string; runnerId: number | null; userId: string | null } {
        if (input.fixerRunnerId) {
            const runner = this.db.query.runners.findFirst({ where: eq(runners.id, input.fixerRunnerId) }).sync();
            if (!runner || !this.members.isFixerRunner(runner)) throw new BadRequestException("That character isn't a fixer.");
            if (!user.isAdmin && runner.ownerId !== user.id) throw new ForbiddenException();
            return { name: runner.handle, runnerId: runner.id, userId: runner.ownerId };
        }
        if (user.isAdmin) {
            if (!input.fixerName) throw new BadRequestException('Pick a fixer or type a name.');
            return { name: input.fixerName, runnerId: null, userId: null };
        }
        // A fixer with a single fixer character doesn't need to pick
        const own = this.runnersOf(user.id).filter((r) => this.members.isFixerRunner(r));
        if (own.length === 1) return { name: own[0].handle, runnerId: own[0].id, userId: user.id };
        throw new BadRequestException(own.length ? 'Pick which of your fixers this gig is from.' : 'Make a fixer character first: a runner with the Fixer role.');
    }

    /**
     * Updates the gig's post, then posts `note` in its thread, asks the `ask` players to
     * confirm the session time by DM, and runs `after` for anything else that needs the post.
     */
    post(id: number, { note, ask = [], after }: { note?: string; ask?: string[]; after?: AfterPost } = {}) {
        const previous = this.postQueue.get(id) ?? Promise.resolve();
        const next = previous.then(async () => {
            try {
                const gig = this.row(id);
                const view = this.view(id);
                const { threadId, overflowIds } = await this.posts.sync(view, { threadId: gig.threadId, overflowIds: gig.overflowMessageIds }, note);
                if (threadId !== gig.threadId || overflowIds.join() !== gig.overflowMessageIds.join()) {
                    this.db.update(gigs).set({ threadId, overflowMessageIds: overflowIds }).where(eq(gigs.id, id)).run();
                }
                if (!threadId) return;
                // Only players still waiting to confirm by now (someone may have pulled out meanwhile)
                const stillAsked = ask.filter((userId) => view.slots.some((s) => s.runner?.ownerId === userId && s.state === 'awaiting'));
                if (stillAsked.length && view.sessionAt) {
                    const confirmBy = confirmDeadline(Date.now(), view.sessionAt, this.settings.get().confirmHours);
                    await this.posts.askToConfirm(view, threadId, stillAsked, confirmBy);
                }
                await after?.(view, threadId);
            } catch (err) {
                this.logger.error(`Couldn't update the post for gig ${id}: ${err}`);
            }
        });
        this.postQueue.set(id, next);
        void next.finally(() => {
            if (this.postQueue.get(id) === next) this.postQueue.delete(id);
        });
    }

    row(id: number) {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.id, id) }).sync();
        if (!gig) throw new NotFoundException('No such gig.');
        return gig;
    }

    /** `userId` fills in their own rating of the fixer. */
    view(id: number, userId?: string): GigView {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.id, id), with: GIG_WITH }).sync();
        if (!gig) throw new NotFoundException('No such gig.');
        return this.toView(gig, userId);
    }

    /** When an awaiting runner gets dropped if they don't confirm. */
    private confirmBy(slot: { state: RunnerState; askedAt: Date | null }, sessionAt: Date | null): number | null {
        if (slot.state !== 'awaiting' || !sessionAt || !slot.askedAt) return null;
        return confirmDeadline(slot.askedAt.getTime(), sessionAt.getTime(), this.settings.get().confirmHours);
    }

    private toView(gig: GigRow, userId?: string): GigView {
        const ids = [...gig.slots.map((s) => s.runnerId), ...gig.reserves.map((r) => r.runnerId), ...gig.rewards.map((r) => r.runnerId), gig.fixerRunnerId];
        const known = ids.filter((id): id is number => id !== null);
        const cards = new Map(
            (known.length ? this.db.query.runners.findMany({ where: inArray(runners.id, known) }).sync() : []).map((r) => [r.id, r]),
        );
        const card = (id: number | null) => (id && cards.has(id) ? toCard(cards.get(id)!) : null);
        const fixer = gig.fixerRunnerId ? cards.get(gig.fixerRunnerId) : undefined;
        const rating = userId ? this.db.query.fixerRatings.findFirst({ where: and(eq(fixerRatings.gigId, gig.id), eq(fixerRatings.userId, userId)) }).sync() : undefined;
        const done = gig.status === 'completed';

        return {
            id: gig.id,
            name: gig.name,
            fixerName: fixer?.handle ?? gig.fixerName,
            fixerRunnerId: gig.fixerRunnerId,
            fixerImageId: fixer?.imageId ?? null,
            fixerId: gig.fixerId,
            location: gig.location,
            type: gig.type,
            pay: gig.pay,
            objective: gig.objective,
            imageId: gig.imageId,
            objectives: gig.objectives.sort((a, b) => a.position - b.position).map((o) => ({ text: o.text, bonus: o.bonus })),
            slots: gig.slots
                .sort((a, b) => a.position - b.position)
                .map((s) => ({
                    id: s.id,
                    crew: s.crew ? { id: s.crew.id, name: s.crew.name } : null,
                    runner: s.userId ? (card(s.runnerId) ?? unknownRunner(s.userId)) : null,
                    state: s.state,
                    confirmBy: this.confirmBy(s, gig.sessionAt),
                })),
            reserves: gig.reserves
                .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
                .map((r) => card(r.runnerId) ?? unknownRunner(r.userId)),
            sessionAt: gig.sessionAt?.getTime() ?? null,
            status: gig.status,
            createdBy: this.members.member(gig.createdBy),
            threadUrl: gig.threadId ? `https://discord.com/channels/${this.settings.get().guildId}/${gig.threadId}` : null,
            createdAt: gig.createdAt.getTime(),
            summary: done ? gig.summary : null,
            crewRewards: done ? { eb: gig.rewardEb, ip: gig.rewardIp, hqIp: gig.rewardHqIp, text: gig.rewardText } : null,
            runnerRewards: gig.rewards
                .filter((r) => cards.has(r.runnerId))
                .map((r) => ({ runner: toCard(cards.get(r.runnerId)!), eb: r.eb, ip: r.ip, text: r.text })),
            canRate: done && !!gig.fixerRunnerId && !!userId && gig.slots.some((s) => s.userId === userId),
            myRating: rating ? { stars: rating.stars, comment: rating.comment } : null,
        };
    }

    private writeObjectives(tx: Tx, gigId: number, objectives: GigInput['objectives']) {
        if (!objectives.length) return;
        tx.insert(gigObjectives)
            .values(objectives.map((o, position) => ({ gigId, text: o.text, bonus: o.bonus, position })))
            .run();
    }

    private writeSlots(tx: Tx, gigId: number, groups: GigInput['slots']) {
        const existing = tx.select().from(gigSlots).where(eq(gigSlots.gigId, gigId)).all();
        let changes;
        try {
            changes = diffSlots(existing, groups);
        } catch (err) {
            throw new BadRequestException((err as Error).message);
        }
        if (changes.remove.length) tx.delete(gigSlots).where(and(inArray(gigSlots.id, changes.remove), isNull(gigSlots.userId))).run();
        if (changes.add.length) {
            const start = existing.length ? Math.max(...existing.map((s) => s.position)) + 1 : 0;
            tx.insert(gigSlots)
                .values(changes.add.map((crewId, i) => ({ gigId, crewId, position: start + i })))
                .run();
        }
    }
}

/** A sign-up whose runner was deleted. */
const unknownRunner = (userId: string): RunnerCard => ({ id: 0, slug: '', handle: 'Unknown runner', role: '', extraRoles: [], imageId: null, ownerId: userId });

type AfterPost = (view: GigView, threadId: string) => Promise<void>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type GigRow = typeof gigs.$inferSelect & {
    objectives: (typeof gigObjectives.$inferSelect)[];
    slots: (typeof gigSlots.$inferSelect & { crew: typeof crews.$inferSelect | null })[];
    reserves: (typeof gigReserves.$inferSelect)[];
    rewards: (typeof gigRewards.$inferSelect)[];
};
