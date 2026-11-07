import { canDeleteGig, canEditGig, NEXT_STATUSES } from '@shared/permissions';
import { type GigStatus, isLive } from '@shared/schemas';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmButton, DiscordIcon, Icon, Live, Money, Pay, Say, StatusBadge } from '@/components/common';
import { DebriefCard, RateFixer } from '@/components/debrief';
import { Markdown } from '@/components/markdown';
import { RunnerAvatar } from '@/components/runner';
import { AssignRunner, SessionCard, SignUp } from '@/components/session';
import { SlotList } from '@/components/slot-list';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, imageUrl, useAction, useGig, useUser } from '@/lib/api';

const STATUS_ACTIONS: Record<string, { label: string; confirm?: string }> = {
    open: { label: 'Reopen sign-ups' },
    closed: { label: 'Lock sign-ups' },
    // Opens the debrief page rather than changing status here
    completed: { label: 'Mark complete' },
    cancelled: { label: 'Cancel gig', confirm: 'The Discord post gets locked and archived.' },
};

export function Gig() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: gig, isError } = useGig(id);

    // The address bar holds the gig's link (or UUID); changes go to its numeric ID
    const url = `/api/gigs/${gig?.id}`;
    const approve = useAction(() => api(`${url}/approve`, 'POST'), 'approved. posting to discord.');
    const reject = useAction(() => api(`${url}/reject`, 'POST'), 'contract rejected.');
    const setStatus = useAction((status: GigStatus) => api(`${url}/status`, 'POST', { status }), 'status updated.');
    const kick = useAction((slotId: string) => api(`${url}/slots/${slotId}/runner`, 'DELETE'), 'runner removed.');
    const unreserve = useAction((userId: string) => api(`${url}/reserves/${userId}`, 'DELETE'), 'removed from the reserves.');
    const openCrew = useAction((crewId: string) => api(`${url}/open-slots`, 'POST', { crewId }), 'slots opened to freelancers.');
    const remove = useAction(() => api(url, 'DELETE'), 'contract deleted.', () => navigate('/gigs'));

    if (isError) return <Say>no such contract.</Say>;
    if (!gig) return <Say>decrypting...</Say>;

    const owner = { createdBy: gig.createdBy.id, status: gig.status };
    const nextStatuses = me.isAdmin ? NEXT_STATUSES[gig.status] : [];
    const canDelete = canDeleteGig(me, owner);
    const active = isLive(gig.status);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start gap-4">
                <Live value={[gig.status, gig.type, gig.name]}>
                    <div className="min-w-0 flex-[1_1_16rem]">
                        <div className="mb-2 flex items-center gap-2">
                            <StatusBadge status={gig.status} />
                            {gig.type && <span className="text-xs text-muted-foreground uppercase">{gig.type}</span>}
                        </div>
                        <h1 className="text-3xl break-words text-primary">{gig.name}</h1>
                    </div>
                </Live>
                <div className="flex flex-wrap gap-2">
                    {gig.threadUrl && (
                        // Just the logo on phones, so it doesn't crowd the title
                        <Button asChild variant="accent" className="max-sm:px-3">
                            <a href={gig.threadUrl} target="_blank" rel="noreferrer" title="Open in Discord" aria-label="Open in Discord">
                                <DiscordIcon className="size-5" />
                                <span className="max-sm:hidden">Open in Discord</span>
                                <ExternalLink className="size-4 max-sm:hidden" />
                            </a>
                        </Button>
                    )}
                    {canEditGig(me, owner) && (
                        <Button asChild variant="outline">
                            <Link to={`/gigs/${gig.ref}/edit`}>Edit</Link>
                        </Button>
                    )}
                </div>
            </div>

            {gig.status === 'pending' && (
                <div className="cut-frame flex flex-wrap items-center gap-3 p-4 [--frame:var(--color-primary)]">
                    <Say className="flex-1">
                        {me.isAdmin ? `${gig.fixerName} wants this on the board. approve to post it.` : 'waiting on admin sign-off. not posted yet.'}
                    </Say>
                    {me.isAdmin && (
                        <>
                            <Button onClick={() => approve.mutate()}>Approve</Button>
                            <ConfirmButton label="Reject" title="Reject this gig?" description="The fixer will see it was rejected." onConfirm={() => reject.mutate()} />
                        </>
                    )}
                </div>
            )}
            {gig.status === 'rejected' && <Say className="text-destructive">contract rejected by admin.</Say>}

            <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
                <div className="space-y-5">
                    {gig.imageId && (
                        <Live value={gig.imageId}>
                            <img src={imageUrl(gig.imageId)} alt="" className="aspect-video w-full object-cover" />
                        </Live>
                    )}
                    {gig.status === 'completed' && <DebriefCard gig={gig} />}
                    {gig.canRate && <RateFixer gig={gig} />}
                    <Live value={gig.brief}>
                        <Card>
                            <CardTitle>Brief</CardTitle>
                            <Markdown text={gig.brief} />
                        </Card>
                    </Live>
                    {gig.primaryObjective.length > 0 && (
                        <Live value={[gig.primaryObjective, gig.pay]}>
                            <Card>
                                <CardTitle className="flex items-center gap-2">
                                    <Icon name="objective" /> Primary objective
                                </CardTitle>
                                {/* One payout for the whole thing, however many parts */}
                                <div className="flex justify-between gap-4">
                                    <ul className="space-y-2">
                                        {gig.primaryObjective.map((part, i) => (
                                            <li key={i}>
                                                - <Markdown inline text={part} />
                                            </li>
                                        ))}
                                    </ul>
                                    <Money amount={gig.pay} className="shrink-0 self-start" />
                                </div>
                            </Card>
                        </Live>
                    )}
                    {gig.objectives.length > 0 && (
                        <Live value={gig.objectives}>
                            <Card>
                                <CardTitle className="flex items-center gap-2">
                                    <Icon name="bonus" /> Secondary objectives
                                </CardTitle>
                                <ul className="space-y-2">
                                    {gig.objectives.map((o, i) => (
                                        <li key={i} className="flex justify-between gap-4">
                                            {/* Players get no text for an undisclosed one; admins and its fixer see it, marked */}
                                            {o.secret && !o.text ? (
                                                <span className="text-muted-foreground">- [ NOT DISCLOSED ]</span>
                                            ) : (
                                                <span>
                                                    - <Markdown inline text={o.text} />
                                                    {o.secret && <span className="ml-2 text-xs text-accent uppercase">not disclosed yet</span>}
                                                </span>
                                            )}
                                            {o.bonus && (
                                                <span className="flex shrink-0 items-center gap-1 self-start">
                                                    <span className="font-semibold text-primary">+</span>
                                                    <Money amount={o.bonus} />
                                                    {o.each && <span className="text-muted-foreground">each</span>}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        </Live>
                    )}
                </div>

                <div className="space-y-5">
                    <Live value={[gig.fixerName, gig.fixerRunnerId, gig.fixerImageId, gig.location, gig.pay, gig.objectives]}>
                        <Card className="space-y-2">
                            <CardTitle>Details</CardTitle>
                            <Detail
                                icon="fixer"
                                label="Fixer"
                                value={
                                    gig.fixerRunnerId ? (
                                        <Link to={`/fixers/${gig.fixerRunnerId}`} className="inline-flex items-center gap-2 text-accent hover:underline">
                                            <RunnerAvatar runner={{ handle: gig.fixerName, imageId: gig.fixerImageId }} />
                                            {gig.fixerName}
                                        </Link>
                                    ) : (
                                        gig.fixerName
                                    )
                                }
                            />
                            <Detail icon="location" label="Location" value={gig.location} />
                            <Detail icon="eb" label="Pay" value={<Pay gig={gig} />} />
                        </Card>
                    </Live>

                    {(active || gig.status === 'pending' || gig.sessionAt) && <SessionCard key={gig.sessionAt ?? 'none'} gig={gig} canSet={me.isAdmin && (active || gig.status === 'pending')} />}

                    <Card>
                        <Live value={[gig.slots.filter((s) => s.runner).length, gig.slots.length]}>
                            <CardTitle
                                className="flex items-center gap-2"
                                help="runners hold a slot while the session time is being sorted, then confirm once it's set. when the slots are full, sign-ups wait on the reserves in order."
                            >
                                <Icon name="crew" /> Crew {gig.slots.filter((s) => s.runner).length}/{gig.slots.length}
                            </CardTitle>
                        </Live>
                        <SlotList
                            gig={gig}
                            onKick={me.isAdmin && active ? (slotId) => kick.mutate(slotId) : undefined}
                            onUnreserve={me.isAdmin && active ? (userId) => unreserve.mutate(userId) : undefined}
                            onOpenCrew={me.isAdmin && active ? (crewId) => openCrew.mutate(crewId) : undefined}
                        />
                        {me.isAdmin && gig.status === 'open' && <AssignRunner gig={gig} />}
                        {/* Your own place on it, and signing up, under the list */}
                        {me.isEdgerunner && active ? (
                            <div className="mt-4 border-t-2 border-border pt-4">
                                <SignUp gig={gig} userId={me.id} />
                            </div>
                        ) : (
                            gig.status === 'open' && <Say className="mt-4">runners can sign up here or on the Discord post.</Say>
                        )}
                    </Card>

                    {(nextStatuses.length > 0 || canDelete) && (
                        <Card className="flex flex-wrap gap-2">
                            <CardTitle className="w-full" help="status changes are posted in the gig's thread. completing or cancelling locks the post.">
                                Manage
                            </CardTitle>
                            {nextStatuses.map((status) => {
                                const action = STATUS_ACTIONS[status];
                                // Completing has its own form for the debrief and rewards
                                if (status === 'completed') {
                                    return (
                                        <Button key={status} asChild size="sm">
                                            <Link to={`/gigs/${gig.ref}/complete`}>{action.label}</Link>
                                        </Button>
                                    );
                                }
                                return action.confirm ? (
                                    <ConfirmButton
                                        key={status}
                                        size="sm"
                                        label={action.label}
                                        title={`${action.label}?`}
                                        description={action.confirm}
                                        variant={status === 'cancelled' ? 'destructive' : 'default'}
                                        onConfirm={() => setStatus.mutate(status)}
                                    />
                                ) : (
                                    <Button key={status} size="sm" variant="outline" onClick={() => setStatus.mutate(status)}>
                                        {action.label}
                                    </Button>
                                );
                            })}
                            {canDelete && (
                                <ConfirmButton size="sm" label="Delete" title="Delete this gig?" description="It's gone for good." onConfirm={() => remove.mutate()} />
                            )}
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}

function Detail({ icon, label, value }: { icon: string; label: string; value: ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            <Icon name={icon} />
            <span className="w-20 text-muted-foreground">{label}</span>
            <span>{value}</span>
        </div>
    );
}
