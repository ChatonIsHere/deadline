import { FIXER_ROLE, runnerInput, type RunnerInput, type RunnerView } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArtField } from '@/components/art';
import { Loading, Say } from '@/components/common';
import { LivingCard } from '@/components/living-card';
import { MarkdownEditor } from '@/components/markdown';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { UploadButton } from '@/components/upload-button';
import { api, useAction, usePlayers, useRoles, useRunner, useUser } from '@/lib/api';
import { useDraft, useUnsavedForm } from '@/lib/unsaved';
import { cn, firstIssue } from '@/lib/utils';

/**
 * New runner, or editing one. Players make their own characters here, fixers included (a
 * fixer only counts once they have the fixer role in Discord). Admins can pick who plays it.
 * NPC fixers have their own form (fixer-edit.tsx).
 */
export function RunnerEdit() {
    const { id } = useParams();
    const me = useUser();
    const { data: runner, isError } = useRunner(id);
    if (isError) return <Say>no such runner.</Say>;
    if (id && !runner) return <Loading>loading runner...</Loading>;
    if (runner && !me.isAdmin && runner.ownerId !== me.id) return <Say>that runner isn't yours to change.</Say>;
    if (runner && !runner.ownerId) return <Navigate to={`/fixers/${runner.slug}/edit`} replace />;
    // Keyed so going from editing one runner to a new one starts a fresh form
    return <RunnerForm key={runner?.id ?? 'new'} runner={runner} />;
}

