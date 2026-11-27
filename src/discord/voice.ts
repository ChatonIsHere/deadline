// Most of what the board's AI says, in one place so the tone is easy to change. Command errors are in commands.ts.
// Discord shows these as embeds coloured by tone (see lineEmbed in colours.ts); the web shows the plain text.

import type { EmojiLookup } from './emoji.service';

/**
 * What a line is about, which sets its colour in Discord, as on the site. act: needs you to do
 * something. info: news. good: it worked. bad: it didn't, or bad news. quiet: nothing to do.
 */
export type Tone = 'act' | 'info' | 'good' | 'bad' | 'quiet';

/** A line from the board, with optional details shown under it as fields. */
export interface Said {
    text: string;
    tone: Tone;
    details?: { name: string; value: string; inline?: boolean }[];
}

const say = (tone: Tone, text: string, details?: Said['details']): Said => ({ tone, text, details });

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * A rating as five stars, for messages and embeds. Averages fill a star part way, to the
 * nearest tenth like the number beside it (star_1 to star_9 in assets/emoji). Without the
 * bot's emoji, standard ones and whole stars.
 */
export function starRow(value: number, emoji: EmojiLookup): string {
    const tenths = Math.round(Math.min(Math.max(value, 0), 5) * 10);
    const part = tenths % 10 ? emoji(`star_${tenths % 10}`) : '';
    const full = emoji('star_full');
    const empty = emoji('star_empty');
    if (!full || !empty || (tenths % 10 && !part)) {
        const filled = Math.round(tenths / 10);
        return (full || '⭐').repeat(filled) + (empty || '⬛').repeat(5 - filled);
    }
    const filled = Math.floor(tenths / 10);
    return full.repeat(filled) + part + empty.repeat(5 - filled - (part ? 1 : 0));
}

/** Menus and pop-up titles can't draw the bot's own emoji, so they count in standard stars. */
export const plainStars = (filled: number) => '⭐'.repeat(filled);

