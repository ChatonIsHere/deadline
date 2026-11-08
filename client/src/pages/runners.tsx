import type { FixerSummary, RunnerSummary } from '@shared/schemas';
import { LinkCard, liveKey, Loading, Say } from '@/components/common';
import { RatingLine, RunnerTile } from '@/components/runner';
import { PageTabs } from '@/components/ui/tabs';
import { imageUrl, useFixers, useRunners } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Runners taking gigs, and retired and flatlined ones (latest first). */
export function RunnersPage() {
    const { data: runners, isPending } = useRunners();
    if (isPending) return <Loading>pulling records...</Loading>;
    const active = runners?.filter((r) => r.status === 'active') ?? [];
    const retired = (runners?.filter((r) => r.status !== 'active') ?? []).sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0));

    return (
        <PageTabs
            empty={<Say>no runners on the board yet.</Say>}
            tabs={[
                { key: 'active', label: 'Active', count: active.length, content: <RunnerGrid runners={active} /> },
                { key: 'retired', label: 'Retired', count: retired.length, content: <RunnerGrid runners={retired} /> },
            ]}
        />
    );
}

/** Fixers: player fixers (with the Discord fixer role) and NPC ones. */
export function FixersPage() {
    const { data: fixers, isPending } = useFixers();

    return (
        <div className="space-y-5">
            {isPending ? (
                <Loading>pinging contacts...</Loading>
            ) : fixers?.length ? (
                <div className="card-rows [--cols:2] [--gap:0.75rem] sm:[--gap:1rem] lg:[--cols:3] xl:[--cols:5]">
                    {fixers.map((f) => (
                        <FixerCard key={liveKey(f.id, f)} fixer={f} />
                    ))}
                </div>
            ) : (
                <Say>no fixers yet. a runner with the Fixer role shows here once their player has the Discord fixer role.</Say>
            )}
        </div>
    );
}

function RunnerGrid({ runners }: { runners: RunnerSummary[] }) {
    return (
        <div className="card-rows sm:[--cols:2] lg:[--cols:3] 2xl:[--cols:4]">
            {runners.map((r) => (
                <RunnerTile key={liveKey(r.id, r)} runner={r} />
            ))}
        </div>
    );
}

/**
 * A fixer on the Fixers tab: their picture across the top, like a gig card, then name,
 * specialties, and the rating bottom right. The card's corner is cut to match the picture's frame: 51 + 2 x 3
 * margin at 512 wide, so 11.1% of the card's width (cqw of the wrapper).
 */
function FixerCard({ fixer: f }: { fixer: FixerSummary }) {
    const picture = '-mx-4 -mt-4 mb-3 aspect-square w-[calc(100%+2rem)] max-w-none';
    return (
        <div className="@container">
            <LinkCard to={`/fixers/${f.fixerSlug}`} className={f.imageId ? 'flex h-full flex-col [--cut:11.1cqw]' : 'flex h-full flex-col'}>
                {f.imageId ? (
                    <img src={imageUrl(f.imageId)} alt="" loading="lazy" className={picture} />
                ) : (
                    <span className={cn(picture, 'grid place-items-center bg-muted font-display text-[40cqw] text-primary')}>{f.fixerName[0]?.toUpperCase()}</span>
                )}
                <h3 className="mb-1 truncate text-lg leading-tight">{f.fixerName}</h3>
                {f.specialties && <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{f.specialties}</p>}
                <div className="mt-auto flex justify-end text-right">
                    <RatingLine rating={f.rating} count={false} className="flex-wrap justify-end gap-x-2 gap-y-0.5" />
                </div>
            </LinkCard>
        </div>
    );
}
