import { gigInput, type GigInput, type GigView, type LibraryView, MAX_SLOTS } from '@shared/schemas';
import { Eye, EyeOff, Plus, Shuffle, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon, Pay, Say } from '@/components/common';
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
    brief: string;
    /** One row per part. */
    primaryObjective: string[];
    /** What the primary objective pays. */
    pay: string;
    imageId: string | null;
    /** The picture came from the library, so it follows the location. */
    imageAuto: boolean;
    objectives: { text: string; bonus: string; each: boolean; hidden: boolean }[];
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
            brief: '',
            primaryObjective: [''],
            pay: '',
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
        brief: gig.brief,
        primaryObjective: gig.primaryObjective.length ? gig.primaryObjective : [''],
        pay: String(gig.pay),
        imageId: gig.imageId,
        imageAuto: false,
        objectives: gig.objectives.map((o) => ({ text: o.text, bonus: o.bonus ? String(o.bonus) : '', each: o.each, hidden: o.hidden })),
        slots: [...counts].map(([crewId, count]) => ({ crewId, count: String(count) })),
    };
}

function fromForm({ imageAuto: _, ...form }: FormState): GigInput {
    return {
        ...form,
        fixerRunnerId: form.fixerRunnerId || null,
        type: form.type.trim() || null,
        pay: form.pay === '' ? NaN : Number(form.pay),
        // Blank extra parts are dropped rather than failing the form
        primaryObjective: form.primaryObjective.filter((p, i) => i === 0 || p.trim()),
        objectives: form.objectives.map((o) => ({ text: o.text, bonus: o.bonus ? Number(o.bonus) : null, each: o.each, hidden: o.hidden })),
        slots: form.slots.map((s) => ({ crewId: s.crewId || null, count: Number(s.count) })),
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

function randomFrom(ids: string[], not: string | null): string | null {
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
                        <MarkdownEditor value={form.brief} onChange={(brief) => set({ brief })} max={4000} />
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle help="what the crew has to pull off to get paid. split it into parts if it has several, it still pays once.">Primary objective</CardTitle>
                    {form.primaryObjective.map((part, i) => (
                        <div key={i} className="flex items-end gap-2">
                            <div className="flex-1">
                                <MarkdownEditor
                                    singleLine
                                    max={150}
                                    value={part}
                                    onChange={(text) => set({ primaryObjective: form.primaryObjective.map((p, j) => (j === i ? text : p)) })}
                                />
                            </div>
                            {form.primaryObjective.length > 1 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="mb-0.5"
                                    aria-label="Remove part"
                                    onClick={() => set({ primaryObjective: form.primaryObjective.filter((_, j) => j !== i) })}
                                >
                                    <X className="size-4" />
                                </Button>
                            )}
                        </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        {form.primaryObjective.length < 8 ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => set({ primaryObjective: [...form.primaryObjective, ''] })}>
                                <Plus className="size-4" /> Add part
                            </Button>
                        ) : (
                            <span />
                        )}
                        <div className="relative w-40">
                            <Icon name="eb" className="absolute top-2.5 left-2 z-10" />
                            <Input className="pl-8" type="number" min={1} value={form.pay} onChange={(e) => set({ pay: e.target.value })} placeholder="Pay" aria-label="Pay" />
                        </div>
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle help="optional extras, one line each. a bonus is paid once when the crew pulls it off, or for each time with Each.">Secondary objectives</CardTitle>
                    {form.objectives.map((o, i) => (
                        // Text on its own line on phones, bonus beside it on wider screens
                        <div key={i} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
                            <div className="w-full sm:w-auto sm:flex-1">
                                <MarkdownEditor singleLine max={150} value={o.text} onChange={(text) => setRow('objectives', i, { text })} />
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
                            <Button
                                type="button"
                                variant={o.each ? 'default' : 'outline'}
                                className="mb-0.5 w-16"
                                aria-pressed={o.each}
                                title={o.each ? 'Paid for each time it is done' : 'Paid once, on completion'}
                                onClick={() => setRow('objectives', i, { each: !o.each })}
                            >
                                {o.each ? 'Each' : 'Once'}
                            </Button>
                            <Button
                                type="button"
                                variant={o.hidden ? 'accent' : 'outline'}
                                size="icon"
                                className="mb-0.5"
                                aria-pressed={o.hidden}
                                title={o.hidden ? 'Not disclosed to players until sign-ups lock' : 'Shown to players'}
                                onClick={() => setRow('objectives', i, { hidden: !o.hidden })}
                            >
                                {o.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="mb-0.5" onClick={() => removeRow('objectives', i)}>
                                <X className="size-4" />
                            </Button>
                        </div>
                    ))}
                    {form.objectives.length < 8 && (
                        <Button type="button" variant="outline" size="sm" onClick={() => set({ objectives: [...form.objectives, { text: '', bonus: '', each: false, hidden: false }] })}>
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
                            {/* Only once the library has loaded, or it says so before it knows */}
                            <Say>{library ? 'no pictures in the library yet. upload one.' : 'loading pictures...'}</Say>
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
                            <Say>checking your fixers...</Say>
                        ) : (
                            <Say>
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
                        <Label help="the primary objective's pay, up to that plus every secondary bonus. a + means per-each bonuses can add more.">Pay</Label>
                        <Pay gig={{ pay: Number(form.pay) || 0, objectives: form.objectives.map((o) => ({ bonus: Number(o.bonus) || null, each: o.each, secret: o.hidden })) }} />
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle help="one runner per slot. crew slots are kept for that crew's runners until an admin opens them up. full gigs still take sign-ups as reserves.">
                        {/* The cap only shows once it's reached */}
                        Slots {totalSlots}
                        {totalSlots >= MAX_SLOTS && <span className={cn(totalSlots > MAX_SLOTS && 'text-destructive')}> / {MAX_SLOTS} max</span>}
                    </CardTitle>
                    {form.slots.map((s, i) => (
                        <div key={i} className="flex gap-2">
                            <Select
                                value={s.crewId}
                                onChange={(crewId) => setRow('slots', i, { crewId })}
                                options={[{ value: '', label: 'Freelance' }, ...crews.map((c) => ({ value: String(c.id), label: c.name, hint: 'Crew' }))]}
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
