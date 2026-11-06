import type { SlotGroup } from '../shared/schemas';

export interface Slot {
    id: string;
    crewId: string | null;
    userId: string | null;
}

/** The slot a runner should take: one of their crews' slots first, then an open one. */
export function pickSlot<T extends Slot>(slots: T[], crewIds: string[]): T | null {
    const empty = slots.filter((s) => s.userId === null);
    return empty.find((s) => s.crewId !== null && crewIds.includes(s.crewId)) ?? empty.find((s) => s.crewId === null) ?? null;
}

export interface SlotChanges {
    add: (string | null)[];
    remove: string[];
}

/**
 * Works out how to turn the current slots into the requested groups. Filled slots
 * are never removed, so asking for fewer slots than are filled is an error.
 */
export function diffSlots(existing: Slot[], groups: SlotGroup[]): SlotChanges {
    const wanted = new Map<string | null, number>();
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

export interface Reserve {
    userId: string;
    crewIds: string[];
}

/**
 * Moves reserves (oldest first) into empty slots they can take. Crew slots are filled
 * first so a crew member doesn't use up an open slot that someone else could have had.
 */
export function fillFromReserves(slots: Slot[], reserves: Reserve[]): { slotId: string; userId: string }[] {
    const waiting = [...reserves];
    const empty = slots.filter((s) => s.userId === null).sort((a, b) => (a.crewId === null ? 1 : 0) - (b.crewId === null ? 1 : 0));
    const moves: { slotId: string; userId: string }[] = [];
    for (const slot of empty) {
        const i = waiting.findIndex((r) => slot.crewId === null || r.crewIds.includes(slot.crewId));
        if (i === -1) continue;
        moves.push({ slotId: slot.id, userId: waiting[i].userId });
        waiting.splice(i, 1);
    }
    return moves;
}
