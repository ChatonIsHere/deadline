import type { GigView } from '@shared/schemas';
import { Icon, LinkCard, Pay, StatusBadge } from '@/components/common';
import { useFormatSession } from '@/lib/time';
import { mediumUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function GigCard({ gig }: { gig: GigView }) {
    const formatSession = useFormatSession();
    const taken = gig.slots.filter((s) => s.runner).length;
    // The picture runs to the card's edge, and the card's corner is cut to match the picture's
    // frame: 72 + 2 x 4 margin at 1280 wide, so 6.25% of the card's width (cqw of the wrapper)
    return (
        <div className="@container">
            <LinkCard to={`/gigs/${gig.ref}`} className={gig.imageId ? '[--cut:6.25cqw]' : undefined}>
                {gig.imageId && <img src={mediumUrl(gig.imageId)} alt="" loading="lazy" className="-mx-4 -mt-4 mb-3 aspect-video w-[calc(100%+2rem)] max-w-none object-cover" />}
                <div className="mb-2 flex items-center gap-2">
                    <StatusBadge status={gig.status} />
                    {gig.type && <span className="text-xs text-muted-foreground uppercase">{gig.type}</span>}
                </div>
                <h3 className="mb-2 text-lg leading-tight">{gig.name}</h3>
                <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Icon name="fixer" /> {gig.fixerName}
                    </span>
                    <span className="flex items-center gap-1">
                        <Icon name="location" /> {gig.location}
                    </span>
                    {gig.sessionAt && <span className="text-accent">{formatSession(gig.sessionAt)}</span>}
                </p>
                <div className="flex items-center justify-between gap-4">
                    <Pay gig={gig} />
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex gap-0.5">
                            {gig.slots.map((s) => (
                                <span key={s.id} className={cn('h-3 w-1.5', s.runner ? 'bg-primary' : 'bg-border')} />
                            ))}
                        </span>
                        {taken}/{gig.slots.length}
                    </span>
                </div>
            </LinkCard>
        </div>
    );
}
