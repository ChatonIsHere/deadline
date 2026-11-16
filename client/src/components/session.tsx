import type { GigView } from '@shared/schemas';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, useAction, useMyRunners, useMySignups, useRunners } from '@/lib/api';
import { clock, duration, endFromTime, formatSessionRange, fromInput, toInput, useTimeZone, zoneOffset } from '@/lib/time';
import { useUnsavedChanges } from '@/lib/unsaved';

/**
 * The session time and roughly when it ends, in the viewer's timezone. Admins set them here. A
 * new start time asks everyone on the gig to confirm; changing only the end doesn't.
 */
export function SessionCard({ gig, canSet }: { gig: GigView; canSet: boolean }) {
    const tz = useTimeZone();
    const savedStart = gig.sessionAt ? toInput(gig.sessionAt, tz) : '';
    const savedEnd = gig.sessionEndAt ? clock(gig.sessionEndAt, tz) : '';
    const [value, setValue] = useState(savedStart);
    const [endValue, setEndValue] = useState(savedEnd);
    const save = useAction((body: { sessionAt: number | null; sessionEndAt: number | null }) => api(`/api/gigs/${gig.id}/session`, 'POST', body), 'session time updated.');
    // Against the saved times, so it's not unsaved once they're set
    useUnsavedChanges(value !== savedStart || endValue !== savedEnd);

    const filled = gig.slots.filter((s) => s.runner);
    const confirmed = filled.filter((s) => s.state === 'confirmed').length;
    const start = value ? fromInput(value, tz) : null;
    const end = start && endValue ? endFromTime(start, endValue, tz) : null;

    return (
        <Card className='space-y-3'>
            <CardTitle help='when the gig gets played and roughly when it wraps up, set by an admin. everyone on it is asked by DM to confirm, and confirmed runners get reminders.'>Session</CardTitle>
            {gig.sessionAt ? (
                <>
                    <p className='font-display text-lg text-accent'>{formatSessionRange(gig.sessionAt, gig.sessionEndAt, tz)}</p>
                    <p className='text-xs text-muted-foreground'>
                        {gig.sessionEndAt && `about ${duration(gig.sessionAt, gig.sessionEndAt)} · `}
                        {confirmed}/{filled.length} confirmed
                    </p>
                </>
            ) : (
                <Say>not scheduled. runners are just showing interest for now.</Say>
            )}

            {canSet && (
                <>
                    <div className='space-y-2'>
                        <div>
                            <Label htmlFor='session-start'>Starts</Label>
                            <Input id='session-start' type='datetime-local' value={value} onChange={(e) => setValue(e.target.value)} />
                        </div>
                        <div className='flex items-end gap-2'>
                            <div className='flex-1'>
                                <Label htmlFor='session-end' help="optional. earlier than the start means it runs past midnight.">
                                    Ends about
                                </Label>
                                <Input id='session-end' type='time' value={endValue} onChange={(e) => setEndValue(e.target.value)} disabled={!value} />
                            </div>
                            <Button size='sm' className='mb-0.5' disabled={!start || save.isPending} onClick={() => save.mutate({ sessionAt: start, sessionEndAt: end })}>
                                Set
                            </Button>
                        </div>
                    </div>
                    <p className='text-xs text-muted-foreground'>
                        Your time ({tz}, {zoneOffset(tz)}).
                        {start && end && ` Runs about ${duration(start, end)}.`}{' '}
                        <Link to={`/availability?gig=${gig.ref}`} className='text-accent hover:underline'>
                            Who's free?
                        </Link>
                        {gig.sessionAt && (
                            <>
                                {' '}
                                <button type='button' className='cursor-pointer text-accent hover:underline' onClick={() => save.mutate({ sessionAt: null, sessionEndAt: null })}>
                                    Clear the time
                                </button>
                            </>
                        )}
                    </p>
                </>
            )}
        </Card>
    );
}

