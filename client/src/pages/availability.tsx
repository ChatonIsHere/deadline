import { isLive, type PlayerAvailability } from '@shared/schemas';
import { addDays, DAYS, heatmap, weekStart } from '@shared/time';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Heatmap } from '@/components/availability';
import { Avatar, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useAvailability, useCrews, useGigs, useUser } from '@/lib/api';
import { clock, useTimeZone, zoneOffset } from '@/lib/time';

type Placed = PlayerAvailability & { timezone: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When everyone can play, for admins picking a session time. Each player's usual week is read
 * on their own clock and shown on the admin's, for a real week, so clock changes land right.
 * Narrow it to a crew, a gig's runners or one player.
 */
export function AvailabilityPage() {
    const me = useUser();
    const tz = useTimeZone();
    const everyone = useAvailability(me.isAdmin).data;
    const crews = useCrews().data ?? [];
    const gigs = (useGigs().data ?? []).filter((g) => isLive(g.status));
    const [params, setParams] = useSearchParams();
    const [weeks, setWeeks] = useState(0);
    const [picked, setPicked] = useState<number | null>(null);

    // ?crew=<slug>, ?gig=<ref> or neither; ?player=<id> narrows further
    const crew = crews.find((c) => c.slug === params.get('crew'));
    const gig = gigs.find((g) => g.ref === params.get('gig') || g.id === params.get('gig'));
    const group = crew ? `crew:${crew.slug}` : gig ? `gig:${gig.ref}` : '';
    const playerId = params.get('player') ?? '';

    const setFilter = (key: 'group' | 'player', value: string) => {
        const next = new URLSearchParams(params);
        if (key === 'group') {
            next.delete('crew');
            next.delete('gig');
            next.delete('player');
            const [kind, ref] = value.split(':');
            if (kind && ref) next.set(kind, ref);
        } else if (value) next.set('player', value);
        else next.delete('player');
        setParams(next, { replace: true });
    };

    const inGroup = useMemo(() => {
        const all = everyone ?? [];
        if (crew) return all.filter((p) => p.crewIds.includes(crew.id));
        if (gig) {
            const on = new Set([...gig.slots.map((s) => s.runner?.ownerId), ...gig.reserves.map((r) => r.ownerId)]);
            return all.filter((p) => on.has(p.member.id));
        }
        return all;
    }, [everyone, crew, gig]);
    // Memoised so pointing at hours doesn't redo the whole week
    const { placed, unset } = useMemo(() => {
        const shown = playerId ? inGroup.filter((p) => p.member.id === playerId) : inGroup;
        const isPlaced = (p: PlayerAvailability): p is Placed => !!p.timezone && p.hours.length > 0;
        return { placed: shown.filter(isPlaced), unset: shown.filter((p) => !isPlaced(p)) };
    }, [inGroup, playerId]);

    const monday = addDays(weekStart(Date.now(), tz), weeks * 7);
    const mondayKey = `${monday.year}-${monday.month}-${monday.day}`;
    const cells = useMemo(() => heatmap(placed, monday, tz), [placed, mondayKey, tz]);
    const days = DAYS.map((d, i) => `${d} ${addDays(monday, i).day}`);
    const cell = picked === null ? null : cells[picked];

    if (!me.isAdmin) return <Navigate to="/gigs" replace />;

    const groupOptions = [
        { value: '', label: 'Everyone' },
        ...crews.map((c) => ({ value: `crew:${c.slug}`, label: c.name, hint: 'crew' })),
        ...gigs.map((g) => ({ value: `gig:${g.ref}`, label: g.name, hint: 'gig' })),
    ];
    const playerOptions = [{ value: '', label: inGroup.length ? 'All of them' : 'Nobody here' }, ...inGroup.map((p) => ({ value: p.member.id, label: p.member.name }))];
    const sunday = addDays(monday, 6);
    const free = cell ? cell.free.map((i) => placed[i]) : [];
    const busy = cell ? placed.filter((_, i) => !cell.free.includes(i)) : [];

    return (
        <div className="space-y-5">
            <h1 className="text-3xl text-primary">Availability</h1>

            <div className="grid gap-3 sm:grid-cols-2">
                <Select value={group} onChange={(v) => setFilter('group', v)} options={groupOptions} placeholder="Everyone" />
                <Select value={playerId} onChange={(v) => setFilter('player', v)} options={playerOptions} placeholder="All of them" />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
                <Card className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" title="Week before" onClick={() => setWeeks((w) => w - 1)}>
                            <ChevronLeft className="size-4" />
                        </Button>
                        <p className="flex-1 text-center font-display tracking-wider uppercase">
                            {monday.day} {MONTHS[monday.month - 1]} to {sunday.day} {MONTHS[sunday.month - 1]}
                            {weeks === 0 && <span className="text-muted-foreground"> · this week</span>}
                        </p>
                        <Button variant="ghost" size="icon" title="Week after" onClick={() => setWeeks((w) => w + 1)}>
                            <ChevronRight className="size-4" />
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Your time ({tz}, {zoneOffset(tz)}). Numbers are how many are free; outlined hours suit everyone shown.
                    </p>
                    {!everyone ? <Say>pulling schedules...</Say> : <Heatmap cells={cells} total={placed.length} days={days} picked={picked} onPick={setPicked} />}
                </Card>

                <div className="space-y-5">
                    <Card className="space-y-3">
                        <CardTitle>{cell ? `${days[Math.floor(picked! / 24)]}, ${clock(cell.start, tz)}` : 'Pick an hour'}</CardTitle>
                        {!cell ? (
                            <Say>point at an hour to see who's free.</Say>
                        ) : cell.skipped ? (
                            <Say>the clocks skip this hour this week.</Say>
                        ) : (
                            <>
                                <p>
                                    <span className="text-primary">{free.length}</span> of {placed.length} free
                                </p>
                                <People title="Free" people={free} at={cell.start} />
                                <People title="Busy" people={busy} at={cell.start} muted />
                            </>
                        )}
                    </Card>

                    {unset.length > 0 && (
                        <Card className="space-y-3">
                            <CardTitle help="they haven't picked a timezone or marked any hours yet, so they're not counted.">Not set</CardTitle>
                            <ul className="space-y-2">
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
    );
}

/** Who's free or busy at an hour, with the time on their own clock. */
function People({ title, people, at, muted }: { title: string; people: Placed[]; at: number; muted?: boolean }) {
    if (!people.length) return null;
    return (
        <div className="space-y-2">
            <p className="text-xs tracking-widest text-muted-foreground uppercase">{title}</p>
            <ul className="space-y-2">
                {people.map((p) => (
                    <li key={p.member.id} className={muted ? 'flex items-center gap-2 text-muted-foreground' : 'flex items-center gap-2'}>
                        <Avatar member={p.member} />
                        <span className="min-w-0 flex-1 truncate">{p.member.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums" title={p.timezone}>
                            {clock(at, p.timezone)} theirs
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
