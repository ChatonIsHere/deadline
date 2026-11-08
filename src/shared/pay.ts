/**
 * An overall pay pot divided between `count` runners in whole eddies. Everyone gets the same,
 * and what's left over goes 1 each from the front of the list. Pass runners oldest first.
 */
export function splitPot(pot: number, count: number): number[] {
    if (count <= 0) return [];
    const base = Math.floor(pot / count);
    const left = pot - base * count;
    return Array.from({ length: count }, (_, i) => base + (i < left ? 1 : 0));
}
