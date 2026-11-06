import { DAYS, type HeatCell, isTimeZone } from '@shared/time';
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { allTimeZones, clock, zoneOffset } from '@/lib/time';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** A searchable list of timezones, with each one's offset. Says what time it is there. */
export function TimezonePicker({ id, value, onChange }: { id: string; value: string; onChange: (tz: string) => void }) {
    const zones = useMemo(() => allTimeZones().map((z) => ({ value: z, hint: zoneOffset(z) })), []);
    const valid = isTimeZone(value) && zones.some((z) => z.value === value);
    return (
        <div className="space-y-1">
            <Combobox id={id} value={value} onChange={onChange} suggestions={zones} maxLength={64} />
            <p className={cn('text-xs', valid ? 'text-muted-foreground' : 'text-destructive')}>
                {valid ? `It's ${clock(Date.now(), value)} there (${zoneOffset(value)}).` : 'Pick a timezone from the list, like Europe/London.'}
            </p>
        </div>
    );
}

/** Whether a picked timezone is one from the list. */
export const isPickedZone = (tz: string) => isTimeZone(tz) && allTimeZones().includes(tz);

/**
 * A week of hours to click or drag across. Days across the top, hours down the side, on the
 * player's own clock. Clicking a day or an hour flips the whole column or row.
 */
export function WeekGrid({ hours, onChange }: { hours: number[]; onChange: (hours: number[]) => void }) {
    const free = new Set(hours);
    // While dragging: whether cells are being turned on or off, and the hours so far
    const drag = useRef<{ on: boolean; set: Set<number> } | null>(null);

    useEffect(() => {
        const end = () => (drag.current = null);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        return () => {
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }, []);

    const paint = (hour: number) => {
        const d = drag.current;
        if (!d || d.on === d.set.has(hour)) return;
        if (d.on) d.set.add(hour);
        else d.set.delete(hour);
        onChange([...d.set].sort((a, b) => a - b));
    };

    const start = (e: PointerEvent, hour: number) => {
        e.preventDefault();
        drag.current = { on: !free.has(hour), set: new Set(free) };
        paint(hour);
    };

    // Touch keeps sending moves to the cell it started on, so find the cell under the finger
    const move = (e: PointerEvent) => {
        if (!drag.current) return;
        const hour = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.dataset.hour;
        if (hour !== undefined) paint(Number(hour));
    };

    const flip = (list: number[]) => {
        const on = !list.every((h) => free.has(h));
        const next = new Set(free);
        for (const h of list) if (on) next.add(h);
        else next.delete(h);
        onChange([...next].sort((a, b) => a - b));
    };

    return (
        <div className="grid grid-cols-[2.25rem_repeat(7,1fr)] gap-px select-none" onPointerMove={move}>
            <span />
            {DAYS.map((day, d) => (
                <button
                    key={day}
                    type="button"
                    title={`All of ${day}`}
                    className="cursor-pointer pb-1 text-center font-display text-xs tracking-wider text-muted-foreground uppercase hover:text-primary"
                    onClick={() => flip(HOURS.map((h) => d * 24 + h))}
                >
                    {day}
                </button>
            ))}
            {HOURS.map((h) => (
                <Row key={h} hour={h} onLabel={() => flip(DAYS.map((_, d) => d * 24 + h))}>
                    {DAYS.map((day, d) => {
                        const hour = d * 24 + h;
                        return (
                            <span
                                key={day}
                                data-hour={hour}
                                role="checkbox"
                                aria-checked={free.has(hour)}
                                aria-label={`${day} ${pad(h)}:00`}
                                tabIndex={0}
                                onPointerDown={(e) => start(e, hour)}
                                onKeyDown={(e) => {
                                    if (e.key === ' ' || e.key === 'Enter') {
                                        e.preventDefault();
                                        flip([hour]);
                                    }
                                }}
                                className={cn('h-5 cursor-pointer touch-none', free.has(hour) ? 'bg-primary hover:bg-primary/80' : 'bg-muted hover:bg-primary/30')}
                            />
                        );
                    })}
                </Row>
            ))}
        </div>
    );
}

function Row({ hour, onLabel, children }: { hour: number; onLabel?: () => void; children: ReactNode }) {
    return (
        <>
            {onLabel ? (
                <button type="button" title={`${pad(hour)}:00 every day`} className="cursor-pointer pr-1 text-right text-xs leading-5 text-muted-foreground tabular-nums hover:text-primary" onClick={onLabel}>
                    {pad(hour)}
                </button>
            ) : (
                <span className="pr-1 text-right text-xs leading-5 text-muted-foreground tabular-nums">{pad(hour)}</span>
            )}
            {children}
        </>
    );
}

/**
 * A week of hours on the viewer's clock, shaded by how many people are free. Hours everyone
 * can make get an outline. Pointing at (or tapping) an hour picks it, to show who's free.
 */
export function Heatmap({
    cells,
    total,
    days,
    picked,
    onPick,
}: {
    cells: HeatCell[];
    total: number;
    /** Column headings, e.g. "Mon 9" */
    days: string[];
    picked: number | null;
    onPick: (index: number) => void;
}) {
    return (
        <div className="grid grid-cols-[2.25rem_repeat(7,1fr)] gap-px select-none">
            <span />
            {days.map((day) => {
                // Day over date, so seven fit across a phone
                const [name, date] = day.split(' ');
                return (
                    <span key={day} className="pb-1 text-center font-display text-xs leading-tight tracking-wider text-muted-foreground uppercase">
                        <span className="block">{name}</span>
                        <span className="block text-foreground">{date}</span>
                    </span>
                );
            })}
            {HOURS.map((h) => (
                <Row key={h} hour={h}>
                    {days.map((day, d) => {
                        const i = d * 24 + h;
                        const cell = cells[i];
                        const n = cell.free.length;
                        const share = total ? n / total : 0;
                        const everyone = total > 0 && n === total;
                        return (
                            <button
                                key={day}
                                type="button"
                                aria-label={`${day} ${pad(h)}:00, ${cell.skipped ? 'skipped by the clock change' : `${n} of ${total} free`}`}
                                onPointerEnter={(e) => e.pointerType === 'mouse' && onPick(i)}
                                onClick={() => onPick(i)}
                                style={cell.skipped ? undefined : { background: `color-mix(in oklab, var(--color-primary) ${Math.round(share * 100)}%, var(--color-muted))` }}
                                className={cn(
                                    'h-5 cursor-pointer text-center text-[10px] leading-5 tabular-nums outline-none',
                                    cell.skipped && 'bg-[repeating-linear-gradient(45deg,var(--color-muted)_0_3px,transparent_3px_6px)]',
                                    share > 0.5 ? 'text-primary-foreground' : 'text-muted-foreground',
                                    everyone && 'shadow-[inset_0_0_0_1px_var(--color-accent)]',
                                    picked === i && 'shadow-[inset_0_0_0_2px_var(--color-accent)]',
                                )}
                            >
                                {n > 0 && total > 1 ? n : ''}
                            </button>
                        );
                    })}
                </Row>
            ))}
        </div>
    );
}
