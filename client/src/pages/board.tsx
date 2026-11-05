import type { GigView, Me } from '@shared/schemas';
import { useSearchParams } from 'react-router';
import { Say } from '@/components/common';
import { GigCard } from '@/components/gig-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGigs, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Tab {
    key: string;
    label: string;
    show?: (me: Me) => boolean;
    filter: (gig: GigView, me: Me) => boolean;
}

const isPast = (g: GigView) => g.status === 'completed' || g.status === 'cancelled';
const isMine = (g: GigView, me: Me) =>
    g.createdBy.id === me.id || g.fixerId === me.id || g.slots.some((s) => s.runner?.id === me.id) || g.reserves.some((r) => r.id === me.id);

// Past gigs only show when the toggle is on (see Board).
const TABS: Tab[] = [
    { key: 'live', label: 'Live', filter: (g) => g.status === 'open' || g.status === 'closed' || isPast(g) },
    {
        key: 'pending',
        label: 'Pending',
        show: (me) => me.isAdmin || me.isFixer,
        filter: (g) => g.status === 'pending' || g.status === 'rejected',
    },
    { key: 'mine', label: 'Mine', filter: isMine },
];

export function Board() {
    const me = useUser();
    const { data: gigs, isPending } = useGigs();
    const [params, setParams] = useSearchParams();
    const showPast = params.get('past') === '1';

    const tabs = TABS.filter((t) => !t.show || t.show(me));
    const listFor = (t: Tab) => gigs?.filter((g) => t.filter(g, me) && (showPast || !isPast(g))) ?? [];

    return (
        <Tabs defaultValue="live">
            <div className="flex flex-wrap items-end gap-x-4">
                <TabsList className="flex-1">
                    {tabs.map((t) => (
                        <TabsTrigger key={t.key} value={t.key}>
                            {t.label} <span className="text-xs opacity-60">{gigs && listFor(t).length}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>
                <button
                    type="button"
                    className={cn('mb-5 cursor-pointer text-xs tracking-wider uppercase hover:text-primary', showPast ? 'text-primary' : 'text-muted-foreground')}
                    onClick={() => setParams(showPast ? {} : { past: '1' }, { replace: true })}
                >
                    [{showPast ? 'x' : ' '}] show past gigs
                </button>
            </div>
            {tabs.map((t) => {
                const list = listFor(t);
                return (
                    <TabsContent key={t.key} value={t.key}>
                        {isPending ? (
                            <Say>pulling contracts...</Say>
                        ) : list.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {list.map((g) => (
                                    <GigCard key={g.id} gig={g} />
                                ))}
                            </div>
                        ) : (
                            <Say>nothing on the wire.</Say>
                        )}
                    </TabsContent>
                );
            })}
        </Tabs>
    );
}
