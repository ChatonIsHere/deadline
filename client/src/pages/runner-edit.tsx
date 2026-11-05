import { FIXER_ROLE, runnerInput, type RunnerInput, type RunnerView } from '@shared/schemas';
import { Upload } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Say } from '@/components/common';
import { MarkdownEditor } from '@/components/markdown';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, uploadImage, useAction, usePlayers, useRoles, useRunner, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * New runner, or editing one. Admins pick who plays the runner (or nobody, for an NPC
 * fixer). `?npc=1` starts a new one as an NPC fixer.
 */
export function RunnerEdit() {
    const { id } = useParams();
    const { data: runner } = useRunner(id);
    if (id && !runner) return <Say>loading runner...</Say>;
    return <RunnerForm runner={runner} />;
}

function RunnerForm({ runner }: { runner?: RunnerView }) {
    const me = useUser();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const npc = !runner && me.isAdmin && params.get('npc') === '1';
    const roles = useRoles().data ?? [];
    const players = usePlayers(me.isAdmin).data ?? [];
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState<RunnerInput>(() => ({
        handle: runner?.handle ?? '',
        role: runner?.role ?? (npc ? FIXER_ROLE : ''),
        extraRoles: runner?.extraRoles ?? [],
        imageId: runner?.imageId ?? null,
        officeLocation: runner?.officeLocation ?? null,
        specialties: runner?.specialties ?? null,
        contact: runner?.contact ?? null,
        bio: runner?.bio ?? null,
        // Only admins send a player. Everyone else's runners are their own.
        ownerId: me.isAdmin ? (runner ? runner.ownerId : npc ? null : me.id) : undefined,
    }));
    const isNpc = form.ownerId === null;
    const set = (patch: Partial<RunnerInput>) => setForm((f) => ({ ...f, ...patch }));

    const save = useAction(
        (input: RunnerInput) => (runner ? api<RunnerView>(`/api/runners/${runner.id}`, 'PATCH', input) : api<RunnerView>('/api/runners', 'POST', input)),
        (saved) => navigate(`/runners/${saved.id}`),
    );

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        try {
            set({ imageId: await uploadImage(file, { kind: 'avatar' }) });
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setUploading(false);
        }
    };

    const toggleExtra = (role: string) =>
        set({ extraRoles: form.extraRoles.includes(role) ? form.extraRoles.filter((r) => r !== role) : [...form.extraRoles, role] });
    const isFixer = form.role === FIXER_ROLE || form.extraRoles.includes(FIXER_ROLE);
    // Keep roles the runner already has, even if they've been taken off the list since
    const roleList = [...new Set([...roles, ...(runner ? [runner.role, ...runner.extraRoles] : [])])];

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const result = runnerInput.safeParse(form);
        if (!result.success) {
            const issue = result.error.issues[0];
            setError(`${issue.path.join(' ') || 'form'}: ${issue.message}`);
            return;
        }
        setError('');
        save.mutate(result.data);
    };

    return (
        <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
            <h1 className="text-3xl text-primary">{runner ? `Edit ${runner.handle}` : isNpc ? 'New NPC fixer' : 'New runner'}</h1>

            {me.isAdmin && (
                <Card className="space-y-2">
                    <CardTitle>Player</CardTitle>
                    <Select
                        id="player"
                        value={form.ownerId ?? ''}
                        onChange={(ownerId) => set({ ownerId: ownerId || null, ...(!ownerId && !isFixer ? { role: FIXER_ROLE } : {}) })}
                        options={[
                            { value: '', label: 'Nobody (NPC fixer)' },
                            ...players.map((p) => ({ value: p.id, label: p.name, hint: p.id === me.id ? 'you' : undefined })),
                            // Someone who has left the server still shows as the current player
                            ...(form.ownerId && !players.some((p) => p.id === form.ownerId) ? [{ value: form.ownerId, label: runner?.owner?.name ?? 'Unknown player' }] : []),
                        ]}
                    />
                    <p className="text-xs text-muted-foreground">
                        {isNpc
                            ? 'An NPC fixer has no player. They show on the Fixers tab and can be picked for gigs.'
                            : 'The runner shows under their Runners tab and they can sign them up for gigs.'}
                    </p>
                </Card>
            )}

            <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
                <Card className="space-y-3">
                    <CardTitle>Picture</CardTitle>
                    <RunnerAvatar runner={{ handle: form.handle || '?', imageId: form.imageId }} framed className="aspect-square h-auto w-full text-5xl" />
                    <Button type="button" variant="outline" size="sm" className="w-full" disabled={uploading} onClick={() => fileInput.current?.click()}>
                        <Upload className="size-4" /> {uploading ? 'Uploading' : 'Upload'}
                    </Button>
                    <input ref={fileInput} type="file" accept="image/*" hidden onChange={upload} />
                </Card>

                <Card className="space-y-4">
                    <CardTitle>Runner</CardTitle>
                    <div>
                        <Label htmlFor="handle">Handle</Label>
                        <Input id="handle" value={form.handle} onChange={(e) => set({ handle: e.target.value })} maxLength={40} />
                    </div>
                    <div>
                        <Label htmlFor="role">Role</Label>
                        <Select
                            id="role"
                            value={form.role}
                            placeholder="Pick a role"
                            onChange={(role) => set({ role, extraRoles: form.extraRoles.filter((r) => r !== role) })}
                            options={roleList.map((r) => ({ value: r, label: r }))}
                        />
                    </div>
                    <div>
                        <Label>Extra roles</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {roleList
                                .filter((r) => r !== form.role)
                                .map((r) => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => toggleExtra(r)}
                                        className={cn(
                                            'cut cursor-pointer px-2 py-1 font-display text-xs tracking-wider uppercase [--cut:5px]',
                                            form.extraRoles.includes(r) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        {r}
                                    </button>
                                ))}
                        </div>
                    </div>
                </Card>
            </div>

            {isFixer && (
                <Card className="space-y-4">
                    <CardTitle>Fixer profile</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Shown on the Fixers tab. A player's fixer only counts once an admin gives them the fixer role in Discord.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="office">Office location</Label>
                            <Input id="office" value={form.officeLocation ?? ''} onChange={(e) => set({ officeLocation: e.target.value })} maxLength={100} />
                        </div>
                        <div>
                            <Label htmlFor="contact">How to reach them</Label>
                            <Input id="contact" value={form.contact ?? ''} onChange={(e) => set({ contact: e.target.value })} maxLength={150} />
                        </div>
                    </div>
                    <div>
                        <Label htmlFor="specialties">Specialties</Label>
                        <Input id="specialties" value={form.specialties ?? ''} onChange={(e) => set({ specialties: e.target.value })} maxLength={150} />
                    </div>
                    <div>
                        <Label>Bio</Label>
                        <MarkdownEditor value={form.bio ?? ''} onChange={(bio) => set({ bio })} />
                    </div>
                </Card>
            )}

            {error && <p className="text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={save.isPending || uploading}>
                {runner ? 'Save changes' : 'Create'}
            </Button>
        </form>
    );
}
