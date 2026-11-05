// Typed IDs for runners and crews, used in URLs next to the numeric ones: /runners/vex, /crews/static-wolves.

/** Lowercase letters, numbers, _ and -, with at least one letter so it can't be mistaken for a numeric ID. */
export const SLUG = /^(?=.*[a-z])[a-z0-9_-]{2,40}$/;
export const SLUG_HINT = '2 to 40 letters, numbers, _ or -, with at least one letter';

/** Words the routes already use (/runners/new, /api/runners/mine, /api/crews/invites). */
export const RESERVED_SLUGS = ['new', 'mine', 'invites', 'edit'];
export const isFreeSlugWord = (slug: string) => SLUG.test(slug) && !RESERVED_SLUGS.includes(slug);

/** A suggestion from a name: "Static Wolves!" becomes "static-wolves". May still need fixing up (see SLUG). */
export function toSlug(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

/** Whether a URL part is a numeric ID rather than a typed one. */
export const isNumericId = (ref: string) => /^\d+$/.test(ref);
