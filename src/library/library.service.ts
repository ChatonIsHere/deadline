import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { config } from '../config';
import { DB, Db } from '../db/db';
import { gigs, images, regions } from '../db/schema';
import type { LibraryView, Me, RegionInput } from '../shared/schemas';
import { FRAME_VERSION, framedFile } from '../shared/images';
import { frameSvg, HEIGHT, WIDTH } from './frame';
import { NIGHT_CITY } from './night-city';

const POOL_DIR = join(__dirname, '..', '..', 'assets', 'pool');
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

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
        await this.reframe();
    }

    /** Builds framed copies missing for the current FRAME_VERSION and clears out older ones. */
    private async reframe() {
        let count = 0;
        for (const { id } of this.db.select({ id: images.id }).from(images).all()) {
            const target = join(this.dir, framedFile(id));
            const plain = join(this.dir, `${id}.jpg`);
            if (existsSync(target) || !existsSync(plain)) continue;
            writeFileSync(target, await frame(readFileSync(plain)));
            count++;
        }
        const current = new Set(this.db.select({ id: images.id }).from(images).all().map((r) => framedFile(r.id)));
        for (const file of readdirSync(this.dir).filter((f) => f.includes('-framed') && !current.has(f))) rmSync(join(this.dir, file));
        if (count) this.logger.log(`Rebuilt ${count} framed image(s) for frame v${FRAME_VERSION}`);
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

    /** Resizes to 16:9, saves a plain and a framed copy, and returns the new image's ID. */
    async add(data: Buffer, opts: { regionId: number | null; inLibrary: boolean; createdBy: string | null }): Promise<number> {
        let plain: Buffer;
        try {
            plain = await sharp(data).rotate().resize(WIDTH, HEIGHT, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        } catch {
            throw new BadRequestException("That file isn't an image I can read.");
        }
        const framed = await frame(plain);

        const [row] = this.db.insert(images).values(opts).returning({ id: images.id }).all();
        writeFileSync(join(this.dir, `${row.id}.jpg`), plain);
        writeFileSync(join(this.dir, framedFile(row.id)), framed);
        return row.id;
    }

    async upload(user: Me, data: Buffer, regionId: number | null, inLibrary: boolean): Promise<number> {
        if (inLibrary ? !user.isAdmin : !(user.isAdmin || user.isFixer)) throw new ForbiddenException();
        if (regionId && !this.db.query.regions.findFirst({ where: eq(regions.id, regionId) }).sync()) throw new NotFoundException('No such region.');
        return this.add(data, { regionId, inLibrary, createdBy: user.id });
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
        for (const file of [`${id}.jpg`, framedFile(id)]) rmSync(join(this.dir, file), { force: true });
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
function frame(plain: Buffer): Promise<Buffer> {
    return sharp(plain)
        .composite([{ input: Buffer.from(frameSvg()) }])
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
}
