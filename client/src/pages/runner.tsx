import type { GigLink } from '@shared/schemas';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ConfirmButton, Icon, Person, Say, StatusBadge } from '@/components/common';
import { Roles, RunnerAvatar } from '@/components/runner';
import { useFormatSession } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useRunner, useUser } from '@/lib/api';

/** A runner's profile: roles, player, crews and gigs run. Fixers have their own profile (fixer.tsx), linked from here. */
export function RunnerPage() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: runner, isError } = useRunner(id);
    const remove = useAction(() => api(`/api/runners/${runner!.id}`, 'DELETE'), 'runner deleted.', () => navigate('/runners'));

    if (isError) return <Say>no such runner.</Say>;
    if (!runner) return <Say>pulling records...</Say>;
    // NPC fixers only exist as fixers
    if (!runner.owner) return <Navigate to={`/fixers/${runner.slug}`} replace />;

    const canManage = me.isAdmin || runner.ownerId === me.id;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start gap-5">
                <RunnerAvatar runner={runner} framed className="aspect-square h-auto w-40 text-5xl sm:w-48" />
                <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-xs tracking-widest text-muted-foreground">// RUNNER</p>
                    <h1 className="text-3xl break-words text-primary">{runner.handle}</h1>
                    <Roles runner={runner} />
                    <p className="text-xs text-muted-foreground">
                        played by <Person member={runner.owner} />
                    </p>
                    {runner.crews.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {runner.crews.map((c) => (
                                <Link
                                    key={c.id}
                                    to={`/crews/${c.slug}`}
                                    title="Crew"
                                    className="cut-frame inline-flex items-center gap-2 px-3 py-1.5 font-display text-sm tracking-wider text-accent uppercase [--cut:8px] [--frame:var(--color-accent)] hover:[--fill:var(--color-muted)]"
                                >
                                    <Icon name="crew" />
                                    {c.name}
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
                {(canManage || runner.isFixer) && (
                    <div className="flex flex-wrap gap-2">
                        {runner.isFixer && (
                            <Button asChild variant="outline" size="sm">
                                <Link to={`/fixers/${runner.slug}`}>View fixer profile</Link>
                            </Button>
                        )}
                        {canManage && (
                            <Button asChild variant="outline" size="sm">
                                <Link to={`/runners/${runner.slug}/edit`}>Edit</Link>
                            </Button>
                        )}
                        {canManage && (
                            <ConfirmButton
                                size="sm"
                                label="Delete"
                                title={`Delete ${runner.handle}?`}
                                description="They're taken off any live gigs. Finished gigs keep the record."
                                onConfirm={() => remove.mutate()}
                            />
                        )}
                    </div>
                )}
            </div>

            <GigList title="Gigs run" gigs={runner.gigs} empty="no gigs yet." />
        </div>
    );
}

export function GigList({ title, gigs, empty }: { title: string; gigs: GigLink[]; empty: string }) {
    const formatSession = useFormatSession();
    return (
        <Card>
            <CardTitle>{title}</CardTitle>
            {gigs.length ? (
                <ul className="space-y-2">
                    {gigs.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={g.status} />
                            <Link to={`/gigs/${g.ref}`} className="hover:text-primary">
                                {g.name}
                            </Link>
                            {g.sessionAt && <span className="ml-auto text-xs text-muted-foreground">{formatSession(g.sessionAt)}</span>}
                        </li>
                    ))}
                </ul>
            ) : (
                <Say>{empty}</Say>
            )}
        </Card>
    );
}
