import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { imagePrefix } from '../shared/images';
import { StorageService } from '../storage/storage.service';

/** How long an unused picture or an old file is kept before it's deleted. */
export const KEEP_DAYS = 30;

/**
 * Deletes what's no longer needed, once a day: pictures nothing has used for 30 days (rows and
 * files), and old files (replaced gig cards, earlier frame versions) listed 30 days ago.
 */
@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
    ) {}

    @Cron('30 4 * * *')
    async daily() {
        try {
            await this.run();
        } catch (err) {
            this.logger.error(`Cleanup failed: ${err}`);
        }
    }

    /** Returns what it removed. `now` is for tests. */
    async run(now = new Date()): Promise<{ images: number; files: number }> {
        const before = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
        let files = 0;

        // Checked again here, so a picture someone started using since isn't lost
        const unused = await this.prisma.image.findMany({
            where: { unusedSince: { lte: before }, inLibrary: false, gigs: { none: {} }, runners: { none: {} } },
            select: { id: true },
        });
        for (const { id } of unused) {
            const keys = await this.storage.list(imagePrefix(id));
            await this.storage.delete(keys);
            files += keys.length;
            await this.prisma.image.delete({ where: { id } });
        }

        const stale = await this.prisma.staleObject.findMany({ where: { since: { lte: before } } });
        // A card that became current again (a rename undone) stays
        const current = new Set((await this.prisma.gig.findMany({ where: { cardKey: { in: stale.map((s) => s.key) } }, select: { cardKey: true } })).map((g) => g.cardKey));
        const gone = stale.filter((s) => !current.has(s.key)).map((s) => s.key);
        await this.storage.delete(gone);
        await this.prisma.staleObject.deleteMany({ where: { key: { in: stale.map((s) => s.key) } } });
        files += gone.length;

        if (unused.length || files) this.logger.log(`Cleaned up ${unused.length} unused picture(s), ${files} file(s)`);
        return { images: unused.length, files };
    }
}
