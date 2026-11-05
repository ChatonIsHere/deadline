import { gigInput, type GigInput, type GigView, type LibraryView, MAX_SLOTS } from '@shared/schemas';
import { Plus, Shuffle, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Icon, Say } from '@/components/common';
import { MarkdownEditor } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { RunnerAvatar } from '@/components/runner';
import { Combobox } from '@/components/ui/combobox';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { UploadButton } from '@/components/upload-button';
import { cn, firstIssue } from '@/lib/utils';
import { imageUrl, useCrews, useFixers, useGigTypes, useLibrary, useUser } from '@/lib/api';

// Numbers are kept as strings while typing so fields can be empty.
interface FormState {
    name: string;
    fixerName: string;
    /** A fixer character's ID, or '' for a typed name (admins only). */
    fixerRunnerId: string;
    location: string;
    type: string;
    pay: string;
    objective: string;
    imageId: number | null;
    /** The picture came from the library, so it follows the location. */
    imageAuto: boolean;
    objectives: { text: string; bonus: string }[];
    slots: { crewId: string; count: string }[];
}

function toForm(gig?: GigView): FormState {
    if (!gig) {
        return {
            name: '',
            fixerName: '',
            fixerRunnerId: '',
            location: '',
            type: '',
            pay: '',
            objective: '',
            imageId: null,
            imageAuto: true,
            objectives: [],
            slots: [{ crewId: '', count: '4' }],
        };
    }
    const counts = new Map<string, number>();
    for (const s of gig.slots) counts.set(String(s.crew?.id ?? ''), (counts.get(String(s.crew?.id ?? '')) ?? 0) + 1);
    return {
        name: gig.name,
        fixerName: gig.fixerName,
        fixerRunnerId: gig.fixerRunnerId ? String(gig.fixerRunnerId) : '',
        location: gig.location,
        type: gig.type ?? '',
        pay: String(gig.pay),
        objective: gig.objective,
        imageId: gig.imageId,
        imageAuto: false,
        objectives: gig.objectives.map((o) => ({ text: o.text, bonus: o.bonus ? String(o.bonus) : '' })),
        slots: [...counts].map(([crewId, count]) => ({ crewId, count: String(count) })),
    };
}

function fromForm({ imageAuto: _, ...form }: FormState): GigInput {
    return {
        ...form,
        fixerRunnerId: form.fixerRunnerId ? Number(form.fixerRunnerId) : null,
        type: form.type.trim() || null,
        pay: form.pay === '' ? NaN : Number(form.pay),
        objectives: form.objectives.map((o) => ({ text: o.text, bonus: o.bonus ? Number(o.bonus) : null })),
        slots: form.slots.map((s) => ({ crewId: s.crewId ? Number(s.crewId) : null, count: Number(s.count) })),
    };
}

/** Library pictures for a location: the region's, else its district's, else the pool. Same order as the server. */
function candidates(library: LibraryView, location: string) {
    const find = (name: string) => library.regions.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    const region = find(location);
    const district = region?.district ? find(region.district) : undefined;
    for (const r of [region, district]) if (r?.images.length) return { key: `region-${r.id}`, ids: r.images };
    return { key: 'pool', ids: library.pool };
}

