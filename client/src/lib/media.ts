import { useEffect, useState } from 'react';

/** Whether a CSS media query matches, kept up to date. */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const update = () => setMatches(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, [query]);
    return matches;
}

/** Phones and small tablets: below Tailwind's md breakpoint. */
export const usePhone = () => useMediaQuery('(max-width: 767.98px)');

/**
 * The part of the page that's actually on screen. On phones the keyboard covers the bottom
 * without shrinking the page, so things pinned to it measure from this instead.
 */
export function useVisualViewport(): { height: number; offsetTop: number } | null {
    const [box, setBox] = useState<{ height: number; offsetTop: number } | null>(null);
    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;
        const update = () => setBox({ height: vv.height, offsetTop: vv.offsetTop });
        update();
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
        };
    }, []);
    return box;
}
