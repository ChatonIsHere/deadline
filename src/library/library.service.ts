import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { config } from '../config';
import { DB, Db } from '../db/db';
import { gigs, images, regions } from '../db/schema';
import type { LibraryView, Me, RegionInput } from '../shared/schemas';
import { FRAME_VERSION, framedFile, plainFile } from '../shared/images';
import { frameSvg, type ImageKind, SIZES } from './frame';
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
        await this.upgradeFiles();
    }

    /**
     * Converts plain pictures saved as JPEG (before WebP) and builds framed copies missing
     * for the current FRAME_VERSION. Older framed files stay: finished posts link to them.
     */
    private async upgradeFiles() {
        let converted = 0;
        let framed = 0;
        for (const { id, kind } of this.db.select({ id: images.id, kind: images.kind }).from(images).all()) {
            const plain = join(this.dir, plainFile(id));
            const jpeg = join(this.dir, `${id}.jpg`);
            if (!existsSync(plain) && existsSync(jpeg)) {
                writeFileSync(plain, await sharp(jpeg).webp(WEBP).toBuffer());
                unlinkSync(jpeg);
                converted++;
            }
            const target = join(this.dir, framedFile(id));
            if (existsSync(target) || !existsSync(plain)) continue;
            writeFileSync(target, await frame(readFileSync(plain), kind));
            framed++;
        }
        if (converted) this.logger.log(`Converted ${converted} picture(s) to WebP`);
        if (framed) this.logger.log(`Built ${framed} framed picture(s) for frame v${FRAME_VERSION}`);
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
        const framed = await frame(plain, kind);

        const [row] = this.db
            .insert(images)
            .values({ ...opts, kind })
            .returning({ id: images.id })
            .all();
        writeFileSync(join(this.dir, plainFile(row.id)), plain);
        writeFileSync(join(this.dir, framedFile(row.id)), framed);
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

    /** Takes an image out of the library. Its files stay while a gig still uses it. */
    remove(user: Me, id: number) {
        if (!user.isAdmin) throw new ForbiddenException();
        const used = this.db.query.gigs.findFirst({ where: eq(gigs.imageId, id) }).sync();
        if (used) {
            this.db.update(images).set({ inLibrary: false }).where(eq(images.id, id)).run();
            return;
        }
        this.db.delete(images).where(eq(images.id, id)).run();
        for (const file of [plainFile(id), framedFile(id)]) rmSync(join(this.dir, file), { force: true });
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

    /** Public URL of an image with its frame, for Discord. */
    url(id: number): string {
        return `${config.PUBLIC_URL}/images/${framedFile(id)}`;
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

/** Draws the frame over a plain 1280x720 image. */
function frame(plain: Buffer, kind: ImageKind): Promise<Buffer> {
    const { width, height } = SIZES[kind];
    return sharp(plain)
        .composite([{ input: Buffer.from(frameSvg(width, height)) }])
        .webp(WEBP)
        .toBuffer();
}
