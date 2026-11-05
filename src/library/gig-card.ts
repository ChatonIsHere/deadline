import { join } from 'node:path';
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';
import sharp from 'sharp';
import { FORUM, frameSvg, type Variant } from './frame';

/**
 * A gig's picture for Discord: cut to the forum gallery preview's shape, framed, with the
 * operation's name on the left, centred top to bottom (clear of the forum's tags along the
 * bottom), one word per line, as big as fits. PNG: Discord labels WebP pictures as GIFs.
 * Bump when the look changes, so Discord fetches new copies.
 */
export const CARD_VERSION = 3;

/** Chakra Petch Bold (SIL Open Font License, see assets/fonts/OFL.txt), the site's heading font. */
const FONT = join(__dirname, '..', '..', 'assets', 'fonts', 'ChakraPetch-Bold.ttf');
const RESVG: ResvgRenderOptions = { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Chakra Petch' } };

const Y = '#f3e600';
const P = '#ff2a6d';
const BG = '#0a0a12';

/** Room the name may take, as parts of the space inside the frame. Wider would run into the barcode. */
const MAX_WIDTH = 0.6;
const MAX_HEIGHT = 0.5;
/** Gap between lines' baselines, in cap heights. */
const LINE = 1.5;
/** Each word sits on a dark bar so it reads on bright pictures too. Padding in cap heights. */
const BAR_X = 0.3;
const BAR_Y = 0.17;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textSvg = (inner: string, w = 4000, h = 400) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${inner}</svg>`;

/** Width and cap height of text in the font at size 100. */
function measure(text: string): { width: number; height: number } {
    const box = new Resvg(textSvg(`<text x="0" y="200" font-family="Chakra Petch" font-weight="700" font-size="100">${escape(text)}</text>`), RESVG).getBBox();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
}

export async function renderGigCard(plain: Buffer, variant: Variant, name: string): Promise<Buffer> {
    const { width: W, height: H } = FORUM;
    const { overlay, mask } = frameSvg(W, H, { variant, padded: true });
    const framed = await sharp(plain)
        .resize(W, H, { fit: 'cover' })
        .ensureAlpha()
        .composite([
            { input: Buffer.from(mask), blend: 'dest-in' },
            { input: Buffer.from(overlay) },
        ])
        .png()
        .toBuffer();

    const words = name.toUpperCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sharp(framed).png({ palette: true, quality: 95, effort: 10, dither: 1 }).toBuffer();

    // The frame's margin and padding inside it (same scale as frame.ts, sized off 720 high)
    const s = Math.min(W, H) / 720;
    const margin = Math.round(28 * s);
    const pad = Math.round(44 * s);

    // As big as fits: the longest word within the width, all lines within the height
    const cap = measure('H').height;
    const widest = Math.max(...words.map((w) => measure(w).width));
    const byWidth = ((W - 2 * margin) * MAX_WIDTH * 100) / (widest + 2 * BAR_X * cap);
    const byHeight = ((H - 2 * margin) * MAX_HEIGHT * 100) / (cap * (1 + 2 * BAR_Y + (words.length - 1) * LINE));
    const size = Math.min(byWidth, byHeight);
    const capPx = (cap * size) / 100;

    const padX = capPx * BAR_X;
    const padY = capPx * BAR_Y;
    const x = margin + pad + padX;
    const blockHeight = capPx * (1 + (words.length - 1) * LINE);
    const firstBaseline = (H - blockHeight) / 2 + capPx;
    const lines = words
        .map((word, i) => {
            const y = firstBaseline + i * capPx * LINE;
            const text = escape(word);
            // The bar: dark, a pink edge on the left, the bottom right corner cut like the frame
            const left = x - padX;
            const right = x + (measure(word).width * size) / 100 + padX;
            const top = y - capPx - padY;
            const bottom = y + padY;
            const cut = (bottom - top) * 0.35;
            const bar =
                `<path d="M${left} ${top}H${right}V${bottom - cut}L${right - cut} ${bottom}H${left}Z" fill="${BG}" fill-opacity="0.82"/>` +
                `<rect x="${left}" y="${top}" width="${capPx * 0.09}" height="${bottom - top}" fill="${P}"/>`;
            const font = `font-family="Chakra Petch" font-weight="700" font-size="${size.toFixed(1)}"`;
            // A pink offset copy behind (the glitch look of the emoji), then yellow with a dark edge
            return (
                bar +
                `<text x="${x - size * 0.035}" y="${y + size * 0.03}" ${font} fill="${P}" opacity="0.7">${text}</text>` +
                `<text x="${x}" y="${y}" ${font} fill="${Y}" stroke="${BG}" stroke-width="${(size * 0.04).toFixed(1)}" stroke-linejoin="round" paint-order="stroke">${text}</text>`
            );
        })
        .join('');

    const label = new Resvg(textSvg(lines, W, H), RESVG).render().asPng();
    return sharp(framed)
        .composite([{ input: label }])
        // A 256 colour palette: looks the same at preview size, a fifth of the size
        .png({ palette: true, quality: 95, effort: 10, dither: 1 })
        .toBuffer();
}
