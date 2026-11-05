import { canManageCrew } from '@shared/permissions';
import type { CrewView, RunnerSummary } from '@shared/schemas';
import { X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmButton, Icon, Person, Say } from '@/components/common';
import { RunnerChip } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, useAction, useCrew, useRunners, useUser } from '@/lib/api';

export function Crew() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: crew, isError } = useCrew(id);
    const runners = useRunners().data ?? [];

    const url = `/api/crews/${id}`;
    const removeMember = useAction((runnerId: number) => api(`${url}/members/${runnerId}`, 'DELETE'), 'Removed.');
    const remove = useAction(() => api(url, 'DELETE'), () => navigate('/crews'));

    if (isError) return <Say>no such crew.</Say>;
    if (!crew) return <Say>scanning...</Say>;

    const canManage = canManageCrew(me, { ownerId: crew.owner.id });

    return (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-5">
                <div>
                    <h1 className="flex items-center gap-3 text-3xl text-primary">
                        <Icon name="crew" className="size-7" /> {crew.name}
                    </h1>
                    {crew.tagline && <p className="mt-1 text-muted-foreground italic">"{crew.tagline}"</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                        run by <Person member={crew.owner} />
                    </p>
                </div>

                <Card>
                    <CardTitle>Runners</CardTitle>
                    {!crew.members.length && <Say>no runners yet.</Say>}
                    <ul className="space-y-1">
                        {crew.members.map((m) => {
                            const mine = m.ownerId === me.id;
                            return (
                                <li key={m.id} className="flex min-h-8 items-center gap-2">
                                    <RunnerChip runner={m} />
                                    <span className="text-xs text-muted-foreground">{m.role}</span>
                                    {(canManage || mine) && (
                                        <Button
                                            variant="ghost"
                                            size={!canManage && mine ? 'sm' : 'icon'}
                                            className="ml-auto"
                                            title="Remove"
                                            onClick={() => removeMember.mutate(m.id)}
                                        >
                                            {!canManage && mine ? 'Leave' : <X className="size-4" />}
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    {canManage && <AddMember crew={crew} runners={runners} />}
                </Card>
            </div>

            {canManage && (
                <div className="space-y-5">
                    <EditCrew crew={crew} runners={runners} isAdmin={me.isAdmin} />
                    <ConfirmButton
                        label="Disband crew"
                        title={`Disband ${crew.name}?`}
                        description="Gig slots reserved for this crew open up to anyone."
                        onConfirm={() => remove.mutate()}
                    />
                </div>
            )}
        </div>
    );
}

function AddMember({ crew, runners }: { crew: CrewView; runners: RunnerSummary[] }) {
    const [runnerId, setRunnerId] = useState('');
    const add = useAction(() => api(`/api/crews/${crew.id}/members`, 'POST', { runnerId: Number(runnerId) }), () => setRunnerId(''));
    const options = runners.filter((r) => !crew.members.some((m) => m.id === r.id));

    return (
        <div className="mt-4 flex gap-2">
            <Select
                value={runnerId}
                onChange={setRunnerId}
                placeholder="Add a runner..."
                options={options.map((r) => ({ value: String(r.id), label: r.handle, hint: r.owner?.name }))}
            />
            <Button disabled={!runnerId || add.isPending} onClick={() => add.mutate()}>
                Add
            </Button>
        </div>
    );
}

function EditCrew({ crew, runners, isAdmin }: { crew: CrewView; runners: RunnerSummary[]; isAdmin: boolean }) {
    const [name, setName] = useState(crew.name);
    const [tagline, setTagline] = useState(crew.tagline);
    const [ownerId, setOwnerId] = useState(crew.owner.id);
    const save = useAction(() => api(`/api/crews/${crew.id}`, 'PATCH', { name, tagline, ownerId }), 'Saved.');

    // Any player with a runner in the crew can take it over, plus whoever has it now
    const players = new Map([[crew.owner.id, crew.owner.name]]);
    for (const r of runners) if (r.owner && crew.members.some((m) => m.id === r.id)) players.set(r.owner.id, r.owner.name);

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
                {isAdmin && (
                    <div>
                        <Label htmlFor="owner">Run by</Label>
                        <Select id="owner" value={ownerId} onChange={setOwnerId} options={[...players].map(([value, label]) => ({ value, label }))} />
                    </div>
                )}
                <Button type="submit" className="w-full" disabled={save.isPending || !name.trim()}>
                    Save
                </Button>
            </form>
        </Card>
    );
}
