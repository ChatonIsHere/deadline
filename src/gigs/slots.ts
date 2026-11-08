import type { SlotGroup } from '../shared/schemas';

export interface Slot {
    id: string;
    crewId: string | null;
    userId: string | null;
    unlimited?: boolean;
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
 * are never removed, so asking for fewer slots than are filled is an error. A group with a
 * count of 0 has no limit, and is left with one empty slot.
 */
export function diffSlots(existing: Slot[], groups: SlotGroup[]): SlotChanges {
    const wanted = new Map<string | null, number>();
    for (const g of groups) wanted.set(g.crewId, (wanted.get(g.crewId) ?? 0) + g.count);

    const changes: SlotChanges = { add: [], remove: [] };
    const crewIds = new Set([...wanted.keys(), ...existing.map((s) => s.crewId)]);
    const unlimited = unlimitedGroups(groups);

    for (const crewId of crewIds) {
        const current = existing.filter((s) => s.crewId === crewId);
        if (unlimited.has(crewId)) {
            const empty = current.filter((s) => s.userId === null);
            if (!empty.length) changes.add.push(crewId);
            changes.remove.push(...empty.slice(0, -1).map((s) => s.id));
            continue;
        }
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

/** The groups asked for with no limit (a count of 0). */
export function unlimitedGroups(groups: SlotGroup[]): Set<string | null> {
    return new Set(groups.filter((g) => g.count === 0).map((g) => g.crewId));
}

/**
 * What an unlimited group needs so it has `spare` empty slots: one to sign up to normally,
 * more while reserves are moving in. Later slots are the ones kept, so the spare stays at the
 * end of the list. Takes slots in position order.
 */
export function spareChanges(slots: Slot[], spare = 1): SlotChanges {
    const changes: SlotChanges = { add: [], remove: [] };
    for (const crewId of new Set(slots.filter((s) => s.unlimited).map((s) => s.crewId))) {
        const empty = slots.filter((s) => s.crewId === crewId && s.userId === null);
        for (let i = empty.length; i < spare; i++) changes.add.push(crewId);
        changes.remove.push(...empty.slice(0, Math.max(0, empty.length - spare)).map((s) => s.id));
    }
    return changes;
}

/** The groups stored slots came from, for checking a saved gig against gigInput. */
export function slotGroups(slots: Slot[]): SlotGroup[] {
    const crewIds = [...new Set(slots.map((s) => s.crewId))];
    return crewIds.map((crewId) => {
        const group = slots.filter((s) => s.crewId === crewId);
        return { crewId, count: group.some((s) => s.unlimited) ? 0 : group.length };
    });
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

/**
 * Crew members in open slots who could move to an empty slot of one of their crews. Moving
 * them frees the open slot for anyone on the reserves.
 */
export function shiftToCrewSlots(slots: (Slot & { crewIds: string[] })[]): { from: string; to: string }[] {
    const empty = slots.filter((s) => s.userId === null && s.crewId !== null);
    const moves: { from: string; to: string }[] = [];
    for (const slot of slots) {
        if (slot.userId === null || slot.crewId !== null) continue;
        const i = empty.findIndex((e) => slot.crewIds.includes(e.crewId!));
        if (i === -1) continue;
        moves.push({ from: slot.id, to: empty[i].id });
        empty.splice(i, 1);
    }
    return moves;
}
