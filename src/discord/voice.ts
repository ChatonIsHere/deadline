// Everything the board's AI says, in one place so the tone is easy to change.

const say = (line: string) => `\`// DEADLINE:\` ${line}`;

/** Discord renders these in each reader's own timezone. */
const when = (ms: number) => `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)`;

export const voice = {
    footer: (status: string) => `DEADLINE // fixer board node // ${status.toUpperCase()}`,
    when,

    // Replies to the person who pressed a button
    interested: () => say("noted. you're on the list. you'll get a ping when the session time is set."),
    joined: (open: number) => say(`slot locked in. ${open ? `${open} left on the contract.` : 'crew is full.'}`),
    reserve: (position: number) => say(`slots are full. you're reserve #${position}. you'll get a ping if one opens up.`),
    confirmed: () => say('attendance confirmed. see you there, choom.'),
    left: () => say('slot released. no hard feelings, choom.'),
    error: (message: string) => say(message),

    // Asking runners to confirm, by DM (or in the thread if their DMs are closed)
    confirmAsk: (gigName: string, at: number) =>
        say(`**${gigName}** is on for ${when(at)}. confirm you're in, or drop out so a reserve can take your slot.`),
    confirmFallback: (mentions: string) => `${mentions} ${say("couldn't DM you. confirm or drop out here.")}`,
    confirmDone: (gigName: string) => say(`confirmed for **${gigName}**. see you there.`),
    dropDone: (gigName: string) => say(`you're off **${gigName}**. slot released.`),

    // Posted in the gig's thread
    runnerIn: (userId: string, state: string) =>
        say(
            state === 'interested'
                ? `<@${userId}> is interested.`
                : state === 'awaiting'
                  ? `<@${userId}> was added. waiting on them to confirm.`
                  : `<@${userId}> signed on.`,
        ),
    reserveIn: (userId: string, position: number) => say(`<@${userId}> joined the reserves (#${position}).`),
    runnerConfirmed: (userId: string) => say(`<@${userId}> confirmed.`),
    runnerOut: (userId: string) => say(`<@${userId}> pulled out.`),
    promoted: (userIds: string[]) => say(`${userIds.map((id) => `<@${id}>`).join(', ')} moved up from reserves.`),
    sessionSet: (at: number) => say(`session set for ${when(at)}. runners, check your DMs and confirm.`),
    sessionCleared: () => say('session time cleared. back to gauging interest.'),
    statusChanged: {
        open: 'contract is live. sign-ups open.',
        closed: 'sign-ups locked. good luck out there.',
        completed: 'job done. payment cleared.',
        cancelled: 'contract pulled. stand down.',
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
};
