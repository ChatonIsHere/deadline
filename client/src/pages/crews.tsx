import { canCreateCrew } from '@shared/permissions';
import type { CrewView } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon, LinkCard, liveKey, Loading, Say } from '@/components/common';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, useAction, useCrews, useMyRunners, useRunners, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

/** The crew list: crews you have a runner in, then everyone else's. New crews are registered at /crews/new, from the corner +. */
export function Crews() {
    const me = useUser();
    const { data: crews, isPending } = useCrews();

    if (isPending) return <Loading>scanning...</Loading>;
    if (!crews?.length) {
        return (
            <div className="space-y-4">
                <Say>no crews registered. a crew is a group of runners with ranks, and gigs can hold slots for one.</Say>
                {canCreateCrew(me) && (
                    <Button asChild>
                        <Link to="/crews/new">Register a crew</Link>
                    </Button>
                )}
            </div>
        );
    }
    const isMine = (c: CrewView) => c.members.some((m) => m.ownerId === me.id);
    const mine = crews.filter(isMine);
    const rest = crews.filter((c) => !isMine(c));
    return (
        <div className="space-y-8">
            {mine.length > 0 && <CrewGrid title="Your crews" crews={mine} mine />}
            {rest.length > 0 && <CrewGrid title={mine.length ? 'Other crews' : 'Crews'} crews={rest} />}
        </div>
    );
}

function CrewGrid({ title, crews, mine }: { title: string; crews: CrewView[]; mine?: boolean }) {
    return (
        <section className="space-y-3">
            <h2 className="text-xs tracking-widest text-muted-foreground">
                // {title.toUpperCase()} <span className="opacity-60">{crews.length}</span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {crews.map((c) => (
                    <CrewCard key={liveKey(c.id, c)} crew={c} mine={mine} />
                ))}
            </div>
        </section>
    );
}

export function NewCrewPage() {
    const me = useUser();
    if (!canCreateCrew(me)) return <Say>you need the edgerunner role to register a crew.</Say>;
    return (
        <div className="mx-auto max-w-xl">
            <NewCrew />
        </div>
    );
}

/** Name and tagline, who's at the top, the runners' faces, and counts along the bottom. Your own crews get a yellow frame. */
function CrewCard({ crew, mine }: { crew: CrewView; mine?: boolean }) {
    const leaders = crew.members.filter((m) => m.rank === crew.ranks[0]);
    const shown = crew.members.slice(0, 6);
    return (
        <LinkCard to={`/crews/${crew.slug}`} className={cn('flex h-full flex-col gap-3', mine && '[--frame:var(--color-primary)]')}>
            <div>
                <h3 className="flex items-center gap-2 text-xl">
                    <Icon name="crew" className="size-5" /> <span className="truncate">{crew.name}</span>
                </h3>
                {crew.tagline && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground italic">"{crew.tagline}"</p>}
            </div>
            {leaders.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                    <span className="tracking-widest uppercase">{crew.ranks[0]}</span> <span className="text-foreground">{leaders.map((l) => l.handle).join(', ')}</span>
                </p>
            )}
            {shown.length > 0 && (
                <div className="flex items-center gap-1.5">
                    {shown.map((m) => (
                        <RunnerAvatar key={m.id} runner={m} className="size-10 text-base [--cut:6px]" />
                    ))}
                    {crew.members.length > shown.length && <span className="ml-1 text-xs text-muted-foreground">+{crew.members.length - shown.length}</span>}
                </div>
            )}
            <dl className="mt-auto grid grid-cols-3 gap-2 border-t-2 border-border pt-3">
                <Count label="Runners" value={crew.members.length} />
                <Count label="Allies" value={crew.allies.length} />
                <Count label="Gigs" value={crew.gigs.length} />
            </dl>
        </LinkCard>
    );
}

function Count({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <dt className="text-xs tracking-widest text-muted-foreground uppercase">{label}</dt>
            <dd className="font-display text-xl tabular-nums">{value}</dd>
        </div>
    );
}

/** The founding runner is the player's own. Admins can found a crew for anyone's runner. */
function NewCrew() {
    const me = useUser();
    const navigate = useNavigate();
    const myQuery = useMyRunners();
    const everyoneQuery = useRunners();
    const mine = myQuery.data ?? [];
    const everyone = (everyoneQuery.data ?? []).filter((r) => r.status === 'active');
    const loading = me.isAdmin ? everyoneQuery.isPending : myQuery.isPending;
    const choices = me.isAdmin ? everyone.map((r) => ({ value: String(r.id), label: r.handle, hint: r.owner?.name })) : mine.map((r) => ({ value: String(r.id), label: r.handle }));
    const [name, setName] = useState('');
    const [tagline, setTagline] = useState('');
    const [picked, setPicked] = useState('');
    // One runner of your own needs no picking
    const runnerId = picked || (mine.length === 1 ? String(mine[0].id) : '');
    const create = useAction(() => api<CrewView>('/api/crews', 'POST', { name, tagline, runnerId }), 'crew registered.', (crew) => navigate(`/crews/${crew.slug}`));

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
                <div>
                    <Label htmlFor="crew-founder">Founder</Label>
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading runners...</p>
                    ) : choices.length ? (
                        <Select id="crew-founder" value={runnerId} onChange={setPicked} placeholder="Which runner founds it?" options={choices} />
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Make a runner first. <Link to="/runners/new" className="text-accent hover:underline">New runner</Link>
                        </p>
                    )}
                </div>
                <Button type="submit" className="w-full" disabled={create.isPending || !name.trim() || !runnerId}>
                    Register
                </Button>
            </form>
        </Card>
    );
}
