import type { GigLink } from '@shared/schemas';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArtPanel } from '@/components/art';
import { ConfirmButton, Icon, Live, liveKey, Loading, Person, Say, StatusBadge } from '@/components/common';
import { DowntimePanel } from '@/components/downtime';
import { Markdown } from '@/components/markdown';
import { RetireControls } from '@/components/retire';
import { Roles, RunnerAvatar } from '@/components/runner';
import { useFormatSession } from '@/lib/time';
import { cn } from '@/lib/utils';
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
    if (!runner) return <Loading>pulling records...</Loading>;
    // NPC fixers only exist as fixers
    if (!runner.owner) return <Navigate to={`/fixers/${runner.fixerSlug}`} replace />;

    const canManage = me.isAdmin || runner.ownerId === me.id;
    const gone = runner.status !== 'active';

    const details = (
        <>
            <p className="text-xs text-muted-foreground">
                played by <Person member={runner.owner} />
            </p>
            {runner.crews.length > 0 && (
                <div className="flex flex-wrap gap-2">
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
            {(canManage || runner.isFixer) && (
                <div className="flex flex-wrap gap-2">
                    {runner.isFixer && (
                        <Button asChild variant="outline" size="sm">
                            <Link to={`/fixers/${runner.fixerSlug}`}>View fixer profile</Link>
                        </Button>
                    )}
                    {canManage && (
                        <Button asChild variant="outline" size="sm">
                            <Link to={`/runners/${runner.slug}/edit`}>Edit</Link>
                        </Button>
                    )}
                    {canManage && <RetireControls runner={runner} isAdmin={me.isAdmin} />}
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
        </>
    );

    return (
        <div className={cn('grid items-start gap-6', runner.artId && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
            {runner.artId && (
                <div className="max-lg:hidden lg:col-start-2 lg:row-start-1">
                    <ArtPanel artId={runner.artId} name={runner.handle} gone={gone} />
                </div>
            )}
            <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
                {/* Phones: picture and name side by side, the rest underneath. Wider: all beside the picture. */}
                <Live value={[runner.handle, runner.tagline, runner.role, runner.extraRoles, runner.imageId, runner.owner, runner.crews, runner.isFixer, runner.status]}>
                    <div className="space-y-4">
                        <div className="flex items-start gap-4 sm:gap-5">
                            <RunnerAvatar runner={runner} framed className={cn('aspect-square h-auto w-28 shrink-0 text-4xl sm:w-48 sm:text-5xl', gone && 'grayscale')} />
                            <div className="min-w-0 flex-1 space-y-2 sm:space-y-3">
                                <p className="text-xs tracking-widest text-muted-foreground">
                                    // RUNNER
                                    {gone && <span className={runner.status === 'dead' ? 'text-destructive' : undefined}>{runner.status === 'dead' ? ' · FLATLINED' : ' · RETIRED'}</span>}
                                </p>
                                <h1 className={cn('text-2xl break-words sm:text-3xl', gone ? 'text-muted-foreground' : 'text-primary')}>{runner.handle}</h1>
                                {runner.tagline && <p className="text-accent italic">{runner.tagline}</p>}
                                <Roles runner={runner} />
                                <div className="hidden space-y-3 sm:block">{details}</div>
                            </div>
                        </div>
                        <div className="space-y-3 sm:hidden">{details}</div>
                    </div>
                </Live>

                {/* On phones it goes under their name, not above it */}
                {runner.artId && (
                    <div className="lg:hidden">
                        <ArtPanel artId={runner.artId} name={runner.handle} gone={gone} />
                    </div>
                )}

                {runner.obituary && (
                    <Live value={runner.obituary}>
                        <Card className="[--frame:var(--color-destructive)]">
                            <CardTitle>Obituary</CardTitle>
                            <Markdown text={runner.obituary} />
                        </Card>
                    </Live>
                )}

                {runner.bio && (
                    <Live value={runner.bio}>
                        <Card>
                            <CardTitle>About</CardTitle>
                            <Markdown text={runner.bio} />
                        </Card>
                    </Live>
                )}

                <DowntimePanel runner={runner} />

                <GigList title="Gigs run" gigs={runner.gigs} empty="no gigs yet." />
            </div>
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
                        <li key={liveKey(g.id, g)} className="live-in flex flex-wrap items-center gap-2">
                            <StatusBadge status={g.status} />
                            <Link to={`/gigs/${g.ref}`} className="hover:text-accent">
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
