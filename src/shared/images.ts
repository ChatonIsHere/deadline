/**
 * Bump when the frame in library/frame.ts changes. It's part of the framed file's name,
 * so Discord (which caches by URL) picks up the new look, and old framed files get
 * rebuilt on startup.
 */
export const FRAME_VERSION = 2;

/** File name of an image with its frame, served under /images. */
export const framedFile = (id: number) => `${id}-framed-v${FRAME_VERSION}.jpg`;
