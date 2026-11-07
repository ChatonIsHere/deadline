import type { FixerSummary, RunnerSummary } from '@shared/schemas';
import { LinkCard, Say } from '@/components/common';
import { RatingLine, RunnerTile } from '@/components/runner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { imageUrl, useFixers, useRunners, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Everyone's runners, with your own on a second tab. */
export function RunnersPage() {
    const me = useUser();
    const { data: runners, isPending } = useRunners();
    const mine = runners?.filter((r) => r.ownerId === me.id) ?? [];

    return (
        <div className="space-y-5">
            <Tabs defaultValue="all">
                <TabsList>
                    <TabsTrigger value="all">
                        All <span className="text-xs opacity-60">{runners?.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="mine">
                        Mine <span className="text-xs opacity-60">{mine.length}</span>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="all">
                    <RunnerGrid runners={runners ?? []} loading={isPending} empty="no runners on the board yet." />
                </TabsContent>
                <TabsContent value="mine">
                    <RunnerGrid runners={mine} loading={isPending} empty="no runners yet. make one to start taking gigs." />
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
                <Say>pinging contacts...</Say>
            ) : fixers?.length ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                    {fixers.map((f) => (
                        <FixerCard key={f.id} fixer={f} />
                    ))}
                </div>
            ) : (
                <Say>no fixers yet. a runner with the Fixer role shows here once their player has the Discord fixer role.</Say>
            )}
        </div>
    );
}

function RunnerGrid({ runners, loading, empty }: { runners: RunnerSummary[]; loading: boolean; empty: string }) {
    if (loading) return <Say>pulling records...</Say>;
    if (!runners.length) return <Say>{empty}</Say>;
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runners.map((r) => (
                <RunnerTile key={r.id} runner={r} />
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
                    <RatingLine rating={f.rating} className="flex-wrap justify-end gap-x-2 gap-y-0.5" />
                </div>
            </LinkCard>
        </div>
    );
}
