import type { GigView } from '@shared/schemas';
import { Link } from 'react-router';
import { Icon, Money, StatusBadge } from '@/components/common';
import { imageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function GigCard({ gig }: { gig: GigView }) {
    const taken = gig.slots.filter((s) => s.runner).length;
    return (
        <Link to={`/gigs/${gig.id}`} className="cut-frame block p-4 transition-colors hover:[--frame:var(--color-primary)]">
            {gig.imageId && <img src={imageUrl(gig.imageId)} alt="" loading="lazy" className="-mx-4 -mt-4 mb-3 aspect-video w-[calc(100%+2rem)] max-w-none object-cover" />}
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
            </p>
            <div className="flex items-center justify-between gap-4">
                <Money amount={gig.pay} />
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex gap-0.5">
                        {gig.slots.map((s) => (
                            <span key={s.id} className={cn('h-3 w-1.5', s.runner ? 'bg-primary' : 'bg-muted')} />
                        ))}
                    </span>
                    {taken}/{gig.slots.length}
                </span>
            </div>
        </Link>
    );
}