function randomFrom(ids: number[], not: number | null): number | null {
    const others = ids.filter((id) => id !== not);
    const list = others.length ? others : ids;
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export function GigForm({ gig, saving, onSave }: { gig?: GigView; saving: boolean; onSave: (input: GigInput) => void }) {
    const me = useUser();
    const [form, setForm] = useState(() => toForm(gig));
    const [error, setError] = useState('');

    const crews = useCrews().data ?? [];
    const types = useGigTypes().data ?? [];
    // Admins can pick any fixer. Fixers pick from their own fixer characters.
    const fixerQuery = useFixers();
    const allFixers = fixerQuery.data ?? [];
    const fixers = me.isAdmin ? allFixers : allFixers.filter((f) => f.ownerId === me.id);
    // A fixer can't post until they have a fixer character
    const noFixer = !me.isAdmin && (fixerQuery.isPending || !fixers.length);
    const library = useLibrary().data;

    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
    const setRow = <K extends 'objectives' | 'slots'>(key: K, i: number, patch: Partial<FormState[K][number]>) =>
        set({ [key]: form[key].map((row, j) => (j === i ? { ...row, ...patch } : row)) });
    const removeRow = (key: 'objectives' | 'slots', i: number) => set({ [key]: form[key].filter((_, j) => j !== i) });

    // A library picture follows the location: new region, new picture.
    const pictures = library ? candidates(library, form.location) : null;
    useEffect(() => {
        if (pictures && form.imageAuto) set({ imageId: randomFrom(pictures.ids, null) });
    }, [pictures?.key]);

    const totalSlots = form.slots.reduce((sum, s) => sum + (Number(s.count) || 0), 0);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const result = gigInput.safeParse(fromForm(form));
        if (!result.success) {
            setError(firstIssue(result.error));
            return;
        }
        setError('');
        onSave(result.data);
    };

    return (
        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-5">
                <Card className="space-y-4">
                    <CardTitle>The job</CardTitle>
                    <div>
                        <Label htmlFor="name">Gig name</Label>
                        <Input id="name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} />
                    </div>
                    <div>
                        <Label help="the post's description in Discord, up to 4,000 characters. bold, italic, lists, links and quotes carry over.">Brief</Label>
                        <MarkdownEditor value={form.objective} onChange={(objective) => set({ objective })} />
                        <p className={cn('mt-1 text-right text-xs', form.objective.length > 4000 ? 'text-destructive' : 'text-muted-foreground')}>{form.objective.length} / 4000</p>
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle help="optional extras, one line each. a bonus is paid on top of the pay when the crew pulls one off.">Secondary objectives</CardTitle>
                    {form.objectives.map((o, i) => (
                        // Text on its own line on phones, bonus beside it on wider screens
                        <div key={i} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                            <div className="w-full sm:w-auto sm:flex-1">
                                <MarkdownEditor singleLine value={o.text} onChange={(text) => setRow('objectives', i, { text })} />
                            </div>
                            <div className="relative flex-1 sm:w-32 sm:flex-none">
                                <Icon name="eb" className="absolute top-2.5 left-2 z-10" />
                                <Input
                                    className="pl-8"
                                    type="number"
                                    min={1}
                                    value={o.bonus}
                                    onChange={(e) => setRow('objectives', i, { bonus: e.target.value })}
                                    placeholder="Bonus"
                                />
                            </div>
                            <Button type="button" variant="ghost" size="icon" className="mb-0.5" onClick={() => removeRow('objectives', i)}>
                                <X className="size-4" />
                            </Button>
                        </div>
                    ))}
                    {form.objectives.length < 8 && (
                        <Button type="button" variant="outline" size="sm" onClick={() => set({ objectives: [...form.objectives, { text: '', bonus: '' }] })}>
                            <Plus className="size-4" /> Add objective
                        </Button>
                    )}
                </Card>
            </div>

            <div className="space-y-5">
                <Card className="space-y-3">
                    <CardTitle help="every post gets a picture. one is picked from the library for the location. shuffle for another, or upload your own.">Picture</CardTitle>
                    {form.imageId ? (
                        <img src={imageUrl(form.imageId)} alt="" className="aspect-video w-full object-cover" />
                    ) : (
                        <div className="grid aspect-video place-items-center bg-muted p-4 text-center">
                            <Say className="text-xs">no pictures in the library yet. upload one.</Say>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!pictures?.ids.length}
                            onClick={() => pictures && set({ imageId: randomFrom(pictures.ids, form.imageId), imageAuto: true })}
                        >
                            <Shuffle className="size-4" /> Shuffle
                        </Button>
                        <UploadButton onUploaded={([imageId]) => set({ imageId, imageAuto: false })} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {form.imageAuto ? 'Picked for the location. Changes with it.' : 'Your pick. Shuffle to go back to the library.'}
                    </p>
                </Card>

                <Card className="space-y-4">
                    <CardTitle>Details</CardTitle>
                    <div>
                        <Label htmlFor="fixer" help="who's putting the job out. a fixer character links the gig to their profile and ratings.">Fixer</Label>
                        {me.isAdmin ? (
                            // Typing a fixer's handle links the gig to them. Anything else is a one-off NPC.
                            <Combobox
                                id="fixer"
                                value={form.fixerName}
                                onChange={(fixerName) => {
                                    const match = fixers.find((f) => f.handle.toLowerCase() === fixerName.trim().toLowerCase());
                                    set({ fixerName, fixerRunnerId: match ? String(match.id) : '' });
                                }}
                                suggestions={fixers.map((f) => ({ value: f.handle, hint: f.owner?.name ?? 'NPC' }))}
                                maxLength={60}
                            />
                        ) : fixers.length > 1 ? (
                            <Select
                                id="fixer"
                                value={form.fixerRunnerId}
                                onChange={(fixerRunnerId) => set({ fixerRunnerId })}
                                placeholder="Which of your fixers?"
                                options={fixers.map((f) => ({ value: String(f.id), label: f.handle }))}
                            />
                        ) : fixers.length === 1 ? (
                            <p className="flex h-9 items-center gap-2">
                                <RunnerAvatar runner={fixers[0]} /> {fixers[0].handle}
                            </p>
                        ) : fixerQuery.isPending ? (
                            <Say className="text-xs">checking your fixers...</Say>
                        ) : (
                            <Say className="text-xs">
                                you need a fixer character first: a runner with the Fixer role.{' '}
                                <Link to="/runners/new" className="text-accent hover:underline">
                                    make one
                                </Link>
                            </Say>
                        )}
                        {me.isAdmin && form.fixerRunnerId && <p className="mt-1 text-xs text-accent">Linked to their fixer profile.</p>}
                    </div>
                    <div>
                        <Label htmlFor="location" help="a Night City district, or anywhere else. districts also pick the post's picture.">Location</Label>
                        <Combobox
                            id="location"
                            value={form.location}
                            onChange={(location) => set({ location })}
                            suggestions={(library?.regions ?? []).map((r) => ({ value: r.name, hint: r.district ?? 'District' }))}
                            maxLength={100}
                        />
                    </div>
                    <div>
                        <Label htmlFor="type" help="if a forum tag has the same name, the post gets that tag.">Type (optional)</Label>
                        <Combobox id="type" value={form.type} onChange={(type) => set({ type })} suggestions={types.map((t) => ({ value: t }))} maxLength={40} />
                    </div>
                    <div>
                        <Label htmlFor="pay" help="the base pay for the job, in eb. secondary objective bonuses come on top.">Pay</Label>
                        <div className="relative">
                            <Icon name="eb" className="absolute top-2.5 left-2 z-10" />
                            <Input id="pay" className="pl-8" type="number" min={0} value={form.pay} onChange={(e) => set({ pay: e.target.value })} />
                        </div>
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle help="one runner per slot. crew slots are kept for that crew's runners until an admin opens them up. full gigs still take sign-ups as reserves.">
                        Slots {totalSlots}/{MAX_SLOTS}
                    </CardTitle>
                    {form.slots.map((s, i) => (
                        <div key={i} className="flex gap-2">
                            <Select
                                value={s.crewId}
                                onChange={(crewId) => setRow('slots', i, { crewId })}
                                options={[{ value: '', label: 'Any edgerunner' }, ...crews.map((c) => ({ value: String(c.id), label: c.name, hint: 'Crew' }))]}
                            />
                            <Input className="w-20 shrink-0" type="number" min={1} value={s.count} onChange={(e) => setRow('slots', i, { count: e.target.value })} />
                            <Button type="button" variant="ghost" size="icon" className="mt-0.5" onClick={() => removeRow('slots', i)}>
                                <X className="size-4" />
                            </Button>
                        </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => set({ slots: [...form.slots, { crewId: '', count: '1' }] })}>
                        <Plus className="size-4" /> Add slots
                    </Button>
                </Card>

                {error && <p className="text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={saving || noFixer}>
                    {gig ? 'Save changes' : 'Post the gig'}
                </Button>
            </div>
        </form>
    );
}
