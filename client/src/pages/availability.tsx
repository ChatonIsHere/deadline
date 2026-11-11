import { isLive, type PlayerAvailability } from '@shared/schemas';
import { DAYS, heatmap, wallTime } from '@shared/time';
import { PinOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Heatmap } from '@/components/availability';
import { Avatar, Loading, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { type Tag, TagInput } from '@/components/ui/tag-input';
import { useAvailability, useCrews, useGigs, useUser } from '@/lib/api';
import { daysAway, formatSession, useTimeZone, zoneOffset } from '@/lib/time';

type Placed = PlayerAvailability & { timezone: string };

/** What can be picked, and how each shows in the address: ?crew=<slug>&gig=<ref>&player=<id>, any number of each. */
const KINDS = ['crew', 'gig', 'player'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * When everyone can usually play, for admins picking a session time. Each player's usual week
 * is shown on the admin's clock. Narrow it to any mix of crews, live gigs (everyone signed up
 * or interested, reserves too) and players; nothing picked shows everyone.
 */
export function AvailabilityPage() {
    const me = useUser();
    const tz = useTimeZone();
    const everyone = useAvailability(me.isAdmin).data;
    const crews = useCrews().data;
    const allGigs = useGigs().data;
    const [params, setParams] = useSearchParams();
    // The hour pointed at, and the one clicked to keep. A pinned hour stays on the right until it's let go.
    const [hovered, setHovered] = useState<number | null>(null);
    const [pinned, setPinned] = useState<number | null>(null);
    const picked = pinned ?? hovered;
    const pin = (i: number) => setPinned((p) => (p === i ? null : i));

    useEffect(() => {
        if (pinned === null) return;
        const unpin = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null);
        window.addEventListener('keydown', unpin);
        return () => window.removeEventListener('keydown', unpin);
    }, [pinned]);

    const gigs = useMemo(() => (allGigs ?? []).filter((g) => isLive(g.status)), [allGigs]);
    const tags = useMemo(
        (): Tag[] => [
            ...(crews ?? []).map((c) => ({ key: `crew:${c.slug}`, label: c.name, kind: 'crew' })),
            ...gigs.map((g) => ({ key: `gig:${g.ref}`, label: g.name, kind: 'gig' })),
            ...(everyone ?? []).map((p) => ({ key: `player:${p.member.id}`, label: p.member.name, kind: 'player', icon: <Avatar member={p.member} className="size-4 [--cut:2px]" /> })),
        ],
        [crews, gigs, everyone],
    );

    const selected = KINDS.flatMap((kind) => params.getAll(kind).map((ref) => `${kind}:${ref}`));
    const selectedKey = selected.join(',');
    const setSelected = (keys: string[]) => {
        const next = new URLSearchParams();
        for (const key of keys) {
            const at = key.indexOf(':');
            next.append(key.slice(0, at), key.slice(at + 1));
        }
        setParams(next, { replace: true });
    };

    // Memoised so pointing at hours doesn't redo the whole week
    const { placed, unset } = useMemo(() => {
        const all = everyone ?? [];
        const keys = selectedKey ? selectedKey.split(',') : [];
        let shown = all;
        if (keys.length) {
            const ids = new Set<string>();
            for (const key of keys) {
                const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
                if (kind === 'player') ids.add(ref);
                if (kind === 'crew') {
                    const crew = crews?.find((c) => c.slug === ref);
                    if (crew) for (const p of all) if (p.crewIds.includes(crew.id)) ids.add(p.member.id);
                }
                if (kind === 'gig') {
                    const gig = gigs.find((g) => g.ref === ref || g.id === ref);
                    for (const s of gig?.slots ?? []) if (s.runner?.ownerId) ids.add(s.runner.ownerId);
                    for (const r of gig?.reserves ?? []) if (r.ownerId) ids.add(r.ownerId);
                }
            }
            shown = all.filter((p) => ids.has(p.member.id));
        }
        const isPlaced = (p: PlayerAvailability): p is Placed => !!p.timezone && p.hours.length > 0;
        return { placed: shown.filter(isPlaced), unset: shown.filter((p) => !isPlaced(p)) };
    }, [everyone, crews, gigs, selectedKey]);

    const cells = useMemo(() => heatmap(placed, tz), [placed, tz]);
    const cell = picked === null ? null : cells[picked];

    if (!me.isAdmin) return <Navigate to="/gigs" replace />;

    const free = cell ? cell.free.map((i) => placed[i]) : [];
    const busy = cell ? placed.filter((_, i) => !cell.free.includes(i)) : [];

    return (
        <div className="space-y-5">
            <TagInput id="availability-filter" options={tags} value={selected} onChange={setSelected} placeholder="Everyone. Type a crew, gig or player to narrow it..." />

            <div className="grid gap-5 lg:grid-cols-[1fr_18rem] 3xl:grid-cols-[1fr_24rem]">
                <Card className="space-y-3">
                    <CardTitle help="everyone's usual week on your clock. each hour is the next time it comes round, so clock changes coming up this week, in any country, are placed right.">
                        Usual week
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Your time ({tz}, {zoneOffset(tz)}). Numbers are how many are free; outlined hours suit everyone shown.
                    </p>
                    {!everyone ? <Loading>pulling schedules...</Loading> : <Heatmap cells={cells} total={placed.length} hovered={hovered} pinned={pinned} onHover={setHovered} onPin={pin} />}
                </Card>

                {/* Wider screens: exactly as tall as the table, so pointing at hours never moves anything. Long lists scroll inside. */}
                <div className="lg:relative">
                    <div className="flex flex-col gap-5 lg:absolute lg:inset-0">
                        <Card className="flex flex-col space-y-3 lg:min-h-0 lg:flex-1">
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    {/* The real date it next falls on. A skipped hour has no time that day, so it keeps the plain label. */}
                                    <CardTitle className="mb-0">
                                        {picked === null || !cell ? 'Pick an hour' : cell.skipped ? `${DAYS[Math.floor(picked / 24)]} ${pad(picked % 24)}:00` : formatSession(cell.start, tz)}
                                    </CardTitle>
                                    {cell && !cell.skipped && (
                                        <p className="text-xs text-muted-foreground">
                                            Next one, {daysAway(cell.start, tz)}
                                            {pinned !== null && ' · pinned'}
                                        </p>
                                    )}
                                </div>
                                {pinned !== null && (
                                    <Button variant="ghost" size="icon" className="size-7 shrink-0" title="Let go (Esc)" aria-label="Unpin this hour" onClick={() => setPinned(null)}>
                                        <PinOff className="size-4" />
                                    </Button>
                                )}
                            </div>
                            <div className="space-y-3 [scrollbar-width:thin] lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                                {!cell ? (
                                    <Say>point at an hour to see who's free. click one to keep it here.</Say>
                                ) : cell.skipped ? (
                                    <Say>your clocks skip this hour this week.</Say>
                                ) : (
                                    <>
                                        <p>
                                            <span className="text-primary">{free.length}</span> of {placed.length} free
                                        </p>
                                        <People title="Free" people={free} at={cell.start} />
                                        <People title="Busy" people={busy} at={cell.start} muted />
                                    </>
                                )}
                            </div>
                        </Card>

                        {unset.length > 0 && (
                            <Card className="flex shrink-0 flex-col space-y-3 lg:max-h-[40%]">
                                <CardTitle help="they haven't picked a timezone or marked any hours yet, so they're not counted.">Not set</CardTitle>
                                <ul className="space-y-2 [scrollbar-width:thin] lg:min-h-0 lg:overflow-y-auto">
                                    {unset.map((p) => (
                                        <li key={p.member.id} className="flex items-center gap-2">
                                            <Avatar member={p.member} />
                                            <span className="truncate">{p.member.name}</span>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Who's free or busy at an hour, with the day and time on their own clock. */
function People({ title, people, at, muted }: { title: string; people: Placed[]; at: number; muted?: boolean }) {
    if (!people.length) return null;
    return (
        <div className="space-y-2">
            <p className="text-xs tracking-widest text-muted-foreground uppercase">{title}</p>
            <ul className="space-y-2">
                {people.map((p) => {
                    const w = wallTime(at, p.timezone);
                    return (
                        <li key={p.member.id} className={muted ? 'flex items-center gap-2 text-muted-foreground' : 'flex items-center gap-2'}>
                            <Avatar member={p.member} />
                            <span className="min-w-0 flex-1 truncate">{p.member.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums" title={p.timezone}>
                                {DAYS[w.weekday]} {pad(w.hour)}:{pad(w.minute)} theirs
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
