import { gigInput, type GigInput, type GigView, type LibraryView, MAX_SLOTS } from '@shared/schemas';
import { Plus, Shuffle, Upload, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon, Say } from '@/components/common';
import { MarkdownEditor } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { imageUrl, uploadImage, useCrews, useFixers, useGigTypes, useLibrary, useUser } from '@/lib/api';

// Numbers are kept as strings while typing so fields can be empty.
interface FormState {
    name: string;
    fixerName: string;
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

function toForm(fixerName: string, gig?: GigView): FormState {
    if (!gig) {
        return {
            name: '',
            fixerName,
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
    const [form, setForm] = useState(() => toForm(me.isFixer ? me.name : '', gig));
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const crews = useCrews().data ?? [];
    const types = useGigTypes().data ?? [];
    const fixers = useFixers(me.isAdmin).data ?? [];
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

    const upload = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        try {
            set({ imageId: await uploadImage(file), imageAuto: false });
        } catch (err) {
            toast.error((err as Error).message);
        } finally {
            setUploading(false);
        }
    };

    const totalSlots = form.slots.reduce((sum, s) => sum + (Number(s.count) || 0), 0);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const result = gigInput.safeParse(fromForm(form));
        if (!result.success) {
            const issue = result.error.issues[0];
            setError(`${issue.path.join(' ') || 'form'}: ${issue.message}`);
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
                        <Label>Primary objective</Label>
                        <MarkdownEditor value={form.objective} onChange={(objective) => set({ objective })} />
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle>Secondary objectives</CardTitle>
                    {form.objectives.map((o, i) => (
                        <div key={i} className="flex items-end gap-2">
                            <MarkdownEditor singleLine value={o.text} onChange={(text) => setRow('objectives', i, { text })} />
                            <div className="relative w-32 shrink-0">
                                <Icon name="eb" className="absolute top-2.5 left-2" />
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
                    <CardTitle>Picture</CardTitle>
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
                        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                            <Upload className="size-4" /> {uploading ? 'Uploading' : 'Upload'}
                        </Button>
                        <input ref={fileInput} type="file" accept="image/*" hidden onChange={upload} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {form.imageAuto ? 'Picked for the location. Changes with it.' : 'Your pick. Shuffle to go back to the library.'}
                    </p>
                </Card>

                <Card className="space-y-4">
                    <CardTitle>Details</CardTitle>
                    {me.isAdmin && (
                        <div>
                            <Label htmlFor="fixer">Fixer</Label>
                            <Input id="fixer" list="fixers" value={form.fixerName} onChange={(e) => set({ fixerName: e.target.value })} maxLength={60} />
                            <datalist id="fixers">
                                {fixers.map((f) => (
                                    <option key={f.id} value={f.name} />
                                ))}
                            </datalist>
                        </div>
                    )}
                    <div>
                        <Label htmlFor="location">Location</Label>
                        <Input id="location" list="regions" value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={100} />
                        <datalist id="regions">
                            {library?.regions.map((r) => (
                                <option key={r.id} value={r.name} label={r.district ?? 'District'} />
                            ))}
                        </datalist>
                    </div>
                    <div>
                        <Label htmlFor="type">Type (optional)</Label>
                        <Input id="type" list="gig-types" value={form.type} onChange={(e) => set({ type: e.target.value })} maxLength={40} />
                        <datalist id="gig-types">
                            {types.map((t) => (
                                <option key={t} value={t} />
                            ))}
                        </datalist>
                    </div>
                    <div>
                        <Label htmlFor="pay">Pay</Label>
                        <div className="relative">
                            <Icon name="eb" className="absolute top-2.5 left-2" />
                            <Input id="pay" className="pl-8" type="number" min={0} value={form.pay} onChange={(e) => set({ pay: e.target.value })} />
                        </div>
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle>
                        Slots {totalSlots}/{MAX_SLOTS}
                    </CardTitle>
                    {form.slots.map((s, i) => (
                        <div key={i} className="flex gap-2">
                            <Select value={s.crewId} onChange={(e) => setRow('slots', i, { crewId: e.target.value })}>
                                <option value="">Any edgerunner</option>
                                {crews.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </Select>
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
                <Button type="submit" className="w-full" disabled={saving || uploading}>
                    {gig ? 'Save changes' : 'Post the gig'}
                </Button>
            </div>
        </form>
    );
}
