import type { GigView } from '@shared/schemas';
import { CalendarClock } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { api, useAction, useUser } from '@/lib/api';
import { daysAway, formatSession, fromInput, toInput, useTimeZone, zoneOffset } from '@/lib/time';

/**
 * The bar on a draft: send it on, or (admins) schedule it to post by itself. A scheduled
 * draft says when, and can still be posted now or unscheduled.
 */
export function DraftBar({ gig }: { gig: GigView }) {
    const me = useUser();
    const tz = useTimeZone();
    const url = `/api/gigs/${gig.id}`;
    const send = useAction(() => api<GigView>(`${url}/send`, 'POST'), (sent) => (sent.status === 'open' ? 'posted. going up on discord.' : 'sent to the admins for approval.'));
    const unschedule = useAction(() => api(`${url}/schedule`, 'POST', { postAt: null }), 'unscheduled. it stays a draft.');
    const s = gig.scheduled;

    const note = s
        ? `scheduled to post ${formatSession(s.at, tz)} (${daysAway(s.at, tz)})${s.by.id === me.id ? '' : `, as ${s.by.name}`}.${me.isAdmin ? '' : ' an admin set that up.'}`
        : !me.isAdmin
          ? 'draft. only you and the admins can see it.'
          : gig.createdBy.id === me.id
            ? 'your draft. nothing is posted until you post it.'
            : `${gig.createdBy.name}'s draft. posting it counts as approving it.`;

    return (
        <div className="cut-frame flex flex-wrap items-center gap-3 p-4 [--frame:var(--color-primary)]">
            <Say className="flex-1">{note}</Say>
            {me.isAdmin && s && (
                <Button variant="outline" onClick={() => unschedule.mutate()} disabled={unschedule.isPending}>
                    Unschedule
                </Button>
            )}
            {me.isAdmin && <ScheduleButton gig={gig} />}
            <Button onClick={() => send.mutate()} disabled={send.isPending}>
                {!me.isAdmin ? 'Send for approval' : s ? 'Post now' : 'Post it'}
            </Button>
        </div>
    );
}

/** Picks when the draft posts, on the admin's clock. Opens on tomorrow at 18:00, or the time already set. */
function ScheduleButton({ gig }: { gig: GigView }) {
    const tz = useTimeZone();
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');
    const schedule = useAction(
        (postAt: number) => api(`/api/gigs/${gig.id}/schedule`, 'POST', { postAt }),
        'scheduled.',
        () => setOpen(false),
    );

    const start = () => {
        if (gig.scheduled) setValue(toInput(gig.scheduled.at, tz));
        else {
            const [day] = toInput(Date.now() + 24 * 60 * 60 * 1000, tz).split('T');
            setValue(`${day}T18:00`);
        }
        setOpen(true);
    };

    const at = value ? fromInput(value, tz) : null;
    const valid = at !== null && at > Date.now();
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (valid) schedule.mutate(at);
    };

    return (
        <>
            <Button variant="outline" onClick={start}>
                <CalendarClock className="size-4" /> {gig.scheduled ? 'Reschedule' : 'Schedule'}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogTitle>Schedule the post</DialogTitle>
                    <DialogDescription>It posts to Discord by itself at this time, as you, and the usual new gig heads-ups go out. It has to be ready to post now.</DialogDescription>
                    <form onSubmit={submit} className="mt-4 space-y-4">
                        <div>
                            <Label htmlFor="post-at">Post at</Label>
                            <Input id="post-at" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
                            <p className={valid || !value ? 'mt-1 text-xs text-muted-foreground' : 'mt-1 text-xs text-destructive'}>
                                {valid ? `${formatSession(at, tz)}, ${daysAway(at, tz)}. Your time (${tz}, ${zoneOffset(tz)}).` : value ? "That's already gone. Pick a time in the future." : 'Pick a day and time.'}
                            </p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={!valid || schedule.isPending}>
                                Schedule
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
