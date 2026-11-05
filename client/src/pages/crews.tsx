import { canCreateCrew } from '@shared/permissions';
import type { CrewView } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon, LinkCard, Say } from '@/components/common';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, useAction, useCrews, useUser } from '@/lib/api';

export function Crews() {
    const me = useUser();
    const { data: crews, isPending } = useCrews();

    return (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
            <div>
                <h1 className="mb-5 text-3xl text-primary">Crews</h1>
                {isPending ? (
                    <Say>scanning...</Say>
                ) : crews?.length ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                        {crews.map((c) => (
                            <CrewCard key={c.id} crew={c} />
                        ))}
                    </div>
                ) : (
                    <Say>no crews registered.</Say>
                )}
            </div>
            {canCreateCrew(me) && <NewCrew />}
        </div>
    );
}

function CrewCard({ crew }: { crew: CrewView }) {
    return (
        <LinkCard to={`/crews/${crew.id}`}>
            <h3 className="flex items-center gap-2 text-lg">
                <Icon name="crew" /> {crew.name}
            </h3>
            {crew.tagline && <p className="mt-1 text-muted-foreground italic">"{crew.tagline}"</p>}
            <div className="mt-4 flex items-center gap-1">
                {crew.members.slice(0, 8).map((m) => (
                    <RunnerAvatar key={m.id} runner={m} />
                ))}
                <span className="ml-2 text-xs text-muted-foreground">{crew.members.length} runner(s)</span>
            </div>
        </LinkCard>
    );
}

function NewCrew() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [tagline, setTagline] = useState('');
    const create = useAction(() => api<CrewView>('/api/crews', 'POST', { name, tagline }), (crew) => navigate(`/crews/${crew.id}`));

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (name.trim()) create.mutate();
    };

    return (
        <Card className="h-fit">
            <CardTitle>Register a crew</CardTitle>
            <form onSubmit={submit} className="space-y-4">
                <div>
                    <Label htmlFor="crew-name">Name</Label>
                    <Input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
                </div>
                <div>
                    <Label htmlFor="crew-tagline">Tagline</Label>
                    <Input id="crew-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
                </div>
                <Button type="submit" className="w-full" disabled={create.isPending || !name.trim()}>
                    Register
                </Button>
            </form>
        </Card>
    );
}
