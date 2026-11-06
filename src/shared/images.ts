/**
 * Bump when the frame in library/frame.ts changes. It's part of the framed files' names, so
 * Discord (which caches by URL) picks up the new look, and missing copies get rebuilt on
 * startup. Old ones are kept a while for finished Discord posts, then cleaned up.
 */
export const FRAME_VERSION = 6;

// Stored files, by key, linked straight from the bucket: <endpoint>/<bucket>/images/<id>/web-v6.webp
// (or this server's /images/ in local dev). Everything is WebP but the gig cards.

/** Everything belonging to one picture. */
export const imagePrefix = (id: string) => `images/${id}/`;
export const plainFile = (id: string) => `images/${id}/plain.webp`;
/** Framed with a transparent margin, for Discord (its gallery preview crops the edges). */
export const framedFile = (id: string) => `images/${id}/framed-v${FRAME_VERSION}.webp`;
/** Framed to the edge, for the web. */
export const webFile = (id: string) => `images/${id}/web-v${FRAME_VERSION}.webp`;
/** Smaller copies of the web picture: thumb for pickers, grids and avatars, medium for gig cards. Sizes are in library/frame.ts. */
export const thumbFile = (id: string) => `images/${id}/thumb-v${FRAME_VERSION}.webp`;
export const mediumFile = (id: string) => `images/${id}/medium-v${FRAME_VERSION}.webp`;
/** A gig's Discord card (its picture with the name on it), one per name and picture. */
export const cardFile = (gigId: string, hash: string) => `images/cards/${gigId}/${hash}.png`;

/** Gig pictures are 16:9, which suits Discord's gallery view. Runner pictures are square. */
export const SIZES = {
    gig: { width: 1280, height: 720 },
    avatar: { width: 512, height: 512 },
} as const;
export type ImageKind = keyof typeof SIZES;
