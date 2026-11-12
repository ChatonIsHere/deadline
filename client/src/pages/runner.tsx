import type { GigLink, RunnerView } from '@shared/schemas';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArtGallery } from '@/components/art';
import { ConfirmButton, LinkCard, Live, liveKey, Loading, Person, Say, StatusBadge } from '@/components/common';
import { Markdown } from '@/components/markdown';
import { RetireControls } from '@/components/retire';
import { Roles, RunnerAvatar } from '@/components/runner';
import { StaggeredImage } from '@/components/staggered-image';
import { useFormatSession } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, thumbUrl, useAction, useRunner, useUser } from '@/lib/api';
import { usePhone } from '@/lib/media';

/**
 * A runner's profile: roles, player, crews and gigs run. Fixers have their own profile
 * (fixer.tsx), linked from here. Downtime has its own page (runner-downtime.tsx), linked for
 * their player and admins.
 */
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
    const hasCrews = runner.crews.length > 0;
    // With nothing written, the gigs sit beside the gallery instead of under it
    const hasText = !!(runner.bio || runner.obituary);

    const details = (
        <>
            <p className="text-xs text-muted-foreground">
                played by <Person member={runner.owner} />
            </p>
            {(canManage || runner.isFixer || runner.downtime) && (
                <div className="flex flex-wrap gap-2">
                    {runner.downtime && (
                        <Button asChild variant="outline" size="sm">
                            <Link to={`/runners/${runner.slug}/downtime`}>
                                Downtime <span className="text-primary">{runner.downtime.balance} DT</span>
                            </Link>
                        </Button>
                    )}
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
            {/* The same two columns as below, so the crews sit over the gallery */}
            <div className={cn('grid items-start gap-6', hasCrews && 'lg:grid-cols-[minmax(0,1fr)_22rem]')}>
                {/* Phones: picture and name side by side, the rest underneath. Wider: all beside the picture. */}
                <Live value={[runner.handle, runner.tagline, runner.role, runner.extraRoles, runner.imageId, runner.owner, runner.isFixer, runner.status]}>
                    <div className="min-w-0 space-y-4">
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
                {hasCrews && <RunnerCrews crews={runner.crews} />}
            </div>
            <div className={cn('grid items-start gap-6', hasArt && 'lg:grid-cols-[minmax(0,1fr)_22rem] 3xl:grid-cols-[minmax(0,1fr)_28rem]')}>
                {/* Comes first so phones get it under their name. Wider, it's the right-hand column. */}
                {hasArt && (
                    <div className="lg:col-start-2 lg:row-start-1">
                        <ArtGallery artIds={runner.artIds} name={runner.handle} gone={gone} />
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

                    {!hasText && <GigTiles gigs={runner.gigs} />}
                </div>
            </div>
            {/* The page's full width, for as many in a row as fit */}
            {hasText && <GigTiles gigs={runner.gigs} />}
        </div>
    );
}

/** How many gigs phones show before "show all". */
const PHONE_GIGS = 5;

/**
 * The gigs a runner has been on, newest first, as small cards: picture on top, name, status and
 * session under it. Up to ten in a row. Phones show the latest few until asked for the rest.
 */
function GigTiles({ gigs }: { gigs: GigLink[] }) {
    const phone = usePhone();
    const [all, setAll] = useState(false);
    const formatSession = useFormatSession();
    const shown = phone && !all ? gigs.slice(0, PHONE_GIGS) : gigs;
    return (
        <Card className="space-y-3">
            <CardTitle>Gigs run</CardTitle>
            {gigs.length ? (
                // As many as fit at 7.5rem or more, but never more than ten across
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(max(7.5rem,calc((100%_-_9*0.75rem)/10)),1fr))] gap-3">
                    {shown.map((g) => (
                        <li key={liveKey(g.id, g)} className="live-in">
                            <LinkCard to={`/gigs/${g.ref}`} className="flex h-full flex-col p-2 [--cut:8px]">
                                {g.imageId ? (
                                    <StaggeredImage src={thumbUrl(g.imageId)} className="-mx-2 -mt-2 mb-2 aspect-video w-[calc(100%+1rem)] max-w-none object-cover" />
                                ) : (
                                    <span className="-mx-2 -mt-2 mb-2 grid aspect-video w-[calc(100%+1rem)] place-items-center bg-muted font-display text-2xl text-primary">{g.name[0]?.toUpperCase()}</span>
                                )}
                                {/* Two lines kept for the name, so the rows line up */}
                                <h3 className="line-clamp-2 h-8 text-xs leading-4">{g.name}</h3>
                                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
                                    <StatusBadge status={g.status} />
                                    {g.sessionAt && <span className="text-[10px] text-muted-foreground">{formatSession(g.sessionAt)}</span>}
                                </div>
                            </LinkCard>
                        </li>
                    ))}
                </ul>
            ) : (
                <Say>no gigs yet.</Say>
            )}
            {shown.length < gigs.length && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setAll(true)}>
                    Show all {gigs.length}
                </Button>
            )}
        </Card>
    );
}

type RunnerCrew = RunnerView['crews'][number];

/** Two rows at most, to sit beside their picture. With three or more crews, the second row is just logos. */
function RunnerCrews({ crews }: { crews: RunnerCrew[] }) {
    return (
        <div className="space-y-3">
            <CrewBox key={liveKey(crews[0].id, crews[0])} crew={crews[0]} />
            {crews.length === 2 && <CrewBox key={liveKey(crews[1].id, crews[1])} crew={crews[1]} />}
            {crews.length > 2 && <CrewLogos crews={crews.slice(1)} />}
        </div>
    );
}

/** Five places: with more crews than that, the last one says how many are left. */
function CrewLogos({ crews }: { crews: RunnerCrew[] }) {
    const shown = crews.slice(0, crews.length > 5 ? 4 : 5);
    return (
        <div className="live-in cut-frame grid grid-cols-[repeat(5,minmax(0,3.5rem))] items-center gap-2 px-4 py-3 [--frame:var(--color-accent)]">
            {shown.map((c) => (
                <Link key={liveKey(c.id, c)} to={`/crews/${c.slug}`} title={`${c.name} · ${c.rank}`} aria-label={`${c.name}, ${c.rank}`} className="hover:opacity-80">
                    <RunnerAvatar runner={{ handle: c.name, imageId: c.imageId }} large className="aspect-square h-auto w-full text-2xl [--cut:8px]" />
                </Link>
            ))}
            {crews.length > shown.length && <span className="text-center text-xs text-muted-foreground">+{crews.length - shown.length}</span>}
        </div>
    );
}

/** A crew the runner is in: its logo and name, and their rank in it. */
function CrewBox({ crew }: { crew: RunnerCrew }) {
    return (
        <LinkCard to={`/crews/${crew.slug}`} className="live-in flex items-center gap-3 py-3 [--frame:var(--color-accent)]">
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
