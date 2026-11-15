import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleInit, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import { config } from '../config';
import { checkCount } from '../limits';
import { type Db, PrismaService } from '../prisma/prisma.service';
import { artPreviewFile, artThumbFile, cardFile, FRAME_VERSION, framedFile, imagePrefix, mediumFile, plainFile, thumbFile, type UploadKind, webFile } from '../shared/images';
import type { LibraryView, Me, RegionInput } from '../shared/schemas';
import { StorageService } from '../storage/storage.service';
import { frameSvg, type ImageKind, PREVIEWS, SIZES, VARIANTS, variantFor, variantIndex } from './frame';
import { CARD_VERSION, renderGigCard } from './gig-card';
import { NIGHT_CITY } from './night-city';

const POOL_DIR = join(__dirname, '..', '..', 'assets', 'pool');
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;
/** High quality WebP: no visible loss, a bit smaller than JPEG. */
const WEBP = { quality: 85, effort: 5 };

/** Full art keeps its shape. The longest side is capped, and it's squeezed harder if it's still big. */
const ART = { longest: 2000, preview: 900, thumb: 240, quality: 82, fallbackQuality: 65, maxBytes: 1.5 * 1024 * 1024 };

/** Fits art inside the size limit as WebP. Metadata (camera, location) is dropped. */
export async function compressArt(data: Buffer): Promise<Buffer> {
    const encode = (quality: number) =>
        sharp(data).rotate().resize({ width: ART.longest, height: ART.longest, fit: 'inside', withoutEnlargement: true }).webp({ quality, effort: 5 }).toBuffer();
    const art = await encode(ART.quality);
    return art.length > ART.maxBytes ? encode(ART.fallbackQuality) : art;
}