/** A line as plain text, for the web. */
export const plainVoice = (said: Said) =>
    said.text
        .replace(LINK_RE, '$1')
        .replace(/<a?:star_full_\w+:\d+>/g, '★')
        .replace(/<a?:star_empty_\w+:\d+>/g, '☆')
        // A part-filled star: filled from half way
        .replace(/<a?:star_(\d)_\w+:\d+>/g, (_, tenths: string) => (Number(tenths) >= 5 ? '★' : '☆'))
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/[*`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

/** A name in bold. Asterisks in it would break the bold, so they go. */
const n = (name: string) => `**${name.replace(/\*/g, '')}**`;

/** Discord renders these in each reader's own timezone. */
const ts = (ms: number, style: 'F' | 'f' | 't' | 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
/** The start, the estimated end's time if there is one, and how long until it starts. */
const when = (ms: number, endMs?: number | null) => `${ts(ms, 'F')}${endMs ? ` to about ${ts(endMs, 't')}` : ''} (${ts(ms, 'R')})`;

export const voice = {
    footer: (status: string) => `STATUS // ${status.toUpperCase()}`,
    when,

    // Replies to the person who pressed a button
    interested: () => say('info', "noted. you're on the list. you'll get a ping when the session time is set."),
    /** `open` is null when the gig has no limit. */
    joined: (open: number | null) => say('good', `slot locked in.${open === null ? '' : open ? ` ${open} left on the contract.` : ' crew is full.'}`),
    reserve: (position: number) => say('info', `slots are full. you're reserve #${position}. you'll get a ping if one opens up.`),
    confirmed: () => say('good', 'attendance confirmed. see you there, choom.'),
    left: () => say('quiet', 'slot released. no hard feelings, choom.'),
    pickRunnerPrompt: () => say('act', 'which runner is taking this one?'),
    dtSkipped: (handle: string) => say('quiet', `${n(handle)} sat this month out. no DT, nothing due.`),
    monthStart: () => say('act', "new month. DT has reset and this month's is in."),
    rated: (stars: number, emoji: EmojiLookup) => say('good', `review logged: ${starRow(stars, emoji)}. change it any time.`),
    error: (message: string) => say('bad', message),
    /** Answers to /dm and the chat message menus */
    chat: (text: string) => say('info', text),

    // Asking runners to confirm, by DM (or in the thread if their DMs are closed)
    confirmAsk: (gigName: string, at: number, by: number) =>
        say('act', `${n(gigName)} is on. confirm you're in, or drop out so a reserve can take your slot.`, [
            { name: 'When', value: when(at), inline: true },
            { name: 'Confirm by', value: ts(by, 'f'), inline: true },
        ]),
    nudge: (gigName: string, at: number, by: number) =>
        say('act', `still need an answer on ${n(gigName)}. confirm or your slot goes to the reserves.`, [
            { name: 'When', value: when(at), inline: true },
            { name: 'Confirm by', value: ts(by, 'R'), inline: true },
        ]),
    dropped: (gigName: string) => say('bad', `no answer on ${n(gigName)}, so your slot went to the next runner. sign up again if you can still make it.`),
    confirmFallback: () => say('act', "couldn't DM you. confirm or drop out here."),

    // Reminders for confirmed runners
    reminderDay: (gigName: string, at: number) => say('info', `reminder: ${n(gigName)} is on today.`, [{ name: 'When', value: when(at) }]),
    remindersOff: (url: string) => say('quiet', `reminders off. turn them back on from your [Me page](${url}/me).`),
    remindersSet: (on: boolean) =>
        on ? say('good', "reminders on. you'll get a DM a few hours before, and a ping in the gig's thread 30 minutes before.") : say('quiet', 'reminders off. confirm requests still come through.'),
    runnerMade: (handle: string, editUrl: string) => say('good', `${n(handle)} is on file. add a picture and extra roles on the [edit page](${editUrl}).`),

    // After the job
    rateFixer: (fixer: string) => `Review the gig and ${fixer}`,
    rateComment: (stars: number) => `${plainStars(stars)} saved. Say how it went?`,

    // Crews
    crewInvite: (crewName: string, handle: string, from: string) => say('act', `${n(crewName)} wants ${n(handle)} in the crew. ${from} sent the invite.`),
    crewJoined: (crewName: string, handle: string) => say('good', `${n(handle)} is in ${n(crewName)} now. welcome to the family.`),
    crewDeclined: (crewName: string) => say('quiet', `invite from ${n(crewName)} declined.`),

    // Posted in the gig's thread: gig-wide news only. Runners coming and going show in the post's crew list.
    sessionSet: (at: number, end: number | null) => say('info', 'session time set. runners, check your DMs and confirm.', [{ name: 'When', value: when(at, end) }]),
    sessionCleared: () => say('quiet', 'session time cleared. back to gauging interest.'),
    sessionStarted: () => say('good', "session's started. the crew's in-character chat is open."),
    sessionSoon: (at: number) => say('info', 'session starts soon.', [{ name: 'Starts', value: ts(at, 'R') }]),
    sessionToday: (at: number) => say('info', 'session is on today. confirmed runners, see you there.', [{ name: 'When', value: when(at) }]),
    slotsOpened: (crewName: string) => say('info', `${n(crewName)}'s reserved slots are open to freelancers now.`),
    statusChanged: {
        open: say('act', 'contract is live. sign-ups open.'),
        closed: say('info', 'sign-ups locked. good luck out there.'),
        cancelled: say('bad', 'contract pulled. stand down.'),
    } as Partial<Record<string, Said>>,

    // Copies by DM for the people it's about (see NotifySettings)
    movedUp: (gigName: string, handle: string) => say('good', `a slot opened on ${n(gigName)}. ${n(handle)} moved up from the reserves.`),
    assigned: (gigName: string, handle: string) => say('info', `an admin put ${n(handle)} on ${n(gigName)}.`),
    kicked: (gigName: string, handle: string) => say('bad', `an admin took ${n(handle)} off ${n(gigName)}.`),
    gigCancelled: (gigName: string) => say('bad', `${n(gigName)} was pulled. stand down.`),
    sessionClearedFor: (gigName: string) => say('quiet', `${n(gigName)}'s session time was cleared. you're still on it.`),
    gigApproved: (gigName: string) => say('good', `${n(gigName)} is approved and on the board.`),
    gigRejected: (gigName: string) => say('bad', `${n(gigName)} was turned down.`),
    scheduleFailed: (gigName: string, reason: string) => say('bad', `${n(gigName)} didn't post at its scheduled time, so it's back to a plain draft. ${reason}`),
    ratingIn: (gigName: string, by: string, stars: number, comment: string | null, emoji: EmojiLookup) =>
        say('info', `${n(by)} reviewed ${n(gigName)}: ${starRow(stars, emoji)}`, comment ? [{ name: 'Review', value: comment }] : undefined),
    needsApproval: (gigName: string, fixer: string) => say('act', `${n(fixer)} wants ${n(gigName)} on the board. it needs an admin's sign-off.`),
    newGig: () => say('act', 'new contract on the board.'),

    board: (url: string, open: number) => say('info', `${open} contract(s) live. full list on the [gig board](${url}/gigs).`),

    // Errors the service throws, shown on the web and in Discord
    notOpen: 'that contract is not taking runners.',
    notActive: 'that contract is closed.',
    alreadyIn: "you're already on this one.",
    alreadyReserve: "you're already on the reserves.",
    alreadyConfirmed: "you're already confirmed.",
    notIn: "you're not on this contract.",
    nothingToConfirm: "there's no session time to confirm yet.",
    notRunner: 'you need the edgerunner role to take gigs.',
    notEnoughDt: (balance: number) => `only ${balance} DT left this month.`,
    dtNothingToSkip: "there's nothing to skip this month.",
    dtAlreadySpent: "some of this month's DT is already spent, so it can't be skipped.",
    dtMonthOver: "that month's over.",
    atLimit: (max: number) => `you're signed up to ${max} live gig${max === 1 ? '' : 's'}, which is the limit. pull out of one or wait for one to finish.`,
    playerAlreadyIn: 'that player already has a runner on this gig.',
    playerAlreadyReserve: 'that player already has a runner on the reserves.',
    broken: 'something broke on our end. try again in a minute.',
    pickRunner: 'you have more than one runner. pick which one is going.',
    noRunner: (url: string) => `you don't have a runner yet. make one on the [new runner page](${url}/runners/new).`,
};
