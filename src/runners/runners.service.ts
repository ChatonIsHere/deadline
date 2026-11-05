import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, avg, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { crewMembers, crews, fixerRatings, gigs, gigSlots, runners } from '../db/schema';
import { MembersService } from '../discord/members.service';
import { GigsService, toCard } from '../gigs/gigs.service';
import { LibraryService } from '../library/library.service';
import { SettingsService } from '../settings/settings.service';
import { canSeeGig } from '../shared/permissions';
import { FIXER_ROLE, type FixerSummary, type GigLink, type Me, type Rating, type RunnerCard, type RunnerInput, type RunnerSummary, type RunnerView } from '../shared/schemas';

type Runner = typeof runners.$inferSelect;

/** Players' characters, and the fixers among them (plus NPC fixers that admins add). */
@Injectable()
export class RunnersService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly members: MembersService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        private readonly gigs: GigsService,
    ) {}

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
        const memberOf = this.db.select({ id: crews.id, name: crews.name }).from(crewMembers).innerJoin(crews, eq(crews.id, crewMembers.crewId)).where(eq(crewMembers.runnerId, id)).all();
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
        };
    }

    /** Anyone signed in can make runners. Only admins can make NPC fixers (no player). */
    create(user: Me, input: RunnerInput): RunnerView {
        if (input.npc && !user.isAdmin) throw new ForbiddenException();
        this.check(input);
        if (input.npc && input.role !== FIXER_ROLE && !input.extraRoles.includes(FIXER_ROLE)) {
            throw new BadRequestException('An NPC fixer needs the Fixer role.');
        }
        const { npc, ...fields } = input;
        const [row] = this.db
            .insert(runners)
            .values({ ...fields, ownerId: npc ? null : user.id })
            .returning({ id: runners.id })
            .all();
        return this.get(user, row.id);
    }

    update(user: Me, id: number, input: RunnerInput): RunnerView {
        const r = this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        this.check(input, r);
        const { npc: _, ...fields } = input;
        this.db.update(runners).set(fields).where(eq(runners.id, id)).run();
        this.gigs.refresh(this.liveGigs(id));
        return this.get(user, id);
    }

    delete(user: Me, id: number) {
        const r = this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        this.gigs.dropRunner(id);
        this.db.delete(runners).where(eq(runners.id, id)).run();
    }

    canManage(user: Me, runner: { ownerId: string | null }) {
        return user.isAdmin || runner.ownerId === user.id;
    }

    private summary(r: Runner): RunnerSummary {
        return { ...toCard(r), owner: r.ownerId ? this.members.member(r.ownerId) : null, isFixer: this.members.isFixerRunner(r) };
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

    private row(id: number): Runner {
        const r = this.db.query.runners.findFirst({ where: eq(runners.id, id) }).sync();
        if (!r) throw new NotFoundException('No such runner.');
        return r;
    }
}
