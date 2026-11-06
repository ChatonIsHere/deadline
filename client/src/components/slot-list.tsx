import type { GigView } from '@shared/schemas';
import { groupSlots } from '@shared/slots';
import { X } from 'lucide-react';
import { Icon } from '@/components/common';
import { RunnerChip } from '@/components/runner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFormatSession } from '@/lib/time';

/** Who's on the gig, grouped by crew, then the reserves. Pass the remove handlers to show admin buttons. */
export function SlotList({
    gig,
    onKick,
    onUnreserve,
    onOpenCrew,
}: {
    gig: GigView;
    onKick?: (slotId: string) => void;
    onUnreserve?: (userId: string) => void;
    /** Lets anyone take a crew's reserved slots. */
    onOpenCrew?: (crewId: string) => void;
}) {
    const formatSession = useFormatSession();
    const remove = (onClick: () => void) => (
        <Button variant="ghost" size="icon" className="ml-auto" title="Remove" onClick={onClick}>
            <X className="size-4" />
        </Button>
    );

    return (
        <div className="space-y-4">
            {groupSlots(gig.slots).map((group) => (
                <div key={group.crew?.id ?? 'any'}>
                    <div className="mb-1 flex items-center gap-2">
                        <p className="font-display text-xs tracking-widest text-muted-foreground uppercase">{group.crew ? group.crew.name : 'Freelance'}</p>
                        {group.crew && onOpenCrew && (
                            <button
                                type="button"
                                className="ml-auto cursor-pointer text-xs text-accent hover:underline"
                                title="Open these slots to freelancers"
                                onClick={() => onOpenCrew(group.crew!.id)}
                            >
                                open to anyone
                            </button>
                        )}
                    </div>
                    <ul className="space-y-1">
                        {group.slots.map((slot) => (
                            <li key={slot.id} className="flex min-h-8 items-center gap-2">
                                <Icon name={slot.runner ? 'slot_filled' : 'slot_open'} />
                                {slot.runner ? <RunnerChip runner={slot.runner} /> : <span className="text-muted-foreground">open</span>}
                                {slot.runner && gig.sessionAt && slot.state !== 'confirmed' && (
                                    <Badge variant="muted" title={slot.confirmBy ? `Dropped if not confirmed by ${formatSession(slot.confirmBy)}` : undefined}>
                                        {slot.state}
                                        {slot.confirmBy && ` · by ${formatSession(slot.confirmBy)}`}
                                    </Badge>
                                )}
                                {slot.runner && onKick && remove(() => onKick(slot.id))}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}

            {gig.reserves.length > 0 && (
                <div>
                    <p className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">Reserves</p>
                    <ol className="space-y-1">
                        {gig.reserves.map((r, i) => (
                            <li key={r.ownerId ?? r.id} className="flex min-h-8 items-center gap-2">
                                <span className="w-4 text-xs text-muted-foreground">{i + 1}.</span>
                                <RunnerChip runner={r} />
                                {onUnreserve && r.ownerId && remove(() => onUnreserve(r.ownerId!))}
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}
