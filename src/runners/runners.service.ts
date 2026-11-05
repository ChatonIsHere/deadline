import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, avg, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { CrewsService } from '../crews/crews.service';
import { DB, Db } from '../db/db';
import { freeSlug } from '../db/slugs';
import { isNumericId } from '../shared/slug';
import { crewMembers, crews, fixerRatings, gigReserves, gigs, gigSlots, runners } from '../db/schema';
import { MembersService } from '../discord/members.service';
import { GigsService, toCard } from '../gigs/gigs.service';
import { LibraryService } from '../library/library.service';
import { SettingsService } from '../settings/settings.service';
import { canLogIn, canSeeGig } from '../shared/permissions';
import { FIXER_ROLE, type FixerSummary, type GigLink, type Me, type Rating, type RunnerCard, type Review, type RunnerInput, type RunnerSummary, type RunnerView } from '../shared/schemas';

type Runner = typeof runners.$inferSelect;

/** Players' characters, and the fixers among them (plus NPC fixers that admins add). */
@Injectable()
export class RunnersService implements OnModuleInit {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly members: MembersService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        private readonly gigs: GigsService,
        private readonly crews: CrewsService,
    ) {}

    /** Runners from before typed IDs get one made from their handle. */
    onModuleInit() {
        for (const r of this.db.select().from(runners).where(isNull(runners.slug)).all()) {
            this.db.update(runners).set({ slug: this.newSlug(r.handle) }).where(eq(runners.id, r.id)).run();
        }
    }

    /** A runner's numeric ID from a URL part: the ID itself or a typed one. */
    resolve(ref: string): number {
        if (isNumericId(ref)) return Number(ref);
        const r = this.db.query.runners.findFirst({ where: eq(runners.slug, ref.toLowerCase()) }).sync();
        if (!r) throw new NotFoundException('No such runner.');
        return r.id;
    }

    /** Every player's runners. NPC fixers only show on the Fixers tab. */
    list(): RunnerSummary[] {
        return this.db.query.runners
            .findMany({ where: isNotNull(runners.ownerId), orderBy: runners.handle })
            .sync()
            .map((r) => this.summary(r));
    }

    /** Runners that count as fixers, with their ratings. */
    fixers(): FixerSummary[] {
        return this.db.query.runners
            .findMany({ orderBy: runners.handle })
            .sync()
            .filter((r) => this.members.isFixerRunner(r))
            .map((r) => ({
                ...this.summary(r),
                officeLocation: r.officeLocation,
                specialties: r.specialties,
                rating: this.rating(r.id),
                gigCount: this.db.select({ n: count() }).from(gigs).where(eq(gigs.fixerRunnerId, r.id)).get()!.n,
            }));
    }

    /** Runners whose handle contains `query`, for Discord command suggestions. */
    search(query: string, fixersOnly = false): RunnerCard[] {
        const q = query.trim().toLowerCase();
        return this.db.query.runners
            .findMany({ orderBy: runners.handle })
            .sync()
            .filter((r) => r.handle.toLowerCase().includes(q) && (fixersOnly ? this.members.isFixerRunner(r) : !!r.ownerId))
            .slice(0, 25)
            .map(toCard);
    }

    /** The signed in player's own runners. */
    mine(userId: string): RunnerCard[] {
        return this.db.query.runners
            .findMany({ where: eq(runners.ownerId, userId), orderBy: runners.handle })
            .sync()
            .map(toCard);
    }

    get(user: Me, id: number): RunnerView {
        const r = this.row(id);
        const visible = (gig: typeof gigs.$inferSelect) => canSeeGig(user, gig);
        const link = (g: typeof gigs.$inferSelect): GigLink => ({ id: g.id, name: g.name, status: g.status, sessionAt: g.sessionAt?.getTime() ?? null });

        const gigIds = this.db
            .selectDistinct({ id: gigSlots.gigId })
            .from(gigSlots)
            .where(eq(gigSlots.runnerId, id))
            .all()
            .map((g) => g.id);
        const ran = gigIds.length ? this.db.query.gigs.findMany({ where: inArray(gigs.id, gigIds) }).sync() : [];
        const fixed = this.db.query.gigs.findMany({ where: eq(gigs.fixerRunnerId, id) }).sync();
        const memberOf = this.db.select({ id: crews.id, slug: sql<string>`coalesce(${crews.slug}, ${crews.id})`, name: crews.name }).from(crewMembers).innerJoin(crews, eq(crews.id, crewMembers.crewId)).where(eq(crewMembers.runnerId, id)).all();
        const newest = (a: typeof gigs.$inferSelect, b: typeof gigs.$inferSelect) => b.createdAt.getTime() - a.createdAt.getTime();

        return {
            ...this.summary(r),
            officeLocation: r.officeLocation,
            specialties: r.specialties,
            contact: r.contact,
            bio: r.bio,
            crews: memberOf,
            gigs: ran.filter(visible).sort(newest).map(link),
            fixerGigs: fixed.filter(visible).sort(newest).map(link),
            rating: this.rating(id),
            reviews: this.members.isFixerRunner(r) ? this.reviews(id) : [],
        };
    }

    /**
     * Anyone signed in can make runners for themselves. On the web, admins can also make
     * them for any player, or NPC fixers with no player.
     */
    async create(user: Me, input: RunnerInput): Promise<RunnerView> {
        const { ownerId: requested, slug: wanted, ...fields } = input;
        const ownerId = requested === undefined ? user.id : requested;
        await this.checkOwner(user, ownerId, input);
        this.check(input);
        if (wanted && this.slugTaken(wanted)) throw new ConflictException('That ID is taken.');
        const slug = wanted ?? this.newSlug(input.handle);
        const [row] = this.db
            .insert(runners)
            .values({ ...fields, ownerId, slug })
            .returning({ id: runners.id })
            .all();
        return this.get(user, row.id);
    }

    /** Players edit their own runners. Admins edit any, and can hand a runner to another player. */
    async update(user: Me, id: number, input: RunnerInput): Promise<RunnerView> {
        const r = this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        // The typed ID is set when the runner is made and stays
        const { ownerId: requested, slug: _slug, ...fields } = input;
        const ownerId = requested === undefined ? r.ownerId : requested;
        if (ownerId !== r.ownerId) {
            await this.checkOwner(user, ownerId, input);
            // Moving a runner mid-gig could give their new player two runners on it
            if (this.onLiveGigs(id)) throw new BadRequestException('Take this runner off their live gigs before giving them to another player.');
        } else if (!ownerId && !hasFixerRole(input)) {
            throw new BadRequestException('An NPC needs the Fixer role.');
        }
        this.check(input, r);
        this.db
            .update(runners)
            .set({ ...fields, ownerId })
            .where(eq(runners.id, id))
            .run();
        // A fixer character's gigs follow it to its new player
        if (ownerId !== r.ownerId) this.db.update(gigs).set({ fixerId: ownerId }).where(eq(gigs.fixerRunnerId, id)).run();
        this.gigs.refresh(this.liveGigs(id));
        return this.get(user, id);
    }

    /** Only admins pick someone else (or nobody) as the player. Players must be on the server with a role. */
    private async checkOwner(user: Me, ownerId: string | null, input: RunnerInput) {
        if (ownerId === user.id) return;
        if (!user.isAdmin) throw new ForbiddenException();
        if (ownerId === null) {
            if (!hasFixerRole(input)) throw new BadRequestException('An NPC needs the Fixer role.');
            return;
        }
        const player = await this.members.me(ownerId);
        if (!player || !canLogIn(player)) throw new BadRequestException("That person isn't on the server with a role.");
    }

    /** In a slot or on the reserves of a gig that isn't finished. */
    private onLiveGigs(id: number): boolean {
        const live = ['pending', 'open', 'closed'] as const;
        const inSlot = this.db
            .select({ id: gigSlots.id })
            .from(gigSlots)
            .innerJoin(gigs, eq(gigs.id, gigSlots.gigId))
            .where(and(eq(gigSlots.runnerId, id), inArray(gigs.status, [...live])))
            .get();
        const reserved = this.db
            .select({ id: gigReserves.gigId })
            .from(gigReserves)
            .innerJoin(gigs, eq(gigs.id, gigReserves.gigId))
            .where(and(eq(gigReserves.runnerId, id), inArray(gigs.status, [...live])))
            .get();
        return !!inSlot || !!reserved;
    }

    delete(user: Me, id: number) {
        const r = this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        this.gigs.dropRunner(id);
        const crewIds = this.crews.crewsOf(id);
        this.db.delete(runners).where(eq(runners.id, id)).run();
        this.crews.keepFounders(crewIds);
    }

    canManage(user: Me, runner: { ownerId: string | null }) {
        return user.isAdmin || runner.ownerId === user.id;
    }

    private summary(r: Runner): RunnerSummary {
        return {
            ...toCard(r),
            owner: r.ownerId ? this.members.member(r.ownerId) : null,
            canTakeGigs: !!r.ownerId && this.members.isEdgerunner(r.ownerId),
            isFixer: this.members.isFixerRunner(r),
        };
    }

    /** Average stars from players who went on this fixer's gigs. */
    private rating(fixerId: number): Rating {
        const row = this.db
            .select({ average: avg(fixerRatings.stars), count: count() })
            .from(fixerRatings)
            .innerJoin(gigs, eq(gigs.id, fixerRatings.gigId))
            .where(eq(gigs.fixerRunnerId, fixerId))
            .get();
        return { average: row?.average ? Number(row.average) : null, count: row?.count ?? 0 };
    }

    /** The fixer's latest five ratings, newest first, with the runner each rater had on the gig. */
    private reviews(fixerId: number): Review[] {
        const rows = this.db
            .select({ stars: fixerRatings.stars, comment: fixerRatings.comment, at: fixerRatings.ratedAt, userId: fixerRatings.userId, gigId: gigs.id, gigName: gigs.name })
            .from(fixerRatings)
            .innerJoin(gigs, eq(gigs.id, fixerRatings.gigId))
            .where(eq(gigs.fixerRunnerId, fixerId))
            .orderBy(desc(fixerRatings.ratedAt), desc(gigs.id))
            .limit(5)
            .all();
        return rows.map((r) => {
            const slot = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.gigId, r.gigId), eq(gigSlots.userId, r.userId)) }).sync();
            const by = slot?.runnerId ? this.db.query.runners.findFirst({ where: eq(runners.id, slot.runnerId) }).sync() : undefined;
            return { stars: r.stars, comment: r.comment, gig: { id: r.gigId, name: r.gigName }, by: by ? toCard(by) : null, at: r.at?.getTime() ?? null };
        });
    }

    /** Roles have to come from the list in Settings, but a runner keeps roles that were taken off it since. */
    private check(input: RunnerInput, existing?: Runner) {
        const allowed = new Set([...this.settings.get().runnerRoles, ...(existing ? [existing.role, ...existing.extraRoles] : [])]);
        for (const role of [input.role, ...input.extraRoles]) {
            if (!allowed.has(role)) throw new BadRequestException(`"${role}" isn't one of the roles.`);
        }
        if (input.imageId && !this.library.exists(input.imageId)) throw new BadRequestException('That picture is gone. Upload it again.');
    }

    /** Live gigs that show this runner, as a runner or the fixer. */
    private liveGigs(id: number): number[] {
        const asRunner = this.db
            .selectDistinct({ id: gigSlots.gigId })
            .from(gigSlots)
            .innerJoin(gigs, eq(gigs.id, gigSlots.gigId))
            .where(and(eq(gigSlots.runnerId, id), inArray(gigs.status, ['open', 'closed'])))
            .all();
        const asFixer = this.db
            .select({ id: gigs.id })
            .from(gigs)
            .where(and(eq(gigs.fixerRunnerId, id), inArray(gigs.status, ['open', 'closed'])))
            .all();
        return [...new Set([...asRunner, ...asFixer].map((g) => g.id))];
    }

    private slugTaken(slug: string) {
        return !!this.db.query.runners.findFirst({ where: eq(runners.slug, slug) }).sync();
    }

    private newSlug(handle: string) {
        return freeSlug(handle, 'runner', (s) => this.slugTaken(s));
    }

    private row(id: number): Runner {
        const r = this.db.query.runners.findFirst({ where: eq(runners.id, id) }).sync();
        if (!r) throw new NotFoundException('No such runner.');
        return r;
    }
}

const hasFixerRole = (r: { role: string; extraRoles: string[] }) => r.role === FIXER_ROLE || r.extraRoles.includes(FIXER_ROLE);
