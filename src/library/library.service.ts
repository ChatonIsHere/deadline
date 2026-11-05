import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { config } from '../config';
import { DB, Db } from '../db/db';
import { gigs, images, regions, runners } from '../db/schema';
import type { LibraryView, Me, RegionInput } from '../shared/schemas';
import { forumFile, framedFile, mediumFile, plainFile, thumbFile, webFile } from '../shared/images';
import { FORUM, frameSvg, type ImageKind, PREVIEWS, SIZES, variantFor } from './frame';
import { NIGHT_CITY } from './night-city';

const POOL_DIR = join(__dirname, '..', '..', 'assets', 'pool');
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
/** High quality WebP: no visible loss, a bit smaller than the old JPEGs. */
const WEBP = { quality: 85, effort: 5 };

/** The picture library: Night City regions, their pictures and the general pool. */
@Injectable()
export class LibraryService implements OnModuleInit {
    private readonly logger = new Logger(LibraryService.name);
    /** Where processed images live. Served at /images. */
    readonly dir = join(dirname(config.DATABASE_PATH), 'images');
    /** Drop folders here (named after a region, or "pool") and they get imported on startup. */
    private readonly importDir = join(dirname(config.DATABASE_PATH), 'import');

    constructor(@Inject(DB) private readonly db: Db) {}

    async onModuleInit() {
        mkdirSync(this.dir, { recursive: true });
        if (!this.db.query.regions.findFirst().sync()) this.seedRegions();
        if (!this.db.query.images.findFirst().sync()) await this.importFolder(POOL_DIR, null);
        await this.importDrops();
        await this.fillIn();
    }

    /**
     * Builds any missing framed copies (for the current FRAME_VERSION) and previews. Older
     * framed files stay: finished posts link to them.
     */
    private async fillIn() {
        let built = 0;
        for (const { id, kind } of this.db.select({ id: images.id, kind: images.kind }).from(images).all()) {
            const plainPath = join(this.dir, plainFile(id));
            if (!existsSync(plainPath)) continue;
            const plain = readFileSync(plainPath);
            for (const [file, padded] of [
                [framedFile, true],
                [webFile, false],
            ] as const) {
                if (existsSync(join(this.dir, file(id)))) continue;
                writeFileSync(join(this.dir, file(id)), await frame(plain, kind, id, padded));
                built++;
            }
            if (kind === 'gig' && !existsSync(join(this.dir, forumFile(id)))) {
                writeFileSync(join(this.dir, forumFile(id)), await forumFrame(plain, id));
                built++;
            }
            for (const [file, data] of await previews(readFileSync(join(this.dir, webFile(id))), kind, (f) => !existsSync(join(this.dir, f(id))))) {
                writeFileSync(join(this.dir, file(id)), data);
                built++;
            }
        }
        if (built) this.logger.log(`Built ${built} framed or preview file(s)`);

        // Only the web uses previews and web copies, so older versions of those can go
        const current = new Set(this.db.select({ id: images.id }).from(images).all().flatMap(({ id }) => [thumbFile(id), mediumFile(id), webFile(id)]));
        for (const file of readdirSync(this.dir)) {
            if (/^\d+-(thumb|medium|web)(-v\d+)?\.webp$/.test(file) && !current.has(file)) rmSync(join(this.dir, file), { force: true });
        }
    }

    list(): LibraryView {
        const rows = this.db.query.images.findMany({ where: eq(images.inLibrary, true) }).sync();
        const ids = (regionId: number | null) => rows.filter((i) => i.regionId === regionId).map((i) => i.id);
        return {
            regions: this.db.query.regions
                .findMany({ orderBy: regions.name })
                .sync()
                .map((r) => ({ ...r, images: ids(r.id) })),
            pool: ids(null),
        };
    }

    /**
     * Crops to the kind's size (16:9 for gigs, square for runners), saves a plain and a
     * framed WebP, and returns the new image's ID.
     */
    async add(data: Buffer, opts: { regionId: number | null; inLibrary: boolean; createdBy: string | null; kind?: ImageKind }): Promise<number> {
        const kind = opts.kind ?? 'gig';
        const { width, height } = SIZES[kind];
        let plain: Buffer;
        try {
            plain = await sharp(data).rotate().resize(width, height, { fit: 'cover' }).webp(WEBP).toBuffer();
        } catch {
            throw new BadRequestException("That file isn't an image I can read.");
        }

        const [row] = this.db
            .insert(images)
            .values({ ...opts, kind })
            .returning({ id: images.id })
            .all();
        writeFileSync(join(this.dir, plainFile(row.id)), plain);
        writeFileSync(join(this.dir, framedFile(row.id)), await frame(plain, kind, row.id, true));
        if (kind === 'gig') writeFileSync(join(this.dir, forumFile(row.id)), await forumFrame(plain, row.id));
        const web = await frame(plain, kind, row.id, false);
        writeFileSync(join(this.dir, webFile(row.id)), web);
        for (const [file, data] of await previews(web, kind)) writeFileSync(join(this.dir, file(row.id)), data);
        return row.id;
    }

    /** Library pictures are admins only. Gig pictures are for fixers and admins. Runner pictures are for anyone. */
    async upload(user: Me, data: Buffer, opts: { regionId: number | null; inLibrary: boolean; kind: ImageKind }): Promise<number> {
        const allowed = opts.inLibrary ? user.isAdmin : opts.kind === 'avatar' || user.isAdmin || user.isFixer;
        if (!allowed) throw new ForbiddenException();
        if (opts.regionId && !this.db.query.regions.findFirst({ where: eq(regions.id, opts.regionId) }).sync()) {
            throw new NotFoundException('No such region.');
        }
        return this.add(data, { ...opts, createdBy: user.id });
    }

