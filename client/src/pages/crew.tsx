import { canManageCrew, isFounderRank } from '@shared/permissions';
import type { CrewView, RunnerCard } from '@shared/schemas';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmButton, Icon, Live, liveKey, Loading, Say } from '@/components/common';
import { RoleIcon, RunnerAvatar, RunnerChip, RunnerTile } from '@/components/runner';
import { FramePicker } from '@/components/frame-picker';
import { UploadButton } from '@/components/upload-button';
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
    // Off until asked for, like the Edit button on runners and fixers
    const [editing, setEditing] = useState(false);

    // The URL may hold the typed ID; the API calls below use the numeric one
    const url = `/api/crews/${crew?.id}`;
    const setRank = useAction(({ runnerId, rank }: { runnerId: string; rank: string }) => api(`${url}/members/${runnerId}`, 'PATCH', { rank }), 'rank changed.');
    const removeMember = useAction((runnerId: string) => api(`${url}/members/${runnerId}`, 'DELETE'), 'runner removed from the crew.');
    const removeAlly = useAction((runnerId: string) => api(`${url}/allies/${runnerId}`, 'DELETE'), 'ally removed.');
    const cancelInvite = useAction((runnerId: string) => api(`${url}/invites/${runnerId}`, 'DELETE'), 'invite cancelled.');
    const invite = useInvite(url);
    const remove = useAction(() => api(url, 'DELETE'), 'crew disbanded.', () => navigate('/crews'));

    if (isError) return <Say>no such crew.</Say>;
    if (!crew) return <Loading>scanning...</Loading>;

    const canManage = canManageCrew(me, crew);
    const editable = canManage && editing;

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] 3xl:grid-cols-[minmax(0,1fr)_28rem]">
                <div className="space-y-6">
                    <Live value={[crew.name, crew.tagline, crew.imageId, crew.members.length, crew.gigs.length, crew.hqIp]}>
                        <div className="cut-frame flex flex-wrap items-center gap-x-5 gap-y-3 p-5 [--cut:20px] [--frame:var(--color-accent)]">
                            {/* Phones: the logo sits here. Wider, it's big at the top of the right-hand column. */}
                            {crew.imageId ? (
                                <RunnerAvatar runner={{ handle: crew.name, imageId: crew.imageId }} framed className="h-auto w-24 lg:hidden" />
                            ) : (
                                <span className="cut grid size-24 shrink-0 place-items-center bg-muted [--cut:10px] lg:hidden">
                                    <Icon name="crew" className="size-12" />
                                </span>
                            )}
                            <div className="min-w-0 flex-[1_1_14rem]">
                                <h1 className="text-3xl break-words text-primary">{crew.name}</h1>
                                {crew.tagline && <p className="mt-1 text-muted-foreground italic">"{crew.tagline}"</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <p className="text-xs tracking-widest text-muted-foreground uppercase">
                                    {crew.members.length} runner{crew.members.length === 1 ? '' : 's'} · {crew.gigs.length} gig{crew.gigs.length === 1 ? '' : 's'}
                                </p>
                                {/* What the crew has, and its record, are on their own page */}
                                <Button asChild variant="outline" size="sm">
                                    <Link to={`/crews/${crew.slug}/hq`}>
                                        HQ IP <span className="text-primary">{crew.hqIp}</span>
                                    </Link>
                                </Button>
                                {canManage && (
                                    <Button variant={editing ? 'default' : 'outline'} size="sm" onClick={() => setEditing(!editing)}>
                                        {editing ? 'Done' : 'Edit'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </Live>
                    {!crew.members.length && <Say>no runners yet.</Say>}
                    {crew.ranks.map((rank) => {
                        const members = crew.members.filter((m) => m.rank === rank);
                        if (!members.length) return null;
                        return (
                            <section key={rank} className="@container space-y-3">
                                <h2 className="flex items-center gap-3 font-display text-xs tracking-widest text-accent uppercase">
                                    <span>{rank}</span>
                                    <span className="h-0.5 flex-1 bg-border" />
                                </h2>
                                <div className="grid grid-cols-1 gap-4 @[33rem]:grid-cols-2">
                                    {members.map((m) => {
                                        const leave = !canManage && m.ownerId === me.id && !isFounderRank(crew, m.rank);
                                        return (
                                            <div key={liveKey(m.id, m)} className="space-y-2">
                                                <RunnerTile runner={m} compact />
                                                {(editable || leave) && (
                                                    <div className="flex items-center justify-end gap-1">
                                                        {editable && (
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
                            </section>
                        );
                    })}
                </div>

                <div className="space-y-5">
                    {/* As big as the column allows. Phones have it in the header instead. */}
                    {crew.imageId ? (
                        <Live value={crew.imageId}>
                            <RunnerAvatar runner={{ handle: crew.name, imageId: crew.imageId }} framed className="h-auto w-full max-lg:hidden" />
                        </Live>
                    ) : (
                        <span className="cut grid aspect-square w-full place-items-center bg-muted [--cut:20px] max-lg:hidden">
                            <Icon name="crew" className="size-1/3" />
                        </span>
                    )}
                    <GigList title="Crew gigs" gigs={crew.gigs} empty="no gigs with crew slots yet." />

                    <Card className="space-y-3">
                        <CardTitle help="runners and fixers the crew knows and trusts, without them being in it. founders can invite an ally to join.">Allies</CardTitle>
                        {!crew.allies.length && <Say>no allies on file.</Say>}
                        <ul className="space-y-1">
                            {crew.allies.map((a) => {
                                const invited = crew.invites.some((i) => i.id === a.id);
                                return (
                                    <RunnerRow key={liveKey(a.id, a)} runner={a}>
                                        {editable && a.ownerId && (
                                            <Button variant="outline" size="sm" disabled={invited || invite.isPending} onClick={() => invite.mutate(a.id)}>
                                                {invited ? 'Invited' : 'Invite to crew'}
                                            </Button>
                                        )}
                                        {(editable || a.ownerId === me.id) && (
                                            <Button variant="ghost" size="icon" title="Remove" onClick={() => removeAlly.mutate(a.id)}>
                                                <X className="size-4" />
                                            </Button>
                                        )}
                                    </RunnerRow>
                                );
                            })}
                        </ul>
                        {editable && <AddAlly crew={crew} />}
                    </Card>

                    {editable && (
                        <>
                            <Card className="space-y-3">
                                <CardTitle>Invite a runner</CardTitle>
                                <InviteRunner crew={crew} isAdmin={me.isAdmin} onInvite={(runnerId) => invite.mutate(runnerId)} />
                            </Card>
                            {crew.invites.length > 0 && (
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
        </div>
    );
}

/** Invites by DM. Says so when the player's DMs are closed: they'll find it on their Me page. */
function useInvite(url: string) {
    return useAction(
        (runnerId: string) => api<{ dm: boolean }>(`${url}/invites`, 'POST', { runnerId }),
        ({ dm }) => (dm ? 'invite sent.' : "invite saved. it didn't go by DM (closed, or turned off), so they'll see it on their Me page."),
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
    const options = runners.filter((r) => r.status === 'active' && !taken.has(r.id));

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
    const options = [...runners, ...npcs].filter((r) => r.status === 'active' && !taken.has(r.id)).sort((a, b) => a.handle.localeCompare(b.handle));

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

/** Name, tagline, logo and ranks. The top rank can be renamed but stays on top. */
function EditCrew({ crew }: { crew: CrewView }) {
    const [name, setName] = useState(crew.name);
    const [tagline, setTagline] = useState(crew.tagline);
    const [imageId, setImageId] = useState(crew.imageId);
    const [ranks, setRanks] = useState(crew.ranks.map((r) => ({ name: r, was: r as string | null })));
    const save = useAction(() => api(`/api/crews/${crew.id}`, 'PATCH', { name, tagline, imageId, ranks }), 'crew saved.');
    // A copy of the logo in another frame. It takes effect on Save, like a new upload.
    const copyInFrame = async (variant: number) => (await api<{ imageId: string }>(`/api/crews/${crew.id}/frame`, 'POST', { imageId, variant })).imageId;

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
                    <Label help="a square picture, shown on the crew's page, the crew list, runner profiles and /crew in Discord.">Logo</Label>
                    <div className="flex items-center gap-3">
                        <RunnerAvatar runner={{ handle: name || '?', imageId }} large className="size-20 text-3xl [--cut:10px]" />
                        <div className="space-y-1">
                            <UploadButton options={{ kind: 'avatar' }} onUploaded={([id]) => setImageId(id)} />
                            {imageId && (
                                <Button type="button" variant="ghost" size="sm" onClick={() => setImageId(null)}>
                                    Remove logo
                                </Button>
                            )}
                        </div>
                    </div>
                    {imageId && (
                        <div className="mt-3 space-y-1.5">
                            <p className="text-xs text-muted-foreground">Frame</p>
                            <FramePicker imageId={imageId} copy={copyInFrame} onChange={setImageId} disabled={save.isPending} />
                        </div>
                    )}
                </div>
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

