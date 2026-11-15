import { canManageCrew } from '@shared/permissions';
import { type CrewView, hqInput, type HqInput } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Icon, Live, Loading, Say } from '@/components/common';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, useAction, useCrew, useUser } from '@/lib/api';
import { useTimeZone } from '@/lib/time';
import { cn, firstIssue } from '@/lib/utils';

/** A crew's HQ IP, on its own page off the crew's. Everyone can see it; founders spend it. */
export function CrewHqPage() {
    const { id } = useParams();
    const me = useUser();
    const { data: crew, isError } = useCrew(id);

    if (isError) return <Say>no such crew.</Say>;
    if (!crew) return <Loading>scanning...</Loading>;

    return (
        <div className="space-y-5">
            <Link to={`/crews/${crew.slug}`} className="group flex w-fit items-center gap-3">
                {crew.imageId ? (
                    <RunnerAvatar runner={{ handle: crew.name, imageId: crew.imageId }} large className="size-12 text-xl [--cut:6px]" />
                ) : (
                    <span className="cut grid size-12 shrink-0 place-items-center bg-muted [--cut:6px]">
                        <Icon name="crew" className="size-6" />
                    </span>
                )}
                <div>
                    <p className="text-xs tracking-widest text-muted-foreground">// HQ IP</p>
                    <h1 className="text-2xl text-primary group-hover:underline">{crew.name}</h1>
                </div>
            </Link>
            <Live value={[crew.hqIp, crew.hqLog.length]}>
                <HqCard crew={crew} url={`/api/crews/${crew.id}`} canSpend={canManageCrew(me, crew)} canAdd={me.isAdmin} />
            </Live>
        </div>
    );
}

/** What the amount box starts at. */
const DEFAULT_SPEND = 40;

/**
 * The crew's HQ IP. Left: what it has, and spending it (founders, saying what on; admins can add
 * some too). Right: what it earned on gigs and spent.
 */
function HqCard({ crew, url, canSpend, canAdd }: { crew: CrewView; url: string; canSpend: boolean; canAdd: boolean }) {
    const tz = useTimeZone();
    const [amount, setAmount] = useState(String(DEFAULT_SPEND));
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const save = useAction(
        (input: HqInput) => api(`${url}/hq`, 'POST', input),
        'HQ IP logged.',
        () => {
            setAmount(String(DEFAULT_SPEND));
            setNote('');
        },
    );

    const submit = (sign: 1 | -1) => (e?: FormEvent) => {
        e?.preventDefault();
        setError('');
        const n = Number(amount);
        if (!Number.isInteger(n) || n <= 0) return setError('Enter a whole number of IP.');
        if (sign < 0 && n > crew.hqIp) return setError(`${crew.name} has ${crew.hqIp} HQ IP to spend.`);
        const result = hqInput.safeParse({ amount: sign * n, note });
        if (!result.success) return setError(firstIssue(result.error));
        save.mutate(result.data);
    };

    return (
        <div className="grid items-start gap-5 lg:grid-cols-2">
            <Card className="space-y-3">
                <CardTitle help="improvement points for the crew's headquarters. crews earn them on gigs, and founders spend them.">HQ IP</CardTitle>
                <p className="flex items-baseline gap-2">
                    <span className="font-display text-4xl leading-none text-primary">{crew.hqIp}</span>
                    <span className="text-xs text-muted-foreground uppercase">to spend</span>
                </p>
                {canSpend && (
                    <form onSubmit={submit(-1)} className="space-y-2">
                        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                            <div>
                                <Label htmlFor="hq-amount">IP</Label>
                                <Input id="hq-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                            </div>
                            <div>
                                <Label htmlFor="hq-note">On what</Label>
                                <Input id="hq-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. a med bay" />
                            </div>
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                        <div className="flex justify-end gap-2">
                            {canAdd && (
                                <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={() => submit(1)()}>
                                    Add
                                </Button>
                            )}
                            <Button type="submit" size="sm" disabled={save.isPending || !crew.hqIp}>
                                Spend
                            </Button>
                        </div>
                    </form>
                )}
            </Card>

            <Card className="space-y-3">
                <CardTitle help="the latest of what the crew earned on gigs and spent, newest first.">History</CardTitle>
                {crew.hqLog.length ? (
                    <ul className="space-y-2">
                        {crew.hqLog.map((e) => (
                            <li key={e.id} className="live-in flex items-start gap-3 text-sm">
                                <span className={cn('w-10 shrink-0 text-right font-display', e.amount > 0 ? 'text-success' : 'text-destructive')}>
                                    {e.amount > 0 ? '+' : ''}
                                    {e.amount}
                                </span>
                                <span className="min-w-0 flex-1">
                                    {e.gig ? (
                                        <Link to={`/gigs/${e.gig.ref}`} className="hover:text-accent">
                                            {e.gig.name}
                                        </Link>
                                    ) : (
                                        <span className="break-words">{e.note}</span>
                                    )}
                                    <span className="block text-xs text-muted-foreground">
                                        {[e.by, new Date(e.at).toLocaleDateString('en-GB', { timeZone: tz })].filter(Boolean).join(' · ')}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Say>nothing earned yet.</Say>
                )}
            </Card>
        </div>
    );
}
