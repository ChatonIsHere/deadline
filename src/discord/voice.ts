// Everything the board's AI says, in one place so the tone is easy to change.

const say = (line: string) => `\`// DEADLINE:\` ${line}`;

export const voice = {
    footer: (status: string) => `DEADLINE // fixer board node // ${status.toUpperCase()}`,

    joined: (open: number) => say(`slot locked in. ${open ? `${open} left on the contract.` : 'crew is full.'}`),
    left: () => say('slot released. no hard feelings, choom.'),
    error: (message: string) => say(message),

    // Posted in the gig's thread
    runnerIn: (userId: string, open: number) => say(`<@${userId}> signed on. ${open ? `${open} slot(s) open.` : 'all slots filled.'}`),
    runnerOut: (userId: string) => say(`<@${userId}> pulled out. slot's open again.`),
    statusChanged: {
        open: 'contract is live. sign-ups open.',
        closed: 'sign-ups locked. good luck out there.',
        completed: 'job done. payment cleared.',
        cancelled: 'contract pulled. stand down.',
    } as Record<string, string>,

    board: (url: string, open: number) => say(`${open} contract(s) live. full board at ${url}`),

    // Errors the service throws, shown on the web and in Discord
    notOpen: 'that contract is not taking runners.',
    alreadyIn: "you're already on this one.",
    notIn: "you're not on this contract.",
    noSlot: 'no slot open for you. crew slots are reserved.',
    notRunner: 'you need the edgerunner role to take gigs.',
};