    /** Takes an image out of the library. Its files stay while a gig or runner still uses it. */
    remove(user: Me, id: number) {
        if (!user.isAdmin) throw new ForbiddenException();
        const used =
            this.db.query.gigs.findFirst({ where: eq(gigs.imageId, id) }).sync() ?? this.db.query.runners.findFirst({ where: eq(runners.imageId, id) }).sync();
        if (used) {
            this.db.update(images).set({ inLibrary: false }).where(eq(images.id, id)).run();
            return;
        }
        this.db.delete(images).where(eq(images.id, id)).run();
        for (const file of [plainFile(id), framedFile(id), forumFile(id), webFile(id), thumbFile(id), mediumFile(id)]) rmSync(join(this.dir, file), { force: true });
    }

    exists(id: number): boolean {
        return !!this.db.query.images.findFirst({ where: eq(images.id, id) }).sync();
    }

    /** A random picture for a location: the region's own, then its district's, then the general pool. */
    pick(location: string): number | null {
        const region = this.regionByName(location);
        const district = region?.district ? this.regionByName(region.district) : undefined;
        for (const regionId of [region?.id, district?.id, null]) {
            if (regionId === undefined) continue;
            const where = and(eq(images.inLibrary, true), regionId === null ? isNull(images.regionId) : eq(images.regionId, regionId));
            const row = this.db.select({ id: images.id }).from(images).where(where).orderBy(sql`random()`).limit(1).get();
            if (row) return row.id;
        }
        return null;
    }

    /** Public URL of an image with its frame, for Discord. Gig pictures use the forum preview shape. */
    url(id: number): string {
        const image = this.db.select({ kind: images.kind }).from(images).where(eq(images.id, id)).get();
        return `${config.PUBLIC_URL}/images/${image?.kind === 'gig' ? forumFile(id) : framedFile(id)}`;
    }

    // Regions

    addRegion(user: Me, input: RegionInput) {
        if (!user.isAdmin) throw new ForbiddenException();
        if (this.regionByName(input.name)) throw new ConflictException('That region already exists.');
        this.db.insert(regions).values(input).run();
    }

    /** Its pictures move to the general pool. */
    deleteRegion(user: Me, id: number) {
        if (!user.isAdmin) throw new ForbiddenException();
        this.db.delete(regions).where(eq(regions.id, id)).run();
    }

    private regionByName(name: string) {
        return this.db.query.regions.findFirst({ where: sql`lower(${regions.name}) = lower(${name.trim()})` }).sync();
    }

    private seedRegions() {
        const rows = Object.entries(NIGHT_CITY).flatMap(([district, areas]) => [
            { name: district, district: null },
            ...areas.map((name) => ({ name, district })),
        ]);
        this.db.insert(regions).values(rows).run();
        this.logger.log(`Seeded ${rows.length} Night City regions`);
    }

    private async importDrops() {
        if (!existsSync(this.importDir)) return;
        for (const entry of readdirSync(this.importDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
            const region = entry.name.toLowerCase() === 'pool' ? null : this.regionByName(entry.name);
            if (region === undefined) {
                this.logger.warn(`Skipping import folder "${entry.name}": no region with that name`);
                continue;
            }
            await this.importFolder(join(this.importDir, entry.name), region?.id ?? null, true);
        }
    }

    private async importFolder(dir: string, regionId: number | null, removeAfter = false) {
        if (!existsSync(dir)) return;
        let count = 0;
        for (const file of readdirSync(dir).filter((f) => IMAGE_FILE.test(f))) {
            try {
                await this.add(readFileSync(join(dir, file)), { regionId, inLibrary: true, createdBy: null });
                count++;
                if (removeAfter) unlinkSync(join(dir, file));
            } catch (err) {
                this.logger.warn(`Couldn't import ${file}: ${err}`);
            }
        }
        if (count) this.logger.log(`Imported ${count} image(s) from ${dir}`);
    }
}

/** The thumb and medium copies of the web picture, as [file name, data]. `wanted` skips ones that already exist. */
async function previews(framed: Buffer, kind: ImageKind, wanted: (file: (id: number) => string) => boolean = () => true) {
    const out: [(id: number) => string, Buffer][] = [];
    for (const [file, size] of [
        [thumbFile, PREVIEWS[kind].thumb],
        [mediumFile, PREVIEWS[kind].medium],
    ] as const) {
        if (wanted(file)) out.push([file, await sharp(framed).resize(size.width, size.height).webp(WEBP).toBuffer()]);
    }
    return out;
}

/** A gig picture for Discord: the middle of the plain one at the forum preview's shape, framed with a margin. */
async function forumFrame(plain: Buffer, id: number): Promise<Buffer> {
    const { width, height } = FORUM;
    const { overlay, mask } = frameSvg(width, height, { variant: variantFor(id), padded: true });
    return sharp(plain)
        .resize(width, height, { fit: 'cover' })
        .ensureAlpha()
        .composite([
            { input: Buffer.from(mask), blend: 'dest-in' },
            { input: Buffer.from(overlay) },
        ])
        .webp(WEBP)
        .toBuffer();
}

/**
 * Cuts a plain picture to the frame's shape (outside it is transparent) and draws the
 * picture's frame variant over it. Padded for Discord, to the edge for the web.
 */
function frame(plain: Buffer, kind: ImageKind, id: number, padded: boolean): Promise<Buffer> {
    const { width, height } = SIZES[kind];
    const { overlay, mask } = frameSvg(width, height, { variant: variantFor(id), padded });
    return sharp(plain)
        .ensureAlpha()
        .composite([
            { input: Buffer.from(mask), blend: 'dest-in' },
            { input: Buffer.from(overlay) },
        ])
        .webp(WEBP)
        .toBuffer();
}
