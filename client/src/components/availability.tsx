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
                // The heatmap's label: centred on its row, whatever height that is
                <span className="self-center pr-1.5 text-right text-xs text-muted-foreground tabular-nums lg:text-sm">{pad(hour)}</span>
            )}
            {children}
        </>
    );
}

/**
 * A usual week of hours on the viewer's clock, shaded by how many people are free. Hours
 * everyone can make get an outline. Pointing at an hour previews who's free; clicking (or tapping)
 * pins it, and clicking it again lets go.
 */
export function Heatmap({
    cells,
    total,
    hovered,
    pinned,
    onHover,
    onPin,
}: {
    cells: HeatCell[];
    total: number;
    hovered: number | null;
    pinned: number | null;
    onHover: (index: number | null) => void;
    onPin: (index: number) => void;
}) {
    return (
        // Rows grow with the window on wide screens: from today's 20px up to 28px, sized so the
        // whole week fits on screen with the page around it (about 26px on a 1080p display).
        <div
            className="grid grid-cols-[2.25rem_repeat(7,1fr)] gap-px select-none [--cell:1.5rem] lg:grid-cols-[2.75rem_repeat(7,1fr)] lg:[--cell:clamp(1.25rem,calc((100dvh_-_19rem)/24_-_1px),1.75rem)]"
            onPointerLeave={() => onHover(null)}
        >
            <span />
            {DAYS.map((day) => (
                <span key={day} className="pb-1 text-center font-display text-xs tracking-wider text-muted-foreground uppercase lg:pb-1.5 lg:text-sm">
                    {day}
                </span>
            ))}
            {HOURS.map((h) => (
                <Row key={h} hour={h}>
                    {DAYS.map((day, d) => {
                        const i = d * 24 + h;
                        const cell = cells[i];
                        const n = cell.free.length;
                        const share = total ? n / total : 0;
                        const everyone = total > 0 && n === total;
                        return (
                            <button
                                key={day}
                                type="button"
                                aria-label={`${day} ${pad(h)}:00, ${cell.skipped ? 'skipped by the clocks changing' : `${n} of ${total} free`}`}
                                aria-pressed={pinned === i}
                                onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(i)}
                                onClick={() => onPin(i)}
                                // Striped: the clocks jump over this hour this week
                                style={cell.skipped ? undefined : { background: `color-mix(in oklab, var(--color-primary) ${Math.round(share * 100)}%, var(--color-muted))` }}
                                className={cn(
                                    'h-(--cell) cursor-pointer text-center text-[10px] leading-(--cell) tabular-nums outline-none lg:text-xs',
                                    cell.skipped && 'bg-[repeating-linear-gradient(45deg,var(--color-muted)_0_3px,transparent_3px_6px)]',
                                    share > 0.5 ? 'text-primary-foreground' : 'text-muted-foreground',
                                    everyone && 'shadow-[inset_0_0_0_2px_var(--color-accent)]',
                                    // Pointing: a thin line. Pinned: a thick one, in a colour the all-free outline doesn't use
                                    hovered === i && 'shadow-[inset_0_0_0_1px_var(--color-foreground)]',
                                    pinned === i && 'shadow-[inset_0_0_0_2px_var(--color-foreground)]',
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
