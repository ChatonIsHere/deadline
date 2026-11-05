import { isFreeSlugWord, toSlug } from '../shared/slug';

/**
 * A free typed ID made from a name, with -2, -3... added while it's taken. Names that don't
 * make a valid one on their own (too short, only digits, a reserved word) get `prefix` in front: "2077" becomes "runner-2077".
 */
export function freeSlug(name: string, prefix: string, taken: (slug: string) => boolean): string {
    let base = toSlug(name);
    if (!isFreeSlugWord(base)) base = `${prefix}-${base}`.replace(/-+$/, '').slice(0, 40);
    let slug = base;
    for (let n = 2; taken(slug); n++) slug = `${base.slice(0, 36)}-${n}`;
    return slug;
}
