import { type GigView, isLive } from '@shared/schemas';
import { liveKey, Loading, Say } from '@/components/common';
import { GigCard } from '@/components/gig-card';
import { PageTabs } from '@/components/ui/tabs';
import { useGigs } from '@/lib/api';

/**
 * Pending gigs only reach people who can see them: admins (not in player view), and fixers
 * for their own. So that tab only shows for them, when there's something in it.
 */
const TABS: { key: string; label: string; filter: (gig: GigView) => boolean }[] = [
    { key: 'live', label: 'Live', filter: (g) => isLive(g.status) },
    { key: 'pending', label: 'Pending', filter: (g) => g.status === 'pending' || g.status === 'rejected' },
    { key: 'old', label: 'Old gigs', filter: (g) => g.status === 'completed' || g.status === 'cancelled' },
];

export function Board() {
    const { data: gigs, isPending } = useGigs();
    if (isPending) return <Loading>pulling contracts...</Loading>;

    return (
        <PageTabs
            empty={<Say>nothing on the wire.</Say>}
            tabs={TABS.map((t) => {
                const list = gigs?.filter(t.filter) ?? [];
                return {
                    key: t.key,
                    label: t.label,
                    count: list.length,
                    content: (
                        <div className="card-rows sm:[--cols:2] lg:[--cols:3] xl:[--cols:4]">
                            {list.map((g) => (
                                <GigCard key={liveKey(g.id, g)} gig={g} />
                            ))}
                        </div>
                    ),
                };
            })}
        />
    );
}
