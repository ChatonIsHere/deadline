import type { NewGigScope, NotifyKind, NotifySettings, Prefs, PrefsInput } from '@shared/schemas';
import { Lock } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Loading } from '@/components/common';
import { Card, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { api, useAction, useFixers, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

const SCOPES: { value: NewGigScope; label: string }[] = [
    { value: 'off', label: 'No' },
    { value: 'all', label: 'Every new gig' },
    { value: 'crews', label: 'Gigs with slots for my crews' },
    { value: 'fixers', label: 'Gigs from fixers I pick' },
];

/**
 * Which notifications come by DM. Gig news is always in the gig's thread on Discord; these
 * are copies for the people it's about. Each switch saves straight away.
 */
export function NotificationsCard({ prefs }: { prefs: Prefs | undefined }) {
    const me = useUser();
    // Shown at once, saved behind the scenes
    const [local, setLocal] = useState<Prefs | undefined>(prefs);
    useEffect(() => setLocal(prefs), [prefs]);
    const save = useAction((next: PrefsInput) => api('/api/prefs', 'PUT', next), 'saved.');

    if (!local) {
        return (
            <Card>
                <CardTitle>Notifications</CardTitle>
                <Loading>loading...</Loading>
            </Card>
        );
    }

    const setNotify = (patch: Partial<NotifySettings>) => {
        setLocal({ ...local, notify: { ...local.notify, ...patch } });
        save.mutate({ notify: patch });
    };
    const kind = (k: NotifyKind, title: string, hint: string) => <Toggle key={k} title={title} hint={hint} on={local.notify[k]} onChange={(on) => setNotify({ [k]: on })} />;

    return (
        <Card className="space-y-5">
            <CardTitle help="gig news always goes in the gig's thread on Discord. these are copies by DM for the things that are about you.">Discord DMs</CardTitle>

            <Group title="Gigs you're on">
                <Toggle title="Confirm requests" hint="when a session time is set. your slot depends on answering, so these always come." on locked />
                <Toggle
                    title="Session reminders"
                    hint="a few hours before a session you've confirmed, and 30 minutes before."
                    on={local.reminders}
                    onChange={(reminders) => {
                        setLocal({ ...local, reminders });
                        save.mutate({ reminders });
                    }}
                />
                {kind('gigUpdates', 'Your place on a gig', 'moved up from the reserves, put on or taken off by an admin, dropped for not confirming, the gig pulled or its time cleared.')}
                {kind('payouts', 'Payouts', 'your cut after a gig, with stars to rate the fixer. you can also rate on the gig page.')}
                {kind('downtime', 'Monthly DT and rent', "at noon on the 1st: each character's downtime and what's due.")}
            </Group>

            <Group title="New gigs">
                <Select
                    value={local.notify.newGigs}
                    onChange={(v) => setNotify({ newGigs: v as NewGigScope })}
                    options={SCOPES}
                    className="w-full"
                />
                {local.notify.newGigs === 'fixers' && <FixerPicker picked={local.notify.newGigFixers} onChange={(newGigFixers) => setNotify({ newGigFixers })} />}
            </Group>

            <Group title="Crews">
                {kind('crewInvites', 'Crew invites', "with buttons to join or decline. they're on this page either way.")}
                {kind('crewChanges', 'Crew changes', 'someone joins or leaves your crews, your rank changes, an invite you sent is turned down.')}
            </Group>

            {(me.isFixer || me.isAdmin) && (
                <Group title="Gigs you put out">
                    {me.isFixer && !me.isAdmin && kind('fixerApprovals', 'Approved or turned down', 'when an admin decides on a gig you sent in.')}
                    {kind('fixerSignups', 'Sign-ups', 'runners signing up for your gigs or pulling out.')}
                    {kind('fixerRatings', 'Ratings', 'runners rating you after a gig, with their note.')}
                </Group>
            )}

            {me.isAdmin && <Group title="Admin">{kind('approvals', 'Gigs to approve', 'when a fixer sends in a gig for sign-off.')}</Group>}
        </Card>
    );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <h3 className="font-display text-xs tracking-widest text-muted-foreground uppercase">{title}</h3>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

/** One notification: what it is, and a switch. `locked` ones are always on. */
function Toggle({ title, hint, on, onChange, locked }: { title: string; hint: string; on: boolean; onChange?: (on: boolean) => void; locked?: boolean }) {
    return (
        <label className={cn('flex items-start gap-3', !locked && 'cursor-pointer')}>
            <span className="min-w-0 flex-1">
                <span className="block">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
            {locked ? (
                <span className="flex h-6 shrink-0 items-center gap-1 text-xs text-muted-foreground uppercase" title="Always on">
                    <Lock className="size-3.5" /> Always
                </span>
            ) : (
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={title}
                    onClick={() => onChange?.(!on)}
                    className={cn('cut relative h-6 w-11 shrink-0 cursor-pointer transition-colors [--cut:5px]', on ? 'bg-primary' : 'bg-muted')}
                >
                    <span className={cn('cut absolute top-1 size-4 transition-[left] [--cut:3px]', on ? 'left-6 bg-primary-foreground' : 'left-1 bg-muted-foreground')} />
                </button>
            )}
        </label>
    );
}

/** Fixers to hear about new gigs from, as chips. */
function FixerPicker({ picked, onChange }: { picked: string[]; onChange: (ids: string[]) => void }) {
    const { data: fixers, isPending } = useFixers();
    if (isPending) return <Loading>pinging contacts...</Loading>;
    if (!fixers?.length) return <p className="text-xs text-muted-foreground">no fixers yet.</p>;
    return (
        <div className="flex flex-wrap gap-1.5">
            {fixers.map((f) => {
                const on = picked.includes(f.id);
                return (
                    <button
                        key={f.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(on ? picked.filter((id) => id !== f.id) : [...picked, f.id])}
                        className={cn(
                            'cut cursor-pointer px-2 py-1 font-display text-xs tracking-wider uppercase [--cut:5px]',
                            on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {f.fixerName}
                    </button>
                );
            })}
        </div>
    );
}
