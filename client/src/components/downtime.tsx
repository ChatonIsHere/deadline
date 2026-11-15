import { periodName, signed } from '@shared/downtime';
import type { DowntimeView, RunnerView } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmButton, Money, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, useAction, useUser } from '@/lib/api';
import { useTimeZone } from '@/lib/time';
import { useUnsavedChanges } from '@/lib/unsaved';

const LOG_LABEL: Record<DowntimeView['entries'][number]['kind'], string> = { monthly: 'Month start', gig: 'Gig', spend: 'Spent', admin: 'Added by an admin' };

/**
 * A runner's downtime: what they have and the controls on the left, this month's comings and
 * goings on the right. The server only sends it to their player and admins, so nobody else gets this.
 */
export function DowntimePanel({ runner }: { runner: RunnerView }) {
    const me = useUser();
    const tz = useTimeZone();
    const d = runner.downtime;
    const url = `/api/runners/${runner.id}/downtime`;
    const skip = useAction(() => api(`${url}/skip`, 'POST'), 'month skipped. nothing due.');
    if (!d) return null;

    return (
        <div className="grid items-start gap-5 lg:grid-cols-2">
            <Card className="space-y-4">
                <CardTitle help="only you and the admins can see this. it resets at noon on the 1st, your time.">Downtime</CardTitle>

                <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                    <p>
                        <span className="font-display text-4xl text-primary">{d.balance}</span> <span className="text-muted-foreground">DT left for {periodName(d.month)}</span>
                    </p>
                    {d.thisMonth && (
                        <p className="inline-flex flex-wrap items-center gap-x-3 text-sm">
                            {d.thisMonth.skipped ? (
                                <span className="text-muted-foreground">month skipped</span>
                            ) : (
                                <>
                                    <span>+{d.thisMonth.dt} DT</span>
                                    <span className="inline-flex items-center gap-1">
                                        <Money amount={d.thisMonth.due} /> due
                                    </span>
                                    <span>humanity {signed(d.thisMonth.humanity)}</span>
                                </>
                            )}
                        </p>
                    )}
                </div>

                {!d.living && !d.lifestyle ? (
                    <Say>
                        no living situation or lifestyle set, so no DT.{' '}
                        <Link to={`/runners/${runner.slug}/edit`} className="text-accent hover:underline">
                            set them
                        </Link>
                    </Say>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Gets {d.totals.dtMonth} DT a month and {d.totals.dtGig} per gig.
                    </p>
                )}

                {d.canSkip && (
                    <div className="flex flex-wrap items-center gap-3">
                        <ConfirmButton
                            size="sm"
                            variant="default"
                            label="Skip this month"
                            title="Skip this month?"
                            description="No game last month, so you can. You lose this month's DT and humanity change, and owe nothing."
                            onConfirm={() => skip.mutate()}
                        />
                        <p className="text-xs text-muted-foreground">no game last month, so this one's optional.</p>
                    </div>
                )}

                <AmountForm url={`${url}/spend`} label="Spend DT" button="Record" notePlaceholder="What on?" done="spend recorded." max={d.balance} />
                {me.isAdmin && <AmountForm url={`${url}/add`} label="Add DT (admin)" button="Add" notePlaceholder="Why?" done="DT added." />}
            </Card>

            <Card className="space-y-3">
                <CardTitle help="what's come in and gone out this month, newest first. it starts over each month.">{periodName(d.month)}</CardTitle>
                {d.entries.length ? (
                    <ul className="space-y-2">
                        {d.entries.map((e) => (
                            <li key={e.id} className="live-in flex items-start gap-3 text-sm">
                                <span className={e.amount < 0 ? 'w-10 shrink-0 text-right font-display text-destructive' : 'w-10 shrink-0 text-right font-display text-primary'}>{signed(e.amount)}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="break-words">{e.note ?? LOG_LABEL[e.kind]}</span>
                                    <span className="block text-xs text-muted-foreground">
                                        {e.note ? `${LOG_LABEL[e.kind]} · ` : ''}
                                        {new Date(e.at).toLocaleDateString('en-GB', { timeZone: tz })}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Say>nothing yet this month.</Say>
                )}
            </Card>
        </div>
    );
}

/** An amount and a note, for spending DT or adding it. */
function AmountForm({ url, label, button, notePlaceholder, done, max }: { url: string; label: string; button: string; notePlaceholder: string; done: string; max?: number }) {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    useUnsavedChanges(!!amount || !!note.trim());
    const save = useAction(
        () => api(url, 'POST', { amount: Number(amount), note }),
        done,
        () => {
            setAmount('');
            setNote('');
        },
    );
    const valid = Number.isInteger(Number(amount)) && Number(amount) > 0 && !!note.trim();
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (valid) save.mutate();
    };
    return (
        <form onSubmit={submit}>
            <Label>{label}</Label>
            <div className="flex gap-2">
                <Input className="w-20 shrink-0" type="number" min={1} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`${label}: amount`} />
                <Input className="min-w-0 flex-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={notePlaceholder} aria-label={`${label}: note`} />
                <Button type="submit" variant="outline" className="mt-0.5 shrink-0" disabled={!valid || save.isPending}>
                    {button}
                </Button>
            </div>
        </form>
    );
}