function RunnerForm({ runner }: { runner?: RunnerView }) {
    const me = useUser();
    const navigate = useNavigate();
    // Setup sends people here to make their first runner, then takes them back (?next=/setup)
    const asked = useSearchParams()[0].get('next');
    const next = asked?.startsWith('/') && !asked.startsWith('//') ? asked : null;
    const roles = useRoles().data ?? [];
    const players = usePlayers(me.isAdmin).data ?? [];
    const [error, setError] = useState('');
    const [form, setForm] = useDraft<RunnerInput>('runner', () => ({
        handle: runner?.handle ?? '',
        role: runner?.role ?? '',
        extraRoles: runner?.extraRoles ?? [],
        imageId: runner?.imageId ?? null,
        artIds: runner?.artIds ?? [],
        tagline: runner?.tagline ?? null,
        living: runner?.downtime?.living ?? null,
        lifestyle: runner?.downtime?.lifestyle ?? null,
        customLiving: runner?.downtime?.customLiving ?? null,
        fixerAlias: runner?.fixerAlias ?? null,
        officeLocation: runner?.officeLocation ?? null,
        specialties: runner?.specialties ?? null,
        contact: runner?.contact ?? null,
        bio: runner?.bio ?? null,
        // Only admins send a player. Everyone else's runners are their own.
        ownerId: me.isAdmin ? (runner?.ownerId ?? me.id) : undefined,
    }));
    const set = (patch: Partial<RunnerInput>) => setForm((f) => ({ ...f, ...patch }));
    useUnsavedForm(form);

    const save = useAction(
        (input: RunnerInput) => (runner ? api<RunnerView>(`/api/runners/${runner.id}`, 'PATCH', input) : api<RunnerView>('/api/runners', 'POST', input)),
        runner ? 'runner saved.' : 'runner on file.',
        (saved) => navigate(next ?? `/runners/${saved.slug}`),
    );

    const toggleExtra = (role: string) => set({ extraRoles: form.extraRoles.includes(role) ? form.extraRoles.filter((r) => r !== role) : [...form.extraRoles, role] });
    const isFixer = form.role === FIXER_ROLE || form.extraRoles.includes(FIXER_ROLE);
    // Keep roles the runner already has, even if they've been taken off the list since
    const roleList = [...new Set([...roles, ...(runner ? [runner.role, ...runner.extraRoles] : [])])];

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const result = runnerInput.safeParse(form);
        if (!result.success) {
            setError(firstIssue(result.error));
            return;
        }
        setError('');
        save.mutate(result.data);
    };

    return (
        <form onSubmit={submit} className='mx-auto max-w-3xl space-y-5'>
            {me.isAdmin && (
                <Card className='space-y-2'>
                    <CardTitle help="the runner shows on that player's Runners tab, and they can sign it up for gigs.">Player</CardTitle>
                    <Select
                        id='player'
                        value={form.ownerId ?? ''}
                        onChange={(ownerId) => set({ ownerId })}
                        options={[
                            ...players.map((p) => ({ value: p.id, label: p.name, hint: p.id === me.id ? 'you' : undefined })),
                            // Someone who has left the server still shows as the current player
                            ...(form.ownerId && !players.some((p) => p.id === form.ownerId) ? [{ value: form.ownerId, label: runner?.owner?.name ?? 'Unknown player' }] : []),
                        ]}
                    />
                </Card>
            )}

            <div className='grid items-start gap-5 sm:grid-cols-[12rem_1fr]'>
                <div className='space-y-5'>
                    <Card className='space-y-3'>
                        <CardTitle help="a square picture, shown on gigs, crews and the runner's profile.">Picture</CardTitle>
                        <RunnerAvatar runner={{ handle: form.handle || '?', imageId: form.imageId }} framed className='aspect-square h-auto w-full text-5xl' />
                        <UploadButton className='w-full' options={{ kind: 'avatar' }} onUploaded={([imageId]) => set({ imageId })} />
                    </Card>
                    <ArtField value={form.artIds} onChange={(artIds) => set({ artIds })} />
                </div>

                <div className='space-y-5'>
                    <Card className='space-y-4'>
                        <CardTitle>Runner</CardTitle>
                        <div>
                            <Label htmlFor='handle'>Handle</Label>
                            <Input id='handle' value={form.handle} onChange={(e) => set({ handle: e.target.value })} maxLength={40} />
                        </div>
                        <div>
                            <Label htmlFor='tagline' help='one line, shown under their name.'>
                                Tagline
                            </Label>
                            <Input id='tagline' value={form.tagline ?? ''} onChange={(e) => set({ tagline: e.target.value })} maxLength={120} />
                        </div>
                        <div>
                            <Label htmlFor='role'>Role</Label>
                            <Select id='role' value={form.role} placeholder='Pick a role' onChange={(role) => set({ role, extraRoles: form.extraRoles.filter((r) => r !== role) })} options={roleList.map((r) => ({ value: r, label: r }))} />
                        </div>
                        <div>
                            <Label help='other roles this runner has. Fixer gives them a fixer profile.'>Extra roles</Label>
                            <div className='flex flex-wrap gap-1.5'>
                                {roleList
                                    .filter((r) => r !== form.role)
                                    .map((r) => (
                                        <button key={r} type='button' onClick={() => toggleExtra(r)} className={cn('cut cursor-pointer px-2 py-1 font-display text-xs tracking-wider uppercase [--cut:5px]', form.extraRoles.includes(r) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                                            {r}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </Card>

                    <Card className='space-y-2'>
                        <CardTitle help='who they are. shown on their profile.'>Bio</CardTitle>
                        <MarkdownEditor value={form.bio ?? ''} onChange={(bio) => set({ bio })} max={2000} />
                    </Card>
                </div>
            </div>

            <LivingCard value={form} onChange={set} />

            {isFixer && (
                <Card className='space-y-4'>
                    <CardTitle help="shown on the Fixers tab. a player's fixer only counts once an admin gives them the fixer role in Discord.">Fixer profile</CardTitle>
                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <Label htmlFor='alias'>Fixer alias</Label>
                            <Input id='alias' value={form.fixerAlias ?? ''} onChange={(e) => set({ fixerAlias: e.target.value })} maxLength={40} placeholder={form.handle || 'Their handle'} />
                            <p className='mt-1 text-xs text-muted-foreground'>Shows instead of their handle on the Fixers tab.</p>
                        </div>
                        <div>
                            <Label htmlFor='office'>Office location</Label>
                            <Input id='office' value={form.officeLocation ?? ''} onChange={(e) => set({ officeLocation: e.target.value })} maxLength={100} />
                        </div>
                        <div>
                            <Label htmlFor='contact'>How to reach them</Label>
                            <Input id='contact' value={form.contact ?? ''} onChange={(e) => set({ contact: e.target.value })} maxLength={150} />
                        </div>
                        <div>
                            <Label htmlFor='specialties'>Specialties</Label>
                            <Input id='specialties' value={form.specialties ?? ''} onChange={(e) => set({ specialties: e.target.value })} maxLength={150} />
                        </div>
                    </div>
                </Card>
            )}

            {error && <p className='text-destructive'>{error}</p>}
            <Button type='submit' className='w-full' disabled={save.isPending}>
                {runner ? 'Save changes' : 'Create'}
            </Button>
        </form>
    );
}
