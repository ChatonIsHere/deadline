import type { RunnerSummary } from '@shared/schemas';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Say } from '@/components/common';
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
            <div className="flex items-center gap-3">
                <h1 className="flex-1 text-3xl text-primary">Runners</h1>
                <Button asChild size="sm">
                    <Link to="/runners/new">
                        <Plus className="size-4" /> New runner
                    </Link>
                </Button>
            </div>
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
            <div className="flex items-center gap-3">
                <h1 className="flex-1 text-3xl text-primary">Fixers</h1>
                {me.isAdmin && (
                    <Button asChild size="sm">
                        <Link to="/runners/new?npc=1">
                            <Plus className="size-4" /> NPC fixer
                        </Link>
                    </Button>
                )}
            </div>
            {isPending ? (
                <Say>pinging contacts...</Say>
            ) : fixers?.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {fixers.map((f) => (
                        <Link key={f.id} to={`/runners/${f.id}`} className="cut-frame flex gap-4 p-4 transition-colors hover:[--frame:var(--color-primary)]">
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
                        </Link>
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
                <Link key={r.id} to={`/runners/${r.id}`} className="cut-frame flex items-center gap-4 p-4 transition-colors hover:[--frame:var(--color-primary)]">
                    <RunnerAvatar runner={r} className="size-16 text-2xl [--cut:8px]" />
                    <div className="min-w-0 space-y-1.5">
                        <h3 className="truncate text-lg">{r.handle}</h3>
                        <Roles runner={r} />
                        {showPlayer && r.owner && <p className="truncate text-xs text-muted-foreground">{r.owner.name}</p>}
                    </div>
                </Link>
            ))}
        </div>
    );
}
