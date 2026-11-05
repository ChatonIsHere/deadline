// Most of what the board's AI says, in one place so the tone is easy to change. Command errors are in commands.ts.

// Lines go out as ```ansi code blocks: Discord's desktop app colours them (the phone app shows
// them plain). Code blocks don't render timestamps, mentions or links, so those go on a normal
// line underneath: pass them as `extra`, and links are moved there on their own.
const ESC = '\u001b';
const cyan = (s: string) => `${ESC}[0;36m${s}${ESC}[0m`;
const yellow = (s: string) => `${ESC}[1;33m${s}${ESC}[0m`;
const URL_RE = /https?:\/\/\S+/g;

/** A line from the board's AI. `**name**` comes out yellow. */
const say = (line: string, extra?: string) => {
    const links = line.match(URL_RE) ?? [];
    const text = line
        .replace(URL_RE, '')
        .replace(/\s+([.,])/g, '$1')
        .trim()
        // A gig name with ``` in it would end the block early
        .replace(/```/g, "'''")
        .replace(/\*\*(.+?)\*\*/g, (_, name: string) => yellow(name));
    const below = [extra, ...links].filter(Boolean).join('\n');
    return `\`\`\`ansi\n${cyan('// DEADLINE:')} ${text}\n\`\`\`${below ? `\n${below}` : ''}`;
};

/** A said line as plain text, for the web. */
export const plainVoice = (said: string) =>
    said
        .replace(/```(ansi)?\n?/g, '')
        .replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')
        .replace(/[*`]/g, '')
        .replace(/\n+/g, ' ')
        .trim();

/** A name to show in yellow. Asterisks in it would break the highlighting, so they go. */
const n = (name: string) => `**${name.replace(/\*/g, '')}**`;

/** Discord renders these in each reader's own timezone. */
const ts = (ms: number, style: 'F' | 'f' | 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const when = (ms: number) => `${ts(ms, 'F')} (${ts(ms, 'R')})`;

export const voice = {
    footer: (status: string) => `STATUS // ${status.toUpperCase()}`,
    when,

    // Replies to the person who pressed a button
    interested: () => say("noted. you're on the list. you'll get a ping when the session time is set."),
    joined: (open: number) => say(`slot locked in. ${open ? `${open} left on the contract.` : 'crew is full.'}`),
    reserve: (position: number) => say(`slots are full. you're reserve #${position}. you'll get a ping if one opens up.`),
    confirmed: () => say('attendance confirmed. see you there, choom.'),
    left: () => say('slot released. no hard feelings, choom.'),
    pickRunnerPrompt: () => say('which runner is taking this one?'),
    rated: (stars: number) => say(`rating logged: ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}. change it any time.`),
    error: (message: string) => say(message),

    // Asking runners to confirm, by DM (or in the thread if their DMs are closed)
    confirmAsk: (gigName: string, at: number, by: number) =>
        say(`${n(gigName)} is on. confirm you're in, or drop out so a reserve can take your slot.`, `**When:** ${when(at)}\n**Confirm by:** ${ts(by, 'f')}`),
    nudge: (gigName: string, at: number, by: number) =>
        say(`still need an answer on ${n(gigName)}. confirm or your slot goes to the reserves.`, `**When:** ${when(at)}\n**Confirm by:** ${ts(by, 'R')}`),
    dropped: (gigName: string) => say(`no answer on ${n(gigName)}, so your slot went to the next runner. sign up again if you can still make it.`),
    confirmFallback: (mentions: string) => `${mentions}\n${say("couldn't DM you. confirm or drop out here.")}`,

    // Reminders for confirmed runners
    reminderDay: (gigName: string, at: number) => say(`reminder: ${n(gigName)} is on today.`, `**When:** ${when(at)}`),
    reminderSoon: (gigName: string, at: number) => say(`${n(gigName)} starts soon. gear up.`, `**Starts** ${ts(at, 'R')}`),
    remindersOff: (url: string) => say(`reminders off. turn them back on from your Me page: ${url}/me`),
    remindersSet: (on: boolean) => say(on ? "reminders on. you'll get a DM a few hours before and 30 minutes before." : 'reminders off. confirm requests still come through.'),
    runnerMade: (handle: string, editUrl: string) => say(`${n(handle)} is on file. add a picture and extra roles on the web: ${editUrl}`),

    // After the job
    payout: (gigName: string) => say(`${n(gigName)} is done. here's your cut.`),
    rateFixer: (fixer: string) => `Rate ${fixer} (fixer)`,
    rateComment: (stars: number) => `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} saved. Add a note?`,

    // Crews
    crewInvite: (crewName: string, handle: string, from: string) => say(`${n(crewName)} wants ${n(handle)} in the crew. ${from} sent the invite.`),
    crewJoined: (crewName: string, handle: string) => say(`${n(handle)} is in ${n(crewName)} now. welcome to the family.`),
    crewDeclined: (crewName: string) => say(`invite from ${n(crewName)} declined.`),

    // Posted in the gig's thread: gig-wide news only. Runners coming and going show in the post's crew list.
    sessionSet: (at: number) => say('session time set. runners, check your DMs and confirm.', `**When:** ${when(at)}`),
    sessionCleared: () => say('session time cleared. back to gauging interest.'),
    sessionSoon: (at: number) => say('session starts soon.', `**Starts** ${ts(at, 'R')}`),
    sessionToday: (at: number) => say('session is on today. confirmed runners, see you there.', `**When:** ${when(at)}`),
    slotsOpened: (crewName: string) => say(`${n(crewName)}'s reserved slots are open to any edgerunner now.`),
    statusChanged: {
        open: say('contract is live. sign-ups open.'),
        closed: say('sign-ups locked. good luck out there.'),
        completed: say('job done. payment cleared. runners, check your DMs.'),
        cancelled: say('contract pulled. stand down.'),
    } as Record<string, string>,

    board: (url: string, open: number) => say(`${open} contract(s) live. full board: ${url}/gigs`),

    // Errors the service throws, shown on the web and in Discord
    notOpen: 'that contract is not taking runners.',
    notActive: 'that contract is closed.',
    alreadyIn: "you're already on this one.",
    alreadyReserve: "you're already on the reserves.",
    alreadyConfirmed: "you're already confirmed.",
    notIn: "you're not on this contract.",
    nothingToConfirm: "there's no session time to confirm yet.",
    notRunner: 'you need the edgerunner role to take gigs.',
    playerAlreadyIn: 'that player already has a runner on this gig.',
    playerAlreadyReserve: 'that player already has a runner on the reserves.',
    broken: 'something broke on our end. try again in a minute.',
    pickRunner: 'you have more than one runner. pick which one is going.',
    noRunner: (url: string) => `you don't have a runner yet. make one here: ${url}/runners/new`,
};
