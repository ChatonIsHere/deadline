/**
 * Timezones, shared by the server and the web app. Times are stored as instants (Unix ms).
 * Weekly availability is a usual week, not tied to dates: hours on the player's own clock.
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

const WEEK_MINUTES = WEEK_HOURS * 60;

/** How far ahead of UTC a zone is right now (or at an instant), in minutes. */
export const offsetMinutes = (tz: string, at = Date.now()) => Math.round(offset(at, tz) / 60_000);

/**
 * Where a minute of the viewer's week lands on someone else's clock, given how far apart the
 * two zones are. Wraps round the week, so late Sunday for one can be Monday for the other.
 */
export const shiftMinute = (minute: number, by: number) => (((minute + by) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;

export interface HeatCell {
    /** Indexes into the people given, of who's free */
    free: number[];
}

/**
 * A usual week of hours on the viewer's clock, with who's free in each. Not tied to dates:
 * each person's hours are moved by the gap between their zone and the viewer's as it is at
 * `now`. In a zone with a half-hour offset an hour spans two of theirs, and both have to be
 * free. Returns 168 cells, day by day.
 */
export function heatmap(people: Weekly[], viewerTz: string, now = Date.now()): HeatCell[] {
    const viewer = offsetMinutes(viewerTz, now);
    const placed = people.map((p) => ({ free: new Set(p.hours), by: offsetMinutes(p.timezone, now) - viewer }));
    const hourAt = (minute: number) => Math.floor(minute / 60);
    return Array.from({ length: WEEK_HOURS }, (_, h) => ({
        free: placed.flatMap((p, i) => (p.free.has(hourAt(shiftMinute(h * 60, p.by))) && p.free.has(hourAt(shiftMinute(h * 60 + 59, p.by))) ? [i] : [])),
    }));
}
