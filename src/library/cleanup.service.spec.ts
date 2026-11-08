import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import { artPreviewFile, cardFile, imagePrefix, plainFile, webFile } from '../shared/images';
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
        await prisma.runner.create({ data: { ownerId: 'a', handle: 'Vex', slug: 'vex', role: 'Solo', artId: id } });
        assert.deepEqual(await cleanup.run(), { images: 0, files: 0 });
        await library.refreshUsage([id]);
        assert.equal((await prisma.image.findUniqueOrThrow({ where: { id } })).unusedSince, null);
    });

    it('stores art at its own shape, with a preview and no frames', async () => {
        const tall = await sharp({ create: { width: 1500, height: 3000, channels: 3, background: '#336699' } }).png().toBuffer();
        const id = await library.add(tall, { regionId: null, inLibrary: false, createdBy: 'a', kind: 'art' });
        assert.deepEqual((await storage.list(imagePrefix(id))).sort(), [artPreviewFile(id), plainFile(id)].sort());
        const stored = await sharp((await storage.get(plainFile(id)))!).metadata();
        assert.deepEqual([stored.format, stored.width, stored.height], ['webp', 1000, 2000]);
        const preview = await sharp((await storage.get(artPreviewFile(id)))!).metadata();
        assert.deepEqual([preview.width, preview.height], [450, 900]);
    });

    it('never makes small art bigger', async () => {
        const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#993366' } }).png().toBuffer();
        const { width, height } = await sharp(await compressArt(small)).metadata();
        assert.deepEqual([width, height], [300, 200]);
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
