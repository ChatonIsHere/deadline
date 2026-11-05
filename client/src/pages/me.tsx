import type { Prefs } from '@shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useUser } from '@/lib/api';

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

            <Card className="space-y-3">
                <CardTitle>Session reminders</CardTitle>
                <p>DMs on the day of a session you've confirmed, and 30 minutes before it starts.</p>
                {prefs ? (
                    <Button variant={prefs.reminders ? 'outline' : 'default'} disabled={save.isPending} onClick={() => save.mutate({ ...prefs, reminders: !prefs.reminders })}>
                        {prefs.reminders ? 'Turn reminders off' : 'Turn reminders on'}
                    </Button>
                ) : (
                    <Say>loading...</Say>
                )}
                <p className="text-xs text-muted-foreground">Asks to confirm a session time still come through, since your slot depends on them.</p>
            </Card>
        </div>
    );
}
