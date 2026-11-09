import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type Gig, Prisma, type Runner } from '@prisma/client';
import { CrewsService } from '../crews/crews.service';
import { MembersService } from '../discord/members.service';
import { GigsService, toCard } from '../gigs/gigs.service';
import { LibraryService } from '../library/library.service';
import { stringList } from '../prisma/json';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { canLogIn, canSeeGig } from '../shared/permissions';
import { CUSTOM_LIVING, hasLiving } from '../shared/downtime';
import { FIXER_ROLE, type FixerSummary, type GigLink, type Me, type Rating, type RetireInput, type RunnerCard, type Review, type RunnerInput, type RunnerSummary, type RunnerView } from '../shared/schemas';
import { gigRef, isFreeSlugWord, isUuid, toSlug } from '../shared/slug';
import { DowntimeService } from './downtime.service';

const UNFINISHED = ['pending', 'open', 'closed'] as const;
const LIVE = ['open', 'closed'] as const;

/** Players' characters, and the fixers among them (plus NPC fixers that admins add). */
@Injectable()
export class RunnersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly members: MembersService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        private readonly gigs: GigsService,
        private readonly crews: CrewsService,
        private readonly downtime: DowntimeService,
    ) {}

    /** A runner's ID from a URL part: its link (the handle, or a fixer's alias) or its UUID. */
    async resolve(ref: string): Promise<string> {
        const slug = toSlug(ref);
        const r = await this.prisma.runner.findFirst({ where: isUuid(ref) ? { id: ref.toLowerCase() } : { OR: [{ slug }, { fixerSlug: slug }] }, select: { id: true } });
        if (!r) throw new NotFoundException('No such runner.');
        return r.id;
    }

    /** Every player's runners. NPC fixers only show on the Fixers tab. */
    async list(): Promise<RunnerSummary[]> {
        const rows = await this.prisma.runner.findMany({ where: { ownerId: { not: null } }, orderBy: { handle: 'asc' } });
        return rows.map((r) => this.summary(r));
    }

    /** Runners that count as fixers, with their ratings. Retired and dead ones are left out. */
    async fixers(): Promise<FixerSummary[]> {
        const rows = await this.prisma.runner.findMany({ where: { status: 'active' }, orderBy: { handle: 'asc' }, include: { _count: { select: { fixedGigs: true } } } });
        const fixers = rows.filter((r) => this.isFixer(r));
        const ratings = await this.ratings(fixers.map((r) => r.id));
        return fixers.map((r) => ({
            ...this.summary(r),
            officeLocation: r.officeLocation,
            specialties: r.specialties,
            rating: ratings.get(r.id) ?? { average: null, count: 0 },
            gigCount: r._count.fixedGigs,
        }));
    }

    /** Runners whose handle contains `query`, for Discord command suggestions. */
    async search(query: string, fixersOnly = false): Promise<RunnerCard[]> {
        const typed = query.trim().toLowerCase();
        if (fixersOnly) {
            // Fixers go by their alias, and are found by it (not their handle): the card's handle is the fixer name
            const rows = await this.prisma.runner.findMany({ where: { status: 'active' } });
            return rows
                .filter((r) => this.isFixer(r) && (r.fixerAlias ?? r.handle).toLowerCase().includes(typed))
                .map((r) => ({ ...toCard(r), handle: r.fixerAlias ?? r.handle }))
                .sort((a, b) => a.handle.localeCompare(b.handle))
                .slice(0, 25);
        }
        const rows = await this.prisma.runner.findMany({ where: { handle: { contains: query.trim(), mode: 'insensitive' }, ownerId: { not: null } }, orderBy: { handle: 'asc' } });
        return rows.slice(0, 25).map(toCard);
    }

    /** The signed in player's runners still taking gigs. */
    async mine(userId: string): Promise<RunnerCard[]> {
        return (await this.prisma.runner.findMany({ where: { ownerId: userId, status: 'active' }, orderBy: { handle: 'asc' } })).map(toCard);
    }

    async get(user: Me, id: string): Promise<RunnerView> {
        const r = await this.row(id);
        const visible = (gig: Gig) => canSeeGig(user, gig);
        const link = (g: Gig): GigLink => ({ id: g.id, ref: gigRef(g), name: g.name, status: g.status, sessionAt: g.sessionAt?.getTime() ?? null });
        const newest = { createdAt: 'desc' } as const;

        const [ran, fixed, memberOf, ratings] = await Promise.all([
            this.prisma.gig.findMany({ where: { slots: { some: { runnerId: id } } }, orderBy: newest }),
            this.prisma.gig.findMany({ where: { fixerRunnerId: id }, orderBy: newest }),
            this.prisma.crewMember.findMany({ where: { runnerId: id }, include: { crew: { select: { id: true, slug: true, name: true, imageId: true } } }, orderBy: { crew: { name: 'asc' } } }),
            this.ratings([id]),
        ]);
        const isFixer = this.isFixer(r);

        return {
            ...this.summary(r),
            fixerAlias: r.fixerAlias,
            officeLocation: r.officeLocation,
            specialties: r.specialties,
            contact: r.contact,
            bio: r.bio,
            artIds: await this.photoIds(id),
            obituary: r.status === 'dead' ? r.obituary : null,
            crews: memberOf.map((m) => ({ ...m.crew, rank: m.rank })),
            gigs: ran.filter(visible).map(link),
            fixerGigs: fixed.filter(visible).map(link),
            rating: ratings.get(id) ?? { average: null, count: 0 },
            reviews: isFixer ? await this.reviews(id) : [],
            downtime: r.ownerId && this.canManage(user, r) ? await this.downtime.view(r) : null,
        };
    }

    /**
     * Anyone signed in can make runners for themselves. On the web, admins can also make
     * them for any player, or NPC fixers with no player.
     */
    async create(user: Me, input: RunnerInput): Promise<RunnerView> {
        const { ownerId: requested, artIds, ...fields } = input;
        const ownerId = requested === undefined ? user.id : requested;
        await this.checkOwner(user, ownerId, input);
        await this.check(input);
        const slug = await this.handleSlug(input.handle);
        const alias = await this.alias(fields.fixerAlias, slug);
        const living = await this.livingFields(input, ownerId);
        const row = await this.prisma.runner.create({ data: { ...fields, ...alias, ...living, ownerId, slug, photos: { create: photoRows(artIds) } } });
        await this.library.refreshUsage([row.imageId, ...artIds]);
        return this.get(user, row.id);
    }

    /** Players edit their own runners. Admins edit any, and can hand a runner to another player. */
    async update(user: Me, id: string, input: RunnerInput): Promise<RunnerView> {
        const r = await this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        const { ownerId: requested, artIds, ...fields } = input;
        const ownerId = requested === undefined ? r.ownerId : requested;
        if (ownerId !== r.ownerId) {
            await this.checkOwner(user, ownerId, input);
            // Moving a runner mid-gig could give their new player two runners on it
            if (await this.onUnfinishedGigs(id)) throw new BadRequestException('Take this runner off their live gigs before giving them to another player.');
        } else if (!ownerId && !hasFixerRole(input)) {
            throw new BadRequestException('An NPC needs the Fixer role.');
        }
        await this.check(input, r);
        // A new handle means a new link
        const slug = await this.handleSlug(input.handle, id);
        const alias = await this.alias(fields.fixerAlias, slug, id);
        const living = await this.livingFields(input, ownerId, r);
        const hadArt = await this.photoIds(id);
        await this.prisma.runner.update({ where: { id }, data: { ...fields, ...alias, ...living, ownerId, slug, photos: { deleteMany: {}, create: photoRows(artIds) } } });
        // A fixer character's gigs follow it to its new player
        if (ownerId !== r.ownerId) await this.prisma.gig.updateMany({ where: { fixerRunnerId: id }, data: { fixerId: ownerId } });
        await this.library.refreshUsage([input.imageId, r.imageId, ...artIds, ...hadArt]);
        this.gigs.refresh(await this.liveGigs(id));
        return this.get(user, id);
    }

    /**
     * Custom numbers only stay while living is custom. The first time a character has a living
     * situation or lifestyle, their monthly DT starts from next month.
     */
    private async livingFields(input: RunnerInput, ownerId: string | null, existing?: Runner) {
        const customLiving = input.living === CUSTOM_LIVING ? input.customLiving : null;
        const starts = !!ownerId && !existing?.downtimeGrantedFor && hasLiving({ ...input, customLiving });
        return {
            customLiving: customLiving ?? Prisma.DbNull,
            ...(starts && { downtimeGrantedFor: await this.downtime.startMonth(ownerId) }),
        };
    }

    private async photoIds(runnerId: string): Promise<string[]> {
        return (await this.prisma.runnerPhoto.findMany({ where: { runnerId }, orderBy: { position: 'asc' }, select: { imageId: true } })).map((p) => p.imageId);
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
    private async onUnfinishedGigs(id: string): Promise<boolean> {
        const unfinished = { status: { in: [...UNFINISHED] } };
        const [inSlot, reserved] = await Promise.all([
            this.prisma.gigSlot.findFirst({ where: { runnerId: id, gig: unfinished }, select: { id: true } }),
            this.prisma.gigReserve.findFirst({ where: { runnerId: id, gig: unfinished }, select: { gigId: true } }),
        ]);
        return !!inSlot || !!reserved;
    }

    /**
     * Retires a runner, kills them off, or brings a retired one back. Either way out takes them
     * off live gigs. Their player or an admin can retire them or bring them back; only admins
     * can undo a death.
     */
    async retire(user: Me, id: string, input: RetireInput): Promise<RunnerView> {
        const r = await this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        // Their player can still edit the obituary
        if (r.status === 'dead' && input.status !== 'dead' && !user.isAdmin) throw new ForbiddenException('Only admins can bring back the dead.');
        if (input.status === r.status && input.status !== 'dead') return this.get(user, id);

        await this.prisma.runner.update({
            where: { id },
            data:
                input.status === 'active'
                    ? { status: 'active', retiredAt: null, obituary: null }
                    : { status: input.status, retiredAt: r.status === 'active' ? new Date() : r.retiredAt, obituary: input.status === 'dead' ? input.obituary : null },
        });
        if (input.status !== 'active') {
            await this.gigs.dropRunner(id);
            await this.prisma.crewInvite.deleteMany({ where: { runnerId: id } });
        }
        this.gigs.refresh(await this.liveGigs(id));
        return this.get(user, id);
    }

    async delete(user: Me, id: string) {
        const r = await this.row(id);
        if (!this.canManage(user, r)) throw new ForbiddenException();
        await this.gigs.dropRunner(id);
        const crewIds = await this.crews.crewsOf(id);
        const hadArt = await this.photoIds(id);
        await this.prisma.runner.delete({ where: { id } });
        await this.crews.keepFounders(crewIds);
        await this.library.refreshUsage([r.imageId, ...hadArt]);
    }

    canManage(user: Me, runner: { ownerId: string | null }) {
        return user.isAdmin || runner.ownerId === user.id;
    }

    private isFixer(r: Runner): boolean {
        return this.members.isFixerRunner({ role: r.role, extraRoles: stringList(r.extraRoles), ownerId: r.ownerId });
    }

    private summary(r: Runner): RunnerSummary {
        return {
            ...toCard(r),
            owner: r.ownerId ? this.members.member(r.ownerId) : null,
            canTakeGigs: !!r.ownerId && r.status === 'active' && this.members.isEdgerunner(r.ownerId),
            isFixer: this.isFixer(r),
            retiredAt: r.retiredAt?.getTime() ?? null,
            fixerName: r.fixerAlias ?? r.handle,
            fixerSlug: r.fixerSlug ?? r.slug,
        };
    }

    /** Average stars from players who went on each fixer's gigs, in one query. */
    private async ratings(fixerIds: string[]): Promise<Map<string, Rating>> {
        if (!fixerIds.length) return new Map();
        const rows = await this.prisma.$queryRaw<{ fixer: string; average: number; count: bigint }[]>`
            SELECT g.fixer_runner_id AS fixer, avg(r.stars)::float AS average, count(*) AS count
            FROM fixer_ratings r JOIN gigs g ON g.id = r.gig_id
            WHERE g.fixer_runner_id = ANY(${fixerIds}::uuid[])
            GROUP BY g.fixer_runner_id`;
        return new Map(rows.map((r) => [r.fixer, { average: r.average, count: Number(r.count) }]));
    }

    /** The fixer's latest five ratings, newest first, with the runner each rater had on the gig. */
    private async reviews(fixerId: string): Promise<Review[]> {
        const rows = await this.prisma.fixerRating.findMany({
            where: { gig: { fixerRunnerId: fixerId } },
            include: { gig: { include: { slots: { include: { runner: true } } } } },
            orderBy: { ratedAt: 'desc' },
            take: 5,
        });
        return rows.map((r) => {
            const by = r.gig.slots.find((s) => s.userId === r.userId)?.runner;
            return { stars: r.stars, comment: r.comment, gig: { id: r.gig.id, ref: gigRef(r.gig), name: r.gig.name }, by: by ? toCard(by) : null, at: r.ratedAt.getTime() };
        });
    }

    /** Roles have to come from the list in Settings, but a runner keeps roles that were taken off it since. */
    private async check(input: RunnerInput, existing?: Runner) {
        const allowed = new Set([...this.settings.get().runnerRoles, ...(existing ? [existing.role, ...stringList(existing.extraRoles)] : [])]);
        for (const role of [input.role, ...input.extraRoles]) {
            if (!allowed.has(role)) throw new BadRequestException(`"${role}" isn't one of the roles.`);
        }
        for (const imageId of [input.imageId, ...input.artIds]) {
            if (imageId && !(await this.library.exists(imageId))) throw new BadRequestException('That picture is gone. Upload it again.');
        }
    }

    /** Live gigs that show this runner, as a runner or the fixer. */
    private async liveGigs(id: string): Promise<string[]> {
        const rows = await this.prisma.gig.findMany({
            where: { status: { in: [...LIVE] }, OR: [{ fixerRunnerId: id }, { slots: { some: { runnerId: id } } }] },
            select: { id: true },
        });
        return rows.map((g) => g.id);
    }

    /**
     * A handle's link. Handles are one of a kind in Night City, so two that would make the same
     * link ("Mr. B" and "Mr B") can't both exist. `except` is the runner being renamed.
     */
    private async handleSlug(handle: string, except?: string): Promise<string> {
        const slug = toSlug(handle);
        if (!isFreeSlugWord(slug)) throw new BadRequestException("That handle can't be used. It needs a letter in it, and can't be new, edit, mine or invites.");
        if (await this.slugTaken(slug, except)) throw new ConflictException("That handle's taken. Handles are one of a kind in Night City.");
        return slug;
    }

    /**
     * A fixer alias and its link. Aliases are one of a kind too, and can't match anyone's handle.
     * One that's the same as the runner's own handle is no alias at all.
     */
    private async alias(alias: string | null, handleSlug: string, except?: string): Promise<{ fixerAlias: string | null; fixerSlug: string | null }> {
        const fixerSlug = alias ? toSlug(alias) : '';
        if (!alias || fixerSlug === handleSlug) return { fixerAlias: null, fixerSlug: null };
        if (!isFreeSlugWord(fixerSlug)) throw new BadRequestException("That alias can't be used. It needs a letter in it, and can't be new, edit, mine or invites.");
        if (await this.slugTaken(fixerSlug, except)) throw new ConflictException("That alias is taken. Names are one of a kind in Night City.");
        return { fixerAlias: alias, fixerSlug };
    }

    /** Someone else already has this link, as a handle or a fixer alias. */
    private async slugTaken(slug: string, except?: string): Promise<boolean> {
        const other = await this.prisma.runner.findFirst({ where: { OR: [{ slug }, { fixerSlug: slug }], ...(except && { NOT: { id: except } }) }, select: { id: true } });
        return !!other;
    }

    private async row(id: string): Promise<Runner> {
        const r = await this.prisma.runner.findUnique({ where: { id } });
        if (!r) throw new NotFoundException('No such runner.');
        return r;
    }
}

const photoRows = (artIds: string[]) => artIds.map((imageId, position) => ({ imageId, position }));

const hasFixerRole = (r: { role: string; extraRoles: string[] }) => r.role === FIXER_ROLE || r.extraRoles.includes(FIXER_ROLE);
