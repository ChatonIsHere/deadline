import type { PrefsInput } from '@shared/schemas';
import { LogOut, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isPickedZone, TimezonePicker, WeekGrid } from '@/components/availability';
import { Avatar, Say } from '@/components/common';
import { logout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { api, useAction, useCrewInvites, useMyAvailability, usePrefs, useUser } from '@/lib/api';
import { usePhone } from '@/lib/media';
import { browserTimeZone } from '@/lib/time';
import { RunnerChip } from '@/components/runner';
import { Link } from 'react-router';

export function MePage() {
    const me = useUser();
    const { data: prefs } = usePrefs();
    const save = useAction((next: PrefsInput) => api('/api/prefs', 'PUT', next), 'preferences saved.');

    const roles = [me.isAdmin && 'Admin', me.isFixer && 'Fixer', me.isEdgerunner && 'Edgerunner'].filter(Boolean).join(', ');

    return (
        // Desktop: two columns, the availability grid on its own on the right
        <div className="mx-auto max-w-2xl space-y-5 lg:max-w-6xl">
            <div className="flex items-center gap-3">
                <Avatar member={me} className="size-12 [--cut:8px]" />
                <div>
                    <h1 className="text-3xl text-primary">{me.name}</h1>
                    <p className="text-muted-foreground">{roles}</p>
                </div>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                    {me.isOwner && prefs && (
                        <Card className="space-y-3 [--frame:var(--color-accent)]">
                            <CardTitle help="as the bot owner you're always an admin. player view hides that, so the board and the bot treat you like any player with your Discord roles. turn it back off here or from Ctrl+K.">
                                Player view
                            </CardTitle>
                            <p>{prefs.playerView ? 'On. Admin tools are hidden.' : 'Off. You have full admin powers.'}</p>
                            <Button variant={prefs.playerView ? 'default' : 'outline'} disabled={save.isPending} onClick={() => save.mutate({ playerView: !prefs.playerView })}>
                                {prefs.playerView ? 'Back to admin' : 'View as a player'}
                            </Button>
                        </Card>
                    )}

                    <CrewInvites />

                    {prefs && <TimezoneCard current={prefs.timezone} />}

                    <Card className="space-y-3">
                        <CardTitle help="requests to confirm a session time still come through, since your slot depends on them.">Session reminders</CardTitle>
                        <p>DMs a few hours before a session you've confirmed, and 30 minutes before it starts.</p>
                        {prefs ? (
                            <Button variant={prefs.reminders ? 'outline' : 'default'} disabled={save.isPending} onClick={() => save.mutate({ reminders: !prefs.reminders })}>
                                {prefs.reminders ? 'Turn reminders off' : 'Turn reminders on'}
                            </Button>
                        ) : (
                            <Say>loading...</Say>
                        )}
                    </Card>

                    <Button variant="outline" className="w-full" onClick={logout}>
                        <LogOut className="size-4" /> Log out
                    </Button>
                </div>

                <AvailabilityCard />
            </div>
        </div>
    );
}

/** Crews asking one of the player's runners to join. Same as the DM's buttons. */
function CrewInvites() {
    const invites = useCrewInvites().data ?? [];
    const accept = useAction(({ crewId, runnerId }: { crewId: string; runnerId: string }) => api(`/api/crews/${crewId}/invites/${runnerId}/accept`, 'POST'), 'welcome to the crew.');
    const decline = useAction(({ crewId, runnerId }: { crewId: string; runnerId: string }) => api(`/api/crews/${crewId}/invites/${runnerId}`, 'DELETE'), 'invite declined.');
    if (!invites.length) return null;

    return (
        <Card className="space-y-3 [--frame:var(--color-accent)]">
            <CardTitle help="a crew wants one of your runners. these come by DM too.">Crew invites</CardTitle>
            <ul className="space-y-3">
                {invites.map((i) => {
                    const ids = { crewId: i.crew.id, runnerId: i.runner.id };
                    return (
                        <li key={`${i.crew.id}-${i.runner.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <span>
                                <Link to={`/crews/${i.crew.slug}`} className="text-accent hover:underline">
                                    {i.crew.name}
                                </Link>{' '}
                                wants <RunnerChip runner={i.runner} />
                            </span>
                            <span className="text-xs text-muted-foreground">from {i.invitedBy.name}</span>
                            <span className="ml-auto flex gap-2">
                                <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(ids)}>
                                    Join
                                </Button>
                                <Button size="sm" variant="outline" disabled={decline.isPending} onClick={() => decline.mutate(ids)}>
                                    Decline
                                </Button>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

/** Their timezone. Session times and the availability grid use it. */
function TimezoneCard({ current }: { current: string | null }) {
    const [tz, setTz] = useState(current ?? browserTimeZone());
    const save = useAction(() => api('/api/prefs', 'PUT', { timezone: tz }), 'timezone saved.');
    return (
        <Card className="space-y-3">
            <CardTitle help="session times on the board show in this zone, and so does your availability.">Timezone</CardTitle>
            <TimezonePicker id="timezone" value={tz} onChange={setTz} />
            <Button size="sm" disabled={!isPickedZone(tz) || tz === current || save.isPending} onClick={() => save.mutate()}>
                Save
            </Button>
        </Card>
    );
}

/**
 * The hours they can usually play. Admins see everyone's as a heatmap when picking session
 * times. Phones get a summary and open the grid full screen: dragging across it inline made
 * the page impossible to scroll.
 */
function AvailabilityCard() {
    const phone = usePhone();
    const { data } = useMyAvailability();
    const [hours, setHours] = useState<number[] | null>(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (data) setHours(data.hours);
    }, [data]);
    const save = useAction((next: number[]) => api('/api/availability/mine', 'PUT', { hours: next }), 'availability saved.');
    const changed = !!data && !!hours && hours.join() !== data.hours.join();
    const title = 'click or drag across the hours you can usually play. admins see everyone\'s when picking a session time.';

    if (!data || !hours) {
        return (
            <Card id="availability">
                <CardTitle help={title}>Availability</CardTitle>
                <Say>loading...</Say>
            </Card>
        );
    }

    const editor = (
        <>
            <p className="text-xs text-muted-foreground">Your usual week, in {data.timezone ?? `${browserTimeZone()} (your browser's zone, until you save one)`}.</p>
            <WeekGrid hours={hours} onChange={setHours} />
            <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!changed || save.isPending} onClick={() => save.mutate(hours)}>
                    Save
                </Button>
                <Button size="sm" variant="outline" disabled={!hours.length} onClick={() => setHours([])}>
                    Clear
                </Button>
                {changed && (
                    <Button size="sm" variant="ghost" onClick={() => setHours(data.hours)}>
                        Undo changes
                    </Button>
                )}
            </div>
        </>
    );

    if (!phone) {
        return (
            <Card id="availability" className="space-y-3">
                <CardTitle help={title}>Availability</CardTitle>
                {editor}
            </Card>
        );
    }

    return (
        <Card id="availability" className="space-y-3">
            <CardTitle help={title}>Availability</CardTitle>
            <p>{data.hours.length ? `${data.hours.length} hour${data.hours.length === 1 ? '' : 's'} a week marked.` : 'Nothing marked yet.'}</p>
            <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
                Edit availability
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="inset-0 h-dvh w-full max-w-none translate-none space-y-3 overflow-y-auto p-4 [--cut:0px]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <DialogTitle>Availability</DialogTitle>
                            <DialogDescription className="text-xs">Tap or drag across the hours you can usually play.</DialogDescription>
                        </div>
                        <DialogClose asChild>
                            <Button variant="ghost" size="icon" title="Close" aria-label="Close">
                                <X className="size-5" />
                            </Button>
                        </DialogClose>
                    </div>
                    {editor}
                </DialogContent>
            </Dialog>
        </Card>
    );
}
