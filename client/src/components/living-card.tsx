import { CUSTOM_LIMITS, CUSTOM_LIVING, type CustomLiving, LIFESTYLES, LIVING, livingFor, type LivingChoice, signed, totals } from '@shared/downtime';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const eb = (n: number) => `${n.toLocaleString('en-GB')}eb`;

/** Where a character lives and how, on their edit form. What they earn and owe follows from it. */
export function LivingCard({ value, onChange }: { value: LivingChoice; onChange: (patch: Partial<LivingChoice>) => void }) {
    const custom = value.living === CUSTOM_LIVING ? value.customLiving : null;
    const setCustom = (patch: Partial<CustomLiving>) => custom && onChange({ customLiving: { ...custom, ...patch } });

    // Custom starts from the place they'd picked, so a flatmate or owner only changes the rent
    const pickLiving = (living: string) => {
        if (living !== CUSTOM_LIVING) return onChange({ living: living || null, customLiving: null });
        const from = livingFor(value.living, value.customLiving);
        onChange({ living, customLiving: { name: from?.label ?? 'My place', dtMonth: from?.dtMonth ?? 0, dtGig: from?.dtGig ?? 0, rent: from?.rent ?? 0, humanity: from?.humanity ?? 0 } });
    };

    const t = totals(value);
    const anything = !!value.living || !!value.lifestyle;

    return (
        <Card className="space-y-4">
            <CardTitle help="only you and the admins can see this. it sets the downtime they get each month and per gig, and what's due on the 1st. use Custom for a shared or owned place.">Living</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <Label htmlFor="living">Living situation</Label>
                    <Select
                        id="living"
                        value={value.living ?? ''}
                        onChange={pickLiving}
                        options={[
                            { value: '', label: 'Not set' },
                            ...LIVING.map((l) => ({ value: l.key, label: l.label, hint: `${l.dtMonth} DT · ${eb(l.rent)}` })),
                            { value: CUSTOM_LIVING, label: 'Custom', hint: 'shared or owned' },
                        ]}
                    />
                </div>
                <div>
                    <Label htmlFor="lifestyle">Lifestyle</Label>
                    <Select
                        id="lifestyle"
                        value={value.lifestyle ?? ''}
                        onChange={(lifestyle) => onChange({ lifestyle: lifestyle || null })}
                        options={[{ value: '', label: 'Not set' }, ...LIFESTYLES.map((l) => ({ value: l.key, label: l.label, hint: `${l.dtMonth} DT · ${eb(l.cost)}` }))]}
                    />
                </div>
            </div>

            {custom && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_6rem_6rem_7rem_6rem]">
                    <div className="col-span-2 sm:col-span-1">
                        <Label htmlFor="custom-name">Name</Label>
                        <Input id="custom-name" value={custom.name} onChange={(e) => setCustom({ name: e.target.value })} maxLength={60} />
                    </div>
                    <Whole id="custom-dt" label="DT / month" value={custom.dtMonth} min={0} max={CUSTOM_LIMITS.dtMonth} onChange={(dtMonth) => setCustom({ dtMonth })} />
                    <Whole id="custom-gig" label="DT / gig" value={custom.dtGig} min={0} max={CUSTOM_LIMITS.dtGig} onChange={(dtGig) => setCustom({ dtGig })} />
                    <Whole id="custom-rent" label="Rent" value={custom.rent} min={0} max={CUSTOM_LIMITS.rent} onChange={(rent) => setCustom({ rent })} />
                    <Whole id="custom-humanity" label="Humanity" value={custom.humanity} min={CUSTOM_LIMITS.minHumanity} max={CUSTOM_LIMITS.maxHumanity} onChange={(humanity) => setCustom({ humanity })} />
                </div>
            )}

            {anything && (
                <p className="text-sm">
                    {t.dtMonth} DT a month, {t.dtGig} per gig, {eb(t.due)} due, humanity {signed(t.humanity)}
                </p>
            )}
        </Card>
    );
}

function Whole({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
    return (
        <div>
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        </div>
    );
}
