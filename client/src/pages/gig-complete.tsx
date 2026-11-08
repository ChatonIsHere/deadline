import { splitPot } from '@shared/pay';
import { slotCount } from '@shared/slots';
import { completeInput, type CompleteInput, type GigView, isLive } from '@shared/schemas';
import { CalendarClock, Minus, Plus } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Icon, Loading, Money, Pay, Say } from '@/components/common';
import { Markdown, MarkdownEditor } from '@/components/markdown';
import { RunnerChip } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, useAction, useGig, useUser } from '@/lib/api';
import { useFormatSession } from '@/lib/time';
import { firstIssue } from '@/lib/utils';

// Amounts are strings while typing so boxes can be empty
type Amounts = { eb: string; ip: string; hqIp: string; text: string };
const blank: Amounts = { eb: '', ip: '', hqIp: '', text: '' };
const num = (s: string) => (s.trim() === '' ? null : Number(s));

/** The GM's debrief: what happened and what everyone earned. Completing sends payout DMs. */
export function GigComplete() {
    const { id } = useParams();
    const me = useUser();
    const { data: gig, isError } = useGig(id);
    if (!me.isAdmin) return <Say>admins only.</Say>;
    if (isError) return <Say>no such contract.</Say>;
    if (!gig) return <Loading>decrypting...</Loading>;
    if (!isLive(gig.status)) return <Say>that gig isn't live.</Say>;
    return <DebriefForm gig={gig} />;
}

/**
 * What the crew pulled off: the primary objective, and how many times each secondary one was
 * done (0 or 1 for a one-off bonus, any number for a per-each one).
 */
type Done = { primary: boolean; objectives: number[] };

/** The crew's pay from the objectives they pulled off. */
const objectivesPay = (gig: GigView, done: Done) =>
    (done.primary ? gig.pay : 0) + gig.objectives.reduce((sum, o, i) => sum + (o.bonus ?? 0) * (done.objectives[i] ?? 0), 0);

/** How a pot works out between the runners on the gig. */
function PotLine({ pot, runners }: { pot: number; runners: number }) {
    if (!runners) return <Say>nobody on the gig to split it.</Say>;
    const cuts = splitPot(pot, runners);
    const left = cuts.filter((c) => c > cuts[cuts.length - 1]).length;
    return (
        <p className="text-right text-xs text-muted-foreground">
            {cuts[cuts.length - 1].toLocaleString('en-GB')} each between {runners}
            {left > 0 && (left === 1 ? ', and the oldest character gets 1 more' : `, and the ${left} oldest characters get 1 more`)}
        </p>
    );
}

function DebriefForm({ gig }: { gig: GigView }) {
    const navigate = useNavigate();
    const runners = gig.slots.flatMap((s) => (s.runner && s.runner.id ? [s.runner] : []));
    const [summary, setSummary] = useState('');
    const [done, setDone] = useState<Done>({ primary: true, objectives: gig.objectives.map(() => 0) });
    const [crew, setCrew] = useState({ bonus: '', ip: '', hqIp: '', text: '' });
    const [extra, setExtra] = useState<Record<string, Amounts>>({});
    const [error, setError] = useState('');

    const fromObjectives = objectivesPay(gig, done);
    const bonus = num(crew.bonus);
    const pay = fromObjectives + (bonus && bonus > 0 ? bonus : 0);

    const complete = useAction((input: CompleteInput) => api(`/api/gigs/${gig.id}/complete`, 'POST', input), 'job done. payouts sent.', () => navigate(`/gigs/${gig.ref}`));

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (bonus !== null && (!Number.isInteger(bonus) || bonus < 0)) {
            setError('The bonus needs to be a whole number of eddies.');
            return;
        }
        const result = completeInput.safeParse({
            summary: summary.trim() || null,
            eb: pay || null,
            ip: num(crew.ip),
            hqIp: num(crew.hqIp),
            text: crew.text,
            runners: Object.entries(extra).map(([runnerId, a]) => ({ runnerId, eb: num(a.eb), ip: num(a.ip), hqIp: num(a.hqIp), text: a.text })),
        });
        if (!result.success) {
            setError(firstIssue(result.error));
            return;
        }
        complete.mutate(result.data);
    };

    const setRunner = (runnerId: string, patch: Partial<Amounts>) => setExtra((x) => ({ ...x, [runnerId]: { ...(x[runnerId] ?? blank), ...patch } }));

    return (
        <form onSubmit={submit} className="mx-auto max-w-6xl space-y-5">
            <div>
                <h1 className="text-3xl text-primary">{gig.name}</h1>
                <Say>completing locks the post. everyone on the gig gets a DM with their payout and a way to rate the fixer.</Say>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="space-y-5">
                    <GigDetails gig={gig} />
                    <Objectives gig={gig} done={done} onChange={setDone} />
                </div>

                <div className="space-y-5">
                    <Card className="space-y-2">
                        <CardTitle>What happened</CardTitle>
                        <MarkdownEditor value={summary} onChange={setSummary} max={2000} />
                    </Card>

                    <Card className="space-y-4">
                        <CardTitle help={gig.splitPay ? 'the pot is divided between everyone on the gig. IP and anything else goes to each of them.' : 'everyone on the gig gets these. pay comes from the objectives ticked off, plus any bonus.'}>Crew rewards</CardTitle>
                        <div className="grid grid-cols-[1fr_auto] items-end gap-x-4 gap-y-3 sm:grid-cols-[auto_1fr_auto]">
                            <div className="hidden sm:block">
                                <Label>Objectives</Label>
                                <p className="flex h-9 items-center">
                                    <Money amount={fromObjectives} />
                                </p>
                            </div>
                            <Amount id="bonus" label="Bonus" icon value={crew.bonus} onChange={(v) => setCrew({ ...crew, bonus: v })} />
                            <div className="text-right">
                                <Label>{gig.splitPay ? 'Pot' : 'Pay'}</Label>
                                <p className="flex h-9 items-center justify-end text-lg">
                                    <Money amount={pay} />
                                </p>
                            </div>
                        </div>
                        {gig.splitPay && <PotLine pot={pay} runners={runners.length} />}
                        <div className="grid grid-cols-2 gap-3">
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
                                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-[8rem_5rem_5rem_1fr]">
                                        <Amount id={`eb-${r.id}`} label="Pay" icon value={a.eb} onChange={(eb) => setRunner(r.id, { eb })} />
                                        <Amount id={`ip-${r.id}`} label="IP" value={a.ip} onChange={(ip) => setRunner(r.id, { ip })} />
                                        <Amount id={`hq-${r.id}`} label="HQ IP" value={a.hqIp} onChange={(hqIp) => setRunner(r.id, { hqIp })} />
                                        <div className="col-span-3 sm:col-span-1">
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
                </div>
            </div>
        </form>
    );
}

