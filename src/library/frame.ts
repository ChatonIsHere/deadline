/** Gig pictures are 16:9, which suits Discord's gallery view. Runner pictures are square. */
export const SIZES = {
    gig: { width: 1280, height: 720 },
    avatar: { width: 512, height: 512 },
} as const;
export type ImageKind = keyof typeof SIZES;

/**
 * Discord's forum gallery crops previews to about 1.485:1 (measured: 802x540 on mobile; desktop
 * sits between about 1.42 and 1.54). Gig pictures for Discord get cut to this shape from the
 * plain 1280x720 one, so nothing is upscaled. The frame's margin covers the desktop range.
 */
export const FORUM = { width: 1070, height: 720 } as const;

/** Smaller copies of each plain picture, so lists and pickers don't load full-size files. */
export const PREVIEWS = {
    gig: { thumb: { width: 320, height: 180 }, medium: { width: 640, height: 360 } },
    avatar: { thumb: { width: 96, height: 96 }, medium: { width: 256, height: 256 } },
} as const;

const BG = '#0a0a12';
const Y = '#f3e600';
const C = '#00e5ff';
const P = '#ff2a6d';

/**
 * One look for the frame. Every variant has the same parts: a thin inner edge, two big
 * brackets (top right, bottom left), two small corner marks, a side tick and a barcode.
 * They differ in which colour goes where and how long the brackets are.
 */
interface Variant {
    edge: string;
    /** Top right and bottom left brackets. */
    major: [string, string];
    minor: string;
    tick: string;
    /** Barcode colour, or null for none. */
    bars: string | null;
    /** Bracket length along the long side, at 1280x720. */
    reach: number;
    /** Barcode in the bottom right, or along the top left. */
    barsTop?: boolean;
}

export const VARIANTS: Variant[] = [
    { edge: Y, major: [Y, Y], minor: C, tick: P, bars: P, reach: 220 },
    { edge: C, major: [C, C], minor: Y, tick: Y, bars: Y, reach: 260 },
    { edge: P, major: [P, P], minor: C, tick: C, bars: C, reach: 180, barsTop: true },
    { edge: Y, major: [Y, C], minor: P, tick: C, bars: C, reach: 300 },
    { edge: C, major: [P, Y], minor: C, tick: Y, bars: P, reach: 140, barsTop: true },
    { edge: Y, major: [C, C], minor: Y, tick: P, bars: null, reach: 360 },
];

/** Which variant a picture gets. Fixed per picture, so rebuilding keeps its look. */
export const variantFor = (imageId: number): Variant => VARIANTS[imageId % VARIANTS.length];

/**
 * The frame drawn over a picture, as SVG, sized off the 1280x720 gig frame so it scales
 * down for avatars. No text, so no fonts needed.
 *
 * `mask` is the shape the picture is cut to: outside it is transparent, so the frame sits
 * on whatever background it's shown on.
 *
 * `padded` leaves a transparent margin wide enough to survive the crop in Discord's gallery
 * preview. The web doesn't need it (the page spaces things out), so its copies run the frame
 * to the edge. `solid` fills the margin instead (for the bot banner).
 */
export function frameSvg(W: number, H: number, { variant: v = VARIANTS[0], padded = true, solid = false }: { variant?: Variant; padded?: boolean; solid?: boolean } = {}): { overlay: string; mask: string } {
    const s = Math.min(W, H) / 720;
    const n = (x: number) => Math.round(x * s);
    // Unpadded still keeps half a bracket's width, so the thick strokes aren't cut off
    const M = padded ? n(28) : n(4);
    const K = n(72); // corner cut
    const reach = n(v.reach);

    const inner = `M${M} ${M}H${W - M - K}L${W - M} ${M + K}V${H - M}H${M + K}L${M} ${H - M - K}Z`;

    // Barcode, bottom right or along the top
    let bars = '';
    if (v.bars) {
        let x = v.barsTop ? M + K + n(40) : W - M - n(320);
        const y = v.barsTop ? M + n(18) : H - M - n(30);
        for (const w of [6, 14, 4, 10, 4, 22, 8, 4, 12, 6, 4, 16]) {
            bars += `<rect x="${x}" y="${y}" width="${n(w)}" height="${n(12)}" fill="${v.bars}"/>`;
            x += n(w + 5);
        }
    }

    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.22"/></pattern>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity="0.55"/></linearGradient>
<clipPath id="in"><path d="${inner}"/></clipPath>
</defs>
<g clip-path="url(#in)"><rect width="${W}" height="${H}" fill="url(#scan)"/><rect width="${W}" height="${H}" fill="url(#fade)"/></g>
${solid ? `<path fill="${BG}" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z ${inner}"/>` : ''}
<path fill="none" stroke="${v.edge}" stroke-width="${Math.max(1, n(2))}" stroke-opacity="0.7" d="${inner}"/>
<path fill="none" stroke="${v.major[0]}" stroke-width="${n(8)}" d="M${W - M - K - reach} ${M + n(2)}H${W - M - K}L${W - M - n(2)} ${M + K}V${M + K + Math.round(reach * 0.64)}"/>
<path fill="none" stroke="${v.major[1]}" stroke-width="${n(8)}" d="M${M + K + reach} ${H - M - n(2)}H${M + K}L${M + n(2)} ${H - M - K}V${H - M - K - Math.round(reach * 0.64)}"/>
<path fill="none" stroke="${v.minor}" stroke-width="${n(5)}" d="M${M + n(22)} ${M + n(90)}V${M + n(22)}H${M + n(90)}"/>
<path fill="none" stroke="${v.minor}" stroke-width="${n(5)}" d="M${W - M - n(22)} ${H - M - n(90)}V${H - M - n(22)}H${W - M - n(90)}"/>
<rect x="${M + n(22)}" y="${M + n(104)}" width="${n(5)}" height="${n(40)}" fill="${v.tick}"/>
${bars}
</svg>`;

    // The picture is cut exactly at the edge line; nothing shows outside it
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path fill="#fff" d="${inner}"/></svg>`;
    return { overlay, mask };
}
