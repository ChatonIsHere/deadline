// Generates assets/emoji/*.svg in one shared style: a bold main shape, one accent and a
// pink offset "glitch" copy behind it. All original drawings.
const fs = require('fs');
const path = require('path');
// Run: npm run emoji
const OUT = path.join(__dirname, '..', 'assets', 'emoji');

const Y = '#f3e600';
const C = '#00e5ff';
const P = '#ff2a6d';
const D = '#0a0a12';

// [kind, d, colour, width]: s = stroke, f = fill. Dark (D) parts are knockouts and get no shadow.
const s = (d, c, w = 10) => ['s', d, c, w];
const f = (d, c) => ['f', d, c];

const icons = {
    // Board
    eb: [
        // A euro sign and a dollar sign side by side
        s('M60 30H32L20 42V86L32 98H60', Y, 11),
        s('M8 56H46M8 72H46', Y, 9),
        s('M114 36H82L72 46V56L80 64H106L114 72V88L104 98H70', Y, 11),
        s('M92 16V32M92 102V118', Y, 9),
    ],
    // Pay going up
    bonus: [s('M22 66L64 24L106 66', Y, 15), s('M22 104L64 62L106 104', C, 15)],
    objective: [s('M64 16L112 64L64 112L16 64Z', C, 9), s('M64 4V28M64 100V124M4 64H28M100 64H124', Y, 9), f('M56 56H72V72H56Z', Y)],
    location: [f('M30 8H86L106 28V70L64 120L22 70V16Z', Y), f('M50 34H72L80 42V62H58L50 54Z', D)],
    fixer: [s('M10 64L40 34H88L118 64L88 94H40Z', C, 10), f('M50 50H72L80 58V80H58L50 72Z', Y)],
    crew: [s('M64 34L30 94M64 34L98 94M30 94H98', C, 8), f('M50 12H74L82 20V46H58L50 38Z', Y), f('M12 76H36L44 84V110H20L12 102Z', Y), f('M84 76H108L116 84V110H92L84 102Z', Y)],
    slot_open: [s('M28 16H100L112 28V100L100 112H28L16 100V28Z', C, 10)],
    slot_filled: [f('M28 14H100L114 28V100L100 114H28L14 100V28Z', Y), f('M46 46H82V82H46Z', D)],

    // Ratings. The empty one has a thin edge so it still shows on a black theme.
    star_full: [f('M64 10L78 49L119 50L87 75L98 115L64 92L30 115L41 75L9 50L50 49Z', Y)],
    star_empty: [f('M64 10L78 49L119 50L87 75L98 115L64 92L30 115L41 75L9 50L50 49Z', '#000000'), s('M64 10L78 49L119 50L87 75L98 115L64 92L30 115L41 75L9 50L50 49Z', '#55556a', 5)],

    // Gig types
    type_escort: [s('M64 10L110 26V64L64 118L18 64V26Z', Y, 10), s('M40 74L64 50L88 74', C, 11)],
    type_extraction: [s('M58 14H18V114H58', C, 10), s('M40 64H112M86 38L112 64L86 90', Y, 11)],
    type_heist: [s('M30 20H98L120 46L64 114L8 46Z', C, 9), s('M8 46H120M46 20L64 46L82 20M64 46V112', Y, 7)],
    type_hit: [f('M100 8L120 28L58 90L38 70Z', C), s('M28 64L64 100', Y, 10), s('M40 88L14 114', Y, 14)],

    // Runner roles
    role_solo: [s('M14 40V14H40M88 14H114V40M114 88V114H88M40 114H14V88', C, 10), s('M64 22V48M64 80V106M22 64H48M80 64H106', Y, 8), f('M64 54L74 64L64 74L54 64Z', Y)],
    role_netrunner: [s('M14 114L44 84', C, 12), f('M36 72L70 38L90 58L56 92Z', Y), s('M74 46L100 20M86 58L112 32', C, 9)],
    role_tech: [s('M24 104L66 62', C, 16), f('M58 46L84 20H100L84 36L92 44L108 28V44L82 70H66L58 62Z', Y)],
    role_medtech: [s('M26 10H102L118 26V102L102 118H26L10 102V26Z', C, 8), f('M50 28H78V50H100V78H78V100H50V78H28V50H50Z', Y)],
    role_media: [f('M12 40H84L96 52V100H24L12 88Z', C), f('M38 54H62L70 62V86H46L38 78Z', D), f('M96 56L118 42V98L96 84Z', Y), f('M20 20H52V30H20Z', Y)],
    role_exec: [s('M46 38V20H82V38', C, 10), f('M12 38H106L116 48V108H22L12 98Z', Y), s('M12 66H116', D, 8), f('M56 58H72V76H56Z', C)],
    role_lawman: [f('M64 8L112 24V64L64 120L16 64V24Z', C), f('M64 22L98 34V62L64 102L30 62V34Z', D), f('M64 36L71 52H88L74 62L80 80L64 69L48 80L54 62L40 52H57Z', Y)],
    role_fixer: [s('M10 64L40 34H88L118 64L88 94H40Z', C, 10), f('M50 50H72L80 58V80H58L50 72Z', Y)],
    role_nomad: [s('M54 26L18 118M74 26L110 118', C, 10), s('M64 38V50M64 66V82M64 98V116', Y, 8), s('M10 18H118', Y, 8)],
    role_rockerboy: [s('M84 16V84', C, 10), s('M84 16L110 28V46L84 36', C, 10), f('M40 68H80L88 76V100L80 108H48L40 100Z', Y), s('M16 40V64M32 28V76M48 40V56', C, 8)],
};

const draw = ([kind, d, colour, width], override) => {
    const c = override ?? colour;
    return kind === 's' ? `<path stroke="${c}" stroke-width="${width}" d="${d}"/>` : `<path fill="${c}" d="${d}"/>`;
};

for (const [name, parts] of Object.entries(icons)) {
    const shadow = name === 'star_empty' ? '' : parts.filter((p) => p[2] !== D).map((p) => draw(p, P)).join('');
    const main = parts.map((p) => draw(p)).join('');
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none" stroke-linecap="square" stroke-linejoin="miter">` +
        `<g opacity="0.75" transform="translate(-5 4)">${shadow}</g><g>${main}</g></svg>\n`;
    fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
}
console.log(Object.keys(icons).length, 'icons');
