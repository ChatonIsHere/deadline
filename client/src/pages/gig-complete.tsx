import { completeInput, type CompleteInput, type GigView, isLive } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Icon, Say } from '@/components/common';
import { MarkdownEditor } from '@/components/markdown';
import { RunnerChip } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { firstIssue } from '@/lib/utils';
import { api, useAction, useGig, useUser } from '@/lib/api';

// Amounts are strings while typing so boxes can be empty
type Amounts = { eb: string; ip: string; text: string };
const blank: Amounts = { eb: '', ip: '', text: '' };
const num = (s: string) => (s.trim() === '' ? null : Number(s));

/** The GM's debrief: what happened and what everyone earned. Completing sends payout DMs. */
export function GigComplete() {
    const { id } = useParams();
    const me = useUser();
    const { data: gig, isError } = useGig(id);
    if (!me.isAdmin) return <Say>admins only.</Say>;
    if (isError) return <Say>no such contract.</Say>;
    if (!gig) return <Say>decrypting...</Say>;
    if (!isLive(gig.status)) return <Say>that gig isn't live.</Say>;
    return <DebriefForm gig={gig} />;
}

function DebriefForm({ gig }: { gig: GigView }) {
    const navigate = useNavigate();
    const runners = gig.slots.flatMap((s) => (s.runner && s.runner.id ? [s.runner] : []));
    const [summary, setSummary] = useState('');
    const [crew, setCrew] = useState({ ...blank, hqIp: '' });
    const [extra, setExtra] = useState<Record<string, Amounts>>({});
    const [error, setError] = useState('');

    const complete = useAction((input: CompleteInput) => api(`/api/gigs/${gig.id}/complete`, 'POST', input), 'job done. payouts sent.', () => navigate(`/gigs/${gig.ref}`));

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const result = completeInput.safeParse({
            summary: summary.trim() || null,
            eb: num(crew.eb),
            ip: num(crew.ip),
            hqIp: num(crew.hqIp),
            text: crew.text,
            runners: Object.entries(extra).map(([runnerId, a]) => ({ runnerId: Number(runnerId), eb: num(a.eb), ip: num(a.ip), text: a.text })),
        });
        if (!result.success) {
            setError(firstIssue(result.error));
            return;
        }
        complete.mutate(result.data);
    };

    const setRunner = (runnerId: string, patch: Partial<Amounts>) => setExtra((x) => ({ ...x, [runnerId]: { ...(x[runnerId] ?? blank), ...patch } }));

    return (
        <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
            <h1 className="text-3xl text-primary">{gig.name}</h1>
            <Say>completing locks the post. everyone on the gig gets a DM with their payout and a way to rate the fixer.</Say>

            <Card className="space-y-2">
                <CardTitle>What happened</CardTitle>
                <MarkdownEditor value={summary} onChange={setSummary} max={2000} />
            </Card>

            <Card className="space-y-4">
                <CardTitle help="everyone on the gig gets these. all optional.">Crew rewards</CardTitle>
                <div className="grid grid-cols-3 gap-3">
                    <Amount id="eb" label="Pay" icon value={crew.eb} onChange={(eb) => setCrew({ ...crew, eb })} />
                    <Amount id="ip" label="IP" value={crew.ip} onChange={(ip) => setCrew({ ...crew, ip })} />
                    <Amount id="hq" label="HQ IP" value={crew.hqIp} onChange={(hqIp) => setCrew({ ...crew, hqIp })} />
                </div>
                <div>
                    <Label htmlFor="crew-extra">Other rewards</Label>
                    <Input id="crew-extra" value={crew.text} onChange={(e) => setCrew({ ...crew, text: e.target.value })} maxLength={200} placeholder="e.g. a favour from Rogue" />
                </div>
            </Card>

            <Card className="space-y-4">
                <CardTitle>Extra for individual runners</CardTitle>
                {!runners.length && <Say>nobody's on this gig.</Say>}
                {runners.map((r) => {
                    const a = extra[r.id] ?? blank;
                    return (
                        <div key={r.id} className="space-y-2 border-b-2 border-border pb-4 last:border-0 last:pb-0">
                            <RunnerChip runner={r} />
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_6rem_1fr]">
                                <Amount id={`eb-${r.id}`} label="Pay" icon value={a.eb} onChange={(eb) => setRunner(r.id, { eb })} />
                                <Amount id={`ip-${r.id}`} label="IP" value={a.ip} onChange={(ip) => setRunner(r.id, { ip })} />
                                <div className="col-span-2 sm:col-span-1">
                                    <Label htmlFor={`text-${r.id}`}>Other</Label>
                                    <Input id={`text-${r.id}`} value={a.text} onChange={(e) => setRunner(r.id, { text: e.target.value })} maxLength={200} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </Card>

            {error && <p className="text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={complete.isPending}>
                Complete the gig
            </Button>
        </form>
    );
}

function Amount({ id, label, value, onChange, icon }: { id: string; label: string; value: string; onChange: (v: string) => void; icon?: boolean }) {
    return (
        <div>
            <Label htmlFor={id}>{label}</Label>
            <div className="relative">
                {icon && <Icon name="eb" className="absolute top-2.5 left-2 z-10" />}
                <Input id={id} className={icon ? 'pl-8' : undefined} type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
            </div>
        </div>
    );
}
