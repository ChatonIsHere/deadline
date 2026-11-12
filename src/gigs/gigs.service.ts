import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Runner } from '@prisma/client';
import { Once } from 'necord';
import { PrefsService } from '../auth/prefs.service';
import { config } from '../config';
import { GigPostService, type Note } from '../discord/gig-post.service';
import { MembersService } from '../discord/members.service';
import { linked, NotifyService } from '../discord/notify.service';
import { type Said, voice } from '../discord/voice';
import { LibraryService } from '../library/library.service';
import { stringList } from '../prisma/json';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { canCreateGig, canDeleteGig, canEditGig, canSeeGig, NEXT_STATUSES } from '../shared/permissions';
import { type GigDraftInput, gigInput, type GigInput, type GigStatus, type GigView, LIVE_STATUSES, type Me, type MySignups, objectivesRevealed, type RunnerCard, type RunnerState } from '../shared/schemas';
import { gigRef, gigRefPrefix, isUuid } from '../shared/slug';
import { SettingsService } from '../settings/settings.service';
import { confirmDeadline, sessionWork, tooLateToAsk } from './sessions';
import { diffSlots, fillFromReserves, pickSlot, shiftToCrewSlots, slotGroups, spareChanges, unlimitedGroups } from './slots';

export const ACTIVE = LIVE_STATUSES;
const SWEEP_MS = 6 * 60 * 60 * 1000;
/** How often reminders, nudges and no-response drops are checked. */
const CLOCK_MS = 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A slot's fields for a runner who has just been asked to confirm. */
const asked = () => ({ state: 'awaiting' as const, askedAt: new Date(), nudged: false, confirmedAt: null });
/** A slot's fields for a runner who is coming, as of now. */
const confirmedNow = () => ({ state: 'confirmed' as const, confirmedAt: new Date() });
/** A slot's fields once its runner is gone. */
const emptied = { userId: null, runnerId: null, state: 'interested' as const, askedAt: null, nudged: false, confirmedAt: null };

/** Everything a gig's view needs, in one query. */
const GIG_INCLUDE = {
    objectives: { orderBy: { position: 'asc' } },
    slots: { include: { crew: true, runner: true }, orderBy: { position: 'asc' } },
    reserves: { include: { runner: true }, orderBy: { joinedAt: 'asc' } },
    rewards: { include: { runner: true } },
    fixerRunner: true,
} as const satisfies Prisma.GigInclude;
type GigRow = Prisma.GigGetPayload<{ include: typeof GIG_INCLUDE }>;

