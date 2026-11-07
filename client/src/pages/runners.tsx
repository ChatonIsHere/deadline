import type { FixerSummary, RunnerSummary } from '@shared/schemas';
import { LinkCard, liveKey, Loading, Say } from '@/components/common';
import { RatingLine, RunnerTile } from '@/components/runner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { imageUrl, useFixers, useRunners } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Runners taking gigs, and a Retired tab (retired and flatlined, latest first) once there are any. */
export function RunnersPage() {
    const { data: runners, isPending } = useRunners();
    const active = runners?.filter((r) => r.status === 'active') ?? [];
    const retired = (runners?.filter((r) => r.status !== 'active') ?? []).sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0));
    const activeGrid = <RunnerGrid runners={active} loading={isPending} empty="no runners on the board yet." />;

    if (!retired.length) return <div className="space-y-5">{activeGrid}</div>;
    return (
        <div className="space-y-5">
            <Tabs defaultValue="active">
                <TabsList>
                    <TabsTrigger value="active">
                        Active <span className="text-xs opacity-60">{active.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="retired">
                        Retired <span className="text-xs opacity-60">{retired.length}</span>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="active">{activeGrid}</TabsContent>
                <TabsContent value="retired">
                    <RunnerGrid runners={retired} loading={false} empty="" />
                </TabsContent>
            </Tabs>
        </div>
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
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
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

function RunnerGrid({ runners, loading, empty }: { runners: RunnerSummary[]; loading: boolean; empty: string }) {
    if (loading) return <Loading>pulling records...</Loading>;
    if (!runners.length) return <Say>{empty}</Say>;
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <LinkCard to={`/fixers/${f.slug}`} className={f.imageId ? 'flex h-full flex-col [--cut:11.1cqw]' : 'flex h-full flex-col'}>
                {f.imageId ? (
                    <img src={imageUrl(f.imageId)} alt="" loading="lazy" className={picture} />
                ) : (
                    <span className={cn(picture, 'grid place-items-center bg-muted font-display text-[40cqw] text-primary')}>{f.handle[0]?.toUpperCase()}</span>
                )}
                <h3 className="mb-1 truncate text-lg leading-tight">{f.handle}</h3>
                {f.specialties && <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{f.specialties}</p>}
                <div className="mt-auto flex justify-end text-right">
                    <RatingLine rating={f.rating} count={false} className="flex-wrap justify-end gap-x-2 gap-y-0.5" />
                </div>
            </LinkCard>
        </div>
    );
}
