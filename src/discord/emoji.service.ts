import { createHash } from 'node:crypto';
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
 * Keeps the bot's application emojis in sync with assets/emoji. Each is uploaded as
 * name_hash (e.g. eb_3fa2c1), the hash coming from the SVG, so editing a file uploads
 * a new version on the next start. Old versions stay, so old messages keep their icons.
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
                const svg = readFileSync(join(EMOJI_DIR, file), 'utf8');
                const versioned = `${name}_${createHash('sha1').update(svg).digest('hex').slice(0, 6)}`;
                let emoji = existing.find((e) => e.name === versioned);
                if (!emoji) {
                    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 128 } }).render().asPng();
                    emoji = await client.application.emojis.create({ name: versioned, attachment: png });
                    this.logger.log(`Uploaded emoji ${versioned}`);
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
