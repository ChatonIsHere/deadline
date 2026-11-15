import type { FixerSummary, Rating, RunnerSummary } from '@shared/schemas';
import { CardPages } from '@/components/card-pages';
import { LinkCard, liveKey, Loading, Say } from '@/components/common';
import { RatingLine, RunnerAvatar, RunnerTile, Stars } from '@/components/runner';
import { StaggeredImage } from '@/components/staggered-image';
import { PageTabs } from '@/components/ui/tabs';
import { imageUrl, useFixers, useRunners, useUser } from '@/lib/api';
import { usePhone } from '@/lib/media';
import { cn } from '@/lib/utils';

/** Runners taking gigs (yours first, then by name), and retired and flatlined ones (latest first). */
export function RunnersPage() {
    const me = useUser();
    const { data: runners, isPending } = useRunners();
    if (isPending) return <Loading>pulling records...</Loading>;
    const mine = (r: RunnerSummary) => (r.ownerId === me.id ? 0 : 1);
    const active = (runners?.filter((r) => r.status === 'active') ?? []).sort((a, b) => mine(a) - mine(b) || a.handle.localeCompare(b.handle));
    const retired = (runners?.filter((r) => r.status !== 'active') ?? []).sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0));

    return (
        <PageTabs
            empty={<Say>no runners on the board yet.</Say>}
            tabs={[
                { key: 'active', label: 'Active', count: active.length, content: <RunnerGrid id="runners-active" runners={active} /> },
                { key: 'retired', label: 'Retired', count: retired.length, content: <RunnerGrid id="runners-retired" runners={retired} /> },
            ]}
        />
    );
}

/** Best rated first (unrated last), then whoever had a gig on most recently, then by name. */
const byRatingThenActivity = (a: FixerSummary, b: FixerSummary) =>
    (b.rating.average ?? -1) - (a.rating.average ?? -1) || (b.lastGigAt ?? 0) - (a.lastGigAt ?? 0) || a.fixerName.localeCompare(b.fixerName);

/** Fixers: player fixers (with the Discord fixer role) and NPC ones. */
export function FixersPage() {
    const { data, isPending } = useFixers();
    const phone = usePhone();
    if (isPending) return <Loading>pinging contacts...</Loading>;
    const fixers = data && [...data].sort(byRatingThenActivity);
    if (!fixers?.length) return <Say>no fixers yet. a runner with the Fixer role shows here once their player has the Discord fixer role.</Say>;

    return (
        <CardPages
            id="fixers"
            items={fixers}
            className="card-rows [--gap:0.75rem] sm:[--gap:1rem] md:[--cols:2] xl:[--cols:3] 3xl:[--cols:4]"
            card={(f) => (phone ? <FixerMiniCard key={liveKey(f.id, f)} fixer={f} /> : <FixerCard key={liveKey(f.id, f)} fixer={f} />)}
        />
    );
}

function RunnerGrid({ id, runners }: { id: string; runners: RunnerSummary[] }) {
    return <CardPages id={id} items={runners} className="card-rows md:[--cols:2] 3xl:[--cols:3]" card={(r) => <RunnerTile key={liveKey(r.id, r)} runner={r} />} />;
}

/** A fixer's stars running down the side of their picture, with the number at the bottom. */
function RatingColumn({ rating }: { rating: Rating }) {
    return (
        <div className="flex flex-1 flex-col items-center py-3 max-lg:hidden">
            <Stars value={rating.average ?? 0} className="flex-1 flex-col justify-evenly [&_svg]:size-6" />
            <span className="pt-1 font-display text-lg leading-none text-primary">{rating.average?.toFixed(1) ?? '-'}</span>
        </div>
    );
}

/** A fixer on a phone: a small picture with everything else beside it, matching a runner's card. */
function FixerMiniCard({ fixer: f }: { fixer: FixerSummary }) {
    return (
        <LinkCard to={`/fixers/${f.fixerSlug}`} className="flex items-start gap-3 p-3">
            <RunnerAvatar runner={{ handle: f.fixerName, imageId: f.imageId }} large className="size-24 text-4xl [--cut:12px]" />
            <div className="min-w-0 flex-1 space-y-0.5">
                <h3 className="truncate text-lg leading-tight">{f.fixerName}</h3>
                {f.tagline && <p className="truncate text-xs text-accent">{f.tagline}</p>}
                {f.specialties && <p className="line-clamp-2 text-xs text-muted-foreground">{f.specialties}</p>}
                <RatingLine rating={f.rating} count={false} />
            </div>
        </LinkCard>
    );
}

/**
 * A fixer on the Fixers tab: their picture across the top, then name and specialties.
 *
 * Wider screens: the picture stays the size it'd be a column narrower, and the room beside it
 * holds the rating. Narrower: it's the card's full width, the rating is bottom right, and the
 * card's corner is cut to match the picture's frame: 51 + 2 x 3 margin at 512 wide, so 11.1% of
 * the card's width (cqw of the wrapper).
 */
function FixerCard({ fixer: f }: { fixer: FixerSummary }) {
    const picture = 'aspect-square w-full shrink-0 lg:w-2/3 xl:w-3/4 3xl:w-4/5';
    return (
        <div className="@container">
            <LinkCard to={`/fixers/${f.fixerSlug}`} className={f.imageId ? 'flex h-full flex-col max-lg:[--cut:11.1cqw]' : 'flex h-full flex-col'}>
                <div className="-mx-4 -mt-4 mb-3 flex">
                    {f.imageId ? (
                        <StaggeredImage src={imageUrl(f.imageId)} className={picture} />
                    ) : (
                        // Cut like the card, or its corner covers the card's diagonal border
                        <span className={cn(picture, 'cut grid place-items-center bg-muted font-display text-[40cqw] text-primary lg:text-[30cqw]')}>{f.fixerName[0]?.toUpperCase()}</span>
                    )}
                    <RatingColumn rating={f.rating} />
                </div>
                {/* Room for a tagline and two lines of specialties on every card, so all rows are the
                    same height and the pages break in the same place whatever order they're in */}
                <h3 className="mb-1 truncate text-lg leading-tight">{f.fixerName}</h3>
                <p className="mb-1 h-4 truncate text-xs leading-4 text-accent">{f.tagline}</p>
                <p className="mb-3 line-clamp-2 h-10 text-sm leading-5 text-muted-foreground">{f.specialties}</p>
                <div className="mt-auto flex justify-end text-right lg:hidden">
                    <RatingLine rating={f.rating} count={false} className="flex-wrap justify-end gap-x-2 gap-y-0.5" />
                </div>
            </LinkCard>
        </div>
    );
}
