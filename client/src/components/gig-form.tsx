import { gigInput, type GigInput, type GigView, MAX_SLOTS } from '@shared/schemas';
import { Plus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Icon } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { useCrews, useGigTypes } from '@/lib/api';

// Numbers are kept as strings while typing so fields can be empty.
interface FormState {
    name: string;
    fixerName: string;
    location: string;
    type: string;
    pay: string;
    objective: string;
    objectives: { text: string; bonus: string }[];
    slots: { crewId: string; count: string }[];
}

function toForm(gig?: GigView): FormState {
    if (!gig) {
        return { name: '', fixerName: '', location: '', type: '', pay: '', objective: '', objectives: [], slots: [{ crewId: '', count: '4' }] };
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
        objectives: gig.objectives.map((o) => ({ text: o.text, bonus: o.bonus ? String(o.bonus) : '' })),
        slots: [...counts].map(([crewId, count]) => ({ crewId, count: String(count) })),
    };
}

function fromForm(form: FormState): GigInput {
    return {
        ...form,
        type: form.type.trim() || null,
        pay: form.pay === '' ? NaN : Number(form.pay),
        objectives: form.objectives.map((o) => ({ text: o.text, bonus: o.bonus ? Number(o.bonus) : null })),
        slots: form.slots.map((s) => ({ crewId: s.crewId ? Number(s.crewId) : null, count: Number(s.count) })),
    };
}

export function GigForm({ gig, saving, onSave }: { gig?: GigView; saving: boolean; onSave: (input: GigInput) => void }) {
    const [form, setForm] = useState(() => toForm(gig));
    const [error, setError] = useState('');
    const crews = useCrews().data ?? [];
    const types = useGigTypes().data ?? [];

    const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
    const setRow = <K extends 'objectives' | 'slots'>(key: K, i: number, patch: Partial<FormState[K][number]>) =>
        set({ [key]: form[key].map((row, j) => (j === i ? { ...row, ...patch } : row)) });
    const removeRow = (key: 'objectives' | 'slots', i: number) => set({ [key]: form[key].filter((_, j) => j !== i) });

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
                        <Label htmlFor="objective">Primary objective</Label>
                        <Textarea id="objective" value={form.objective} onChange={(e) => set({ objective: e.target.value })} maxLength={2000} rows={6} />
                    </div>
                </Card>

                <Card className="space-y-3">
                    <CardTitle>Secondary objectives</CardTitle>
                    {form.objectives.map((o, i) => (
                        <div key={i} className="flex gap-2">
                            <Input value={o.text} onChange={(e) => setRow('objectives', i, { text: e.target.value })} placeholder="Objective" maxLength={150} />
                            <div className="relative w-36 shrink-0">
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
                            <Button type="button" variant="ghost" size="icon" className="mt-0.5" onClick={() => removeRow('objectives', i)}>
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
                <Card className="space-y-4">
                    <CardTitle>Details</CardTitle>
                    <div>
                        <Label htmlFor="fixer">Fixer</Label>
                        <Input id="fixer" value={form.fixerName} onChange={(e) => set({ fixerName: e.target.value })} maxLength={60} />
                    </div>
                    <div>
                        <Label htmlFor="location">Location</Label>
                        <Input id="location" value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={100} />
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
                <Button type="submit" className="w-full" disabled={saving}>
                    {gig ? 'Save changes' : 'Post the gig'}
                </Button>
            </div>
        </form>
    );
}
