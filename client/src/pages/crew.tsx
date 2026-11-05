import { canManageCrew } from '@shared/permissions';
import type { CrewView } from '@shared/schemas';
import { X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmButton, Icon, Person, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, useAction, useCrew, useMembers, useUser } from '@/lib/api';

export function Crew() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: crew, isError } = useCrew(id);

    const url = `/api/crews/${id}`;
    const removeMember = useAction((userId: string) => api(`${url}/members/${userId}`, 'DELETE'), 'Removed.');
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
                </div>

                <Card>
                    <CardTitle>Members</CardTitle>
                    <ul className="space-y-1">
                        {crew.members.map((m) => (
                            <li key={m.id} className="flex min-h-8 items-center gap-2">
                                <Person member={m} />
                                {m.id === crew.owner.id && <span className="text-xs text-primary uppercase">owner</span>}
                                {m.id !== crew.owner.id && (canManage || m.id === me.id) && (
                                    <Button
                                        variant="ghost"
                                        size={m.id === me.id ? 'sm' : 'icon'}
                                        className="ml-auto"
                                        title="Remove"
                                        onClick={() => removeMember.mutate(m.id)}
                                    >
                                        {m.id === me.id ? 'Leave' : <X className="size-4" />}
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    {canManage && <AddMember crew={crew} />}
                </Card>
            </div>

            {canManage && (
                <div className="space-y-5">
                    <EditCrew crew={crew} isAdmin={me.isAdmin} />
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

function AddMember({ crew }: { crew: CrewView }) {
    const [userId, setUserId] = useState('');
    const members = useMembers().data ?? [];
    const add = useAction(() => api(`/api/crews/${crew.id}/members`, 'POST', { userId }), () => setUserId(''));
    const options = members.filter((m) => !crew.members.some((c) => c.id === m.id));

    return (
        <div className="mt-4 flex gap-2">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Add an edgerunner...</option>
                {options.map((m) => (
                    <option key={m.id} value={m.id}>
                        {m.name}
                    </option>
                ))}
            </Select>
            <Button disabled={!userId || add.isPending} onClick={() => add.mutate()}>
                Add
            </Button>
        </div>
    );
}

function EditCrew({ crew, isAdmin }: { crew: CrewView; isAdmin: boolean }) {
    const [name, setName] = useState(crew.name);
    const [tagline, setTagline] = useState(crew.tagline);
    const [ownerId, setOwnerId] = useState(crew.owner.id);
    const save = useAction(() => api(`/api/crews/${crew.id}`, 'PATCH', { name, tagline, ownerId }), 'Saved.');

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
                        <Label htmlFor="owner">Owner</Label>
                        <Select id="owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                            {crew.members.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
                <Button type="submit" className="w-full" disabled={save.isPending || !name.trim()}>
                    Save
                </Button>
            </form>
        </Card>
    );
}
