// Links to records. Every gig, runner and crew is keyed by a UUID, which works in any URL. The
// links people see are readable: gigs are the first part of their UUID and their name
// (/gigs/3f2a9c1b-overzealous-squanch), runners and crews their handle or name (/runners/vex,
// /crews/static-wolves). Handles and crew names are one of a kind, so those links are too.

/** What a handle or name's link has to look like: has a letter, 1 to 40 long. */
export const SLUG = /^(?=.*[a-z])[a-z0-9_-]{1,40}$/;

/** Words the routes already use (/runners/new, /api/runners/mine, /api/crews/invites). */
export const RESERVED_SLUGS = ['new', 'mine', 'invites', 'edit'];
export const isFreeSlugWord = (slug: string) => SLUG.test(slug) && !RESERVED_SLUGS.includes(slug);

/** A name as it appears in links: "Static Wolves!" becomes "static-wolves". */
export function toSlug(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

export const isUuid = (ref: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);

/** A gig's link: "3f2a9c1b-overzealous-squanch". The deadline:// bar shows it in capitals. */
export const gigRef = (gig: { id: string; name: string }) => [gig.id.slice(0, 8), toSlug(gig.name)].filter(Boolean).join('-');

/** The UUID start in a gig link ("3f2a9c1b" from "3f2a9c1b-overzealous-squanch"), or null if it isn't one. */
export const gigRefPrefix = (ref: string) => /^([0-9a-f]{8})(?:-|$)/i.exec(ref)?.[1].toLowerCase() ?? null;
