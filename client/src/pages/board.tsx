import type { GigView, Me } from '@shared/schemas';
import { Say } from '@/components/common';
import { GigCard } from '@/components/gig-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGigs, useUser } from '@/lib/api';

interface Tab {
    key: string;
    label: string;
    show?: (me: Me) => boolean;
    filter: (gig: GigView, me: Me) => boolean;
}

const TABS: Tab[] = [
    { key: 'live', label: 'Live', filter: (g) => g.status === 'open' || g.status === 'closed' },
    {
        key: 'pending',
        label: 'Pending',
        show: (me) => me.isAdmin || me.isFixer,
        filter: (g) => g.status === 'pending' || g.status === 'rejected',
    },
    { key: 'mine', label: 'Mine', filter: (g, me) => g.createdBy.id === me.id || g.slots.some((s) => s.runner?.id === me.id) },
    { key: 'archive', label: 'Archive', filter: (g) => g.status === 'completed' || g.status === 'cancelled' },
];

export function Board() {
    const me = useUser();
    const { data: gigs, isPending } = useGigs();
    const tabs = TABS.filter((t) => !t.show || t.show(me));

    return (
        <Tabs defaultValue="live">
            <TabsList>
                {tabs.map((t) => (
                    <TabsTrigger key={t.key} value={t.key}>
                        {t.label} <span className="text-xs opacity-60">{gigs?.filter((g) => t.filter(g, me)).length}</span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {tabs.map((t) => {
                const list = gigs?.filter((g) => t.filter(g, me)) ?? [];
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
