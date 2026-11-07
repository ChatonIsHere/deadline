// Writes client/src/styles/reveal.css: the masks pictures appear through, a square at a time.
// Each mask is a strip of frames, every frame showing a few more squares than the one before
// (in a fixed shuffled order). The animation steps the mask along the strip, so a picture
// costs a handful of repaints and no script. Run: node scripts/reveal-masks.mjs
import { writeFileSync } from 'node:fs';

const FRAMES = 10;

/** A cheap seeded shuffle, so the file only changes when this script does. */
function shuffled(n, seed) {
    const list = Array.from({ length: n }, (_, i) => i);
    let s = seed;
    for (let i = n - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) % 2 ** 31;
        const j = s % (i + 1);
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/** A strip of FRAMES frames for a cols x rows grid, as an SVG data URI. */
function strip(cols, rows, seed) {
    const order = shuffled(cols * rows, seed);
    const per = Math.ceil(order.length / FRAMES);
    // Squares overlap a hair so no seams show between them
    const rect = (i) => `<rect x="${i % cols}" y="${Math.floor(i / cols)}" width="1.05" height="1.05"/>`;
    let defs = '';
    let uses = '';
    for (let f = 0; f < FRAMES; f++) {
        const fresh = order.slice(f * per, (f + 1) * per).map(rect).join('');
        defs += `<g id="f${f}">${f ? `<use href="#f${f - 1}"/>` : ''}${fresh}</g>`;
        uses += `<use href="#f${f}" x="${f * cols}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * FRAMES} ${rows}" preserveAspectRatio="none" fill="#fff"><defs>${defs}</defs>${uses}</svg>`;
    // Only the characters a data URI can't hold are escaped, which keeps it about half the size
    return `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[%#<>]/g, (c) => encodeURIComponent(c))}")`;
}

const wide = strip(16, 9, 7);
const square = strip(8, 8, 11);
// The mask is only set inside the animation, so nothing is masked once a picture is in
const keyframes = (name, mask) => `@keyframes ${name} {
    from {
        mask-image: var(${mask});
        mask-position: 0 0;
    }
    to {
        mask-image: var(${mask});
        mask-position: 100% 0;
    }
}`;

const css = `/* Made by scripts/reveal-masks.mjs. Don't edit by hand. */

/* Pictures appear a square at a time: 16 x 9 squares for wide ones, 8 x 8 for square ones */
:root {
    --reveal-wide: ${wide};
    --reveal-square: ${square};
}
${keyframes('reveal-wide', '--reveal-wide')}
${keyframes('reveal-square', '--reveal-square')}

@media (prefers-reduced-motion: no-preference) {
    main img:is([class*='aspect-'], [class*='object-cover']):not(.cut) {
        mask-size: ${FRAMES * 100}% 100%;
        mask-repeat: no-repeat;
        animation: reveal-wide 200ms steps(${FRAMES}, jump-none) backwards;
        animation-delay: calc(var(--d, 0ms) + 60ms);
    }
    main img.aspect-square:not(.cut) {
        animation-name: reveal-square;
    }
}
`;

writeFileSync(new URL('../client/src/styles/reveal.css', import.meta.url), css);
console.log('wrote client/src/styles/reveal.css');
