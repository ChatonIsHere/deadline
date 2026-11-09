import type { GigLink, RunnerView } from '@shared/schemas';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArtGallery } from '@/components/art';
import { ConfirmButton, LinkCard, Live, liveKey, Loading, Person, Say, StatusBadge } from '@/components/common';
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
    const hasArt = runner.artIds.length > 0;
    const hasSide = hasArt || runner.crews.length > 0;

    const details = (
        <>
            <p className="text-xs text-muted-foreground">
                played by <Person member={runner.owner} />
            </p>
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
        <div className="space-y-6">
            {/* Phones: picture and name side by side, the rest underneath. Wider: all beside the picture. */}
            <Live value={[runner.handle, runner.tagline, runner.role, runner.extraRoles, runner.imageId, runner.owner, runner.isFixer, runner.status]}>
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
            <div className={cn('grid items-start gap-6', hasSide && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
                {/* Comes first so phones get it under their name. Wider, it's the right-hand column. */}
                {hasSide && (
                    <div className="space-y-4 lg:col-start-2 lg:row-start-1">
                        {runner.crews.map((c) => (
                            <CrewBox key={liveKey(c.id, c)} crew={c} />
                        ))}
                        {hasArt && <ArtGallery artIds={runner.artIds} name={runner.handle} gone={gone} />}
                    </div>
                )}
                <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
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
        </div>
    );
}

/** A crew the runner is in: its logo and name, and their rank in it. */
function CrewBox({ crew }: { crew: RunnerView['crews'][number] }) {
    return (
        <LinkCard to={`/crews/${crew.slug}`} className="live-in flex items-center gap-3 [--frame:var(--color-accent)]">
            <RunnerAvatar runner={{ handle: crew.name, imageId: crew.imageId }} large className="size-14 text-2xl [--cut:8px]" />
            <div className="min-w-0">
                <h2 className="truncate text-lg leading-tight text-accent">{crew.name}</h2>
                <p className="truncate font-display text-xs tracking-widest text-muted-foreground uppercase">{crew.rank}</p>
            </div>
        </LinkCard>
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
