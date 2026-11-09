import { NIGHT_CITY_TZ, wallTime } from './time';

// Downtime (DT) from where a character lives and how they live, by the campaign's house rules.

export interface Living {
    key: string;
    label: string;
    /** Most people who can live there. Null for nowhere in particular. */
    occupants: number | null;
    dtMonth: number;
    dtGig: number;
    rent: number;
    humanity: number;
    parking: number;
    price: number;
}

const place = (key: string, label: string, occupants: number | null, dtMonth: number, dtGig: number, rent: number, humanity: number, parking: number, price: number): Living => ({
    key,
    label,
    occupants,
    dtMonth,
    dtGig,
    rent,
    humanity,
    parking,
    price,
});

export const LIVING: Living[] = [
    place('homeless-wild', 'Homeless in the wild', null, 7, 3, 0, -1, 0, 0),
    place('homeless-streets', 'Homeless in the streets', null, 7, 3, 0, -1, 0, 0),
    place('homeless-vehicle', 'Homeless in a vehicle', 1, 7, 4, 0, -1, 0, 0),
    place('coffin', 'Coffin hotel room', 1, 10, 4, 500, -1, 0, 10_000),
    place('low-1', 'Low class, 1 occupant', 1, 14, 5, 1_000, 0, 0, 15_000),
    place('low-2', 'Low class, 2 occupants', 2, 14, 5, 1_500, 0, 0, 22_500),
    place('low-3', 'Low class, 3 occupants', 3, 14, 5, 2_000, 0, 0, 30_000),
    place('middle-2', 'Middle class, 2 occupants', 2, 21, 8, 4_000, 3, 1, 75_000),
    place('middle-3', 'Middle class, 3 occupants', 3, 21, 8, 6_000, 3, 1, 105_000),
    place('middle-4', 'Middle class, 4 occupants', 4, 21, 8, 8_000, 3, 2, 135_000),
    place('high-3', 'High class, 3 occupants', 3, 28, 11, 10_000, 7, 3, 225_000),
    place('high-4', 'High class, 4 occupants', 4, 28, 11, 12_000, 7, 4, 300_000),
    place('high-5', 'High class, 5 occupants', 5, 28, 11, 14_000, 7, 5, 375_000),
];

export interface Lifestyle {
    key: string;
    label: string;
    dtMonth: number;
    dtGig: number;
    cost: number;
    humanity: number;
}

export const LIFESTYLES: Lifestyle[] = [
    { key: 'squalid', label: 'Squalid', dtMonth: 1, dtGig: 1, cost: 100, humanity: -1 },
    { key: 'low', label: 'Low class', dtMonth: 3, dtGig: 2, cost: 300, humanity: 0 },
    { key: 'middle', label: 'Middle class', dtMonth: 6, dtGig: 3, cost: 600, humanity: 0 },
    { key: 'high', label: 'High class', dtMonth: 9, dtGig: 4, cost: 1_500, humanity: 1 },
    { key: 'upper', label: 'Upper crust', dtMonth: 12, dtGig: 5, cost: 2_500, humanity: 2 },
];

/** The living option for a shared or owned place, with its own numbers. */
export const CUSTOM_LIVING = 'custom';

/** Custom living can't do better than the best place on the table, or worse on humanity than the worst. */
export const CUSTOM_LIMITS = { dtMonth: 28, dtGig: 11, minHumanity: -1, maxHumanity: 7, rent: 1_000_000 };

export interface CustomLiving {
    name: string;
    dtMonth: number;
    dtGig: number;
    rent: number;
    humanity: number;
}

export interface LivingChoice {
    living: string | null;
    lifestyle: string | null;
    customLiving: CustomLiving | null;
}

/** What a living choice gives, or null if none is set. */
export function livingFor(living: string | null, custom: CustomLiving | null): Pick<Living, 'label' | 'dtMonth' | 'dtGig' | 'rent' | 'humanity'> | null {
    if (living === CUSTOM_LIVING) return custom && { label: custom.name, dtMonth: custom.dtMonth, dtGig: custom.dtGig, rent: custom.rent, humanity: custom.humanity };
    return LIVING.find((l) => l.key === living) ?? null;
}

/** What a character's living situation and lifestyle add up to. Either one unset counts as nothing. */
export function totals({ living, lifestyle, customLiving }: LivingChoice) {
    const home = livingFor(living, customLiving);
    const style = LIFESTYLES.find((l) => l.key === lifestyle);
    return {
        dtMonth: (home?.dtMonth ?? 0) + (style?.dtMonth ?? 0),
        dtGig: (home?.dtGig ?? 0) + (style?.dtGig ?? 0),
        due: (home?.rent ?? 0) + (style?.cost ?? 0),
        humanity: (home?.humanity ?? 0) + (style?.humanity ?? 0),
    };
}
export type Totals = ReturnType<typeof totals>;

/** Whether a character has a living situation or lifestyle at all. */
export const hasLiving = (c: LivingChoice) => !!livingFor(c.living, c.customLiving) || LIFESTYLES.some((l) => l.key === c.lifestyle);

/** The zone a month turns over in for someone who hasn't picked one. */
export const DEFAULT_TZ = NIGHT_CITY_TZ;

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * Which DT month it is for a player, as "2026-11". It moves over at noon on the 1st on their
 * own clock. Keys sort in date order, so a later month is simply a greater string.
 */
export function periodAt(ms: number, tz: string): string {
    const w = wallTime(ms, tz);
    if (w.day === 1 && w.hour < 12) return w.month === 1 ? key(w.year - 1, 12) : key(w.year, w.month - 1);
    return key(w.year, w.month);
}

export function previousPeriod(period: string): string {
    const [year, month] = period.split('-').map(Number);
    return month === 1 ? key(year - 1, 12) : key(year, month - 1);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11" as "November". */
export const periodName = (period: string) => MONTH_NAMES[Number(period.split('-')[1]) - 1];

/** "+3" or "-1" or "0". */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
