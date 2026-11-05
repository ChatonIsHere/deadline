import type { GigView } from '@shared/schemas';
import { groupSlots } from '@shared/slots';
import { X } from 'lucide-react';
import { Icon, Person } from '@/components/common';
import { Button } from '@/components/ui/button';

/** Who's on the gig, grouped by crew. Pass onKick to show remove buttons. */
export function SlotList({ gig, onKick }: { gig: GigView; onKick?: (slotId: number) => void }) {
    return (
        <div className="space-y-4">
            {groupSlots(gig.slots).map((group) => (
                <div key={group.crew?.id ?? 'any'}>
                    <p className="mb-1 font-display text-xs tracking-widest text-muted-foreground uppercase">
                        {group.crew ? group.crew.name : 'Any edgerunner'}
                    </p>
                    <ul className="space-y-1">
                        {group.slots.map((slot) => (
                            <li key={slot.id} className="flex min-h-8 items-center gap-2">
                                <Icon name={slot.runner ? 'slot_filled' : 'slot_open'} />
                                {slot.runner ? <Person member={slot.runner} /> : <span className="text-muted-foreground">open</span>}
                                {slot.runner && onKick && (
                                    <Button variant="ghost" size="icon" className="ml-auto" title="Remove" onClick={() => onKick(slot.id)}>
                                        <X className="size-4" />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
