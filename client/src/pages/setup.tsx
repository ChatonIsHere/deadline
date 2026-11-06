import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isPickedZone, TimezonePicker, WeekGrid } from '@/components/availability';
import { Say } from '@/components/common';
import { logout } from '@/components/layout';
import { RunnerChip } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useMyRunners, useUser } from '@/lib/api';
import { browserTimeZone } from '@/lib/time';

const STEPS = ['Runner', 'Timezone', 'Reminders', 'Availability'];

/**
 * First time in: a runner, a timezone and whether they want session reminders. Their usual
 * week comes last and can wait. Everything else on the board waits until the first three are done.
 */
export function SetupPage() {
    const me = useUser();
    const navigate = useNavigate();
    const mine = useMyRunners().data;
    const [step, setStep] = useState(0);
    const [tz, setTz] = useState(() => me.timezone ?? browserTimeZone());
    const [hours, setHours] = useState<number[]>([]);

    const finish = useAction((reminders: boolean) => api('/api/setup', 'POST', { timezone: tz, reminders }), 'setup complete. welcome to the board.', () => setStep(3));
    const saveWeek = useAction(() => api('/api/availability/mine', 'PUT', { hours }), 'availability saved.', () => navigate('/gigs'));

    return (
        <div className="mx-auto max-w-2xl space-y-5">
            <div className="space-y-1">
                <h1 className="text-3xl text-primary">New connection</h1>
                <p className="flex flex-wrap gap-x-3 text-xs tracking-widest uppercase">
                    {STEPS.map((s, i) => (
                        <span key={s} className={i === step ? 'text-primary' : i < step ? 'text-foreground' : 'text-muted-foreground'}>
                            {String(i + 1).padStart(2, '0')} {s}
                        </span>
                    ))}
                </p>
            </div>

            {step === 0 && (
                <Card className="space-y-4">
                    <CardTitle>Your runner</CardTitle>
                    <Say>every job needs a face. put at least one runner on file.</Say>
                    {!mine ? (
                        <Say>loading...</Say>
                    ) : mine.length ? (
                        <ul className="flex flex-wrap gap-2">
                            {mine.map((r) => (
                                <li key={r.id}>
                                    <RunnerChip runner={r} />
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button asChild variant={mine?.length ? 'outline' : 'default'}>
                            <Link to="/runners/new?next=/setup">{mine?.length ? 'Make another' : 'Make a runner'}</Link>
                        </Button>
                        {(!!mine?.length || me.isAdmin) && <Button onClick={() => setStep(1)}>{mine?.length ? 'Next' : 'Skip'}</Button>}
                    </div>
                    {me.isAdmin && !mine?.length && <p className="text-xs text-muted-foreground">Admins can skip this if they're only running the game.</p>}
                </Card>
            )}

            {step === 1 && (
                <Card className="space-y-4">
                    <CardTitle>Your timezone</CardTitle>
                    <Say>session times show on your clock. admins see your hours on theirs.</Say>
                    <TimezonePicker id="setup-timezone" value={tz} onChange={setTz} />
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setStep(0)}>
                            Back
                        </Button>
                        <Button disabled={!isPickedZone(tz)} onClick={() => setStep(2)}>
                            Next
                        </Button>
                    </div>
                </Card>
            )}

            {step === 2 && (
                <Card className="space-y-4">
                    <CardTitle>Session reminders</CardTitle>
                    <Say>want a ping before you play?</Say>
                    <p>A DM a few hours before a session you've confirmed, and again 30 minutes before it starts. Requests to confirm a session time come either way. You can change this later on your page or with /reminders.</p>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" disabled={finish.isPending} onClick={() => setStep(1)}>
                            Back
                        </Button>
                        <Button disabled={finish.isPending} onClick={() => finish.mutate(true)}>
                            Yes, DM me
                        </Button>
                        <Button variant="outline" disabled={finish.isPending} onClick={() => finish.mutate(false)}>
                            No thanks
                        </Button>
                    </div>
                </Card>
            )}

            {step === 3 && (
                <Card className="space-y-4">
                    <CardTitle>When you can play</CardTitle>
                    <Say>mark the hours you're usually free. admins use it to pick session times.</Say>
                    <p className="text-xs text-muted-foreground">Your usual week, in {tz}. Click or drag across hours. Change it any time on your page.</p>
                    <WeekGrid hours={hours} onChange={setHours} />
                    <div className="flex flex-wrap gap-2">
                        <Button disabled={!hours.length || saveWeek.isPending} onClick={() => saveWeek.mutate()}>
                            Save
                        </Button>
                        <Button variant="outline" onClick={() => navigate('/gigs')}>
                            Later
                        </Button>
                    </div>
                </Card>
            )}

            {step < 3 && (
                <button type="button" className="cursor-pointer text-xs text-muted-foreground hover:text-foreground" onClick={logout}>
                    Not you? Log out
                </button>
            )}
        </div>
    );
}
