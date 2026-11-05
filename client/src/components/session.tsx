import type { GigView } from '@shared/schemas';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, useAction, useMembers } from '@/lib/api';

/** "Fri 3 Jan, 20:00" in the viewer's own timezone. */
export const formatSession = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What a datetime-local input wants: local time, no seconds or zone. */
function toInput(ms: number): string {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
    return d.toISOString().slice(0, 16);
}

/** The session time. Admins set it here, which asks everyone on the gig to confirm. */
export function SessionCard({ gig, canSet }: { gig: GigView; canSet: boolean }) {
    const [value, setValue] = useState(gig.sessionAt ? toInput(gig.sessionAt) : '');
    const save = useAction((sessionAt: number | null) => api(`/api/gigs/${gig.id}/session`, 'POST', { sessionAt }), 'Session updated.');

    const filled = gig.slots.filter((s) => s.runner);
    const confirmed = filled.filter((s) => s.state === 'confirmed').length;

    return (
        <Card className="space-y-3">
            <CardTitle>Session</CardTitle>
            {gig.sessionAt ? (
                <>
                    <p className="font-display text-lg text-primary">{formatSession(gig.sessionAt)}</p>
                    <p className="text-xs text-muted-foreground">
                        {confirmed}/{filled.length} confirmed
                    </p>
                </>
            ) : (
                <Say>not scheduled. runners are just showing interest for now.</Say>
            )}

            {canSet && (
                <>
                    <div className="flex gap-2">
                        <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
                        <Button size="sm" className="mt-1" disabled={!value || save.isPending} onClick={() => save.mutate(new Date(value).getTime())}>
                            Set
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Setting or changing the time DMs everyone on the gig to confirm or drop out.
                        {gig.sessionAt && (
                            <>
                                {' '}
                                <button type="button" className="cursor-pointer text-accent hover:underline" onClick={() => save.mutate(null)}>
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

/** The signed in runner's own place on the gig, with the same actions as the Discord post. */
export function MySpot({ gig, userId }: { gig: GigView; userId: string }) {
    const act = (action: 'join' | 'confirm' | 'leave') => api<{ message: string }>(`/api/gigs/${gig.id}/${action}`, 'POST');
    const done = ({ message }: { message: string }) => toast.success(message);
    const join = useAction(() => act('join'), done);
    const confirm = useAction(() => act('confirm'), done);
    const leave = useAction(() => act('leave'), done);
    const busy = join.isPending || confirm.isPending || leave.isPending;

    const slot = gig.slots.find((s) => s.runner?.id === userId);
    const reserve = gig.reserves.findIndex((r) => r.id === userId) + 1;

    let status: string;
    if (slot?.state === 'confirmed') status = "you're confirmed.";
    else if (slot?.state === 'awaiting') status = `confirm you can make it${slot.confirmBy ? ` by ${formatSession(slot.confirmBy)}` : ''}.`;
    else if (slot) status = "you're interested. you'll be asked to confirm once there's a time.";
    else if (reserve) status = `you're reserve #${reserve}.`;
    else if (gig.status === 'open') status = gig.slots.some((s) => !s.runner) ? 'slots open.' : 'slots are full. signing up puts you on the reserves.';
    else status = 'sign-ups are locked.';

    return (
        <Card className="space-y-3 [--frame:var(--color-primary)]">
            <CardTitle>Your spot</CardTitle>
            <Say>{status}</Say>
            <div className="flex flex-wrap gap-2">
                {!slot && !reserve && gig.status === 'open' && (
                    <Button size="sm" disabled={busy} onClick={() => join.mutate()}>
                        {gig.sessionAt ? 'Take the job' : "I'm interested"}
                    </Button>
                )}
                {slot?.state === 'awaiting' && (
                    <Button size="sm" variant="accent" disabled={busy} onClick={() => confirm.mutate()}>
                        Confirm
                    </Button>
                )}
                {(slot || reserve > 0) && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => leave.mutate()}>
                        Pull out
                    </Button>
                )}
            </div>
        </Card>
    );
}

/** Admins add an edgerunner to the gig. They take a slot, or the reserves if it's full. */
export function AssignRunner({ gig }: { gig: GigView }) {
    const [userId, setUserId] = useState('');
    const members = useMembers().data ?? [];
    const assign = useAction(() => api(`/api/gigs/${gig.id}/runners`, 'POST', { userId }), () => setUserId(''));

    const onGig = new Set([...gig.slots.map((s) => s.runner?.id), ...gig.reserves.map((r) => r.id)]);
    const options = members.filter((m) => !onGig.has(m.id));

    return (
        <div className="mt-4 flex gap-2">
            <Select value={userId} onChange={setUserId} placeholder="Add an edgerunner..." options={options.map((m) => ({ value: m.id, label: m.name }))} />
            <Button size="icon" className="mt-0.5 size-9" title="Add" disabled={!userId || assign.isPending} onClick={() => assign.mutate()}>
                <UserPlus className="size-4" />
            </Button>
        </div>
    );
}
