import type { SlotGroup } from '../shared/schemas';

export interface Slot {
    id: number;
    crewId: number | null;
    userId: string | null;
}

/** The slot a runner should take: one of their crews' slots first, then an open one. */
export function pickSlot<T extends Slot>(slots: T[], crewIds: number[]): T | null {
    const empty = slots.filter((s) => s.userId === null);
    return empty.find((s) => s.crewId !== null && crewIds.includes(s.crewId)) ?? empty.find((s) => s.crewId === null) ?? null;
}

export interface SlotChanges {
    add: (number | null)[];
    remove: number[];
}

/**
 * Works out how to turn the current slots into the requested groups. Filled slots
 * are never removed, so asking for fewer slots than are filled is an error.
 */
export function diffSlots(existing: Slot[], groups: SlotGroup[]): SlotChanges {
    const wanted = new Map<number | null, number>();
    for (const g of groups) wanted.set(g.crewId, (wanted.get(g.crewId) ?? 0) + g.count);

    const changes: SlotChanges = { add: [], remove: [] };
    const crewIds = new Set([...wanted.keys(), ...existing.map((s) => s.crewId)]);

    for (const crewId of crewIds) {
        const current = existing.filter((s) => s.crewId === crewId);
        const filled = current.filter((s) => s.userId !== null).length;
        const count = wanted.get(crewId) ?? 0;

        if (count < filled) {
            throw new Error(`Can't drop below ${filled} slot(s) that are already taken.`);
        }
        if (count > current.length) {
            for (let i = current.length; i < count; i++) changes.add.push(crewId);
        } else {
            const empty = current.filter((s) => s.userId === null);
            changes.remove.push(...empty.slice(0, current.length - count).map((s) => s.id));
        }
    }
    return changes;
}
