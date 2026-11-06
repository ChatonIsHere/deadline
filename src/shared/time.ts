/**
 * Timezones, shared by the server and the web app. Times are stored as instants (Unix ms).
 * Weekly availability is stored as wall-clock hours in the player's own timezone, and only
 * turned into instants for a real week, so clock changes land where they really happen.
 */

/**
 * Night City's zone. The books and games never name one, but the city sits on the California
 * coast between Los Angeles and San Francisco, so it keeps Pacific time.
 */
export const NIGHT_CITY_TZ = 'America/Los_Angeles';

/** The campaign runs 51 years ahead: today in 2026 is the same day in 2077. */
export const YEARS_AHEAD = 51;

/** Hours in a week. Availability hour `i` is day `floor(i / 24)` (0 is Monday), hour `i % 24`. */
export const WEEK_HOURS = 168;

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface WallTime {
    year: number;
    /** 1 to 12 */
    month: number;
    day: number;
    hour: number;
    minute: number;
    /** 0 is Monday */
    weekday: number;
}

/** Whether the runtime knows a timezone name, e.g. "Europe/London". */
export function isTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
    let f = formatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            weekday: 'short',
        });
        formatters.set(tz, f);
    }
    return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** What a clock in `tz` shows at an instant. */
export function wallTime(ms: number, tz: string): WallTime {
    const parts: Record<string, string> = {};
    for (const p of formatter(tz).formatToParts(ms)) parts[p.type] = p.value;
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        weekday: WEEKDAYS[parts.weekday],
    };
}

/** How far ahead of UTC `tz` is at an instant, in ms. */
function offset(ms: number, tz: string): number {
    const w = wallTime(ms, tz);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(ms / 60_000) * 60_000;
}

/**
 * The instant a clock in `tz` shows a wall time. A time skipped by the clocks going forward
 * comes out an hour later; one that happens twice (clocks going back) gives the first.
 */
export function fromWallTime(w: Pick<WallTime, 'year' | 'month' | 'day' | 'hour' | 'minute'>, tz: string): number {
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    // The offset a day either side. They only differ when the clocks change that day.
    const before = asUtc - offset(asUtc - 86_400_000, tz);
    const after = asUtc - offset(asUtc + 86_400_000, tz);
    const shows = (ms: number) => {
        const t = wallTime(ms, tz);
        return t.day === w.day && t.hour === w.hour && t.minute === w.minute;
    };
    if (shows(before)) return Math.min(before, shows(after) ? after : before);
    if (shows(after)) return after;
    // Skipped: with the old offset it lands that far past the jump
    return before;
}

/** Which hour of the week (0 to 167) an instant is in, on a clock in `tz`. */
export function weekHour(ms: number, tz: string): number {
    const w = wallTime(ms, tz);
    return w.weekday * 24 + w.hour;
}

/** The Monday of the week an instant falls in, on a clock in `tz`, as a calendar date. */
export function weekStart(ms: number, tz: string): { year: number; month: number; day: number } {
    const w = wallTime(ms, tz);
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day - w.weekday));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** A calendar date some days on, e.g. the Wednesday of a week. */
export function addDays(date: { year: number; month: number; day: number }, days: number) {
    const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Today in Night City, 51 years on, e.g. "05 NOV 2077". */
export function nightCityDate(now: number): string {
    const w = wallTime(now, NIGHT_CITY_TZ);
    // Through Date so 29 Feb rolls to 1 Mar in a year that doesn't have one
    const d = new Date(Date.UTC(w.year + YEARS_AHEAD, w.month - 1, w.day));
    return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Someone's weekly availability, as stored. */
export interface Weekly {
    timezone: string;
    /** Hours of the week they're free, on their own clock */
    hours: number[];
}

/**
 * Whether someone's free for a whole hour starting at an instant. Usually that's one of their
 * hours, but in a zone with a half-hour offset it spans two, and both have to be free.
 */
export function freeFor(person: Weekly, start: number, free = new Set(person.hours)): boolean {
    return free.has(weekHour(start, person.timezone)) && free.has(weekHour(start + 59 * 60_000, person.timezone));
}

export interface HeatCell {
    /** When the hour starts */
    start: number;
    /** The clocks skip this hour this week (going forward), so nobody can play it */
    skipped: boolean;
    /** Indexes into the people given, of who's free */
    free: number[];
}

/**
 * A week of hours on the viewer's clock, starting from a Monday, with who's free in each.
 * Each person's hours are read on their own clock for that exact week, so it's right across
 * timezones and clock changes. Returns 168 cells, day by day.
 */
export function heatmap(people: Weekly[], monday: { year: number; month: number; day: number }, viewerTz: string): HeatCell[] {
    const sets = people.map((p) => new Set(p.hours));
    const cells: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
        const date = addDays(monday, d);
        for (let hour = 0; hour < 24; hour++) {
            const start = fromWallTime({ ...date, hour, minute: 0 }, viewerTz);
            const skipped = wallTime(start, viewerTz).hour !== hour;
            const free = skipped ? [] : people.flatMap((p, i) => (freeFor(p, start, sets[i]) ? [i] : []));
            cells.push({ start, skipped, free });
        }
    }
    return cells;
}
