import type { Review } from '@shared/schemas';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ConfirmButton, Live, liveKey, Loading, Say } from '@/components/common';
import { Markdown } from '@/components/markdown';
import { RatingLine, RunnerAvatar, RunnerChip, Stars } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useRunner, useUser } from '@/lib/api';
import { useTimeZone } from '@/lib/time';
import { GigList } from '@/pages/runner';

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

    const canManage = me.isAdmin || fixer.ownerId === me.id;
    const fields = [
        { label: 'Office', value: fixer.officeLocation },
        { label: 'Specialties', value: fixer.specialties },
        { label: 'Reach them', value: fixer.contact },
    ].filter((f) => f.value);

    return (
        <div className="space-y-6">
            <Live value={[fixer.handle, fixer.imageId, fixer.rating, fixer.fixerGigs.length, fields, fixer.owner]}>
                <div className="cut-frame grid gap-6 p-5 [--cut:20px] [--frame:var(--color-accent)] sm:grid-cols-[12rem_minmax(0,1fr)] sm:p-6">
                    <RunnerAvatar runner={fixer} framed className="aspect-square h-auto w-40 text-5xl sm:w-full" />
                    <div className="min-w-0 space-y-3">
                        <p className="text-xs tracking-widest text-muted-foreground">// FIXER</p>
                        <h1 className="text-3xl break-words text-accent">{fixer.handle}</h1>
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
                                    title={`Delete ${fixer.handle}?`}
                                    description="They're taken off any live gigs. Finished gigs keep the record."
                                    onConfirm={() => remove.mutate()}
                                />
                            )}
                        </div>
                    </div>
                </div>
            </Live>

            {fixer.bio && (
                <Live value={fixer.bio}>
                    <Card>
                        <CardTitle>About</CardTitle>
                        <Markdown text={fixer.bio} />
                    </Card>
                </Live>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
                <GigList title="Gigs put out" gigs={fixer.fixerGigs} empty="no gigs yet." />
                {fixer.reviews.length > 0 && <Reviews reviews={fixer.reviews} />}
            </div>
        </div>
    );
}

/** A fixer's latest ratings, newest first. */
function Reviews({ reviews }: { reviews: Review[] }) {
    const tz = useTimeZone();
    return (
        <Card>
            <CardTitle>Latest ratings</CardTitle>
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
