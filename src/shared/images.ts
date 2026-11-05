/**
 * Bump when the frame in library/frame.ts changes. It's part of the framed file's name,
 * so Discord (which caches by URL) picks up the new look, and missing framed files get
 * rebuilt on startup. Old ones are kept because finished Discord posts still link to them.
 */
export const FRAME_VERSION = 4;

/** File names under /images. Everything is WebP. */
export const plainFile = (id: number) => `${id}.webp`;
export const framedFile = (id: number) => `${id}-framed-v${FRAME_VERSION}.webp`;
/** Smaller plain copies: thumb for pickers and grids, medium for gig cards. Sizes are in library/frame.ts. */
export const thumbFile = (id: number) => `${id}-thumb.webp`;
export const mediumFile = (id: number) => `${id}-medium.webp`;
