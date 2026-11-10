import { FIXER_ROLE, runnerInput, type RunnerInput, type RunnerView } from '@shared/schemas';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { ArtField } from '@/components/art';
import { Loading, Say } from '@/components/common';
import { MarkdownEditor } from '@/components/markdown';
import { RunnerAvatar } from '@/components/runner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { UploadButton } from '@/components/upload-button';
import { api, useAction, useRunner, useUser } from '@/lib/api';
import { useUnsavedForm } from '@/lib/unsaved';
import { firstIssue } from '@/lib/utils';

/**
 * New NPC fixer, or editing one. Admins only. An NPC fixer has no player, so there's no
 * player or roles to pick: just who they are and their fixer profile. Players make their own
 * fixers with the runner form.
 */
export function FixerEdit() {
    const { id } = useParams();
    const me = useUser();
    const { data: fixer, isError } = useRunner(id);
    if (!me.isAdmin) return <Say>admins only.</Say>;
    if (isError) return <Say>no such fixer.</Say>;
    if (id && !fixer) return <Loading>loading fixer...</Loading>;
    // A player's fixer is their runner: edit it there
    if (fixer && fixer.ownerId) return <Navigate to={`/runners/${fixer.slug}/edit`} replace />;
    return <FixerForm key={fixer?.id ?? 'new'} fixer={fixer} />;
}

function FixerForm({ fixer }: { fixer?: RunnerView }) {
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [form, setForm] = useState<RunnerInput>(() => ({
        handle: fixer?.handle ?? '',
        role: FIXER_ROLE,
        extraRoles: [],
        imageId: fixer?.imageId ?? null,
        artIds: fixer?.artIds ?? [],
        tagline: fixer?.tagline ?? null,
        living: null,
        lifestyle: null,
        customLiving: null,
        fixerAlias: null,
        officeLocation: fixer?.officeLocation ?? null,
        specialties: fixer?.specialties ?? null,
        contact: fixer?.contact ?? null,
        bio: fixer?.bio ?? null,
        ownerId: null,
    }));
    const set = (patch: Partial<RunnerInput>) => setForm((f) => ({ ...f, ...patch }));
    useUnsavedForm(form);

    const save = useAction(
        (input: RunnerInput) => (fixer ? api<RunnerView>(`/api/runners/${fixer.id}`, 'PATCH', input) : api<RunnerView>('/api/runners', 'POST', input)),
        fixer ? 'fixer saved.' : 'fixer on file.',
        (saved) => navigate(`/fixers/${saved.fixerSlug}`),
    );

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
        <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
            <div className="grid items-start gap-5 sm:grid-cols-[12rem_1fr]">
                <div className="space-y-5">
                    <Card className="space-y-3">
                        <CardTitle help="a square picture, shown on gigs and the fixer's profile.">Picture</CardTitle>
                        <RunnerAvatar runner={{ handle: form.handle || '?', imageId: form.imageId }} framed className="aspect-square h-auto w-full text-5xl" />
                        <UploadButton className="w-full" options={{ kind: 'avatar' }} onUploaded={([imageId]) => set({ imageId })} />
                    </Card>
                    <ArtField value={form.artIds} onChange={(artIds) => set({ artIds })} />
                </div>

                <Card className="space-y-4">
                    <CardTitle help="an NPC fixer has no player. they show on the Fixers tab and can be picked for gigs.">NPC fixer</CardTitle>
                    <div>
                        <Label htmlFor="handle">Name</Label>
                        <Input id="handle" value={form.handle} onChange={(e) => set({ handle: e.target.value })} maxLength={40} />
                    </div>
                    <div>
                        <Label htmlFor="tagline" help="one line, shown under their name.">Tagline</Label>
                        <Input id="tagline" value={form.tagline ?? ''} onChange={(e) => set({ tagline: e.target.value })} maxLength={120} />
                    </div>
                    <div>
                        <Label htmlFor="office">Office location</Label>
                        <Input id="office" value={form.officeLocation ?? ''} onChange={(e) => set({ officeLocation: e.target.value })} maxLength={100} />
                    </div>
                </Card>
            </div>

            <Card className="space-y-4">
                <CardTitle>Fixer profile</CardTitle>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="contact">How to reach them</Label>
                        <Input id="contact" value={form.contact ?? ''} onChange={(e) => set({ contact: e.target.value })} maxLength={150} />
                    </div>
                    <div>
                        <Label htmlFor="specialties">Specialties</Label>
                        <Input id="specialties" value={form.specialties ?? ''} onChange={(e) => set({ specialties: e.target.value })} maxLength={150} />
                    </div>
                </div>
                <div>
                    <Label>Bio</Label>
                    <MarkdownEditor value={form.bio ?? ''} onChange={(bio) => set({ bio })} max={2000} />
                </div>
            </Card>

            {error && <p className="text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={save.isPending}>
                {fixer ? 'Save changes' : 'Create'}
            </Button>
        </form>
    );
}
