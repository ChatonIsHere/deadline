import type { GigStatus, Review } from '@shared/schemas';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArtGallery } from '@/components/art';
import { ConfirmButton, Live, liveKey, Loading, Say } from '@/components/common';
import { Markdown } from '@/components/markdown';
import { RatingLine, RunnerAvatar, RunnerChip, Stars } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useRunner, useUser } from '@/lib/api';
import { useTimeZone } from '@/lib/time';
import { cn } from '@/lib/utils';
import { GigList, GigTiles } from '@/pages/runner';

/** Done with: these go in the list beside the tiles. */
const FINISHED: GigStatus[] = ['completed', 'cancelled', 'rejected'];

/**
 * A fixer's profile: the business side of a character. Office, specialties, how to reach
 * them, ratings and the gigs they've put out. Their runner side (roles, crews, gigs run) is
 * on the runner profile, which player fixers link to.
 */
export function FixerPage() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: fixer, isError } = useRunner(id);
    const remove = useAction(() => api(`/api/runners/${fixer!.id}`, 'DELETE'), 'fixer deleted.', () => navigate('/fixers'));

    if (isError) return <Say>no such fixer.</Say>;
    if (!fixer) return <Loading>pulling records...</Loading>;
    // Not (or no longer) a fixer: their runner profile is all there is
    if (!fixer.isFixer) return <Navigate to={`/runners/${fixer.slug}`} replace />;
    // Handle and UUID links (gig pages use those) go to the fixer's own link
    if (id !== fixer.fixerSlug) return <Navigate to={`/fixers/${fixer.fixerSlug}`} replace />;

    const canManage = me.isAdmin || fixer.ownerId === me.id;
    const live = fixer.fixerGigs.filter((g) => !FINISHED.includes(g.status));
    const finished = fixer.fixerGigs.filter((g) => FINISHED.includes(g.status));
    const hasArt = fixer.artIds.length > 0;
    const fields = [
        { label: 'Office', value: fixer.officeLocation },
        { label: 'Specialties', value: fixer.specialties },
        { label: 'Reach them', value: fixer.contact },
    ].filter((f) => f.value);

    return (
        <div className="space-y-6">
            <Live value={[fixer.fixerName, fixer.tagline, fixer.imageId, fixer.rating, fixer.fixerGigs.length, fields, fixer.owner]}>
                <div className="cut-frame grid gap-6 p-5 [--cut:20px] [--frame:var(--color-accent)] sm:grid-cols-[12rem_minmax(0,1fr)] sm:p-6">
                    <RunnerAvatar runner={{ handle: fixer.fixerName, imageId: fixer.imageId }} framed className="aspect-square h-auto w-40 text-5xl sm:w-full" />
                    <div className="min-w-0 space-y-3">
                        <p className="text-xs tracking-widest text-muted-foreground">// FIXER</p>
                        <h1 className="text-3xl break-words text-accent">{fixer.fixerName}</h1>
                        {fixer.tagline && <p className="italic">{fixer.tagline}</p>}
                        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <RatingLine rating={fixer.rating} />
                            <span className="text-xs text-muted-foreground">
                                {fixer.fixerGigs.length} gig{fixer.fixerGigs.length === 1 ? '' : 's'} put out
                            </span>
                        </p>
                        {fields.length > 0 && (
                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 pt-1">
                                {fields.map((f) => (
                                    <div key={f.label} className="contents">
                                        <dt className="text-muted-foreground">{f.label}</dt>
                                        <dd className="break-words">{f.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                        <div className="flex flex-wrap gap-2 pt-2">
                            {fixer.owner && (
                                <Button asChild variant="outline" size="sm">
                                    <Link to={`/runners/${fixer.slug}`}>View runner profile</Link>
                                </Button>
                            )}
                            {canManage && (
                                <Button asChild variant="outline" size="sm">
                                    <Link to={fixer.ownerId ? `/runners/${fixer.slug}/edit` : `/fixers/${fixer.slug}/edit`}>Edit</Link>
                                </Button>
                            )}
                            {/* A player's fixer is their runner, so it's deleted from the runner profile */}
                            {canManage && !fixer.owner && (
                                <ConfirmButton
                                    size="sm"
                                    label="Delete"
                                    title={`Delete ${fixer.fixerName}?`}
                                    description="They're taken off any live gigs. Finished gigs keep the record."
                                    onConfirm={() => remove.mutate()}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </Live>
            {(hasArt || fixer.bio || fixer.reviews.length > 0) && (
                <div className={cn('grid items-start gap-6', hasArt && 'lg:grid-cols-[minmax(0,1fr)_22rem] 3xl:grid-cols-[minmax(0,1fr)_28rem]')}>
                    {/* Comes first so phones get it under their name. Wider, it's the right-hand column. */}
                    {hasArt && (
                        <div className="lg:col-start-2 lg:row-start-1">
                            <ArtGallery artIds={fixer.artIds} name={fixer.fixerName} />
                        </div>
                    )}
                    <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
                        {fixer.bio && (
                            <Live value={fixer.bio}>
                                <Card>
                                    <CardTitle>About</CardTitle>
                                    <Markdown text={fixer.bio} />
                                </Card>
                            </Live>
                        )}

                        {fixer.reviews.length > 0 && <Reviews reviews={fixer.reviews} />}
                    </div>
                </div>
            )}
            {/* Two thirds for what's on now, a third for what's done */}
            <div className="grid gap-6 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                    <GigTiles title="Live gigs" gigs={live} empty="nothing on right now." large />
                </div>
                {/* As tall as the tiles, with room for a few even when there are none */}
                <div className="relative lg:min-h-56">
                    <GigList title="Finished gigs" gigs={finished} empty="none finished yet." fill />
                </div>
            </div>
        </div>
    );
}

/** Reviews of the fixer's latest gigs, newest first. */
function Reviews({ reviews }: { reviews: Review[] }) {
    const tz = useTimeZone();
    return (
        <Card>
            <CardTitle>Latest reviews</CardTitle>
            <ul className="space-y-4">
                {reviews.map((r) => (
                    <li key={liveKey(r.gig.id + (r.by?.handle ?? ''), r)} className="live-in space-y-1">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Stars value={r.stars} />
                            <Link to={`/gigs/${r.gig.ref}`} className="hover:text-accent">
                                {r.gig.name}
                            </Link>
                            {r.by && <RunnerChip runner={r.by} />}
                            {r.at && <span className="ml-auto text-xs text-muted-foreground">{new Date(r.at).toLocaleDateString('en-GB', { timeZone: tz })}</span>}
                        </p>
                        {r.comment && <p className="border-l-3 border-accent pl-3 text-muted-foreground italic">{r.comment}</p>}
                    </li>
                ))}
            </ul>
        </Card>
    );
}
