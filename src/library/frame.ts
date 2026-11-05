/** Gig pictures are 16:9, which suits Discord's gallery view. Runner pictures are square. */
export const SIZES = {
    gig: { width: 1280, height: 720 },
    avatar: { width: 512, height: 512 },
} as const;
export type ImageKind = keyof typeof SIZES;

const BG = '#0a0a12';
const YELLOW = '#f3e600';
const CYAN = '#00e5ff';
const PINK = '#ff2a6d';

/**
 * The border drawn over every picture, as SVG: cut corners like the web UI, neon edges,
 * corner brackets and a few barcode ticks. Sized off the 1280x720 gig frame, so it scales
 * down for avatars. No text, so no fonts needed.
 */
export function frameSvg(W: number, H: number): string {
    const s = Math.min(W, H) / 720;
    const n = (v: number) => Math.round(v * s);
    const P = n(28); // dark margin. Wide enough to survive the crop in Discord's gallery preview.
    const C = n(72); // corner cut

    const inner = `M${P} ${P}H${W - P - C}L${W - P} ${P + C}V${H - P}H${P + C}L${P} ${H - P - C}Z`;
    let x = W - P - n(320);
    const bars = [6, 14, 4, 10, 4, 22, 8, 4, 12, 6, 4, 16]
        .map((w) => {
            const bar = `<rect x="${x}" y="${H - P - n(30)}" width="${n(w)}" height="${n(12)}" fill="${PINK}"/>`;
            x += n(w + 5);
            return bar;
        })
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.22"/></pattern>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity="0.55"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#scan)"/>
<rect width="${W}" height="${H}" fill="url(#fade)"/>
<path fill="${BG}" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z ${inner}"/>
<path fill="none" stroke="${YELLOW}" stroke-width="${Math.max(1, n(2))}" stroke-opacity="0.7" d="${inner}"/>
<path fill="none" stroke="${YELLOW}" stroke-width="${n(8)}" d="M${W - P - C - n(220)} ${P + n(2)}H${W - P - C}L${W - P - n(2)} ${P + C}V${P + C + n(140)}"/>
<path fill="none" stroke="${YELLOW}" stroke-width="${n(8)}" d="M${P + C + n(220)} ${H - P - n(2)}H${P + C}L${P + n(2)} ${H - P - C}V${H - P - C - n(140)}"/>
<path fill="none" stroke="${CYAN}" stroke-width="${n(5)}" d="M${P + n(22)} ${P + n(90)}V${P + n(22)}H${P + n(90)}"/>
<path fill="none" stroke="${CYAN}" stroke-width="${n(5)}" d="M${W - P - n(22)} ${H - P - n(90)}V${H - P - n(22)}H${W - P - n(90)}"/>
<rect x="${P + n(22)}" y="${P + n(104)}" width="${n(5)}" height="${n(40)}" fill="${PINK}"/>
${bars}
</svg>`;
}
