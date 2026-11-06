/** Slots grouped for display: crew slots first in the order they appear, open slots last. */
export function groupSlots<T extends { crew: { id: string; name: string } | null }>(slots: T[]) {
    const groups = new Map<string | null, { crew: T['crew']; slots: T[] }>();
    for (const slot of slots) {
        const key = slot.crew?.id ?? null;
        if (!groups.has(key)) groups.set(key, { crew: slot.crew, slots: [] });
        groups.get(key)!.slots.push(slot);
    }
    return [...groups.values()].sort((a, b) => (a.crew ? 0 : 1) - (b.crew ? 0 : 1));
}
