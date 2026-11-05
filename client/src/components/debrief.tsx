import type { GigView, Rewards } from '@shared/schemas';
import { toast } from 'sonner';
import { Money, Say } from '@/components/common';
import { Markdown } from '@/components/markdown';
import { RunnerChip, StarPicker } from '@/components/runner';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction } from '@/lib/api';

/** A finished gig's summary and rewards. */
export function DebriefCard({ gig }: { gig: GigView }) {
    const crew = gig.crewRewards;
    if (!crew) return null;
    return (
        <Card className="space-y-4 [--frame:var(--color-success)]">
            <CardTitle>Debrief</CardTitle>
            {gig.summary ? <Markdown text={gig.summary} /> : <Say>no summary filed.</Say>}
            <div>
                <p className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">Crew rewards</p>
                <RewardLine rewards={crew} hqIp={crew.hqIp} />
            </div>
            {gig.runnerRewards.length > 0 && (
                <ul className="space-y-2">
                    {gig.runnerRewards.map((r) => (
                        <li key={r.runner.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <RunnerChip runner={r.runner} />
                            <RewardLine rewards={r} plus />
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}

function RewardLine({ rewards, hqIp, plus }: { rewards: Rewards; hqIp?: number | null; plus?: boolean }) {
    const p = plus ? '+' : '';
    const parts = [
        rewards.eb ? (
            <span key="eb" className="inline-flex items-center gap-1">
                {p}
                <Money amount={rewards.eb} />
            </span>
        ) : null,
        rewards.ip ? <span key="ip">{`${p}${rewards.ip} IP`}</span> : null,
        hqIp ? <span key="hq">{`${hqIp} HQ IP`}</span> : null,
        rewards.text ? <span key="text">{rewards.text}</span> : null,
    ].filter(Boolean);
    if (!parts.length) return <span className="text-muted-foreground">none</span>;
    return <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">{parts}</span>;
}

/** Runners on a finished gig rate its fixer. Same as the menu in their payout DM. */
export function RateFixer({ gig }: { gig: GigView }) {
    const rate = useAction((stars: number) => api<{ message: string }>(`/api/gigs/${gig.id}/rating`, 'POST', { stars }), ({ message }) => toast.success(message));
    return (
        <Card className="space-y-2">
            <CardTitle>Rate {gig.fixerName}</CardTitle>
            <StarPicker value={gig.myRating} onPick={(stars) => rate.mutate(stars)} disabled={rate.isPending} />
            <p className="text-xs text-muted-foreground">{gig.myRating ? 'You can change it any time.' : 'How did the fixer treat you on this one?'}</p>
        </Card>
    );
}
