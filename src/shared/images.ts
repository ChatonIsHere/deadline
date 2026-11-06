/**
 * Bump when the frame in library/frame.ts changes. It's part of the framed file's name,
 * so Discord (which caches by URL) picks up the new look, and missing framed files get
 * rebuilt on startup. Old ones are kept because finished Discord posts still link to them.
 */
export const FRAME_VERSION = 6;

/** File names under /images. Everything is WebP. */
export const plainFile = (id: number) => `${id}.webp`;
/** Framed with a transparent margin, for Discord (its gallery preview crops the edges). */
export const framedFile = (id: number) => `${id}-framed-v${FRAME_VERSION}.webp`;
/** Framed to the edge, for the web. */
export const webFile = (id: number) => `${id}-web-v${FRAME_VERSION}.webp`;
/** Smaller copies of the web picture: thumb for pickers, grids and avatars, medium for gig cards. Sizes are in library/frame.ts. */
export const thumbFile = (id: number) => `${id}-thumb-v${FRAME_VERSION}.webp`;
export const mediumFile = (id: number) => `${id}-medium-v${FRAME_VERSION}.webp`;

/** Gig pictures are 16:9, which suits Discord's gallery view. Runner pictures are square. */
export const SIZES = {
    gig: { width: 1280, height: 720 },
    avatar: { width: 512, height: 512 },
} as const;
export type ImageKind = keyof typeof SIZES;
