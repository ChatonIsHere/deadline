import type { GigLink, Review } from '@shared/schemas';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmButton, Person, Say, StatusBadge } from '@/components/common';
import { Markdown } from '@/components/markdown';
import { RatingLine, Roles, RunnerAvatar, RunnerChip, Stars } from '@/components/runner';
import { formatSession } from '@/components/session';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useRunner, useUser } from '@/lib/api';

/** A runner's profile. Fixers also get their office, contacts, bio, rating and the gigs they've put out. */
export function RunnerPage() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: runner, isError } = useRunner(id);
    const remove = useAction(() => api(`/api/runners/${runner!.id}`, 'DELETE'), 'runner deleted.', () => navigate('/runners'));

    if (isError) return <Say>no such runner.</Say>;
    if (!runner) return <Say>pulling records...</Say>;

    const canManage = me.isAdmin || runner.ownerId === me.id;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start gap-5">
                <RunnerAvatar runner={runner} framed className="aspect-square h-auto w-40 text-5xl sm:w-48" />
                <div className="min-w-0 flex-1 space-y-2">
                    <h1 className="text-3xl break-words text-primary">{runner.handle}</h1>
                    <Roles runner={runner} />
                    <p className="text-xs text-muted-foreground">
                        {runner.owner ? (
                            <>
                                played by <Person member={runner.owner} />
                            </>
                        ) : (
                            'NPC'
                        )}
                    </p>
                    {runner.isFixer && <RatingLine rating={runner.rating} />}
                    {runner.crews.length > 0 && (
                        <p className="text-sm">
                            {runner.crews.map((c, i) => (
                                <span key={c.id}>
                                    {i > 0 && ', '}
                                    <Link to={`/crews/${c.slug}`} className="text-accent hover:underline">
                                        {c.name}
                                    </Link>
                                </span>
                            ))}
                        </p>
                    )}
                </div>
                {canManage && (
                    <div className="flex gap-2">
                        <Button asChild variant="outline" size="sm">
                            <Link to={runner.ownerId ? `/runners/${runner.slug}/edit` : `/fixers/${runner.slug}/edit`}>Edit</Link>
                        </Button>
                        <ConfirmButton
                            size="sm"
                            label="Delete"
                            title={`Delete ${runner.handle}?`}
                            description="They're taken off any live gigs. Finished gigs keep the record."
                            onConfirm={() => remove.mutate()}
                        />
                    </div>
                )}
            </div>

            {runner.isFixer && (runner.officeLocation || runner.specialties || runner.contact || runner.bio) && (
                <Card className="space-y-3">
                    <CardTitle>Fixer</CardTitle>
                    {runner.officeLocation && <Field label="Office" value={runner.officeLocation} />}
                    {runner.specialties && <Field label="Specialties" value={runner.specialties} />}
                    {runner.contact && <Field label="Reach them" value={runner.contact} />}
                    {runner.bio && <Markdown text={runner.bio} />}
                </Card>
            )}

            {runner.isFixer && runner.reviews.length > 0 && <Reviews reviews={runner.reviews} />}

            <div className="grid gap-5 lg:grid-cols-2">
                {runner.isFixer && <GigList title="Gigs put out" gigs={runner.fixerGigs} empty="no gigs yet." />}
                {runner.owner && <GigList title="Gigs run" gigs={runner.gigs} empty="no gigs yet." />}
            </div>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <p className="flex gap-3">
            <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
            <span>{value}</span>
        </p>
    );
}

function GigList({ title, gigs, empty }: { title: string; gigs: GigLink[]; empty: string }) {
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

/** A fixer's latest ratings, newest first. */
function Reviews({ reviews }: { reviews: Review[] }) {
    return (
        <Card>
            <CardTitle>Latest ratings</CardTitle>
            <ul className="space-y-4">
                {reviews.map((r) => (
                    <li key={r.gig.id + (r.by?.handle ?? '')} className="space-y-1">
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Stars value={r.stars} />
                            <Link to={`/gigs/${r.gig.ref}`} className="hover:text-primary">
                                {r.gig.name}
                            </Link>
                            {r.by && <RunnerChip runner={r.by} />}
                            {r.at && <span className="ml-auto text-xs text-muted-foreground">{new Date(r.at).toLocaleDateString('en-GB')}</span>}
                        </p>
                        {r.comment && <p className="border-l-2 border-accent pl-3 text-muted-foreground italic">{r.comment}</p>}
                    </li>
                ))}
            </ul>
        </Card>
    );
}
