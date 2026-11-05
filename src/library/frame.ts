/** Gig images are stored at this size (16:9, which suits Discord's gallery view). */
export const WIDTH = 1280;
export const HEIGHT = 720;

const BG = '#0a0a12';
const YELLOW = '#f3e600';
const CYAN = '#00e5ff';
const PINK = '#ff2a6d';

/**
 * The border drawn over every gig image, as SVG: cut corners like the web UI,
 * neon edges, corner brackets and a few barcode ticks. No text, so no fonts needed.
 */
export function frameSvg(): string {
    const W = WIDTH;
    const H = HEIGHT;
    const P = 14; // dark margin
    const C = 72; // corner cut

    const inner = `M${P} ${P}H${W - P - C}L${W - P} ${P + C}V${H - P}H${P + C}L${P} ${H - P - C}Z`;
    let x = W - P - 320;
    const bars = [6, 14, 4, 10, 4, 22, 8, 4, 12, 6, 4, 16]
        .map((w) => {
            const bar = `<rect x="${x}" y="${H - P - 30}" width="${w}" height="12" fill="${PINK}"/>`;
            x += w + 5;
            return bar;
        })
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity="0.22"/></pattern>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${BG}" stop-opacity="0"/><stop offset="1" stop-color="${BG}" stop-opacity="0.55"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#scan)"/>
<rect width="${W}" height="${H}" fill="url(#fade)"/>
<path fill="${BG}" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z ${inner}"/>
<path fill="none" stroke="${YELLOW}" stroke-width="2" stroke-opacity="0.7" d="${inner}"/>
<path fill="none" stroke="${YELLOW}" stroke-width="8" d="M${W - P - C - 220} ${P + 2}H${W - P - C}L${W - P - 2} ${P + C}V${P + C + 140}"/>
<path fill="none" stroke="${YELLOW}" stroke-width="8" d="M${P + C + 220} ${H - P - 2}H${P + C}L${P + 2} ${H - P - C}V${H - P - C - 140}"/>
<path fill="none" stroke="${CYAN}" stroke-width="5" d="M${P + 22} ${P + 90}V${P + 22}H${P + 90}"/>
<path fill="none" stroke="${CYAN}" stroke-width="5" d="M${W - P - 22} ${H - P - 90}V${H - P - 22}H${W - P - 90}"/>
<rect x="${P + 22}" y="${P + 104}" width="5" height="40" fill="${PINK}"/>
${bars}
</svg>`;
}
