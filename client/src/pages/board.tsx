import { type GigView, isLive, type Me } from '@shared/schemas';
import { liveKey, Loading, Say } from '@/components/common';
import { GigCard } from '@/components/gig-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGigs, useUser } from '@/lib/api';

interface Tab {
    key: string;
    label: string;
    show?: (me: Me, gigs: GigView[]) => boolean;
    filter: (gig: GigView, me: Me) => boolean;
}


const isPendingGig = (g: GigView) => g.status === 'pending' || g.status === 'rejected';

const isMine = (g: GigView, me: Me) =>
    g.createdBy.id === me.id || g.fixerId === me.id || g.slots.some((s) => s.runner?.ownerId === me.id) || g.reserves.some((r) => r.ownerId === me.id);

const TABS: Tab[] = [
    { key: 'live', label: 'Live', filter: (g) => isLive(g.status) },
    {
        key: 'pending',
        label: 'Pending',
        // Admins (not in player view, which turns isAdmin off), and anyone with a gig of their own waiting
        show: (me, gigs) => me.isAdmin || gigs.some((g) => isPendingGig(g) && g.createdBy.id === me.id),
        filter: isPendingGig,
    },
    // Anything of yours that isn't finished
    { key: 'mine', label: 'Mine', filter: (g, me) => isMine(g, me) && g.status !== 'completed' && g.status !== 'cancelled' },
    { key: 'old', label: 'Old gigs', filter: (g) => g.status === 'completed' || g.status === 'cancelled' },
];

export function Board() {
    const me = useUser();
    const { data: gigs, isPending } = useGigs();
    const tabs = TABS.filter((t) => !t.show || t.show(me, gigs ?? []));

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
                            <Loading>pulling contracts...</Loading>
                        ) : list.length ? (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {list.map((g) => (
                                    <GigCard key={liveKey(g.id, g)} gig={g} />
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
