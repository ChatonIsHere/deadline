import { canManageCrew, isFounderRank } from '@shared/permissions';
import type { CrewView, RunnerCard } from '@shared/schemas';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmButton, Icon, Live, liveKey, Say } from '@/components/common';
import { RoleIcon, RunnerChip, RunnerTile } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, useAction, useCrew, useFixers, useRunners, useUser } from '@/lib/api';
import { GigList } from '@/pages/runner';

export function Crew() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: crew, isError } = useCrew(id);

    // The URL may hold the typed ID; the API calls below use the numeric one
    const url = `/api/crews/${crew?.id}`;
    const setRank = useAction(({ runnerId, rank }: { runnerId: string; rank: string }) => api(`${url}/members/${runnerId}`, 'PATCH', { rank }), 'rank changed.');
    const removeMember = useAction((runnerId: string) => api(`${url}/members/${runnerId}`, 'DELETE'), 'runner removed from the crew.');
    const removeAlly = useAction((runnerId: string) => api(`${url}/allies/${runnerId}`, 'DELETE'), 'ally removed.');
    const cancelInvite = useAction((runnerId: string) => api(`${url}/invites/${runnerId}`, 'DELETE'), 'invite cancelled.');
    const invite = useInvite(url);
    const remove = useAction(() => api(url, 'DELETE'), 'crew disbanded.', () => navigate('/crews'));

    if (isError) return <Say>no such crew.</Say>;
    if (!crew) return <Say>scanning...</Say>;

    const canManage = canManageCrew(me, crew);

    return (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-6">
                <Live value={[crew.name, crew.tagline]}>
                    <div>
                        <h1 className="flex items-center gap-3 text-3xl text-primary">
                            <Icon name="crew" className="size-7" /> {crew.name}
                        </h1>
                        {crew.tagline && <p className="mt-1 text-muted-foreground italic">"{crew.tagline}"</p>}
                    </div>
                </Live>

                <section className="space-y-4">
                    <h2 className="text-xs text-accent">
                        Runners <span className="text-muted-foreground">{crew.members.length}</span>
                    </h2>
                    {!crew.members.length && <Say>no runners yet.</Say>}
                    {crew.ranks.map((rank) => {
                        const members = crew.members.filter((m) => m.rank === rank);
                        if (!members.length) return null;
                        return (
                            <div key={rank} className="space-y-2">
                                <p className="font-display text-xs tracking-widest text-muted-foreground uppercase">{rank}</p>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {members.map((m) => {
                                        const leave = !canManage && m.ownerId === me.id && !isFounderRank(crew, m.rank);
                                        return (
                                            <div key={liveKey(m.id, m)} className="space-y-2">
                                                <RunnerTile runner={m} />
                                                {(canManage || leave) && (
                                                    <div className="flex items-center justify-end gap-1">
                                                        {canManage && (
                                                            <>
                                                                <Select
                                                                    className="w-36"
                                                                    value={m.rank}
                                                                    onChange={(rank) => setRank.mutate({ runnerId: m.id, rank })}
                                                                    options={crew.ranks.map((r) => ({ value: r, label: r }))}
                                                                />
                                                                <Button variant="ghost" size="icon" title="Remove from the crew" onClick={() => removeMember.mutate(m.id)}>
                                                                    <X className="size-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                        {leave && (
                                                            <Button variant="ghost" size="sm" onClick={() => removeMember.mutate(m.id)}>
                                                                Leave
                                                            </Button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                    {canManage && (
                        <Card>
                            <InviteRunner crew={crew} isAdmin={me.isAdmin} onInvite={(runnerId) => invite.mutate(runnerId)} />
                        </Card>
                    )}
                </section>

                <Card className="space-y-3">
                    <CardTitle help="runners and fixers the crew knows and trusts, without them being in it. founders can invite an ally to join.">Allies</CardTitle>
                    {!crew.allies.length && <Say>no allies on file.</Say>}
                    <ul className="space-y-1">
                        {crew.allies.map((a) => {
                            const invited = crew.invites.some((i) => i.id === a.id);
                            return (
                                <RunnerRow key={liveKey(a.id, a)} runner={a}>
                                    {canManage && a.ownerId && (
                                        <Button variant="outline" size="sm" disabled={invited || invite.isPending} onClick={() => invite.mutate(a.id)}>
                                            {invited ? 'Invited' : 'Invite to crew'}
                                        </Button>
                                    )}
                                    {(canManage || a.ownerId === me.id) && (
                                        <Button variant="ghost" size="icon" title="Remove" onClick={() => removeAlly.mutate(a.id)}>
                                            <X className="size-4" />
                                        </Button>
                                    )}
                                </RunnerRow>
                            );
                        })}
                    </ul>
                    {canManage && <AddAlly crew={crew} />}
                </Card>

                {canManage && crew.invites.length > 0 && (
                    <Card className="space-y-3">
                        <CardTitle>Waiting on an answer</CardTitle>
                        <ul className="space-y-1">
                            {crew.invites.map((r) => (
                                <RunnerRow key={liveKey(r.id, r)} runner={r}>
                                    <Button variant="ghost" size="icon" title="Cancel invite" onClick={() => cancelInvite.mutate(r.id)}>
                                        <X className="size-4" />
                                    </Button>
                                </RunnerRow>
                            ))}
                        </ul>
                    </Card>
                )}
            </div>

            <div className="space-y-5">
                <GigList title="Crew gigs" gigs={crew.gigs} empty="no gigs with crew slots yet." />
                {canManage && (
                    <>
                        <EditCrew key={crew.ranks.join()} crew={crew} />
                        <ConfirmButton
                            label="Disband crew"
                            title={`Disband ${crew.name}?`}
                            description="Gig slots reserved for this crew open up to anyone."
                            onConfirm={() => remove.mutate()}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

/** Invites by DM. Says so when the player's DMs are closed: they'll find it on their Me page. */
function useInvite(url: string) {
    return useAction(
        (runnerId: string) => api<{ dm: boolean }>(`${url}/invites`, 'POST', { runnerId }),
        ({ dm }) => (dm ? 'invite sent.' : "invite saved. their DMs are closed, so they'll see it on their Me page."),
    );
}

function RunnerRow({ runner, children }: { runner: RunnerCard; children?: ReactNode }) {
    return (
        <li className="live-in flex min-h-9 flex-wrap items-center gap-2">
            <RoleIcon role={runner.role} />
            <RunnerChip runner={runner} />
            <span className="text-xs text-muted-foreground">{runner.role}</span>
            <span className="ml-auto flex items-center gap-1">{children}</span>
        </li>
    );
}

/** Founders invite a player's runner. Admins can also put them straight in. */
function InviteRunner({ crew, isAdmin, onInvite }: { crew: CrewView; isAdmin: boolean; onInvite: (runnerId: string) => void }) {
    const runners = useRunners().data ?? [];
    const [runnerId, setRunnerId] = useState('');
    const add = useAction(() => api(`/api/crews/${crew.id}/members`, 'POST', { runnerId }), 'runner added to the crew.', () => setRunnerId(''));
    const taken = new Set([...crew.members, ...crew.invites].map((r) => r.id));
    const options = runners.filter((r) => !taken.has(r.id));

    return (
        <div className="flex flex-wrap gap-2">
            <Select
                className="min-w-48 flex-1"
                value={runnerId}
                onChange={setRunnerId}
                placeholder="Invite a runner..."
                options={options.map((r) => ({ value: String(r.id), label: r.handle, hint: r.owner?.name }))}
            />
            <Button
                disabled={!runnerId}
                onClick={() => {
                    onInvite(runnerId);
                    setRunnerId('');
                }}
            >
                Invite
            </Button>
            {isAdmin && (
                <Button variant="outline" disabled={!runnerId || add.isPending} title="Admins only: no invite needed" onClick={() => add.mutate()}>
                    Add now
                </Button>
            )}
        </div>
    );
}

/** Any runner, or an NPC fixer. */
function AddAlly({ crew }: { crew: CrewView }) {
    const runners = useRunners().data ?? [];
    const npcs = (useFixers().data ?? []).filter((f) => !f.ownerId);
    const [runnerId, setRunnerId] = useState('');
    const add = useAction(() => api(`/api/crews/${crew.id}/allies`, 'POST', { runnerId }), 'ally added.', () => setRunnerId(''));
    const taken = new Set([...crew.members, ...crew.allies].map((r) => r.id));
    const options = [...runners, ...npcs].filter((r) => !taken.has(r.id)).sort((a, b) => a.handle.localeCompare(b.handle));

    return (
        <div className="flex gap-2">
            <Select
                value={runnerId}
                onChange={setRunnerId}
                placeholder="Add an ally..."
                options={options.map((r) => ({ value: String(r.id), label: r.handle, hint: r.owner?.name ?? 'NPC' }))}
            />
            <Button disabled={!runnerId || add.isPending} onClick={() => add.mutate()}>
                Add
            </Button>
        </div>
    );
}

/** Name, tagline and ranks. The top rank can be renamed but stays on top. */
function EditCrew({ crew }: { crew: CrewView }) {
    const [name, setName] = useState(crew.name);
    const [tagline, setTagline] = useState(crew.tagline);
    const [ranks, setRanks] = useState(crew.ranks.map((r) => ({ name: r, was: r as string | null })));
    const save = useAction(() => api(`/api/crews/${crew.id}`, 'PATCH', { name, tagline, ranks }), 'crew saved.');

    const setRank = (i: number, value: string) => setRanks(ranks.map((r, j) => (j === i ? { ...r, name: value } : r)));
    const move = (i: number, by: number) => {
        const next = [...ranks];
        [next[i], next[i + by]] = [next[i + by], next[i]];
        setRanks(next);
    };

    const submit = (e: FormEvent) => {
        e.preventDefault();
        save.mutate();
    };

    return (
        <Card>
            <CardTitle>Edit crew</CardTitle>
            <form onSubmit={submit} className="space-y-4">
                <div>
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
                </div>
                <div>
                    <Label htmlFor="tagline">Tagline</Label>
                    <Input id="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
                </div>
                <div className="space-y-2">
                    <Label help="the top rank runs the crew. new members join at the bottom rank. runners in a removed rank drop to the bottom.">Ranks</Label>
                    {ranks.map((r, i) => (
                        <div key={i} className="flex items-center gap-1">
                            <Input value={r.name} onChange={(e) => setRank(i, e.target.value)} maxLength={30} aria-label={`Rank ${i + 1}`} />
                            {i > 0 && (
                                <>
                                    <Button type="button" variant="ghost" size="icon" title="Up" disabled={i === 1} onClick={() => move(i, -1)}>
                                        <ArrowUp className="size-4" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="icon" title="Down" disabled={i === ranks.length - 1} onClick={() => move(i, 1)}>
                                        <ArrowDown className="size-4" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="icon" title="Remove" disabled={ranks.length <= 2} onClick={() => setRanks(ranks.filter((_, j) => j !== i))}>
                                        <X className="size-4" />
                                    </Button>
                                </>
                            )}
                        </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" disabled={ranks.length >= 10} onClick={() => setRanks([...ranks, { name: '', was: null }])}>
                        <Plus className="size-4" /> Add rank
                    </Button>
                </div>
                <Button type="submit" className="w-full" disabled={save.isPending || !name.trim() || ranks.some((r) => !r.name.trim())}>
                    Save
                </Button>
            </form>
        </Card>
    );
}
