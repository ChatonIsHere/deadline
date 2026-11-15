import type { GigView, Rewards } from '@shared/schemas';
import { useState } from 'react';
import { Link } from 'react-router';
import { Money, Say } from '@/components/common';
import { Markdown } from '@/components/markdown';
import { RunnerAvatar, RunnerChip, StarPicker } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { api, useAction } from '@/lib/api';

/** A finished gig's summary and rewards. */
export function DebriefCard({ gig }: { gig: GigView }) {
    const crew = gig.crewRewards;
    if (!crew) return null;
    return (
        <Card className="space-y-4 [--frame:var(--color-success)]">
            <CardTitle help="the GM's wrap-up. everyone on the gig got their cut by DM.">Debrief</CardTitle>
            {gig.summary ? <Markdown text={gig.summary} /> : <Say>no summary filed.</Say>}
            <div>
                <p className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">Crew rewards</p>
                <RewardLine rewards={crew} hqIp={crew.hqIp} />
                {gig.splitPay && !!crew.eb && <p className="mt-1 text-xs text-muted-foreground">split between {gig.slots.filter((s) => s.runner).length} runners</p>}
            </div>
            {gig.runnerRewards.length > 0 && (
                <ul className="space-y-2">
                    {gig.runnerRewards.map((r) => (
                        <li key={r.runner.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <RunnerChip runner={r.runner} />
                            {r.share !== null && <Money amount={r.share} />}
                            {(r.share === null || r.eb || r.ip || r.hqIp || r.text) && <RewardLine rewards={r} hqIp={r.hqIp} plus />}
                        </li>
                    ))}
                </ul>
            )}
            {gig.crewHqIp.length > 0 && (
                <div>
                    <p className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">HQ IP</p>
                    <ul className="space-y-1">
                        {gig.crewHqIp.map((c) => (
                            <li key={c.crew.id} className="flex items-center gap-2">
                                <Link to={`/crews/${c.crew.slug}`} className="flex min-w-0 items-center gap-2 hover:text-accent">
                                    <RunnerAvatar runner={{ handle: c.crew.name, imageId: c.crew.imageId }} />
                                    <span className="truncate">{c.crew.name}</span>
                                </Link>
                                <span className="text-success">+{c.hqIp}</span>
                            </li>
                        ))}
                    </ul>
                </div>
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
        hqIp ? <span key="hq">{`${p}${hqIp} HQ IP`}</span> : null,
        rewards.text ? <span key="text">{rewards.text}</span> : null,
    ].filter(Boolean);
    if (!parts.length) return <span className="text-muted-foreground">none</span>;
    return <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">{parts}</span>;
}

/**
 * Runners on a finished gig review it: stars for the gig and its fixer, and an optional note,
 * shown on the fixer's profile. Same as the menu in their payout DM.
 */
export function RateFixer({ gig }: { gig: GigView }) {
    const [stars, setStars] = useState(gig.myRating?.stars ?? null);
    const [comment, setComment] = useState(gig.myRating?.comment ?? '');
    const rate = useAction(() => api<{ message: string }>(`/api/gigs/${gig.id}/rating`, 'POST', { stars, comment }), ({ message }) => message);
    const changed = stars !== (gig.myRating?.stars ?? null) || comment.trim() !== (gig.myRating?.comment ?? '');
    return (
        <Card className="space-y-3">
            <CardTitle help={`anyone who had a runner on the gig can review it. the latest reviews show on ${gig.fixerName}'s fixer profile.`}>Review the gig</CardTitle>
            <StarPicker value={stars} onPick={setStars} disabled={rate.isPending} />
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} placeholder={`How did the job and ${gig.fixerName} treat you? (optional)`} />
            <div className="flex items-center gap-3">
                <Button size="sm" disabled={!stars || !changed || rate.isPending} onClick={() => rate.mutate()}>
                    {gig.myRating ? 'Update review' : 'Post review'}
                </Button>
                <p className="text-xs text-muted-foreground">{gig.myRating ? 'You can change it any time.' : `Stars for the gig and ${gig.fixerName}.`}</p>
            </div>
        </Card>
    );
}
