import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Once } from 'necord';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { crewMembers, crews, gigObjectives, gigs, gigSlots } from '../db/schema';
import { GigPostService } from '../discord/gig-post.service';
import { MembersService } from '../discord/members.service';
import { voice } from '../discord/voice';
import { LibraryService } from '../library/library.service';
import { canCreateGig, canDeleteGig, canEditGig, canRunGig, canSeeGig, NEXT_STATUSES } from '../shared/permissions';
import type { GigInput, GigStatus, GigView, Me } from '../shared/schemas';
import { SettingsService } from '../settings/settings.service';
import { diffSlots, pickSlot } from './slots';

const ACTIVE: GigStatus[] = ['open', 'closed'];
const SWEEP_MS = 6 * 60 * 60 * 1000;

/** Every change to a gig goes through here, from the web and from Discord buttons. */
@Injectable()
export class GigsService {
    private readonly logger = new Logger(GigsService.name);
    /** Post updates per gig, run one at a time so an older state never lands last. */
    private readonly postQueue = new Map<number, Promise<void>>();
    private sweep: NodeJS.Timeout | null = null;

    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly members: MembersService,
        private readonly posts: GigPostService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
    ) {}

    list(user: Me): GigView[] {
        const rows = this.db.query.gigs.findMany({ with: { objectives: true, slots: { with: { crew: true } } } }).sync();
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

        this.queuePost(id);
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
        if (!canRunGig(user, gig)) throw new ForbiddenException();
        if (!NEXT_STATUSES[gig.status].includes(status)) throw new BadRequestException(`Can't go from ${gig.status} to ${status}.`);

        this.db.update(gigs).set({ status }).where(eq(gigs.id, id)).run();
        this.queuePost(id, voice.statusChanged[status]);
        return this.view(id);
    }

    /** Takes the best open slot for this runner. Returns how many slots are left. */
    async join(userId: string, id: number): Promise<number> {
        const me = await this.members.me(userId);
        if (!me?.isEdgerunner) throw new ForbiddenException(voice.notRunner);

        const left = this.db.transaction((tx) => {
            const gig = this.row(id);
            if (gig.status !== 'open') throw new BadRequestException(voice.notOpen);

            const slots = tx.select().from(gigSlots).where(eq(gigSlots.gigId, id)).all();
            if (slots.some((s) => s.userId === userId)) throw new BadRequestException(voice.alreadyIn);

            const crewIds = tx.select().from(crewMembers).where(eq(crewMembers.userId, userId)).all().map((m) => m.crewId);
            const slot = pickSlot(slots, crewIds);
            if (!slot) throw new BadRequestException(voice.noSlot);

            tx.update(gigSlots).set({ userId }).where(eq(gigSlots.id, slot.id)).run();
            return slots.filter((s) => s.userId === null).length - 1;
        });

        this.queuePost(id, voice.runnerIn(userId, left));
        return left;
    }

    leave(userId: string, id: number) {
        const gig = this.row(id);
        if (gig.status !== 'open') throw new BadRequestException(voice.notOpen);

        const result = this.db
            .update(gigSlots)
            .set({ userId: null })
            .where(and(eq(gigSlots.gigId, id), eq(gigSlots.userId, userId)))
            .run();
        if (!result.changes) throw new BadRequestException(voice.notIn);

        this.queuePost(id, voice.runnerOut(userId));
    }

    /** Admin removes a runner from a slot. */
    kick(user: Me, id: number, slotId: number): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        const slot = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.id, slotId), eq(gigSlots.gigId, id)) }).sync();
        if (!slot?.userId) throw new NotFoundException();

        this.db.update(gigSlots).set({ userId: null }).where(eq(gigSlots.id, slotId)).run();
        this.queuePost(id, voice.runnerOut(slot.userId));
        return this.view(id);
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
        if (!this.sweep) {
            this.sweep = setInterval(() => this.refreshAll(), SWEEP_MS);
            this.sweep.unref();
        }
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

    private queuePost(id: number, note?: string) {
        const previous = this.postQueue.get(id) ?? Promise.resolve();
        const next = previous.then(async () => {
            try {
                const gig = this.row(id);
                const threadId = await this.posts.sync(this.view(id), gig.threadId, note);
                if (threadId !== gig.threadId) this.db.update(gigs).set({ threadId }).where(eq(gigs.id, id)).run();
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
        const gig = this.db.query.gigs.findFirst({ where: eq(gigs.id, id), with: { objectives: true, slots: { with: { crew: true } } } }).sync();
        if (!gig) throw new NotFoundException('No such gig.');
        return this.toView(gig);
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
                })),
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

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type GigRow = typeof gigs.$inferSelect & {
    objectives: (typeof gigObjectives.$inferSelect)[];
    slots: (typeof gigSlots.$inferSelect & { crew: typeof crews.$inferSelect | null })[];
};
