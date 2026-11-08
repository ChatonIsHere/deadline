import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityType, Client } from 'discord.js';
import { Once } from 'necord';
import sharp from 'sharp';
import { GigsService } from '../gigs/gigs.service';
import { frameSvg } from '../library/frame';
import { LibraryService } from '../library/library.service';
import type { BotProfile, BotProfileInput, Me } from '../shared/schemas';

/** Discord shows profile banners at 5:2. */
const BANNER = { width: 1200, height: 480 };
const STATUS_MS = 60 * 1000;

/**
 * The bot's own Discord profile: banner and About me (set by admins on the web), and a
 * status that keeps count of open gigs.
 */
@Injectable()
export class BotProfileService {
    private readonly logger = new Logger(BotProfileService.name);
    private lastStatus = '';

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly gigs: GigsService,
        private readonly library: LibraryService,
    ) {}

    @Once('clientReady')
    startStatus() {
        const update = () => void this.updateStatus().catch((err) => this.logger.warn(`Status not updated: ${err}`));
        update();
        setInterval(update, STATUS_MS).unref();
    }

    async get(): Promise<BotProfile> {
        const app = await this.client.application!.fetch();
        const user = await this.client.user!.fetch();
        return { about: app.description ?? '', bannerUrl: user.bannerURL({ size: 1024 }) ?? null };
    }

    /** Admins only. The banner is a library picture with the board's frame on it. */
    async set(user: Me, input: BotProfileInput): Promise<BotProfile> {
        if (!user.isAdmin) throw new ForbiddenException();
        // About me first, so a banner Discord refuses doesn't lose it
        await this.discord('About me', () => this.client.application!.edit({ description: input.about }));
        if (input.bannerImageId) {
            const plain = await this.library.plain(input.bannerImageId);
            if (!plain) throw new BadRequestException('That picture is gone. Pick another.');
            const banner = await sharp(plain)
                .resize(BANNER.width, BANNER.height, { fit: 'cover' })
                // Banners get a solid margin: Discord shows them on a coloured strip anyway
                .composite([{ input: Buffer.from(frameSvg(BANNER.width, BANNER.height, { solid: true }).overlay) }])
                .png()
                .toBuffer();
            await this.discord('Banner', () => this.client.user!.setBanner(banner));
        }
        return this.get();
    }

    /** Runs a profile change, turning Discord's refusal (e.g. changing the banner too often) into a message for the page. */
    private async discord(what: string, change: () => Promise<unknown>) {
        try {
            await change();
        } catch (err) {
            this.logger.warn(`${what} not saved: ${err}`);
            const message = err instanceof Error ? err.message : String(err);
            throw new BadRequestException(`${what} not saved. Discord says: ${message}`);
        }
    }

    /** "Watching 3 contracts on the wire". Only sent to Discord when the number changes. */
    private async updateStatus() {
        const open = await this.gigs.countOpen();
        const status = `${open} contract${open === 1 ? '' : 's'} on the wire`;
        if (status === this.lastStatus) return;
        this.lastStatus = status;
        this.client.user?.setPresence({ activities: [{ type: ActivityType.Watching, name: status }] });
    }
}
