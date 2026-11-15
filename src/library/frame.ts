import { type ImageKind, SIZES } from '../shared/images';

// The sizes live in shared/ so the web's crop tool uses the same shapes
export { SIZES };
export type { ImageKind };

/**
 * Discord's forum gallery crops previews to about 1.485:1 (measured: 802x540 on mobile; desktop
 * sits between about 1.42 and 1.54). Gig cards (gig-card.ts) are cut to this shape from the
 * plain 1280x720 picture, so nothing is upscaled. The frame's margin covers the desktop range.
 */
export const FORUM = { width: 1070, height: 720 } as const;

/** Smaller copies of each plain picture, so lists and pickers don't load full-size files. */
export const PREVIEWS = {
    gig: { thumb: { width: 320, height: 180 }, medium: { width: 640, height: 360 } },
    avatar: { thumb: { width: 96, height: 96 }, medium: { width: 256, height: 256 } },
} as const;

export { frameSvg, type Variant, VARIANTS, variantFor, variantIndex } from '../shared/frame';