/**
 * The signed in player's place on the gig and the same actions as the Discord post. Sits at
 * the bottom of the gig's Crew panel.
 */
export function SignUp({ gig, userId }: { gig: GigView; userId: string }) {
    const act = (action: 'join' | 'confirm' | 'leave', body?: unknown) => api<{ message: string }>(`/api/gigs/${gig.id}/${action}`, 'POST', body);
    const done = ({ message }: { message: string }) => message;
    const join = useAction((runnerId?: string) => act('join', { runnerId }), done);
    const confirm = useAction(() => act('confirm'), done);
    const leave = useAction(() => act('leave'), done);
    const busy = join.isPending || confirm.isPending || leave.isPending;

    const mine = useMyRunners().data;
    const [picked, setPicked] = useState('');
    const slot = gig.slots.find((s) => s.runner?.ownerId === userId);
    const reserve = gig.reserves.findIndex((r) => r.ownerId === userId) + 1;
    const limit = useMySignups().data;
    const atLimit = !!limit?.max && limit.used >= limit.max;
    const canJoin = !slot && !reserve && gig.status === 'open';

    if (canJoin && mine && !mine.length) {
        return (
            <div className='space-y-3'>
                <Say>you need a runner to take gigs.</Say>
                <Button asChild size='sm'>
                    <Link to='/runners/new'>Make a runner</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className='space-y-3'>
            {/* A fixed note. Where you stand shows in the list above; what changes comes as a notification. */}
            {canJoin && atLimit ? <Say>you're on the most live gigs a player can be. pull out of one or wait for one to finish.</Say> : <Say>sign up here or on the Discord post. full gigs put you on the reserves.</Say>}
            {!!limit?.max && (
                <p className='text-xs text-muted-foreground'>
                    {limit.used}/{limit.max} live gigs
                </p>
            )}
            {canJoin && !atLimit && mine && mine.length > 1 && <Select value={picked} onChange={setPicked} placeholder='Which runner?' options={mine.map((r) => ({ value: String(r.id), label: r.handle, hint: r.role }))} />}
            <div className='flex flex-wrap gap-2'>
                {canJoin && !atLimit && (
                    <Button size='sm' disabled={busy || (!!mine && mine.length > 1 && !picked)} onClick={() => join.mutate(picked || undefined)}>
                        {gig.sessionAt ? 'Take the job' : "I'm interested"}
                    </Button>
                )}
                {slot?.state === 'awaiting' && (
                    <Button size='sm' variant='accent' disabled={busy} onClick={() => confirm.mutate()}>
                        Confirm
                    </Button>
                )}
                {(slot || reserve > 0) && (
                    <Button size='sm' variant='outline' disabled={busy} onClick={() => leave.mutate()}>
                        Pull out
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Admins add a runner to the gig. They take a slot, or the reserves if it's full. One per player. */
export function AssignRunner({ gig }: { gig: GigView }) {
    const [runnerId, setRunnerId] = useState('');
    const runners = useRunners().data ?? [];
    const assign = useAction(
        () => api(`/api/gigs/${gig.id}/runners`, 'POST', { runnerId }),
        'runner added.',
        () => setRunnerId(''),
    );

    const playersOn = new Set([...gig.slots.map((s) => s.runner?.ownerId), ...gig.reserves.map((r) => r.ownerId)]);
    const options = runners.filter((r) => r.canTakeGigs && !playersOn.has(r.ownerId));

    return (
        <div className='mt-4 flex gap-2'>
            <Select value={runnerId} onChange={setRunnerId} placeholder='Add a runner...' options={options.map((r) => ({ value: String(r.id), label: r.handle, hint: r.owner?.name }))} />
            <Button size='icon' className='mt-0.5 size-9' title='Add' disabled={!runnerId || assign.isPending} onClick={() => assign.mutate()}>
                <UserPlus className='size-4' />
            </Button>
        </div>
    );
}
