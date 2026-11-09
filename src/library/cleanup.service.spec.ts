import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import { config } from '../config';
import type { Me } from '../shared/schemas';
import { artPreviewFile, artThumbFile, cardFile, imagePrefix, plainFile, webFile } from '../shared/images';
import { DiskStorage, StorageService } from '../storage/storage.service';
import { CleanupService } from './cleanup.service';
import { compressArt, LibraryService } from './library.service';

const DAY = 86_400_000;
const folder = mkdtempSync(join(tmpdir(), 'deadline-objects-'));

describe('picture cleanup', () => {
    let storage: StorageService;
    let library: LibraryService;
    let cleanup: CleanupService;

    beforeEach(async () => {
        await emptyDb();
        rmSync(folder, { recursive: true, force: true });
        storage = new StorageService(new DiskStorage(folder));
        library = new LibraryService(prisma, storage);
        cleanup = new CleanupService(prisma, storage);
    });

    after(async () => {
        rmSync(folder, { recursive: true, force: true });
        await prisma.$disconnect();
    });

    /** A picture row and two of its files, not in the library. */
    const picture = async () => {
        const image = await prisma.image.create({ data: { inLibrary: false } });
        await storage.put(plainFile(image.id), Buffer.from('plain'), 'image/webp');
        await storage.put(webFile(image.id), Buffer.from('web'), 'image/webp');
        return image.id;
    };

    it('marks a picture unused when nothing has it, and in use again when something does', async () => {
        const id = await picture();
        const runner = await prisma.runner.create({ data: { ownerId: 'a', handle: 'Vex', slug: 'vex', role: 'Solo', imageId: id } });
        await library.refreshUsage([id]);
        assert.equal((await prisma.image.findUniqueOrThrow({ where: { id } })).unusedSince, null);

        await prisma.runner.update({ where: { id: runner.id }, data: { imageId: null } });
        await library.refreshUsage([id]);
        assert.ok((await prisma.image.findUniqueOrThrow({ where: { id } })).unusedSince);
    });

    it('deletes pictures unused for 30 days, rows and files, and keeps newer ones', async () => {
        const old = await picture();
        const recent = await picture();
        await prisma.image.update({ where: { id: old }, data: { unusedSince: new Date(Date.now() - 31 * DAY) } });
        await prisma.image.update({ where: { id: recent }, data: { unusedSince: new Date(Date.now() - 5 * DAY) } });

        const removed = await cleanup.run();
        assert.deepEqual(removed, { images: 1, files: 2 });
        assert.equal(await prisma.image.findUnique({ where: { id: old } }), null);
        assert.deepEqual(await storage.list(imagePrefix(old)), []);
        assert.ok(await prisma.image.findUnique({ where: { id: recent } }));
        assert.equal((await storage.list(imagePrefix(recent))).length, 2);
    });

    it('keeps a picture marked unused if something has started using it since', async () => {
        const id = await picture();
        await prisma.image.update({ where: { id }, data: { unusedSince: new Date(Date.now() - 40 * DAY) } });
        await prisma.runner.create({ data: { ownerId: 'a', handle: 'Vex', slug: 'vex', role: 'Solo', imageId: id } });
        assert.deepEqual(await cleanup.run(), { images: 0, files: 0 });
        assert.ok(await prisma.image.findUnique({ where: { id } }));
    });

    it('keeps art a runner is using', async () => {
        const id = await picture();
        await prisma.image.update({ where: { id }, data: { unusedSince: new Date(Date.now() - 40 * DAY) } });
        await prisma.runner.create({ data: { ownerId: 'a', handle: 'Vex', slug: 'vex', role: 'Solo', photos: { create: { imageId: id, position: 0 } } } });
        assert.deepEqual(await cleanup.run(), { images: 0, files: 0 });
        await library.refreshUsage([id]);
        assert.equal((await prisma.image.findUniqueOrThrow({ where: { id } })).unusedSince, null);
    });

    it('stores art at its own shape, with a preview and no frames', async () => {
        const tall = await sharp({ create: { width: 1500, height: 3000, channels: 3, background: '#336699' } }).png().toBuffer();
        const id = await library.add(tall, { regionId: null, inLibrary: false, createdBy: 'a', kind: 'art' });
        assert.deepEqual((await storage.list(imagePrefix(id))).sort(), [artPreviewFile(id), artThumbFile(id), plainFile(id)].sort());
        const stored = await sharp((await storage.get(plainFile(id)))!).metadata();
        assert.deepEqual([stored.format, stored.width, stored.height], ['webp', 1000, 2000]);
        const preview = await sharp((await storage.get(artPreviewFile(id)))!).metadata();
        assert.deepEqual([preview.width, preview.height], [450, 900]);
        const thumb = await sharp((await storage.get(artThumbFile(id)))!).metadata();
        assert.deepEqual([thumb.width, thumb.height], [120, 240]);
    });

    it('never makes small art bigger', async () => {
        const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#993366' } }).png().toBuffer();
        const { width, height } = await sharp(await compressArt(small)).metadata();
        assert.deepEqual([width, height], [300, 200]);
    });

    describe('storage limit per person', () => {
        const MB = 1024 * 1024;
        const me = { id: 'a', name: 'a', avatar: null, isOwner: false, isAdmin: true, isFixer: false, isEdgerunner: true, timezone: null, needsSetup: false } as Me;
        const file = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#112233' } }).png().toBuffer();
        const avatar = { regionId: null, inLibrary: false, kind: 'avatar' as const };
        const limit = config.MAX_USER_STORAGE_MB;
        beforeEach(() => {
            config.MAX_USER_STORAGE_MB = 1;
        });
        after(() => {
            config.MAX_USER_STORAGE_MB = limit;
        });

        it('records what each upload takes up', async () => {
            const id = await library.upload(me, await file(), avatar);
            const { bytes } = await prisma.image.findUniqueOrThrow({ where: { id } });
            assert.ok(bytes > 0);
            assert.equal(bytes, await storage.size(imagePrefix(id)));
        });

        it('refuses an upload at the limit', async () => {
            await prisma.image.create({ data: { inLibrary: false, createdBy: 'a', bytes: MB } });
            await assert.rejects(library.upload(me, await file(), avatar), /1 MB of picture storage/);
            assert.equal(await prisma.image.count(), 1);
        });

        it('leaves nothing behind when an upload takes it over', async () => {
            await prisma.image.create({ data: { inLibrary: false, createdBy: 'a', bytes: MB - 1 } });
            await assert.rejects(library.upload(me, await file(), avatar), /picture storage/);
            assert.equal(await prisma.image.count(), 1);
            assert.deepEqual(await storage.list('images/'), []);
        });

        it("doesn't count other people's uploads or the library", async () => {
            await prisma.image.create({ data: { inLibrary: false, createdBy: 'b', bytes: 5 * MB } });
            await prisma.image.create({ data: { inLibrary: true, createdBy: 'a', bytes: 5 * MB } });
            assert.ok(await library.upload(me, await file(), avatar));
        });

        it('lets admins keep adding to the library', async () => {
            await prisma.image.create({ data: { inLibrary: false, createdBy: 'a', bytes: 5 * MB } });
            assert.ok(await library.upload(me, await file(), { regionId: null, inLibrary: true, kind: 'gig' }));
        });

        it('works out the size of pictures from before sizes were kept', async () => {
            const image = await prisma.image.create({ data: { inLibrary: false, kind: 'art' } });
            await storage.put(plainFile(image.id), Buffer.alloc(300), 'image/webp');
            await storage.put(artPreviewFile(image.id), Buffer.alloc(40), 'image/webp');
            await storage.put(artThumbFile(image.id), Buffer.alloc(10), 'image/webp');
            await (library as unknown as { fillIn(): Promise<void> }).fillIn();
            assert.equal((await prisma.image.findUniqueOrThrow({ where: { id: image.id } })).bytes, 350);
        });
    });

    it('deletes replaced gig cards 30 days after they were replaced', async () => {
        const oldCard = cardFile('gig', 'old');
        const newerCard = cardFile('gig', 'newer');
        await storage.put(oldCard, Buffer.from('card'), 'image/png');
        await storage.put(newerCard, Buffer.from('card'), 'image/png');
        await prisma.staleObject.create({ data: { key: oldCard, since: new Date(Date.now() - 31 * DAY) } });
        await prisma.staleObject.create({ data: { key: newerCard, since: new Date(Date.now() - DAY) } });

        assert.deepEqual(await cleanup.run(), { images: 0, files: 1 });
        assert.equal(await storage.get(oldCard), null);
        assert.ok(await storage.get(newerCard));
        assert.equal(await prisma.staleObject.count(), 1);
    });
});
