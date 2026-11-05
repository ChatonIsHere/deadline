import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resvg } from '@resvg/resvg-js';
import { Client } from 'discord.js';
import { Context, ContextOf, Once } from 'necord';

export const EMOJI_DIR = join(__dirname, '..', '..', 'assets', 'emoji');

/** Looks up an emoji by name. Returns '' if it isn't uploaded. */
export type EmojiLookup = (name: string) => string;

/**
 * Keeps the bot's application emojis in sync with assets/emoji. Missing ones are
 * uploaded on startup. To replace one, delete it in the Discord developer portal
 * and restart.
 */
@Injectable()
export class EmojiService {
    private readonly logger = new Logger(EmojiService.name);
    private readonly emojis = new Map<string, string>();

    get: EmojiLookup = (name) => this.emojis.get(name) ?? '';

    /** Settles once emoji are loaded (or failed to), so posts aren't built without them. */
    readonly ready: Promise<void>;
    private markReady!: () => void;

    constructor(@Inject(Client) private readonly client: Client) {
        this.ready = new Promise((resolve) => (this.markReady = resolve));
    }

    @Once('clientReady')
    async onReady(@Context() [client]: ContextOf<'clientReady'>) {
        try {
            const existing = await client.application.emojis.fetch();
            const files = readdirSync(EMOJI_DIR).filter((f) => f.endsWith('.svg'));

            for (const file of files) {
                const name = file.replace(/\.svg$/, '');
                let emoji = existing.find((e) => e.name === name);
                if (!emoji) {
                    const png = new Resvg(readFileSync(join(EMOJI_DIR, file), 'utf8'), { fitTo: { mode: 'width', value: 128 } }).render().asPng();
                    emoji = await client.application.emojis.create({ name, attachment: png });
                    this.logger.log(`Uploaded emoji ${name}`);
                }
                this.emojis.set(name, emoji.toString());
            }
        } catch (err) {
            this.logger.warn(`Emoji sync failed, using text instead: ${err}`);
        } finally {
            this.markReady();
        }
    }
}