const smaller = (art: Buffer, longest: number) => sharp(art).resize({ width: longest, height: longest, fit: 'inside', withoutEnlargement: true }).webp(WEBP).toBuffer();

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
        const rows = await this.prisma.image.findMany({ select: { id: true, kind: true, bytes: true } });
        let built = 0;
        const stale: string[] = [];
        for (const { id, kind, bytes } of rows) {
            const current = kind === 'art' ? [plainFile(id), artPreviewFile(id), artThumbFile(id)] : [plainFile(id), framedFile(id), webFile(id), thumbFile(id), mediumFile(id)];
            if (current.some((key) => !stored.has(key)) && stored.has(plainFile(id))) {
                const plain = (await this.storage.get(plainFile(id)))!;
                if (kind === 'art') {
                    await this.writeArtCopies(id, plain);
                    built += 2;
                } else {
                    built += await this.writeCopies(id, kind, plain, (key) => !stored.has(key));
                }
            }
            const prefix = imagePrefix(id);
            stale.push(...[...stored].filter((key) => key.startsWith(prefix) && !current.includes(key)));
            // Pictures from before sizes were recorded
            if (!bytes) await this.prisma.image.update({ where: { id }, data: { bytes: await this.storage.size(prefix) } });
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
     * and its framed copies, and returns the new image's ID. Art isn't cropped or framed.
     */
    async add(data: Buffer, opts: { regionId: string | null; inLibrary: boolean; createdBy: string | null; kind?: UploadKind }): Promise<string> {
        const kind = opts.kind ?? 'gig';
        let plain: Buffer;
        try {
            plain = kind === 'art' ? await compressArt(data) : await sharp(data).rotate().resize(SIZES[kind].width, SIZES[kind].height, { fit: 'cover' }).webp(WEBP).toBuffer();
        } catch {
            throw new BadRequestException("That file isn't an image I can read.");
        }
        // Uploads for one gig or runner count as unused until they're saved with it
        const row = await this.prisma.image.create({ data: { ...opts, kind, unusedSince: opts.inLibrary ? null : new Date() } });
        try {
            await this.storage.put(plainFile(row.id), plain, 'image/webp');
            if (kind === 'art') await this.writeArtCopies(row.id, plain);
            else await this.writeCopies(row.id, kind, plain);
            await this.prisma.image.update({ where: { id: row.id }, data: { bytes: await this.storage.size(imagePrefix(row.id)) } });
        } catch (err) {
            // No row without its files: storage refused, so the picture doesn't exist
            await this.discard(row.id);
            throw err;
        }
        return row.id;
    }

    private async writeArtCopies(id: string, art: Buffer) {
        await this.storage.put(artPreviewFile(id), await smaller(art, ART.preview), 'image/webp');
        await this.storage.put(artThumbFile(id), await smaller(art, ART.thumb), 'image/webp');
    }

    private async discard(id: string) {
        await this.storage.delete(await this.storage.list(imagePrefix(id))).catch(() => undefined);
        await this.prisma.image.delete({ where: { id } });
    }

    /** What someone's uploads take up until they're cleaned out. Library pictures are the board's, not theirs. */
    private async usedBytes(userId: string): Promise<number> {
        return (await this.prisma.image.aggregate({ where: { createdBy: userId, inLibrary: false }, _sum: { bytes: true } }))._sum.bytes ?? 0;
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

    /** Library pictures are admins only. Gig pictures are for fixers and admins. Runner pictures and art are for anyone. */
    async upload(user: Me, data: Buffer, opts: { regionId: string | null; inLibrary: boolean; kind: UploadKind }): Promise<string> {
        const allowed = opts.inLibrary ? user.isAdmin : opts.kind !== 'gig' || user.isAdmin || user.isFixer;
        if (!allowed) throw new ForbiddenException();
        if (opts.regionId && !(await this.prisma.region.findUnique({ where: { id: opts.regionId } }))) throw new NotFoundException('No such region.');
        if (opts.inLibrary) return this.add(data, { ...opts, createdBy: user.id });

        await this.checkQuota(user);
        // Only its real size counts, so it's checked once stored. Two at once can't both slip under.
        const id = await this.add(data, { ...opts, createdBy: user.id });
        await this.checkStoredSize(user, id);
        return id;
    }

    /** Before a new picture: MAX_UPLOADS_PER_DAY (admins aren't held to it) and the storage limit. */
    private async checkQuota(user: Me) {
        if (!user.isAdmin) {
            const today = await this.prisma.image.count({ where: { createdBy: user.id, inLibrary: false, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
            checkCount(today, config.MAX_UPLOADS_PER_DAY, `that's ${config.MAX_UPLOADS_PER_DAY} pictures today, the most for one day. try again tomorrow.`);
        }
        if ((await this.usedBytes(user.id)) >= config.MAX_USER_STORAGE_MB * 1024 * 1024) throw storageFull();
    }

    /** After storing it: over the storage limit, it goes again. */
    private async checkStoredSize(user: Me, id: string) {
        if ((await this.usedBytes(user.id)) > config.MAX_USER_STORAGE_MB * 1024 * 1024) {
            await this.discard(id);
            throw storageFull();
        }
    }

    /** Takes a picture out of the library. It's deleted 30 days after nothing uses it (see CleanupService). */
    async remove(user: Me, id: string) {
        if (!user.isAdmin) throw new ForbiddenException();
        await this.prisma.image.update({ where: { id }, data: { inLibrary: false } });
        await this.refreshUsage([id]);
    }

    /**
     * A copy of a square picture in another of the frames, as a new image. A picture's frame comes
     * from its ID, so the copy gets an ID that lands on the one asked for: every file is new, and
     * nothing cached shows the old frame. Unused until it's saved with something, like any upload.
     */
    async reframe(user: Me, id: string, variant: number): Promise<string> {
        if (!Number.isInteger(variant) || variant < 0 || variant >= VARIANTS.length) throw new BadRequestException('No such frame.');
        const image = await this.prisma.image.findUnique({ where: { id } });
        if (!image || image.kind !== 'avatar') throw new BadRequestException('Only square pictures can change frame.');
        if (variantIndex(id) === variant) return id;
        const plain = await this.storage.get(plainFile(id));
        if (!plain) throw new BadRequestException('That picture is gone. Upload it again.');

        // A copy is a new picture: it counts toward the uploads per day and the storage limit
        await this.checkQuota(user);
        let copyId = randomUUID();
        while (variantIndex(copyId) !== variant) copyId = randomUUID();
        await this.prisma.image.create({ data: { id: copyId, kind: 'avatar', inLibrary: false, createdBy: user.id, unusedSince: new Date() } });
        try {
            await this.storage.put(plainFile(copyId), plain, 'image/webp');
            await this.writeCopies(copyId, 'avatar', plain);
            await this.prisma.image.update({ where: { id: copyId }, data: { bytes: await this.storage.size(imagePrefix(copyId)) } });
        } catch (err) {
            await this.discard(copyId);
            throw err;
        }
        await this.checkStoredSize(user, copyId);
        return copyId;
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
            const image = await db.image.findUnique({ where: { id }, select: { inLibrary: true, unusedSince: true, _count: { select: { gigs: true, runners: true, artOf: true, crews: true } } } });
            if (!image) continue;
            const used = image.inLibrary || image._count.gigs > 0 || image._count.runners > 0 || image._count.artOf > 0 || image._count.crews > 0;
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
     * when the name or picture changes, or the gig is completed; the key changes with them. The card it replaces is
     * listed as stale and deleted later. A picture whose file is gone gets its plain framed copy.
     */
    async gigCardKey(gig: { id: string; imageId: string; name: string; completed: boolean; cardKey: string | null }): Promise<string> {
        const hash = createHash('sha1').update(`${gig.imageId}|${gig.name}|${gig.completed ? 'completed' : ''}|${FRAME_VERSION}|${CARD_VERSION}`).digest('hex').slice(0, 12);
        const key = cardFile(gig.id, hash);
        if (gig.cardKey !== key) {
            const plain = await this.storage.get(plainFile(gig.imageId));
            if (!plain) return framedFile(gig.imageId);
            await this.storage.put(key, await renderGigCard(plain, variantFor(gig.imageId), gig.name, gig.completed), 'image/png');
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

const storageFull = () =>
    new PayloadTooLargeException(`you've used your ${config.MAX_USER_STORAGE_MB} MB of picture storage. pictures nothing uses any more clear out after 30 days.`);

/** images/cards/<gig>/<hash>.png → cards-<gig>-<hash>.png, images/<id>/framed-v6.webp → <id>-framed-v6.webp */
export const attachmentName = (key: string) => key.split('/').slice(1).join('-');
