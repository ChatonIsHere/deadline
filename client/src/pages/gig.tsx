import { canDeleteGig, canEditGig, NEXT_STATUSES } from '@shared/permissions';
import type { GigStatus } from '@shared/schemas';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmButton, Icon, Money, Person, Say, StatusBadge } from '@/components/common';
import { SlotList } from '@/components/slot-list';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useAction, useGig, useUser } from '@/lib/api';

const STATUS_ACTIONS: Record<string, { label: string; confirm?: string }> = {
    open: { label: 'Reopen sign-ups' },
    closed: { label: 'Lock sign-ups' },
    completed: { label: 'Mark complete', confirm: 'The Discord post gets locked and archived.' },
    cancelled: { label: 'Cancel gig', confirm: 'The Discord post gets locked and archived.' },
};

export function Gig() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: gig, isError } = useGig(id);

    const url = `/api/gigs/${id}`;
    const approve = useAction(() => api(`${url}/approve`, 'POST'), 'Approved. Posting to Discord.');
    const reject = useAction(() => api(`${url}/reject`, 'POST'), 'Rejected.');
    const setStatus = useAction((status: GigStatus) => api(`${url}/status`, 'POST', { status }), 'Status updated.');
    const kick = useAction((slotId: number) => api(`${url}/slots/${slotId}/runner`, 'DELETE'), 'Runner removed.');
    const remove = useAction(() => api(url, 'DELETE'), () => navigate('/'));

    if (isError) return <Say>no such contract.</Say>;
    if (!gig) return <Say>decrypting...</Say>;

    const owner = { createdBy: gig.createdBy.id, status: gig.status };
    const nextStatuses = me.isAdmin ? NEXT_STATUSES[gig.status] : [];
    const canDelete = canDeleteGig(me, owner);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                        <StatusBadge status={gig.status} />
                        {gig.type && <span className="text-xs text-muted-foreground uppercase">{gig.type}</span>}
                    </div>
                    <h1 className="text-3xl text-primary">{gig.name}</h1>
                    <p className="mt-2 text-muted-foreground">
                        Submitted by <Person member={gig.createdBy} />
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {gig.threadUrl && (
                        <Button asChild variant="accent">
                            <a href={gig.threadUrl} target="_blank" rel="noreferrer">
                                Open in Discord <ExternalLink className="size-4" />
                            </a>
                        </Button>
                    )}
                    {canEditGig(me, owner) && (
                        <Button asChild variant="outline">
                            <Link to={`/gigs/${gig.id}/edit`}>Edit</Link>
                        </Button>
                    )}
                </div>
            </div>

            {gig.status === 'pending' && (
                <div className="cut-frame flex flex-wrap items-center gap-3 p-4 [--frame:var(--color-primary)]">
                    <Say className="flex-1">
                        {me.isAdmin ? `${gig.createdBy.name} wants this on the board. approve to post it.` : 'waiting on admin sign-off. not posted yet.'}
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
                    <Card>
                        <CardTitle className="flex items-center gap-2">
                            <Icon name="objective" /> Primary objective
                        </CardTitle>
                        <p className="whitespace-pre-wrap">{gig.objective}</p>
                    </Card>
                    {gig.objectives.length > 0 && (
                        <Card>
                            <CardTitle className="flex items-center gap-2">
                                <Icon name="bonus" /> Secondary objectives
                            </CardTitle>
                            <ul className="space-y-2">
                                {gig.objectives.map((o, i) => (
                                    <li key={i} className="flex justify-between gap-4">
                                        <span>- {o.text}</span>
                                        {o.bonus && <Money amount={o.bonus} className="shrink-0" />}
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}
                </div>

                <div className="space-y-5">
                    <Card className="space-y-2">
                        <CardTitle>Details</CardTitle>
                        <Detail icon="fixer" label="Fixer" value={gig.fixerName} />
                        <Detail icon="location" label="Location" value={gig.location} />
                        <Detail icon="eb" label="Pay" value={<Money amount={gig.pay} />} />
                    </Card>

                    <Card>
                        <CardTitle className="flex items-center gap-2">
                            <Icon name="crew" /> Crew {gig.slots.filter((s) => s.runner).length}/{gig.slots.length}
                        </CardTitle>
                        <SlotList gig={gig} onKick={me.isAdmin ? (slotId) => kick.mutate(slotId) : undefined} />
                        {gig.status === 'open' && <Say className="mt-4 text-xs">sign up from the Discord post.</Say>}
                    </Card>

                    {(nextStatuses.length > 0 || canDelete) && (
                        <Card className="flex flex-wrap gap-2">
                            <CardTitle className="w-full">Manage</CardTitle>
                            {nextStatuses.map((status) => {
                                const action = STATUS_ACTIONS[status];
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
