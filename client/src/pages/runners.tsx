import type { RunnerSummary } from '@shared/schemas';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Help, LinkCard, Say } from '@/components/common';
import { PageActions } from '@/components/page-actions';
import { RatingLine, Roles, RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFixers, useRunners, useUser } from '@/lib/api';

/** Everyone's runners, with your own on their own tab. */
export function RunnersPage() {
    const me = useUser();
    const { data: runners, isPending } = useRunners();
    const mine = runners?.filter((r) => r.ownerId === me.id) ?? [];

    return (
        <div className="space-y-5">
            <PageActions>
                <Help>player characters. a player can have several and picks one when signing up for a gig.</Help>
                <Button asChild size="sm">
                    <Link to="/runners/new" aria-label="New runner">
                        <Plus className="size-4" /> <span className="sm:hidden">New</span>
                        <span className="hidden sm:inline">New runner</span>
                    </Link>
                </Button>
            </PageActions>
            <Tabs defaultValue="mine">
                <TabsList>
                    <TabsTrigger value="mine">
                        Mine <span className="text-xs opacity-60">{mine.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="all">
                        All <span className="text-xs opacity-60">{runners?.length}</span>
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="mine">
                    <RunnerGrid runners={mine} loading={isPending} empty="no runners yet. make one to start taking gigs." />
                </TabsContent>
                <TabsContent value="all">
                    <RunnerGrid runners={runners ?? []} loading={isPending} empty="no runners on the board yet." showPlayer />
                </TabsContent>
            </Tabs>
        </div>
    );
}

/** Fixers: player fixers (with the Discord fixer role) and NPC ones. */
export function FixersPage() {
    const me = useUser();
    const { data: fixers, isPending } = useFixers();

    return (
        <div className="space-y-5">
            <PageActions>
                <Help>runners with the Fixer role whose player has the fixer role in Discord, plus NPC fixers. rated by the runners who worked for them.</Help>
                {me.isAdmin && (
                    <Button asChild size="sm">
                        <Link to="/runners/new?npc=1" aria-label="New NPC fixer">
                            <Plus className="size-4" /> <span className="sm:hidden">NPC</span>
                            <span className="hidden sm:inline">NPC fixer</span>
                        </Link>
                    </Button>
                )}
            </PageActions>
            {isPending ? (
                <Say>pinging contacts...</Say>
            ) : fixers?.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {fixers.map((f) => (
                        <LinkCard key={f.id} to={`/fixers/${f.slug}`} className="flex gap-4">
                            <RunnerAvatar runner={f} className="size-20 text-2xl [--cut:8px]" />
                            <div className="min-w-0 space-y-1">
                                <h3 className="truncate text-lg">{f.handle}</h3>
                                {f.officeLocation && <p className="truncate text-sm text-muted-foreground">{f.officeLocation}</p>}
                                {f.specialties && <p className="line-clamp-2 text-xs text-muted-foreground">{f.specialties}</p>}
                                <RatingLine rating={f.rating} />
                                <p className="text-xs text-muted-foreground">
                                    {f.gigCount} gig{f.gigCount === 1 ? '' : 's'} · {f.owner ? f.owner.name : 'NPC'}
                                </p>
                            </div>
                        </LinkCard>
                    ))}
                </div>
            ) : (
                <Say>no fixers yet. a runner with the Fixer role shows here once their player has the Discord fixer role.</Say>
            )}
        </div>
    );
}

function RunnerGrid({ runners, loading, empty, showPlayer }: { runners: RunnerSummary[]; loading: boolean; empty: string; showPlayer?: boolean }) {
    if (loading) return <Say>pulling records...</Say>;
    if (!runners.length) return <Say>{empty}</Say>;
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runners.map((r) => (
                <LinkCard key={r.id} to={`/runners/${r.slug}`} className="flex items-center gap-4">
                    <RunnerAvatar runner={r} className="size-16 text-2xl [--cut:8px]" />
                    <div className="min-w-0 space-y-1.5">
                        <h3 className="truncate text-lg">{r.handle}</h3>
                        <Roles runner={r} />
                        {showPlayer && r.owner && <p className="truncate text-xs text-muted-foreground">{r.owner.name}</p>}
                    </div>
                </LinkCard>
            ))}
        </div>
    );
}
