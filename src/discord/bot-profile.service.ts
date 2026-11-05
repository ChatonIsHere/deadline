import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityType, Client } from 'discord.js';
import { Once } from 'necord';
import sharp from 'sharp';
import { GigsService } from '../gigs/gigs.service';
import { frameSvg } from '../library/frame';
import { LibraryService } from '../library/library.service';
import { plainFile } from '../shared/images';
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
        this.updateStatus();
        setInterval(() => this.updateStatus(), STATUS_MS).unref();
    }

    async get(): Promise<BotProfile> {
        const app = await this.client.application!.fetch();
        const user = await this.client.user!.fetch();
        return { about: app.description ?? '', bannerUrl: user.bannerURL({ size: 600 }) ?? null };
    }

    /** Admins only. The banner is a library picture with the board's frame on it. */
    async set(user: Me, input: BotProfileInput): Promise<BotProfile> {
        if (!user.isAdmin) throw new ForbiddenException();
        await this.client.application!.edit({ description: input.about });
        if (input.bannerImageId) {
            if (!this.library.exists(input.bannerImageId)) throw new BadRequestException('That picture is gone. Pick another.');
            const plain = readFileSync(join(this.library.dir, plainFile(input.bannerImageId)));
            const banner = await sharp(plain)
                .resize(BANNER.width, BANNER.height, { fit: 'cover' })
                // Banners get a solid margin: Discord shows them on a coloured strip anyway
                .composite([{ input: Buffer.from(frameSvg(BANNER.width, BANNER.height, undefined, true).overlay) }])
                .png()
                .toBuffer();
            await this.client.user!.setBanner(banner);
        }
        return this.get();
    }

    /** "Watching 3 contracts on the wire". Only sent to Discord when the number changes. */
    private updateStatus() {
        const open = this.gigs.countOpen();
        const status = `${open} contract${open === 1 ? '' : 's'} on the wire`;
        if (status === this.lastStatus) return;
        this.lastStatus = status;
        this.client.user?.setPresence({ activities: [{ type: ActivityType.Watching, name: status }] });
    }
}
