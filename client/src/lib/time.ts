import { fromWallTime, wallTime } from '@shared/time';
import { useUser } from '@/lib/api';

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The signed in player's timezone: the one they picked, or the browser's until they do. */
export const useTimeZone = () => useUser().timezone ?? browserTimeZone();

/** Every timezone the browser knows, for pickers. */
export const allTimeZones = (): string[] => {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : [...zones, 'UTC'];
};

/** "GMT+1" for a zone right now (or at an instant). */
export const zoneOffset = (tz: string, at = Date.now()) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';

/** "14:05" in a zone. */
export const clock = (ms: number, tz: string) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

/** "Fri 3 Jan, 20:00" in a zone. */
export const formatSession = (ms: number, tz: string) =>
    new Date(ms).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** "now", "today", "tomorrow" or "in 5 days", by calendar days on a clock in `tz`. */
export function daysAway(ms: number, tz: string, now = Date.now()): string {
    if (ms <= now) return 'now';
    const [a, b] = [wallTime(now, tz), wallTime(ms, tz)];
    const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** formatSession in the signed in player's timezone. */
export function useFormatSession() {
    const tz = useTimeZone();
    return (ms: number) => formatSession(ms, tz);
}

/** "Fri 3 Jan, 20:00 to 23:30", with the end's day as well when it's on another day. No end, just the start. */
export function formatSessionRange(start: number, end: number | null, tz: string): string {
    if (!end) return formatSession(start, tz);
    const sameDay = toInput(start, tz).slice(0, 10) === toInput(end, tz).slice(0, 10);
    return `${formatSession(start, tz)} to ${sameDay ? clock(end, tz) : formatSession(end, tz)}`;
}

/** formatSessionRange in the signed in player's timezone. */
export function useFormatSessionRange() {
    const tz = useTimeZone();
    return (start: number, end: number | null) => formatSessionRange(start, end, tz);
}

/** "3h 30m" between two instants. */
export function duration(start: number, end: number): string {
    const minutes = Math.round((end - start) / 60_000);
    const [h, m] = [Math.floor(minutes / 60), minutes % 60];
    return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m';
}

/**
 * An end time ("23:30") for a session starting at `start`, on a clock in `tz`: that day, or
 * the next if it isn't after the start (a session running past midnight).
 */
export function endFromTime(start: number, time: string, tz: string): number {
    const end = fromInput(`${toInput(start, tz).slice(0, 10)}T${time}`, tz);
    if (end > start) return end;
    const w = wallTime(start, tz);
    const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
    return fromInput(`${next.toISOString().slice(0, 10)}T${time}`, tz);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** What a datetime-local input wants for an instant, on a clock in `tz`. */
export function toInput(ms: number, tz: string): string {
    const w = wallTime(ms, tz);
    return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** A datetime-local input's value read on a clock in `tz`. */
export function fromInput(value: string, tz: string): number {
    const [date, time] = value.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return fromWallTime({ year, month, day, hour, minute }, tz);
}
