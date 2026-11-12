// When reminders, nudges and no-response drops are due. Pure, so it's easy to test.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The second reminder goes out this long before the session. */
export const SOON_MINUTES = 30;
/**
 * Runners put on a gig this close to the session (or once it's started) are counted as coming:
 * it's too late to ask them to confirm.
 */
export const tooLateToAsk = (sessionAt: number, now = Date.now()) => sessionAt - now < SOON_MINUTES * MINUTE;

/** Runners who haven't confirmed get one nudge when this much time is left. */
export const NUDGE_HOURS = 12;
/** No nudge when the whole confirm window is shorter than this: the ask is still fresh. */
export const NUDGE_MIN_WINDOW_HOURS = 24;

/**
 * When an asked runner has to confirm by: `windowHours` after being asked, ending an
 * hour before the session if that's sooner, but never less than an hour after asking.
 */
export function confirmDeadline(askedAt: number, sessionAt: number, windowHours: number): number {
    return Math.max(Math.min(askedAt + windowHours * HOUR, sessionAt - HOUR), askedAt + HOUR);
}

export interface SessionState {
    now: number;
    sessionAt: number;
    reminderHours: number;
    confirmHours: number;
    remindedDay: boolean;
    remindedSoon: boolean;
    awaiting: { userId: string; askedAt: number; nudged: boolean }[];
}

export interface SessionWork {
    remind: 'day' | 'soon' | null;
    nudge: string[];
    drop: string[];
}

/** What needs doing for one gig right now. Nothing happens once the session has started. */
export function sessionWork(s: SessionState): SessionWork {
    const work: SessionWork = { remind: null, nudge: [], drop: [] };
    if (s.now >= s.sessionAt) return work;

    if (!s.remindedSoon && s.now >= s.sessionAt - SOON_MINUTES * MINUTE) work.remind = 'soon';
    else if (!s.remindedDay && !s.remindedSoon && s.now >= s.sessionAt - s.reminderHours * HOUR) work.remind = 'day';

    for (const r of s.awaiting) {
        const deadline = confirmDeadline(r.askedAt, s.sessionAt, s.confirmHours);
        if (s.now >= deadline) work.drop.push(r.userId);
        // No nudge when the whole window is short: it would land soon after the ask
        else if (!r.nudged && deadline - r.askedAt > NUDGE_MIN_WINDOW_HOURS * HOUR && deadline - s.now <= NUDGE_HOURS * HOUR) work.nudge.push(r.userId);
    }
    return work;
}
