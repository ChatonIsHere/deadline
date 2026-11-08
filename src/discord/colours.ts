import type { APIEmbed } from 'discord.js';
import type { GigStatus } from '../shared/schemas';
import type { Said, Tone } from './voice';

/**
 * The site's colours (client/src/styles/globals.css), so Discord reads the same way: yellow
 * for what needs you, yours or money; cyan for information; green and red for how things
 * turned out; grey for nothing to do.
 */
export const SITE = {
    yellow: 0xf3e600,
    cyan: 0x00e5ff,
    green: 0x39ff88,
    red: 0xff3b30,
    grey: 0x9d9dbb,
} as const;

/** A gig's status, as the site's status tags colour it. */
export const COLOURS: Record<GigStatus, number> = {
    draft: SITE.grey,
    pending: SITE.grey,
    open: SITE.yellow,
    closed: SITE.cyan,
    completed: SITE.green,
    cancelled: SITE.red,
    rejected: SITE.red,
};

const TONES: Record<Tone, number> = { act: SITE.yellow, info: SITE.cyan, good: SITE.green, bad: SITE.red, quiet: SITE.grey };

/**
 * Each sentence starts with a capital. The board talks in lowercase on the site, after its
 * "// DEADLINE:" tag; embeds have no tag. Names in bold stay as written ("**the box**").
 */
const capital = (text: string) => text.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());

/** A line from the board as an embed: its tone's colour, the line, and any details as fields. */
export function lineEmbed(said: Said): APIEmbed {
    return { color: TONES[said.tone], description: capital(said.text), fields: said.details };
}

/** A message that's just a line. */
export const lineMessage = (said: Said) => ({ embeds: [lineEmbed(said)] });

/**
 * A line in place of a message's buttons and text, for answering a button on it. `content: ''`
 * clears text left on older messages, from before everything was embeds.
 */
export const lineReplacing = (said: Said) => ({ content: '', embeds: [lineEmbed(said)], components: [] });
