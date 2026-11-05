// Everything the board's AI says, in one place so the tone is easy to change.

const say = (line: string) => `\`// DEADLINE:\` ${line}`;

/** Discord renders these in each reader's own timezone. */
const when = (ms: number) => `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)`;
const list = (names: string[]) => names.map((n) => `**${n}**`).join(', ');

export const voice = {
    footer: (status: string, host: string) => `DEADLINE // ${host} // ${status.toUpperCase()}`,
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
        say(`**${gigName}** is on for ${when(at)}. confirm you're in by <t:${Math.floor(by / 1000)}:f>, or drop out so a reserve can take your slot.`),
    nudge: (gigName: string, at: number, by: number) =>
        say(`still need an answer on **${gigName}** (${when(at)}). confirm by <t:${Math.floor(by / 1000)}:R> or your slot goes to the reserves.`),
    dropped: (gigName: string) => say(`no answer on **${gigName}**, so your slot went to the next runner. sign up again if you can still make it.`),
    confirmFallback: (mentions: string) => `${mentions} ${say("couldn't DM you. confirm or drop out here.")}`,

    // Reminders for confirmed runners
    reminderDay: (gigName: string, at: number) => say(`reminder: **${gigName}** is on ${when(at)}.`),
    reminderSoon: (gigName: string, at: number) => say(`**${gigName}** starts <t:${Math.floor(at / 1000)}:R>. gear up.`),
    remindersOff: (url: string) => say(`reminders off. turn them back on at ${url}/me`),
    remindersSet: (on: boolean) => say(on ? "reminders on. you'll get a DM on the day and 30 minutes before." : 'reminders off. confirm requests still come through.'),
    runnerMade: (handle: string, editUrl: string) => say(`**${handle}** is on file. add a picture and extra roles at ${editUrl}`),

    // After the job
    payout: (gigName: string) => say(`**${gigName}** is done. here's your cut.`),
    rateFixer: (fixer: string) => `Rate ${fixer} (fixer)`,

    // Posted in the gig's thread. Runners go by their handles.
    runnerIn: (handle: string, state: string) =>
        say(
            state === 'interested'
                ? `**${handle}** is interested.`
                : state === 'awaiting'
                  ? `**${handle}** was added. waiting on them to confirm.`
                  : `**${handle}** signed on.`,
        ),
    reserveIn: (handle: string, position: number) => say(`**${handle}** joined the reserves (#${position}).`),
    runnerConfirmed: (handle: string) => say(`**${handle}** confirmed.`),
    runnerOut: (handle: string) => say(`**${handle}** pulled out.`),
    promoted: (handles: string[]) => say(`${list(handles)} moved up from reserves.`),
    noAnswer: (handles: string[]) => say(`no answer from ${list(handles)}. slot(s) released.`),
    sessionSet: (at: number) => say(`session set for ${when(at)}. runners, check your DMs and confirm.`),
    sessionCleared: () => say('session time cleared. back to gauging interest.'),
    sessionSoon: (at: number) => say(`session starts <t:${Math.floor(at / 1000)}:R>.`),
    sessionToday: (at: number) => say(`session is on ${when(at)}. confirmed runners, see you there.`),
    slotsOpened: (crewName: string) => say(`${crewName}'s reserved slots are open to any edgerunner now.`),
    statusChanged: {
        open: say('contract is live. sign-ups open.'),
        closed: say('sign-ups locked. good luck out there.'),
        completed: say('job done. payment cleared. runners, check your DMs.'),
        cancelled: say('contract pulled. stand down.'),
    } as Record<string, string>,

    board: (url: string, open: number) => say(`${open} contract(s) live. full board at ${url}`),

    // Errors the service throws, shown on the web and in Discord
    notOpen: 'that contract is not taking runners.',
    notActive: 'that contract is closed.',
    alreadyIn: "you're already on this one.",
    alreadyReserve: "you're already on the reserves.",
    alreadyConfirmed: "you're already confirmed.",
    notIn: "you're not on this contract.",
    nothingToConfirm: "there's no session time to confirm yet.",
    notRunner: 'you need the edgerunner role to take gigs.',
    pickRunner: 'you have more than one runner. pick which one is going.',
    noRunner: (url: string) => `you don't have a runner yet. make one at ${url}/runners/new`,
};
