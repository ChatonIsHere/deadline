import { type ComponentProps, createContext, useContext, useEffect, useState } from 'react';

/** Gap between one picture starting to load and the next. */
const STEP_MS = 50;
/** Holds the picture's place until its turn: a transparent pixel. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAIBTAA7';

/** True inside a hidden copy of a list, whose pictures should never load. */
export const SkipImages = createContext(false);

interface Turn {
    start: () => void;
    timer?: ReturnType<typeof setTimeout>;
}

/** Pictures already fetched this visit. They show straight away. */
const loaded = new Set<string>();
let waiting: Turn[] = [];

/** Gives everything that asked in this render a turn, in random order. */
function startBatch() {
    const batch = waiting;
    waiting = [];
    for (let i = batch.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [batch[i], batch[j]] = [batch[j], batch[i]];
    }
    batch.forEach((turn, i) => {
        turn.timer = setTimeout(turn.start, i * STEP_MS);
    });
}

function takeTurn(start: () => void): () => void {
    const turn: Turn = { start };
    if (!waiting.length) queueMicrotask(startBatch);
    waiting.push(turn);
    return () => {
        waiting = waiting.filter((t) => t !== turn);
        clearTimeout(turn.timer);
    };
}

/**
 * A large picture in a list. Those on screen together start loading in a random order, one
 * every 50ms, so they arrive at about the same time with some variation.
 */
export function StaggeredImage({ src, ...props }: Omit<ComponentProps<'img'>, 'src' | 'alt' | 'loading'> & { src: string }) {
    const skip = useContext(SkipImages);
    const [started, setStarted] = useState(() => loaded.has(src));

    useEffect(() => {
        if (started || skip) return;
        return takeTurn(() => setStarted(true));
    }, [started, skip]);

    return <img {...props} src={started && !skip ? src : BLANK} alt="" loading="lazy" onLoad={() => started && loaded.add(src)} />;
}
