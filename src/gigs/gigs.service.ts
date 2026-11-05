import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Once } from 'necord';
import { and, count, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { PrefsService } from '../auth/prefs.service';
import { DB, Db } from '../db/db';
import { crewMembers, crews, gigObjectives, gigReserves, gigs, gigSlots } from '../db/schema';
import { GigPostService } from '../discord/gig-post.service';
import { MembersService } from '../discord/members.service';
import { voice } from '../discord/voice';
import { LibraryService } from '../library/library.service';
import { canCreateGig, canDeleteGig, canEditGig, canSeeGig, NEXT_STATUSES } from '../shared/permissions';
import type { GigInput, GigStatus, GigView, Me, RunnerState } from '../shared/schemas';
import { SettingsService } from '../settings/settings.service';
import { confirmDeadline, sessionWork } from './sessions';
import { diffSlots, fillFromReserves, pickSlot } from './slots';

const ACTIVE: GigStatus[] = ['open', 'closed'];
const SWEEP_MS = 6 * 60 * 60 * 1000;
/** How often reminders, nudges and no-response drops are checked. */
const CLOCK_MS = 60 * 1000;

/** A slot's fields for a runner who has just been asked to confirm. */
const asked = () => ({ state: 'awaiting' as const, askedAt: new Date(), nudged: false });
/** A slot's fields once its runner is gone. */
const emptied = { userId: null, state: 'interested' as const, askedAt: null, nudged: false };
const GIG_WITH = { objectives: true, slots: { with: { crew: true } }, reserves: true } as const;

/** Every change to a gig goes through here, from the web and from Discord buttons. */
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
        return rows.filter((g) => canSeeGig(user, g)).map((g) => this.toView(g)).sort((a, b) => b.createdAt - a.createdAt);
    }

    get(user: Me, id: number): GigView {
        const gig = this.view(id);
        if (!canSeeGig(user, { ...gig, createdBy: gig.createdBy.id })) throw new NotFoundException();
        return gig;
    }

    create(user: Me, input: GigInput): GigView {
        if (!canCreateGig(user)) throw new ForbiddenException();
        const status: GigStatus = user.isAdmin ? 'open' : 'pending';

        const id = this.db.transaction((tx) => {
            const { objectives, slots, ...fields } = this.prepare(user, input);
            const [gig] = tx.insert(gigs).values({ ...fields, status, createdBy: user.id }).returning({ id: gigs.id }).all();
            this.writeObjectives(tx, gig.id, objectives);
            this.writeSlots(tx, gig.id, slots);
            return gig.id;
        });

        this.queuePost(id);
        return this.view(id);
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
        const promoted = this.promote(id);
        this.queuePost(id, promoted.length ? { note: voice.promoted(promoted), ask: gig.sessionAt ? promoted : [] } : {});
        return this.view(id);
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

        this.db.update(gigs).set({ status: approved ? 'open' : 'rejected' }).where(eq(gigs.id, id)).run();
        this.queuePost(id);
        return this.view(id);
    }

    setStatus(user: Me, id: number, status: GigStatus): GigView {
        const gig = this.row(id);
        if (!user.isAdmin) throw new ForbiddenException();
        if (!NEXT_STATUSES[gig.status].includes(status)) throw new BadRequestException(`Can't go from ${gig.status} to ${status}.`);

        this.db.update(gigs).set({ status }).where(eq(gigs.id, id)).run();
        this.queuePost(id, { note: voice.statusChanged[status] });
        return this.view(id);
    }

    // Runners and sessions
    //
    // Before a session time is set, joining marks a runner interested and takes a slot.
    // Once a time is set, everyone in a slot is asked to confirm (awaiting) and new
    // runners are confirmed as they join. Full gigs put people on reserves, and any
    // slot that frees up goes to the oldest reserve who can take it.

    /** The post's join button. Confirms a runner who was asked, otherwise adds them. */
    async join(userId: string, id: number): Promise<string> {
        const me = await this.members.me(userId);
        if (!me?.isEdgerunner) throw new ForbiddenException(voice.notRunner);

        const slot = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.gigId, id), eq(gigSlots.userId, userId)) }).sync();
        if (slot?.state === 'awaiting') return this.confirm(userId, id);

        const added = this.add(userId, id, false);
        if (added.reserve) return voice.reserve(added.reserve);
        return added.state === 'interested' ? voice.interested() : voice.joined(added.left);
    }

    /** Admin puts a runner on a gig. Same as them joining, except they're asked to confirm a set time. */
    async assign(user: Me, id: number, userId: string): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const runner = await this.members.me(userId);
        if (!runner?.isEdgerunner) throw new BadRequestException('Only edgerunners can be put on a gig.');
        this.add(userId, id, true);
        return this.view(id);
    }

    confirm(userId: string, id: number): string {
        const gig = this.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException(voice.notActive);
        if (!gig.sessionAt) throw new BadRequestException(voice.nothingToConfirm);

        const slot = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.gigId, id), eq(gigSlots.userId, userId)) }).sync();
        if (!slot) throw new BadRequestException(this.isReserve(id, userId) ? voice.alreadyReserve : voice.notIn);
        if (slot.state === 'confirmed') throw new BadRequestException(voice.alreadyConfirmed);

        this.db.update(gigSlots).set({ state: 'confirmed' }).where(eq(gigSlots.id, slot.id)).run();
        this.queuePost(id, { note: voice.runnerConfirmed(userId) });
        return voice.confirmed();
    }

    /** Drops a runner from their slot or the reserves. Works after sign-ups lock too. */
    leave(userId: string, id: number) {
        const gig = this.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException(voice.notActive);

        const freed = this.db
            .update(gigSlots)
            .set(emptied)
            .where(and(eq(gigSlots.gigId, id), eq(gigSlots.userId, userId)))
            .run().changes;
        const unreserved = freed ? 0 : this.removeReserve(id, userId);
        if (!freed && !unreserved) throw new BadRequestException(voice.notIn);

        this.afterRemoval(id, voice.runnerOut(userId));
    }

    /** Admin removes a runner from a slot. */
    kick(user: Me, id: number, slotId: number): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        const slot = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.id, slotId), eq(gigSlots.gigId, id)) }).sync();
        if (!slot?.userId) throw new NotFoundException();

        this.db.update(gigSlots).set(emptied).where(eq(gigSlots.id, slotId)).run();
        this.afterRemoval(id, voice.runnerOut(slot.userId));
        return this.view(id);
    }

    /** Admin removes someone from the reserves. */
    unreserve(user: Me, id: number, userId: string): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!this.removeReserve(id, userId)) throw new NotFoundException();
        this.queuePost(id);
        return this.view(id);
    }

    /** Sets or clears the session time. Everyone in a slot is asked to confirm, again if it changed. */
    setSession(user: Me, id: number, sessionAt: number | null): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        const gig = this.row(id);
        if (!ACTIVE.includes(gig.status) && gig.status !== 'pending') throw new BadRequestException(voice.notActive);

        const runners = this.db.transaction((tx) => {
            tx.update(gigs)
                .set({ sessionAt: sessionAt ? new Date(sessionAt) : null, remindedDay: false, remindedSoon: false })
                .where(eq(gigs.id, id))
                .run();
            const filled = and(eq(gigSlots.gigId, id), isNotNull(gigSlots.userId));
            tx.update(gigSlots).set(sessionAt ? asked() : { state: 'interested', askedAt: null }).where(filled).run();
            return tx.select({ userId: gigSlots.userId }).from(gigSlots).where(filled).all().map((s) => s.userId!);
        });

        this.queuePost(id, sessionAt ? { note: voice.sessionSet(sessionAt), ask: runners } : { note: voice.sessionCleared() });
        return this.view(id);
    }

    /** Takes a slot or a place on the reserves. */
    private add(userId: string, id: number, assigned: boolean): { state?: RunnerState; left: number; reserve?: number } {
        const result = this.db.transaction((tx) => {
            const gig = this.row(id);
            if (gig.status !== 'open') throw new BadRequestException(voice.notOpen);

            const slots = tx.select().from(gigSlots).where(eq(gigSlots.gigId, id)).all();
            if (slots.some((s) => s.userId === userId)) throw new BadRequestException(voice.alreadyIn);
            if (this.isReserve(id, userId)) throw new BadRequestException(voice.alreadyReserve);

            const slot = pickSlot(slots, this.crewIds(userId));
            if (!slot) {
                tx.insert(gigReserves).values({ gigId: id, userId }).run();
                return { left: 0, reserve: tx.select({ n: count() }).from(gigReserves).where(eq(gigReserves.gigId, id)).get()!.n };
            }

            const state: RunnerState = !gig.sessionAt ? 'interested' : assigned ? 'awaiting' : 'confirmed';
            tx.update(gigSlots)
                .set({ userId, ...(state === 'awaiting' ? asked() : { state }) })
                .where(eq(gigSlots.id, slot.id))
                .run();
            return { state, left: slots.filter((s) => s.userId === null).length - 1 };
        });

        if (result.reserve) this.queuePost(id, { note: voice.reserveIn(userId, result.reserve) });
        else this.queuePost(id, { note: voice.runnerIn(userId, result.state!), ask: result.state === 'awaiting' ? [userId] : [] });
        return result;
    }

    /** After someone leaves: fill the gap from the reserves and update the post. */
    private afterRemoval(id: number, note: string) {
        const promoted = this.promote(id);
        const notes = promoted.length ? `${note}\n${voice.promoted(promoted)}` : note;
        this.queuePost(id, { note: notes, ask: this.row(id).sessionAt ? promoted : [] });
    }

    /** Moves reserves into any empty slots they can take. Returns who moved up. */
    private promote(id: number): string[] {
        return this.db.transaction((tx) => {
            const gig = this.row(id);
            const slots = tx.select().from(gigSlots).where(eq(gigSlots.gigId, id)).all();
            const reserves = tx.select().from(gigReserves).where(eq(gigReserves.gigId, id)).orderBy(gigReserves.joinedAt).all();
            const moves = fillFromReserves(
                slots,
                reserves.map((r) => ({ userId: r.userId, crewIds: this.crewIds(r.userId) })),
            );
            for (const { slotId, userId } of moves) {
                tx.update(gigSlots)
                    .set({ userId, ...(gig.sessionAt ? asked() : { state: 'interested' }) })
                    .where(eq(gigSlots.id, slotId))
                    .run();
                tx.delete(gigReserves)
                    .where(and(eq(gigReserves.gigId, id), eq(gigReserves.userId, userId)))
                    .run();
            }
            return moves.map((m) => m.userId);
        });
    }

    private crewIds(userId: string): number[] {
        return this.db.select().from(crewMembers).where(eq(crewMembers.userId, userId)).all().map((m) => m.crewId);
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

    /** Re-posts gigs after a crew they use is renamed or deleted. */
    refresh(ids: number[]) {
        for (const id of ids) this.queuePost(id);
    }

    countOpen(): number {
        return this.db.select({ n: count() }).from(gigs).where(eq(gigs.status, 'open')).get()?.n ?? 0;
    }

    /** Brings back the post of a live gig that Discord archived or someone closed. */
    keepOpen(threadId: string) {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.threadId, threadId) }).sync();
        if (gig && ACTIVE.includes(gig.status)) this.queuePost(gig.id);
    }

    /** Refreshes every live post: on startup (so format changes reach old posts) and every few hours. */
    @Once('clientReady')
    refreshAll() {
        const live = this.db.select({ id: gigs.id }).from(gigs).where(inArray(gigs.status, ACTIVE)).all();
        for (const { id } of live) this.queuePost(id);
        if (!this.timers.length) {
            this.timers.push(setInterval(() => this.refreshAll(), SWEEP_MS), setInterval(() => this.tick(), CLOCK_MS));
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
                    .set(work.remind === 'soon' ? { remindedDay: true, remindedSoon: true } : { remindedDay: true })
                    .where(eq(gigs.id, gig.id))
                    .run();
                const confirmed = gig.slots.filter((s) => s.userId && s.state === 'confirmed').map((s) => s.userId!);
                const wanting = confirmed.filter((userId) => this.prefs.get(userId).reminders);
                const kind = work.remind;
                this.queuePost(gig.id, { after: (view, threadId) => this.posts.remind(view, threadId, wanting, kind) });
            }

            for (const userId of work.nudge) {
                const slot = awaiting.find((s) => s.userId === userId)!;
                this.db.update(gigSlots).set({ nudged: true }).where(eq(gigSlots.id, slot.id)).run();
                const confirmBy = confirmDeadline(slot.askedAt?.getTime() ?? now, sessionAt, confirmHours);
                this.queuePost(gig.id, { after: (view, threadId) => this.posts.askToConfirm(view, threadId, [userId], confirmBy, true) });
            }

            if (work.drop.length) {
                this.db
                    .update(gigSlots)
                    .set(emptied)
                    .where(and(eq(gigSlots.gigId, gig.id), inArray(gigSlots.userId, work.drop)))
                    .run();
                const promoted = this.promote(gig.id);
                const dropped = work.drop;
                this.queuePost(gig.id, {
                    note: [voice.noAnswer(dropped), promoted.length ? voice.promoted(promoted) : ''].filter(Boolean).join('\n'),
                    ask: promoted,
                    after: (view) => this.posts.notifyDropped(view, dropped),
                });
            }
        }
    }

    /** Lifts a crew's hold on its slots in this gig, so any edgerunner can take them. */
    openCrewSlots(user: Me, id: number, crewId: number): GigView {
        const gig = this.row(id);
        if (!user.isAdmin) throw new ForbiddenException();
        const crew = this.db.query.crews.findFirst({ where: eq(crews.id, crewId) }).sync();
        const changed = this.db
            .update(gigSlots)
            .set({ crewId: null })
            .where(and(eq(gigSlots.gigId, id), eq(gigSlots.crewId, crewId)))
            .run().changes;
        if (!changed) throw new NotFoundException();

        const promoted = this.promote(id);
        const note = [voice.slotsOpened(crew?.name ?? 'The crew'), promoted.length ? voice.promoted(promoted) : ''].filter(Boolean).join('\n');
        this.queuePost(id, { note, ask: gig.sessionAt ? promoted : [] });
        return this.view(id);
    }

    // Helpers

    /**
     * Fills in the fixer and picture. Fixers are always themselves. Admins type a name,
     * which links to the person if someone with the fixer role has it. No picture means
     * a random one for the location.
     */
    private prepare(user: Me, input: GigInput) {
        const fixer = user.isAdmin ? this.members.fixers().find((f) => f.name.toLowerCase() === input.fixerName.toLowerCase()) : user;
        const fixerName = user.isAdmin ? input.fixerName : user.name;

        if (input.imageId && !this.library.exists(input.imageId)) throw new BadRequestException('That picture is gone. Pick another.');
        const imageId = input.imageId ?? this.library.pick(input.location);
        return { ...input, fixerName, fixerId: fixer?.id ?? null, imageId };
    }

    /**
     * Updates the gig's post, then posts `note` in its thread, asks the `ask` runners to
     * confirm the session time by DM, and runs `after` for anything else that needs the post.
     */
    private queuePost(id: number, { note, ask = [], after }: { note?: string; ask?: string[]; after?: AfterPost } = {}) {
        const previous = this.postQueue.get(id) ?? Promise.resolve();
        const next = previous.then(async () => {
            try {
                const gig = this.row(id);
                const view = this.view(id);
                const threadId = await this.posts.sync(view, gig.threadId, note);
                if (threadId !== gig.threadId) this.db.update(gigs).set({ threadId }).where(eq(gigs.id, id)).run();
                if (!threadId) return;
                if (ask.length && view.sessionAt) {
                    const confirmBy = confirmDeadline(Date.now(), view.sessionAt, this.settings.get().confirmHours);
                    await this.posts.askToConfirm(view, threadId, ask, confirmBy);
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

    private row(id: number) {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.id, id) }).sync();
        if (!gig) throw new NotFoundException('No such gig.');
        return gig;
    }

    private view(id: number): GigView {
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.id, id), with: GIG_WITH }).sync();
        if (!gig) throw new NotFoundException('No such gig.');
        return this.toView(gig);
    }

    /** When an awaiting runner gets dropped if they don't confirm. */
    private confirmBy(slot: { state: RunnerState; askedAt: Date | null }, sessionAt: Date | null): number | null {
        if (slot.state !== 'awaiting' || !sessionAt || !slot.askedAt) return null;
        return confirmDeadline(slot.askedAt.getTime(), sessionAt.getTime(), this.settings.get().confirmHours);
    }

    private toView(gig: GigRow): GigView {
        return {
            id: gig.id,
            name: gig.name,
            fixerName: gig.fixerName,
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
                    runner: s.userId ? this.members.member(s.userId) : null,
                    state: s.state,
                    confirmBy: this.confirmBy(s, gig.sessionAt),
                })),
            reserves: gig.reserves.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).map((r) => this.members.member(r.userId)),
            sessionAt: gig.sessionAt?.getTime() ?? null,
            status: gig.status,
            createdBy: this.members.member(gig.createdBy),
            threadUrl: gig.threadId ? `https://discord.com/channels/${this.settings.get().guildId}/${gig.threadId}` : null,
            createdAt: gig.createdAt.getTime(),
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

type AfterPost = (view: GigView, threadId: string) => Promise<void>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type GigRow = typeof gigs.$inferSelect & {
    objectives: (typeof gigObjectives.$inferSelect)[];
    slots: (typeof gigSlots.$inferSelect & { crew: typeof crews.$inferSelect | null })[];
    reserves: (typeof gigReserves.$inferSelect)[];
};
