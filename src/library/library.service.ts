import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import { type Db, PrismaService } from '../prisma/prisma.service';
import { cardFile, FRAME_VERSION, framedFile, imagePrefix, mediumFile, plainFile, thumbFile, webFile } from '../shared/images';
import type { LibraryView, Me, RegionInput } from '../shared/schemas';
import { StorageService } from '../storage/storage.service';
import { frameSvg, type ImageKind, PREVIEWS, SIZES, variantFor } from './frame';
import { CARD_VERSION, renderGigCard } from './gig-card';
import { NIGHT_CITY } from './night-city';

const POOL_DIR = join(__dirname, '..', '..', 'assets', 'pool');
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
/** High quality WebP: no visible loss, a bit smaller than JPEG. */
const WEBP = { quality: 85, effort: 5 };

/**
 * The picture library: Night City regions, their pictures and the general pool. Files live in
 * storage (S3, or a folder locally) under images/<id>/; see shared/images.ts for the keys.
 */
@Injectable()
export class LibraryService implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(LibraryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
    ) {}

    async onModuleInit() {
        if (!(await this.prisma.region.count())) await this.seedRegions();
        if (!(await this.prisma.image.count())) await this.importPool();
    }

    /** After a frame change, rebuild in the background so the app starts straight away. */
    onApplicationBootstrap() {
        void this.fillIn().catch((err) => this.logger.error(`Rebuilding pictures failed: ${err}`));
    }

    /**
     * Builds any missing framed copies and previews for the current FRAME_VERSION. Files from
     * older versions are listed as stale: finished Discord posts may still show them for a while.
     */
    private async fillIn() {
        const stored = new Set(await this.storage.list('images/'));
        const rows = await this.prisma.image.findMany({ select: { id: true, kind: true } });
        let built = 0;
        const stale: string[] = [];
        for (const { id, kind } of rows) {
            const current = [plainFile(id), framedFile(id), webFile(id), thumbFile(id), mediumFile(id)];
            if (current.some((key) => !stored.has(key)) && stored.has(plainFile(id))) {
                const plain = (await this.storage.get(plainFile(id)))!;
                built += await this.writeCopies(id, kind, plain, (key) => !stored.has(key));
            }
            const prefix = imagePrefix(id);
            stale.push(...[...stored].filter((key) => key.startsWith(prefix) && !current.includes(key)));
        }
        if (stale.length) await this.prisma.staleObject.createMany({ data: stale.map((key) => ({ key })), skipDuplicates: true });
        if (built) this.logger.log(`Built ${built} framed or preview file(s)`);
    }

    async list(): Promise<LibraryView> {
        const rows = await this.prisma.image.findMany({ where: { inLibrary: true }, select: { id: true, regionId: true }, orderBy: { createdAt: 'asc' } });
        const ids = (regionId: string | null) => rows.filter((i) => i.regionId === regionId).map((i) => i.id);
        const regions = await this.prisma.region.findMany({ orderBy: { name: 'asc' } });
        return { regions: regions.map((r) => ({ ...r, images: ids(r.id) })), pool: ids(null) };
    }

    /**
     * Crops to the kind's size (16:9 for gigs, square for runners), stores the plain picture
     * and its framed copies, and returns the new image's ID.
     */
    async add(data: Buffer, opts: { regionId: string | null; inLibrary: boolean; createdBy: string | null; kind?: ImageKind }): Promise<string> {
        const kind = opts.kind ?? 'gig';
        const { width, height } = SIZES[kind];
        let plain: Buffer;
        try {
            plain = await sharp(data).rotate().resize(width, height, { fit: 'cover' }).webp(WEBP).toBuffer();
        } catch {
            throw new BadRequestException("That file isn't an image I can read.");
        }
        // Uploads for one gig or runner count as unused until they're saved with it
        const row = await this.prisma.image.create({ data: { ...opts, kind, unusedSince: opts.inLibrary ? null : new Date() } });
        try {
            await this.storage.put(plainFile(row.id), plain, 'image/webp');
            await this.writeCopies(row.id, kind, plain);
        } catch (err) {
            // No row without its files: storage refused, so the picture doesn't exist
            await this.storage.delete(await this.storage.list(imagePrefix(row.id))).catch(() => undefined);
            await this.prisma.image.delete({ where: { id: row.id } });
            throw err;
        }
        return row.id;
    }

    /** The framed copies and previews of a plain picture. `wanted` skips ones already stored. */
    private async writeCopies(id: string, kind: ImageKind, plain: Buffer, wanted: (key: string) => boolean = () => true): Promise<number> {
        let written = 0;
        if (wanted(framedFile(id))) {
            await this.storage.put(framedFile(id), await frame(plain, kind, id, true), 'image/webp');
            written++;
        }
        const web = wanted(webFile(id)) ? await frame(plain, kind, id, false) : await this.storage.get(webFile(id));
        if (wanted(webFile(id))) {
            await this.storage.put(webFile(id), web!, 'image/webp');
            written++;
        }
        for (const [key, size] of [
            [thumbFile(id), PREVIEWS[kind].thumb],
            [mediumFile(id), PREVIEWS[kind].medium],
        ] as const) {
            if (!wanted(key)) continue;
            await this.storage.put(key, await sharp(web!).resize(size.width, size.height).webp(WEBP).toBuffer(), 'image/webp');
            written++;
        }
        return written;
    }

    /** Library pictures are admins only. Gig pictures are for fixers and admins. Runner pictures are for anyone. */
    async upload(user: Me, data: Buffer, opts: { regionId: string | null; inLibrary: boolean; kind: ImageKind }): Promise<string> {
        const allowed = opts.inLibrary ? user.isAdmin : opts.kind === 'avatar' || user.isAdmin || user.isFixer;
        if (!allowed) throw new ForbiddenException();
        if (opts.regionId && !(await this.prisma.region.findUnique({ where: { id: opts.regionId } }))) throw new NotFoundException('No such region.');
        return this.add(data, { ...opts, createdBy: user.id });
    }

    /** Takes a picture out of the library. It's deleted 30 days after nothing uses it (see CleanupService). */
    async remove(user: Me, id: string) {
        if (!user.isAdmin) throw new ForbiddenException();
        await this.prisma.image.update({ where: { id }, data: { inLibrary: false } });
        await this.refreshUsage([id]);
    }

    async exists(id: string): Promise<boolean> {
        return !!(await this.prisma.image.findUnique({ where: { id }, select: { id: true } }));
    }

    /**
     * Marks pictures as in use or not, after something that uses them changed. A picture is in
     * use while it's in the library or any gig (finished ones too, so old posts keep theirs) or
     * runner has it. `db` lets this run inside a transaction.
     */
    async refreshUsage(ids: (string | null | undefined)[], db: Db = this.prisma) {
        for (const id of new Set(ids.filter((i): i is string => !!i))) {
            const image = await db.image.findUnique({ where: { id }, select: { inLibrary: true, unusedSince: true, _count: { select: { gigs: true, runners: true } } } });
            if (!image) continue;
            const used = image.inLibrary || image._count.gigs > 0 || image._count.runners > 0;
            if (used && image.unusedSince) await db.image.update({ where: { id }, data: { unusedSince: null } });
            if (!used && !image.unusedSince) await db.image.update({ where: { id }, data: { unusedSince: new Date() } });
        }
    }

    /** A random picture for a location: the region's own, then its district's, then the general pool. */
    async pick(location: string): Promise<string | null> {
        const region = await this.regionByName(location);
        const district = region?.district ? await this.regionByName(region.district) : null;
        for (const regionId of [region?.id, district?.id, null]) {
            if (regionId === undefined) continue;
            const ids = await this.prisma.image.findMany({ where: { inLibrary: true, regionId }, select: { id: true } });
            if (ids.length) return ids[Math.floor(Math.random() * ids.length)].id;
        }
        return null;
    }

    /**
     * A gig's picture for Discord, with its name on it (see gig-card.ts), as a storage key. Made
     * when the name or picture changes; the key changes with them. The card it replaces is
     * listed as stale and deleted later. A picture whose file is gone gets its plain framed copy.
     */
    async gigCardKey(gig: { id: string; imageId: string; name: string; cardKey: string | null }): Promise<string> {
        const hash = createHash('sha1').update(`${gig.imageId}|${gig.name}|${FRAME_VERSION}|${CARD_VERSION}`).digest('hex').slice(0, 12);
        const key = cardFile(gig.id, hash);
        if (gig.cardKey !== key) {
            const plain = await this.storage.get(plainFile(gig.imageId));
            if (!plain) return framedFile(gig.imageId);
            await this.storage.put(key, await renderGigCard(plain, variantFor(gig.imageId), gig.name), 'image/png');
            await this.prisma.gig.update({ where: { id: gig.id }, data: { cardKey: key } });
            if (gig.cardKey) await this.prisma.staleObject.upsert({ where: { key: gig.cardKey }, create: { key: gig.cardKey }, update: {} });
        }
        return key;
    }

    /**
     * A stored file to upload to Discord, or null if it's gone. Pictures are uploaded rather
     * than linked so Discord serves them from its own CDN, and forum previews follow edits.
     * The name comes from the key, so it changes whenever the picture does.
     */
    async attachment(key: string): Promise<{ name: string; attachment: Buffer } | null> {
        const data = await this.storage.get(key);
        return data ? { name: attachmentName(key), attachment: data } : null;
    }

    /** A stored picture's bytes (the bot banner uses the plain one). */
    plain(id: string): Promise<Buffer | null> {
        return this.storage.get(plainFile(id));
    }

    // Regions

    async addRegion(user: Me, input: RegionInput) {
        if (!user.isAdmin) throw new ForbiddenException();
        if (await this.regionByName(input.name)) throw new ConflictException('That region already exists.');
        await this.prisma.region.create({ data: input });
    }

    /** Its pictures move to the general pool. */
    async deleteRegion(user: Me, id: string) {
        if (!user.isAdmin) throw new ForbiddenException();
        await this.prisma.region.delete({ where: { id } });
    }

    private regionByName(name: string) {
        return this.prisma.region.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
    }

    private async seedRegions() {
        const rows = Object.entries(NIGHT_CITY).flatMap(([district, areas]) => [{ name: district, district: null }, ...areas.map((name) => ({ name, district }))]);
        await this.prisma.region.createMany({ data: rows, skipDuplicates: true });
        this.logger.log(`Seeded ${rows.length} Night City regions`);
    }

    /** The starter pictures in assets/pool go into the general pool on first start. */
    private async importPool() {
        const files = (await readdir(POOL_DIR).catch(() => [])).filter((f) => IMAGE_FILE.test(f));
        let count = 0;
        for (const file of files) {
            try {
                await this.add(await readFile(join(POOL_DIR, file)), { regionId: null, inLibrary: true, createdBy: null });
                count++;
            } catch (err) {
                this.logger.warn(`Couldn't import ${file}: ${err}`);
            }
        }
        if (count) this.logger.log(`Imported ${count} starter picture(s)`);
    }
}

/**
 * Cuts a plain picture to the frame's shape (outside it is transparent) and draws the
 * picture's frame variant over it. Padded for Discord, to the edge for the web.
 */
function frame(plain: Buffer, kind: ImageKind, id: string, padded: boolean): Promise<Buffer> {
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

/** images/cards/<gig>/<hash>.png → cards-<gig>-<hash>.png, images/<id>/framed-v6.webp → <id>-framed-v6.webp */
export const attachmentName = (key: string) => key.split('/').slice(1).join('-');
