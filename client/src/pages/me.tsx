import type { Prefs } from '@shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { Avatar, Say } from '@/components/common';
import { logout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useCrewInvites, useUser } from '@/lib/api';
import { RunnerChip } from '@/components/runner';
import { Link } from 'react-router';

export function MePage() {
    const me = useUser();
    const { data: prefs } = useQuery({ queryKey: ['prefs'], queryFn: () => api<Prefs>('/api/prefs') });
    const save = useAction((next: Prefs) => api('/api/prefs', 'PUT', next), 'Saved.');

    const roles = [me.isAdmin && 'Admin', me.isFixer && 'Fixer', me.isEdgerunner && 'Edgerunner'].filter(Boolean).join(', ');

    return (
        <div className="mx-auto max-w-2xl space-y-5">
            <div className="flex items-center gap-3">
                <Avatar member={me} className="size-12 [--cut:8px]" />
                <div>
                    <h1 className="text-2xl text-primary">{me.name}</h1>
                    <p className="text-muted-foreground">{roles}</p>
                </div>
            </div>

            <CrewInvites />

            <Card className="space-y-3">
                <CardTitle help="requests to confirm a session time still come through, since your slot depends on them.">Session reminders</CardTitle>
                <p>DMs a few hours before a session you've confirmed, and 30 minutes before it starts.</p>
                {prefs ? (
                    <Button variant={prefs.reminders ? 'outline' : 'default'} disabled={save.isPending} onClick={() => save.mutate({ ...prefs, reminders: !prefs.reminders })}>
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
    );
}

/** Crews asking one of the player's runners to join. Same as the DM's buttons. */
function CrewInvites() {
    const invites = useCrewInvites().data ?? [];
    const accept = useAction(({ crewId, runnerId }: { crewId: number; runnerId: number }) => api(`/api/crews/${crewId}/invites/${runnerId}/accept`, 'POST'), 'Welcome to the crew.');
    const decline = useAction(({ crewId, runnerId }: { crewId: number; runnerId: number }) => api(`/api/crews/${crewId}/invites/${runnerId}`, 'DELETE'), 'Declined.');
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
                                <Link to={`/crews/${i.crew.slug}`} className="text-primary hover:underline">
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