export const toCard = (r: Runner): RunnerCard => ({
    id: r.id,
    slug: r.slug,
    handle: r.handle,
    role: r.role,
    extraRoles: stringList(r.extraRoles),
    imageId: r.imageId,
    tagline: r.tagline,
    ownerId: r.ownerId,
    status: r.status,
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
    private readonly postQueue = new Map<string, Promise<void>>();
    private readonly timers: NodeJS.Timeout[] = [];

    constructor(
        private readonly prisma: PrismaService,
        private readonly members: MembersService,
        private readonly posts: GigPostService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        private readonly prefs: PrefsService,
        private readonly notify: NotifyService,
    ) {}

    async list(user: Me): Promise<GigView[]> {
        const rows = await this.prisma.gig.findMany({ include: GIG_INCLUDE, orderBy: { createdAt: 'desc' } });
        const visible = rows.filter((g) => canSeeGig(user, g));
        return Promise.all(visible.map((g) => this.toView(g, user)));
    }

    /**
     * A gig's ID from a URL part: its link ("3f2a9c1b-overzealous-squanch", matched on the
     * UUID start, so renames don't break old links) or its full UUID.
     */
    async resolve(ref: string): Promise<string> {
        if (isUuid(ref)) {
            const gig = await this.prisma.gig.findUnique({ where: { id: ref.toLowerCase() }, select: { id: true } });
            if (gig) return gig.id;
        }
        const prefix = gigRefPrefix(ref);
        if (prefix) {
            const [gig] = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM gigs WHERE id::text LIKE ${`${prefix}%`} LIMIT 1`;
            if (gig) return gig.id;
        }
        throw new NotFoundException('No such gig.');
    }

    async get(user: Me, ref: string): Promise<GigView> {
        const gig = await this.view(await this.resolve(ref), user);
        if (!canSeeGig(user, { ...gig, createdBy: gig.createdBy.id })) throw new NotFoundException();
        return gig;
    }

    async create(user: Me, input: GigInput): Promise<GigView> {
        if (!canCreateGig(user)) throw new ForbiddenException();
        const status: GigStatus = user.isAdmin ? 'open' : 'pending';
        const { objectives, slots, ...fields } = await this.prepare(user, input);

        const id = await this.prisma.$transaction(async (tx) => {
            const gig = await tx.gig.create({ data: { ...fields, status, createdBy: user.id }, select: { id: true } });
            await this.writeObjectives(tx, gig.id, objectives);
            await this.writeSlots(tx, gig.id, slots);
            return gig.id;
        });

        await this.library.refreshUsage([fields.imageId]);
        this.announceSent(user, id, status, fields);
        return this.view(id, user);
    }

    /** Posts a gig that just went live, or tells the admins one is waiting for them. */
    private announceSent(user: Me, id: string, status: GigStatus, gig: { name: string; fixerName: string }) {
        if (status === 'open') {
            this.post(id, { after: (view) => this.announce(view, user.id) });
        } else {
            this.post(id);
            const admins = this.members.admins().filter((a) => a !== user.id);
            this.notify.fire('approvals', admins, linked(voice.needsApproval(gig.name, gig.fixerName), 'Review it', boardLink({ id, name: gig.name })));
        }
    }

    /** Saves a new draft. Only the name has to be there yet. */
    async createDraft(user: Me, input: GigDraftInput): Promise<GigView> {
        if (!canCreateGig(user)) throw new ForbiddenException();
        const { objectives, slots, ...fields } = await this.prepareDraft(user, input);
        const id = await this.prisma.$transaction(async (tx) => {
            const gig = await tx.gig.create({ data: { ...fields, status: 'draft', createdBy: user.id }, select: { id: true } });
            await this.writeObjectives(tx, gig.id, objectives);
            await this.writeSlots(tx, gig.id, slots);
            return gig.id;
        });
        await this.library.refreshUsage([fields.imageId]);
        return this.view(id, user);
    }

    async updateDraft(user: Me, id: string, input: GigDraftInput): Promise<GigView> {
        const gig = await this.row(id);
        if (!canEditGig(user, gig)) throw new ForbiddenException();
        if (gig.status !== 'draft') throw new BadRequestException('That gig is not a draft any more.');
        const { objectives, slots, ...fields } = await this.prepareDraft(user, input);
        await this.prisma.$transaction(async (tx) => {
            await tx.gig.update({ where: { id }, data: fields });
            await tx.gigObjective.deleteMany({ where: { gigId: id } });
            await this.writeObjectives(tx, id, objectives);
            await this.writeSlots(tx, id, slots);
        });
        await this.library.refreshUsage([fields.imageId, gig.imageId]);
        return this.view(id, user);
    }

    /**
     * Sends a draft on, once it's complete. A fixer's goes to the admins for approval. An admin
     * sending one is the approval, so it posts, and a fixer whose draft it was gets told.
     */
    async send(user: Me, id: string): Promise<GigView> {
        const gig = await this.draftRow(id);
        if (!canEditGig(user, gig)) throw new ForbiddenException();
        if (gig.status !== 'draft') throw new BadRequestException('That gig is not a draft any more.');

        const { objectives: _, slots: __, ...fields } = await this.prepare(user, this.readyToSend(gig));
        const status: GigStatus = user.isAdmin ? 'open' : 'pending';
        // Only one send can win, so a double click (or the schedule firing at the same moment) can't post it twice
        const { count } = await this.prisma.gig.updateMany({ where: { id, status: 'draft' }, data: { ...fields, status, postAt: null, postBy: null } });
        if (!count) throw new BadRequestException('That gig is not a draft any more.');

        await this.library.refreshUsage([fields.imageId, gig.imageId]);
        this.announceSent(user, id, status, fields);
        if (status === 'open' && gig.createdBy !== user.id) {
            this.notify.fire('fixerApprovals', [gig.createdBy], linked(voice.gigApproved(fields.name), 'Open on board', boardLink({ id, name: fields.name })));
        }
        return this.view(id, user);
    }

    /**
     * Schedules a draft to post by itself, as the admin scheduling it, or stops that with null.
     * It has to be ready to post now, so it doesn't fail when the time comes. It can still be
     * edited meanwhile; if that leaves it unpostable, the admin hears why when it's due.
     */
    async schedule(user: Me, id: string, postAt: number | null): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const gig = await this.draftRow(id);
        if (gig.status !== 'draft') throw new BadRequestException('Only drafts can be scheduled.');
        if (postAt !== null) {
            if (postAt <= Date.now()) throw new BadRequestException('Pick a time in the future. To post it now, post it.');
            if (postAt > Date.now() + 366 * 24 * 60 * 60 * 1000) throw new BadRequestException('Pick a time within the next year.');
            this.readyToSend(gig);
        }
        const { count } = await this.prisma.gig.updateMany({
            where: { id, status: 'draft' },
            data: postAt === null ? { postAt: null, postBy: null } : { postAt: new Date(postAt), postBy: user.id },
        });
        if (!count) throw new BadRequestException('That gig is not a draft any more.');
        return this.view(id, user);
    }

    /** Posts the scheduled drafts that are due. One that can't post goes back to a plain draft, and its admin is told why. */
    async postScheduled(now = Date.now()) {
        const due = await this.prisma.gig.findMany({ where: { status: 'draft', postAt: { lte: new Date(now) } }, select: { id: true, name: true, postBy: true } });
        for (const gig of due) {
            const by = gig.postBy ? await this.members.me(gig.postBy) : null;
            try {
                if (!by?.isAdmin) throw new ForbiddenException("Whoever scheduled it isn't an admin any more.");
                await this.send(by, gig.id);
                this.logger.log(`Posted scheduled gig ${gig.id}`);
            } catch (err) {
                await this.prisma.gig.updateMany({ where: { id: gig.id, status: 'draft' }, data: { postAt: null, postBy: null } });
                const reason = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Scheduled gig ${gig.id} didn't post: ${reason}`);
                if (gig.postBy) await this.members.dm([gig.postBy], linked(voice.scheduleFailed(gig.name, reason), 'Open on board', boardLink(gig)));
            }
        }
    }

    private draftRow(id: string) {
        return this.prisma.gig
            .findUnique({ where: { id }, include: { objectives: { orderBy: { position: 'asc' } }, slots: true } })
            .then((gig) => gig ?? Promise.reject(new NotFoundException('No such gig.')));
    }

    /** A draft as a complete gig, or why it can't be posted yet. */
    private readyToSend(gig: NonNullable<Awaited<ReturnType<GigsService['draftRow']>>>): GigInput {
        const checked = gigInput.safeParse({
            name: gig.name,
            fixerName: gig.fixerName,
            fixerRunnerId: gig.fixerRunnerId,
            location: gig.location,
            type: gig.type,
            brief: gig.brief,
            primaryObjective: stringList(gig.primaryObjective),
            pay: gig.pay,
            splitPay: gig.splitPay,
            imageId: gig.imageId,
            objectives: gig.objectives.map((o) => ({ text: o.text, bonus: o.bonus, each: o.each, hidden: o.hidden })),
            slots: slotGroups(gig.slots),
        });
        if (!checked.success) {
            const issue = checked.error.issues[0];
            throw new BadRequestException(`Not ready to send. ${String(issue.path[0] ?? 'form')}: ${issue.message}`);
        }
        return checked.data;
    }

    /** Heads-ups for people watching for new gigs, once the post is up so they can open it. Not to `by`, who put it live. */
    private async announce(view: GigView, by: string) {
        const audience = (await this.notify.newGigAudience(view)).filter((u) => u !== by);
        if (audience.length) await this.members.dm(audience, await this.posts.newGigMessage(view));
    }

    async update(user: Me, id: string, input: GigInput): Promise<GigView> {
        const gig = await this.row(id);
        if (!canEditGig(user, gig)) throw new ForbiddenException();
        const { objectives, slots, ...fields } = await this.prepare(user, input);

        await this.prisma.$transaction(async (tx) => {
            await tx.gig.update({ where: { id }, data: fields });
            await tx.gigObjective.deleteMany({ where: { gigId: id } });
            await this.writeObjectives(tx, id, objectives);
            await this.writeSlots(tx, id, slots);
        });

        await this.library.refreshUsage([fields.imageId, gig.imageId]);
        // More slots can mean room for reserves
        await this.afterRemoval(id);
        return this.view(id, user);
    }

    async delete(user: Me, id: string) {
        const gig = await this.row(id);
        if (!canDeleteGig(user, gig)) throw new ForbiddenException();
        await this.prisma.gig.delete({ where: { id } });
        await this.library.refreshUsage([gig.imageId]);
    }

    async approve(user: Me, id: string, approved: boolean): Promise<GigView> {
        const gig = await this.row(id);
        if (!user.isAdmin) throw new ForbiddenException();
        if (gig.status !== 'pending') throw new BadRequestException('Only pending gigs can be approved or rejected.');

        await this.prisma.gig.update({ where: { id }, data: { status: approved ? 'open' : 'rejected' } });
        if (approved) this.post(id, { after: (view) => this.announce(view, user.id) });
        else this.post(id);
        if (gig.createdBy !== user.id) {
            this.notify.fire('fixerApprovals', [gig.createdBy], linked(approved ? voice.gigApproved(gig.name) : voice.gigRejected(gig.name), 'Open on board', boardLink(gig)));
        }
        return this.view(id, user);
    }

    /** Lock or reopen sign-ups, or cancel. Completing goes through DebriefService. */
    async setStatus(user: Me, id: string, status: GigStatus): Promise<GigView> {
        const gig = await this.row(id);
        if (!user.isAdmin) throw new ForbiddenException();
        if (status === 'completed') throw new BadRequestException('Complete a gig with its debrief form.');
        if (!NEXT_STATUSES[gig.status].includes(status)) throw new BadRequestException(`Can't go from ${gig.status} to ${status}.`);

        await this.prisma.gig.update({ where: { id }, data: { status } });
        if (status === 'cancelled') {
            const players = (await this.playersOn(id)).filter((p) => p !== user.id);
            await this.clearReserves(id);
            this.notify.fire('gigUpdates', players, linked(voice.gigCancelled(gig.name), 'Open on board', boardLink(gig)));
        }
        this.post(id, { note: voice.statusChanged[status] });
        return this.view(id, user);
    }

    /** Players with a runner in a slot or on the reserves. */
    private async playersOn(id: string): Promise<string[]> {
        const [slots, reserves] = await Promise.all([
            this.prisma.gigSlot.findMany({ where: { gigId: id, userId: { not: null } }, select: { userId: true } }),
            this.prisma.gigReserve.findMany({ where: { gigId: id }, select: { userId: true } }),
        ]);
        return [...slots.map((s) => s.userId!), ...reserves.map((r) => r.userId)];
    }

    /** A finished gig has no one waiting for a slot. */
    async clearReserves(id: string, db: PrismaService | Tx = this.prisma) {
        await db.gigReserve.deleteMany({ where: { gigId: id } });
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
    async join(userId: string, id: string, runnerId?: string): Promise<Said> {
        const me = await this.members.me(userId);
        if (!me?.isEdgerunner) throw new ForbiddenException(voice.notRunner);

        const slot = await this.slotOf(id, userId);
        if (slot?.state === 'awaiting') return this.confirm(userId, id);
        if ((await this.row(id)).status !== 'open') throw new BadRequestException(voice.notOpen);
        // Before asking which runner, so nobody picks one only to be told no
        if (!slot && !(await this.isReserve(id, userId))) await this.checkLimit(this.prisma, userId);

        const added = await this.add(await this.pickRunner(userId, runnerId), id, null);
        if (added.reserve) return voice.reserve(added.reserve);
        return added.state === 'interested' ? voice.interested() : voice.joined(added.left);
    }

    /**
     * The player's runners, when they need to pick one to sign up with. Empty means no
     * choice is needed (or joining will fail anyway, which join() then explains).
     */
    async runnerChoices(userId: string, id: string): Promise<RunnerCard[]> {
        const gig = await this.prisma.gig.findUnique({ where: { id }, select: { status: true } });
        if (gig?.status !== 'open' || !this.members.isEdgerunner(userId)) return [];
        if ((await this.slotOf(id, userId)) || (await this.isReserve(id, userId))) return [];
        if (await this.atLimit(this.prisma, userId)) return [];
        const mine = await this.runnersOf(userId);
        return mine.length > 1 ? mine.map(toCard) : [];
    }

    /** Admin puts a runner on a gig. Same as them joining, except they're asked to confirm a set time. */
    async assign(user: Me, id: string, runnerId: string): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const runner = await this.prisma.runner.findUnique({ where: { id: runnerId } });
        const player = runner?.ownerId ? await this.members.me(runner.ownerId) : null;
        if (!runner || !player?.isEdgerunner) throw new BadRequestException('Only runners whose player has the edgerunner role can go on a gig.');
        if (runner.status !== 'active') throw new BadRequestException(`${runner.handle} is ${runner.status}.`);
        await this.add(runner, id, user.id);
        return this.view(id, user);
    }

    async confirm(userId: string, id: string): Promise<Said> {
        const gig = await this.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException(voice.notActive);
        if (!gig.sessionAt) throw new BadRequestException(voice.nothingToConfirm);

        const slot = await this.slotOf(id, userId);
        if (!slot) throw new BadRequestException((await this.isReserve(id, userId)) ? voice.alreadyReserve : voice.notIn);
        if (slot.state === 'confirmed') throw new BadRequestException(voice.alreadyConfirmed);

        await this.prisma.gigSlot.update({ where: { id: slot.id }, data: confirmedNow() });
        this.post(id);
        return voice.confirmed();
    }

    /** Drops a player's runner from their slot or the reserves. Works after sign-ups lock too. */
    async leave(userId: string, id: string) {
        const gig = await this.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException(voice.notActive);

        // The runner who left, or null if they weren't on it
        const removed = await this.prisma.$transaction(async (tx) => {
            await lockGig(tx, id);
            const slot = await tx.gigSlot.findFirst({ where: { gigId: id, userId } });
            if (slot) {
                await tx.gigSlot.update({ where: { id: slot.id }, data: emptied });
                return slot.runnerId;
            }
            const reserve = await tx.gigReserve.findUnique({ where: { gigId_userId: { gigId: id, userId } } });
            if (!reserve) return null;
            await tx.gigReserve.delete({ where: { gigId_userId: { gigId: id, userId } } });
            return reserve.runnerId;
        });
        if (!removed) throw new BadRequestException(voice.notIn);
        await this.afterRemoval(id);
    }

    /** Admin removes a runner from a slot. */
    async kick(user: Me, id: string, slotId: string): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!ACTIVE.includes((await this.row(id)).status)) throw new BadRequestException(voice.notActive);
        const slot = await this.prisma.gigSlot.findFirst({ where: { id: slotId, gigId: id } });
        if (!slot?.userId) throw new NotFoundException();

        await this.prisma.gigSlot.update({ where: { id: slotId }, data: emptied });
        if (slot.userId !== user.id) {
            const gig = await this.row(id);
            this.notify.fire('gigUpdates', [slot.userId], async () => linked(voice.kicked(gig.name, await this.handle(slot.runnerId)), 'Open on board', boardLink(gig)));
        }
        await this.afterRemoval(id);
        return this.view(id, user);
    }

    /** Admin removes a player's runner from the reserves. */
    async unreserve(user: Me, id: string, userId: string): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!ACTIVE.includes((await this.row(id)).status)) throw new BadRequestException(voice.notActive);
        if (!(await this.prisma.gigReserve.deleteMany({ where: { gigId: id, userId } })).count) throw new NotFoundException();
        this.post(id);
        return this.view(id, user);
    }

    /**
     * Sets or clears the session time and its estimated end. A new start time asks everyone in a
     * slot to confirm, again if it moved. Only changing the end just updates the post.
     */
    async setSession(user: Me, id: string, sessionAt: number | null, sessionEndAt: number | null = null): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const gig = await this.row(id);
        if (!ACTIVE.includes(gig.status) && gig.status !== 'pending') throw new BadRequestException(voice.notActive);
        const endAt = sessionAt ? sessionEndAt : null;

        if (sessionAt === (gig.sessionAt?.getTime() ?? null)) {
            if (endAt === (gig.sessionEndAt?.getTime() ?? null)) return this.view(id, user);
            await this.prisma.gig.update({ where: { id }, data: { sessionEndAt: endAt ? new Date(endAt) : null } });
            this.post(id, {});
            return this.view(id, user);
        }

        const others = await this.prisma.$transaction(async (tx) => {
            await tx.gig.update({
                where: { id },
                data: { sessionAt: sessionAt ? new Date(sessionAt) : null, sessionEndAt: endAt ? new Date(endAt) : null, remindedDay: false, remindedSoon: false },
            });
            const filled = { gigId: id, userId: { not: null } };
            await tx.gigSlot.updateMany({ where: filled, data: sessionAt ? asked() : { state: 'interested', askedAt: null, confirmedAt: null } });
            // Whoever set the time knows about it: their own runner is just coming
            if (sessionAt) await tx.gigSlot.updateMany({ where: { gigId: id, userId: user.id }, data: { ...confirmedNow(), askedAt: null } });
            return (await tx.gigSlot.findMany({ where: filled, select: { userId: true } })).map((s) => s.userId!).filter((u) => u !== user.id);
        });

        this.post(id, sessionAt ? { note: voice.sessionSet(sessionAt, endAt), ask: others } : { note: voice.sessionCleared() });
        // Setting a time asks everyone to confirm, which always goes; clearing it is a copy
        if (!sessionAt && gig.sessionAt) this.notify.fire('gigUpdates', others, linked(voice.sessionClearedFor(gig.name), 'Open on board', boardLink(gig)));
        return this.view(id, user);
    }

    /** Lifts a crew's hold on its slots in this gig, so any runner can take them. */
    async openCrewSlots(user: Me, id: string, crewId: string): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        if (!ACTIVE.includes((await this.row(id)).status)) throw new BadRequestException(voice.notActive);
        const crew = await this.prisma.crew.findUnique({ where: { id: crewId }, select: { name: true } });
        const { count } = await this.prisma.gigSlot.updateMany({ where: { gigId: id, crewId }, data: { crewId: null } });
        if (!count) throw new NotFoundException();

        await this.afterRemoval(id, voice.slotsOpened(crew?.name ?? 'The crew'));
        return this.view(id, user);
    }

    /**
     * Takes a runner off every unfinished gig, slots and reserves, when they're deleted, retire
     * or die. Reserves move up into the slots they leave. Finished gigs keep their record.
     */
    async dropRunner(runnerId: string) {
        const live = await this.prisma.gig.findMany({
            where: { status: { in: [...ACTIVE, 'pending'] }, OR: [{ slots: { some: { runnerId } } }, { reserves: { some: { runnerId } } }] },
            select: { id: true },
        });
        const liveIds = live.map((g) => g.id);
        await this.prisma.gigSlot.updateMany({ where: { runnerId, gigId: { in: liveIds } }, data: emptied });
        await this.prisma.gigReserve.deleteMany({ where: { runnerId, gigId: { in: liveIds } } });
        // Deleting the runner clears the rest itself: older slots lose the link, fixer links go
        for (const id of liveIds) await this.afterRemoval(id);
    }

    /** Takes a slot or a place on the reserves. The gig is locked meanwhile, so two people can't take the same slot. */
    /** `by`: the admin putting the runner on, or null when their player signs up. */
    private async add(runner: Runner, id: string, by: string | null): Promise<{ state?: RunnerState; left: number | null; reserve?: number }> {
        const userId = runner.ownerId!;
        const assigned = by !== null;
        const crewIds = await this.crewIds(runner.id);
        const result = await this.prisma.$transaction(async (tx) => {
            await lockGig(tx, id);
            const gig = await tx.gig.findUniqueOrThrow({ where: { id } });
            // Admins can still add runners once sign-ups are locked
            if (assigned ? !ACTIVE.includes(gig.status) : gig.status !== 'open') throw new BadRequestException(assigned ? voice.notActive : voice.notOpen);

            const slots = await tx.gigSlot.findMany({ where: { gigId: id } });
            if (slots.some((s) => s.userId === userId)) throw new BadRequestException(assigned ? voice.playerAlreadyIn : voice.alreadyIn);
            if (await tx.gigReserve.findUnique({ where: { gigId_userId: { gigId: id, userId } } })) {
                throw new BadRequestException(assigned ? voice.playerAlreadyReserve : voice.alreadyReserve);
            }
            // Admins putting someone on a gig can go over the limit
            if (!assigned && this.settings.get().maxSignups) {
                // One sign-up per player at a time, or two quick ones on different gigs could both fit
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
                await this.checkLimit(tx, userId);
            }

            const slot = pickSlot(slots, crewIds);
            if (!slot) {
                await tx.gigReserve.create({ data: { gigId: id, userId, runnerId: runner.id } });
                return { left: 0, reserve: await tx.gigReserve.count({ where: { gigId: id } }) };
            }

            // An admin's pick is asked to confirm, unless it's their own runner or the session is about to start (or has): then they're just on
            const ask = assigned && by !== userId && !tooLateToAsk(gig.sessionAt?.getTime() ?? 0);
            const state: RunnerState = !gig.sessionAt ? 'interested' : ask ? 'awaiting' : 'confirmed';
            const fields = state === 'awaiting' ? asked() : state === 'confirmed' ? confirmedNow() : { state };
            await tx.gigSlot.update({ where: { id: slot.id }, data: { userId, runnerId: runner.id, ...fields } });
            await this.keepSpares(tx, id);
            return { state, left: slots.some((s) => s.unlimited) ? null : slots.filter((s) => s.userId === null).length - 1 };
        });

        this.post(id, { ask: !result.reserve && result.state === 'awaiting' ? [userId] : [] });
        // Asked to confirm a set time instead, which always goes. An admin adding their own runner knows.
        if (assigned && by !== userId && result.state !== 'awaiting') {
            const gig = await this.row(id);
            this.notify.fire('gigUpdates', [userId], linked(voice.assigned(gig.name, runner.handle), 'Open on board', boardLink(gig)));
        }
        return result;
    }

    /**
     * After someone leaves (or slots change): fill gaps from the reserves and update the
     * post. Not once the session has happened: removing a no-show shouldn't pull a
     * reserve into a job they weren't on. `note` is for gig-wide news only; runners coming
     * and going show in the post's crew list instead of the thread.
     */
    private async afterRemoval(id: string, note?: Note) {
        const gig = await this.row(id);
        const played = !!gig.sessionAt && gig.sessionAt.getTime() <= Date.now();
        const promoted = await this.promote(id, ACTIVE.includes(gig.status) && !played);
        this.post(id, { note, ask: gig.sessionAt ? promoted.map((p) => p.userId) : [] });
        if (!gig.sessionAt) {
            for (const p of promoted) this.notify.fire('gigUpdates', [p.userId], async () => linked(voice.movedUp(gig.name, await this.handle(p.runnerId)), 'Open on board', boardLink(gig)));
        }
    }

    /**
     * Moves reserves into any empty slots they can take. A crew member sitting in an open slot
     * moves over to an empty slot of their crew first, so the open slot goes to a reserve.
     * `fill` false only tidies the spare slots. Returns who moved up.
     */
    private async promote(id: string, fill: boolean): Promise<{ userId: string; runnerId: string }[]> {
        return this.prisma.$transaction(async (tx) => {
            await lockGig(tx, id);
            const gig = await tx.gig.findUniqueOrThrow({ where: { id } });
            const reserves = fill ? await tx.gigReserve.findMany({ where: { gigId: id }, orderBy: { joinedAt: 'asc' } }) : [];
            // An unlimited group has room for every reserve. Back to one spare afterwards.
            await this.keepSpares(tx, id, Math.max(reserves.length, 1));
            if (!reserves.length) return [];
            let slots = await tx.gigSlot.findMany({ where: { gigId: id } });
            const runnerIds = [...reserves.map((r) => r.runnerId), ...slots.flatMap((s) => (s.runnerId ? [s.runnerId] : []))];
            const memberships = await tx.crewMember.findMany({ where: { runnerId: { in: runnerIds } } });
            const crewsOf = (runnerId: string | null) => memberships.filter((m) => m.runnerId === runnerId).map((m) => m.crewId);

            for (const { from, to } of shiftToCrewSlots(slots.map((s) => ({ ...s, crewIds: crewsOf(s.runnerId) })))) {
                const { userId, runnerId, state, askedAt, nudged, confirmedAt } = slots.find((s) => s.id === from)!;
                await tx.gigSlot.update({ where: { id: from }, data: emptied });
                await tx.gigSlot.update({ where: { id: to }, data: { userId, runnerId, state, askedAt, nudged, confirmedAt } });
                slots = slots.map((s) => (s.id === to ? { ...s, userId, runnerId } : s.id === from ? { ...s, userId: null, runnerId: null } : s));
            }

            const moves = fillFromReserves(
                slots,
                reserves.map((r) => ({ userId: r.userId, crewIds: crewsOf(r.runnerId) })),
            );
            const moved: { userId: string; runnerId: string }[] = [];
            for (const { slotId, userId } of moves) {
                const runnerId = reserves.find((r) => r.userId === userId)!.runnerId;
                await tx.gigSlot.update({ where: { id: slotId }, data: { userId, runnerId, ...(gig.sessionAt ? asked() : { state: 'interested' }) } });
                await tx.gigReserve.delete({ where: { gigId_userId: { gigId: id, userId } } });
                moved.push({ userId, runnerId });
            }
            await this.keepSpares(tx, id);
            return moved;
        });
    }

    /** Slots and reserve places on live gigs, across all the player's runners. */
    private async signupCount(db: PrismaService | Tx, userId: string): Promise<number> {
        const live = { userId, gig: { status: { in: ACTIVE } } };
        return (await db.gigSlot.count({ where: live })) + (await db.gigReserve.count({ where: live }));
    }

    private async atLimit(db: PrismaService | Tx, userId: string): Promise<boolean> {
        const { maxSignups } = this.settings.get();
        return !!maxSignups && (await this.signupCount(db, userId)) >= maxSignups;
    }

    private async checkLimit(db: PrismaService | Tx, userId: string) {
        if (await this.atLimit(db, userId)) throw new BadRequestException(voice.atLimit(this.settings.get().maxSignups));
    }

    async mySignups(userId: string): Promise<MySignups> {
        return { used: await this.signupCount(this.prisma, userId), max: this.settings.get().maxSignups };
    }

    /** Which of the player's runners is signing up. One runner means no need to ask. */
    private async pickRunner(userId: string, runnerId?: string): Promise<Runner> {
        const mine = await this.runnersOf(userId);
        if (runnerId !== undefined) {
            const runner = mine.find((r) => r.id === runnerId);
            if (!runner) throw new BadRequestException("That runner isn't yours, or isn't taking gigs.");
            return runner;
        }
        if (mine.length === 1) return mine[0];
        throw new BadRequestException(mine.length ? voice.pickRunner : voice.noRunner(config.PUBLIC_URL));
    }

    /** The player's runners still taking gigs. */
    private runnersOf(userId: string): Promise<Runner[]> {
        return this.prisma.runner.findMany({ where: { ownerId: userId, status: 'active' }, orderBy: { handle: 'asc' } });
    }

    private async crewIds(runnerId: string): Promise<string[]> {
        return (await this.prisma.crewMember.findMany({ where: { runnerId }, select: { crewId: true } })).map((m) => m.crewId);
    }

    private slotOf(id: string, userId: string) {
        return this.prisma.gigSlot.findFirst({ where: { gigId: id, userId } });
    }

    private async isReserve(id: string, userId: string): Promise<boolean> {
        return !!(await this.prisma.gigReserve.findUnique({ where: { gigId_userId: { gigId: id, userId } } }));
    }

    /** A runner's handle for the bot's messages. */
    async handle(runnerId: string | null): Promise<string> {
        const runner = runnerId ? await this.prisma.runner.findUnique({ where: { id: runnerId }, select: { handle: true } }) : null;
        return runner?.handle ?? 'A runner';
    }

    /** Active gigs with slots for this crew. Look them up before deleting a crew, then refresh them. */
    async gigsForCrew(crewId: string): Promise<string[]> {
        const rows = await this.prisma.gig.findMany({ where: { status: { in: ACTIVE }, slots: { some: { crewId } } }, select: { id: true } });
        return rows.map((r) => r.id);
    }

    /** Fills open slots from the reserves (after crew changes) and updates the posts. */
    async refill(ids: string[]) {
        for (const id of ids) await this.afterRemoval(id);
    }

    /** Re-posts gigs after something they show changes (a crew renamed, a runner edited). */
    refresh(ids: string[]) {
        for (const id of ids) this.post(id);
    }

    /** Gigs that are live (open or locked), newest first. For /gig suggestions. */
    live(): Promise<{ id: string; name: string }[]> {
        return this.prisma.gig.findMany({ where: { status: { in: ACTIVE } }, select: { id: true, name: true }, orderBy: { createdAt: 'desc' } });
    }

    /** Live gigs where the player has a runner in a slot or on the reserves. For /mygigs. */
    async forPlayer(userId: string): Promise<GigView[]> {
        const rows = await this.prisma.gig.findMany({
            where: { status: { in: ACTIVE }, OR: [{ slots: { some: { userId } } }, { reserves: { some: { userId } } }] },
            include: GIG_INCLUDE,
        });
        const views = await Promise.all(rows.map((g) => this.toView(g, userId)));
        return views.sort((a, b) => (a.sessionAt ?? Infinity) - (b.sessionAt ?? Infinity));
    }

    countOpen(): Promise<number> {
        return this.prisma.gig.count({ where: { status: 'open' } });
    }

    /** Brings back the post of a live gig that Discord archived or someone closed. */
    async keepOpen(threadId: string) {
        const gig = await this.prisma.gig.findUnique({ where: { threadId }, select: { id: true, status: true } });
        if (gig && ACTIVE.includes(gig.status)) this.post(gig.id);
    }

    /** Refreshes every live post: on startup (so format changes reach old posts) and every few hours. */
    @Once('clientReady')
    async refreshAll() {
        const live = await this.prisma.gig.findMany({ where: { status: { in: ACTIVE } }, select: { id: true } });
        for (const { id } of live) this.post(id);
        if (!this.timers.length) {
            this.timers.push(
                setInterval(() => void this.refreshAll().catch((err) => this.logger.error(`Refresh failed: ${err}`)), SWEEP_MS),
                setInterval(() => void this.tick().catch((err) => this.logger.error(`Clock failed: ${err}`)), CLOCK_MS),
            );
            this.timers.forEach((t) => t.unref());
            await this.tick();
        }
    }

    /** Posts scheduled drafts and sends whatever reminders, nudges and no-response drops are due. Runs every minute. */
    async tick(now = Date.now()) {
        await this.postScheduled(now);
        const { reminderHours, confirmHours } = this.settings.get();
        const upcoming = await this.prisma.gig.findMany({ where: { status: { in: ACTIVE }, sessionAt: { gt: new Date(now) } }, include: { slots: true } });

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
                // The 30-minute reminder covers the day-of one too, so that never comes after it
                await this.prisma.gig.update({ where: { id: gig.id }, data: work.remind === 'soon' ? { remindedDay: true, remindedSoon: true } : { remindedDay: true } });
                // The day reminder skips anyone who confirmed within the last reminderHours: they've only just said yes
                const recent = now - reminderHours * HOUR;
                const confirmed = gig.slots
                    .filter((s) => s.userId && s.state === 'confirmed' && (work.remind === 'soon' || !s.confirmedAt || s.confirmedAt.getTime() < recent))
                    .map((s) => s.userId!);
                const wanting: string[] = [];
                for (const userId of confirmed) if ((await this.prefs.get(userId)).reminders) wanting.push(userId);
                const kind = work.remind;
                this.post(gig.id, { after: (view, threadId) => this.posts.remind(view, threadId, wanting, kind) });
            }

            for (const userId of work.nudge) {
                const slot = awaiting.find((s) => s.userId === userId)!;
                await this.prisma.gigSlot.update({ where: { id: slot.id }, data: { nudged: true } });
                const confirmBy = confirmDeadline(slot.askedAt?.getTime() ?? now, sessionAt, confirmHours);
                this.post(gig.id, { after: (view, threadId) => this.posts.askToConfirm(view, threadId, [userId], confirmBy, true) });
            }

            if (work.drop.length) {
                await this.prisma.gigSlot.updateMany({ where: { gigId: gig.id, userId: { in: work.drop } }, data: emptied });
                const dropped = work.drop;
                await this.afterRemoval(gig.id);
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
    private async prepare(user: Me, input: GigInput) {
        const fixer = await this.resolveFixer(user, input);
        if (input.imageId && !(await this.library.exists(input.imageId))) throw new BadRequestException('That picture is gone. Pick another.');
        const imageId = input.imageId ?? (await this.library.pick(input.location));
        return { ...input, fixerName: fixer.name, fixerRunnerId: fixer.runnerId, fixerId: fixer.userId, imageId };
    }

    /** The same for a draft, which can leave things blank. A fixer who can't be worked out yet stays empty. */
    private async prepareDraft(user: Me, input: GigDraftInput) {
        const fixer = await this.resolveFixer(user, input).catch((err) => {
            if (err instanceof BadRequestException) return { name: input.fixerName, runnerId: null, userId: null };
            throw err;
        });
        if (input.imageId && !(await this.library.exists(input.imageId))) throw new BadRequestException('That picture is gone. Pick another.');
        return { ...input, fixerName: fixer.name, fixerRunnerId: fixer.runnerId, fixerId: fixer.userId };
    }

    private async resolveFixer(user: Me, input: GigInput): Promise<{ name: string; runnerId: string | null; userId: string | null }> {
        if (input.fixerRunnerId) {
            const runner = await this.prisma.runner.findUnique({ where: { id: input.fixerRunnerId } });
            if (!runner || !this.members.isFixerRunner({ ...runner, extraRoles: stringList(runner.extraRoles) })) throw new BadRequestException("That character isn't a fixer.");
            if (!user.isAdmin && runner.ownerId !== user.id) throw new ForbiddenException();
            return { name: runner.fixerAlias ?? runner.handle, runnerId: runner.id, userId: runner.ownerId };
        }
        if (user.isAdmin) {
            if (!input.fixerName) throw new BadRequestException('Pick a fixer or type a name.');
            return { name: input.fixerName, runnerId: null, userId: null };
        }
        // A fixer with a single fixer character doesn't need to pick
        const own = (await this.runnersOf(user.id)).filter((r) => this.members.isFixerRunner({ ...r, extraRoles: stringList(r.extraRoles) }));
        if (own.length === 1) return { name: own[0].fixerAlias ?? own[0].handle, runnerId: own[0].id, userId: user.id };
        throw new BadRequestException(own.length ? 'Pick which of your fixers this gig is from.' : 'Make a fixer character first: a runner with the Fixer role.');
    }

    /**
     * Updates the gig's post, then posts `note` in its thread, asks the `ask` players to
     * confirm the session time by DM, and runs `after` for anything else that needs the post.
     * Queued per gig and run in the background; failures are logged.
     */
    post(id: string, { note, ask = [], after }: { note?: Note; ask?: string[]; after?: AfterPost } = {}) {
        const previous = this.postQueue.get(id) ?? Promise.resolve();
        const next = previous.then(async () => {
            try {
                const gig = await this.row(id);
                const view = await this.view(id);
                const overflow = stringList(gig.overflowMessageIds);
                const { threadId, overflowIds } = await this.posts.sync(view, { threadId: gig.threadId, overflowIds: overflow, cardKey: gig.cardKey }, note);
                if (threadId !== gig.threadId || overflowIds.join() !== overflow.join()) {
                    await this.prisma.gig.update({ where: { id }, data: { threadId, overflowMessageIds: overflowIds } });
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

    async row(id: string) {
        const gig = await this.prisma.gig.findUnique({ where: { id } });
        if (!gig) throw new NotFoundException('No such gig.');
        return gig;
    }

    /**
     * `viewer` fills in their own rating of the fixer. A signed in admin, or the gig's fixer or
     * poster, also gets undisclosed objectives' details. No viewer (Discord) gets the public view.
     */
    async view(id: string, viewer?: Me | string): Promise<GigView> {
        const gig = await this.prisma.gig.findUnique({ where: { id }, include: GIG_INCLUDE });
        if (!gig) throw new NotFoundException('No such gig.');
        return this.toView(gig, viewer);
    }

    /** When an awaiting runner gets dropped if they don't confirm. */
    private confirmBy(slot: { state: RunnerState; askedAt: Date | null }, sessionAt: Date | null): number | null {
        if (slot.state !== 'awaiting' || !sessionAt || !slot.askedAt) return null;
        return confirmDeadline(slot.askedAt.getTime(), sessionAt.getTime(), this.settings.get().confirmHours);
    }

    private async toView(gig: GigRow, viewer?: Me | string): Promise<GigView> {
        const userId = typeof viewer === 'string' ? viewer : viewer?.id;
        const insider = typeof viewer === 'object' && (viewer.isAdmin || viewer.id === gig.createdBy || viewer.id === gig.fixerId);
        const revealed = objectivesRevealed(gig.status);
        const rating = userId ? await this.prisma.fixerRating.findUnique({ where: { gigId_userId: { gigId: gig.id, userId } } }) : null;
        const done = gig.status === 'completed';
        const fixer = gig.fixerRunner;

        return {
            id: gig.id,
            ref: gigRef(gig),
            name: gig.name,
            fixerName: fixer ? (fixer.fixerAlias ?? fixer.handle) : gig.fixerName,
            fixerRunnerId: gig.fixerRunnerId,
            fixerImageId: fixer?.imageId ?? null,
            fixerId: gig.fixerId,
            location: gig.location,
            type: gig.type,
            pay: gig.pay,
            splitPay: gig.splitPay,
            brief: gig.brief,
            primaryObjective: stringList(gig.primaryObjective),
            imageId: gig.imageId,
            objectives: gig.objectives.map((o) => {
                const secret = o.hidden && !revealed;
                // Players don't get an undisclosed objective's details at all, not just hidden on screen
                if (secret && !insider) return { text: '', bonus: null, each: false, hidden: true, secret };
                return { text: o.text, bonus: o.bonus, each: o.each, hidden: o.hidden, secret };
            }),
            slots: gig.slots.map((s) => ({
                id: s.id,
                crew: s.crew ? { id: s.crew.id, name: s.crew.name } : null,
                runner: s.userId ? (s.runner ? toCard(s.runner) : unknownRunner(s.userId)) : null,
                state: s.state,
                confirmBy: this.confirmBy(s, gig.sessionAt),
                unlimited: s.unlimited,
            })),
            reserves: gig.reserves.map((r) => toCard(r.runner)),
            sessionAt: gig.sessionAt?.getTime() ?? null,
            sessionEndAt: gig.sessionEndAt?.getTime() ?? null,
            scheduled: gig.status === 'draft' && gig.postAt && gig.postBy ? { at: gig.postAt.getTime(), by: this.members.member(gig.postBy) } : null,
            status: gig.status,
            createdBy: this.members.member(gig.createdBy),
            threadUrl: gig.threadId ? `https://discord.com/channels/${this.settings.get().guildId}/${gig.threadId}` : null,
            createdAt: gig.createdAt.getTime(),
            summary: done ? gig.summary : null,
            crewRewards: done ? { eb: gig.rewardEb, ip: gig.rewardIp, hqIp: gig.rewardHqIp, text: gig.rewardText } : null,
            runnerRewards: gig.rewards.map((r) => ({ runner: toCard(r.runner), eb: r.eb, ip: r.ip, hqIp: r.hqIp, text: r.text, share: r.share })),
            canRate: done && !!gig.fixerRunnerId && !!userId && gig.slots.some((s) => s.userId === userId),
            myRating: rating ? { stars: rating.stars, comment: rating.comment } : null,
        };
    }

    private async writeObjectives(tx: Tx, gigId: string, objectives: GigInput['objectives']) {
        if (!objectives.length) return;
        await tx.gigObjective.createMany({ data: objectives.map((o, position) => ({ gigId, text: o.text, bonus: o.bonus, each: o.each, hidden: o.hidden, position })) });
    }

    private async writeSlots(tx: Tx, gigId: string, groups: GigInput['slots']) {
        const existing = await tx.gigSlot.findMany({ where: { gigId }, orderBy: { position: 'asc' } });
        let changes;
        try {
            changes = diffSlots(existing, groups);
        } catch (err) {
            throw new BadRequestException((err as Error).message);
        }
        if (changes.remove.length) await tx.gigSlot.deleteMany({ where: { id: { in: changes.remove }, userId: null } });
        if (changes.add.length) {
            const start = existing.length ? Math.max(...existing.map((s) => s.position)) + 1 : 0;
            await tx.gigSlot.createMany({ data: changes.add.map((crewId, i) => ({ gigId, crewId, position: start + i })) });
        }
        const unlimited = unlimitedGroups(groups);
        for (const crewId of new Set(groups.map((g) => g.crewId))) await tx.gigSlot.updateMany({ where: { gigId, crewId }, data: { unlimited: unlimited.has(crewId) } });
    }

    /** Gives each unlimited group `spare` empty slots. */
    private async keepSpares(tx: Tx, gigId: string, spare = 1) {
        const slots = await tx.gigSlot.findMany({ where: { gigId }, orderBy: { position: 'asc' } });
        const { add, remove } = spareChanges(slots, spare);
        if (remove.length) await tx.gigSlot.deleteMany({ where: { id: { in: remove }, userId: null } });
        if (add.length) {
            const start = Math.max(...slots.map((s) => s.position)) + 1;
            await tx.gigSlot.createMany({ data: add.map((crewId, i) => ({ gigId, crewId, unlimited: true, position: start + i })) });
        }
    }
}

/**
 * Holds the gig's row until the transaction ends, so changes to its slots and reserves happen
 * one at a time. Without it, two people could take the same last slot.
 */
async function lockGig(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM gigs WHERE id = ${id}::uuid FOR UPDATE`;
}

/** A gig's page on the board. */
const boardLink = (gig: { id: string; name: string }) => `${config.PUBLIC_URL}/gigs/${gigRef(gig)}`;

/** A sign-up whose runner was deleted. */
const unknownRunner = (userId: string): RunnerCard => ({ id: '', slug: '', handle: 'Unknown runner', role: '', extraRoles: [], imageId: null, tagline: null, ownerId: userId, status: 'active' });

type AfterPost = (view: GigView, threadId: string) => Promise<void>;