/** The basics, for reference while writing the debrief. */
function GigDetails({ gig }: { gig: GigView }) {
    const formatSession = useFormatSession();
    return (
        <Card className="space-y-2">
            <CardTitle>Details</CardTitle>
            <Detail icon="fixer" label="Fixer" value={gig.fixerName} />
            <Detail icon="location" label="Location" value={gig.location} />
            {gig.sessionAt && <Detail icon={<CalendarClock className="size-4 shrink-0 text-accent" />} label="Session" value={formatSession(gig.sessionAt)} />}
            <Detail icon="crew" label="Crew" value={slotCount(gig.slots)} />
            {/* Admins know every bonus, undisclosed ones included */}
            <Detail icon="eb" label="On offer" value={<Pay gig={{ ...gig, objectives: gig.objectives.map((o) => ({ ...o, secret: false })) }} />} />
        </Card>
    );
}

/** `icon`: one of the bot's emoji by name, or an icon element. */
function Detail({ icon, label, value }: { icon: string | ReactNode; label: string; value: ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            {typeof icon === 'string' ? <Icon name={icon} /> : icon}
            <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0">{value}</span>
        </div>
    );
}

/** Every objective with what it pays. Tick off what the crew did; count the per-each ones. */
function Objectives({ gig, done, onChange }: { gig: GigView; done: Done; onChange: (done: Done) => void }) {
    const setCount = (i: number, count: number) => onChange({ ...done, objectives: done.objectives.map((c, j) => (j === i ? Math.max(0, count) : c)) });
    return (
        <Card className="space-y-4">
            <CardTitle help="tick what the crew pulled off. per-each bonuses take a count. it all adds up to the crew's pay.">Objectives</CardTitle>
            <div>
                <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground uppercase">
                    <Icon name="objective" /> Primary objective
                </p>
                <label className="flex cursor-pointer items-start gap-3">
                    <Tick checked={done.primary} onChange={(primary) => onChange({ ...done, primary })} />
                    <ul className="min-w-0 flex-1 space-y-1">
                        {gig.primaryObjective.map((part, i) => (
                            <li key={i}>
                                <Markdown inline text={part} />
                            </li>
                        ))}
                    </ul>
                    <Money amount={gig.pay} className={done.primary ? 'shrink-0' : 'shrink-0 opacity-50'} />
                </label>
            </div>
            {gig.objectives.length > 0 && (
                <div>
                    <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground uppercase">
                        <Icon name="bonus" /> Secondary objectives
                    </p>
                    <ul className="space-y-2">
                        {gig.objectives.map((o, i) => {
                            const count = done.objectives[i] ?? 0;
                            const text = (
                                <span className="min-w-0 flex-1">
                                    <Markdown inline text={o.text} />
                                    {o.hidden && <span className="ml-2 text-xs text-accent uppercase">{o.secret ? 'not disclosed yet' : 'was hidden'}</span>}
                                </span>
                            );
                            const worth = o.bonus ? (
                                <span className={count ? 'flex shrink-0 items-center gap-1' : 'flex shrink-0 items-center gap-1 opacity-50'}>
                                    <span className="font-semibold text-primary">+</span>
                                    <Money amount={o.bonus} />
                                    {o.each && <span className="text-muted-foreground">each</span>}
                                </span>
                            ) : (
                                <span className="shrink-0 text-muted-foreground">no bonus</span>
                            );
                            // Per-each ones tick too (once), and the counter beside the bonus takes it higher
                            return (
                                <li key={i} className="flex items-start gap-3">
                                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                                        <Tick checked={count > 0} onChange={(on) => setCount(i, on ? 1 : 0)} />
                                        {text}
                                    </label>
                                    {o.each && <Counter label={o.text} value={count} onChange={(c) => setCount(i, c)} />}
                                    {worth}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </Card>
    );
}

function Tick({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
    return <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 cursor-pointer accent-[var(--color-primary)]" />;
}

/** How many times a per-each objective was done. */
function Counter({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return (
        <span className="flex shrink-0 items-center">
            <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={`One fewer: ${label}`} disabled={value === 0} onClick={() => onChange(value - 1)}>
                <Minus className="size-3.5" />
            </Button>
            <span className="w-6 text-center tabular-nums" aria-live="polite">
                {value}
            </span>
            <Button type="button" variant="ghost" size="icon" className="size-6" aria-label={`One more: ${label}`} onClick={() => onChange(value + 1)}>
                <Plus className="size-3.5" />
            </Button>
        </span>
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
