import { fitPages, pageNumbers } from '@shared/pages';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SkipImages } from '@/components/staggered-image';
import { Button } from '@/components/ui/button';
import { usePrefs } from '@/lib/api';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';

/** Cards per page on phones and tablets, where the list scrolls. */
const SCROLLING_PAGE = 12;
/** What the desktop layout keeps under the page: the prompt bar (3rem) and bottom padding (1.5rem). */
const BELOW_PAGE = 72;
/** The page buttons (2rem) and the gap above them (1rem). */
const PAGER_HEIGHT = 48;

/** How close to the end of the list (in px) the next page starts loading, with infinite scroll. */
const LOAD_AHEAD = 600;

/** The page each list was on (or, with infinite scroll, how many pages were loaded), so going to a card and back returns to it. */
const remembered = new Map<string, number>();

/**
 * A list of cards in pages. On desktop each page holds as many rows as fit on the screen, so
 * there's nothing to scroll. Card heights differ, so a hidden copy of the list is measured to
 * see where the pages break. `className` sets the columns (card-rows).
 *
 * With infinite scroll on (the Me page), there are no page buttons: the first page fills the
 * screen the same way, and each next one is added as the list scrolls near its end.
 */
export function CardPages<T>({ id, items, className, card }: { id: string; items: T[]; className: string; card: (item: T) => ReactNode }) {
    const infinite = !!usePrefs().data?.infiniteScroll;
    return infinite ? <ScrollingCards key={id} id={id} items={items} className={className} card={card} /> : <PagedCards id={id} items={items} className={className} card={card} />;
}

/** Where each page starts: as many rows as fit the screen on desktop (measured from a hidden copy), a set number elsewhere. */
function usePageStarts<T>(items: T[], { room: leaveForPager }: { room: boolean }) {
    const desktop = useMediaQuery('(min-width: 1280px)');
    const root = useRef<HTMLDivElement>(null);
    const ruler = useRef<HTMLDivElement>(null);
    const [fitted, setFitted] = useState<number[] | null>(null);

    const measure = useCallback(() => {
        if (!root.current || !ruler.current) return;
        const style = getComputedStyle(ruler.current);
        const cols = Number(style.getPropertyValue('--cols')) || 1;
        const gap = parseFloat(style.rowGap) || 0;
        const room = window.innerHeight - BELOW_PAGE - (root.current.getBoundingClientRect().top + window.scrollY);
        // offsetHeight ignores the entrance animation's transforms. It rounds, so 1px to be safe.
        const heights = [...ruler.current.children].map((c) => (c as HTMLElement).offsetHeight + 1);
        let starts = fitPages(heights, cols, gap, room);
        if (leaveForPager && starts.length > 1) starts = fitPages(heights, cols, gap, room - PAGER_HEIGHT);
        setFitted((old) => (old?.join() === starts.join() ? old : starts));
    }, [leaveForPager]);

    // Before painting, so the list never shows at the wrong size
    useLayoutEffect(measure);
    useEffect(() => {
        if (!desktop || !ruler.current) return;
        const observer = new ResizeObserver(measure);
        observer.observe(ruler.current);
        window.addEventListener('resize', measure);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [desktop, measure]);

    const starts = desktop ? fitted : Array.from({ length: Math.max(1, Math.ceil(items.length / SCROLLING_PAGE)) }, (_, i) => i * SCROLLING_PAGE);
    return { desktop, root, ruler, starts };
}

/** The hidden copy of the list that desktop measures pages from. */
function Ruler<T>({ ruler, items, className, card }: { ruler: RefObject<HTMLDivElement | null>; items: T[]; className: string; card: (item: T) => ReactNode }) {
    return (
        <div aria-hidden className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
            <SkipImages value>
                <div ref={ruler} className={cn(className, 'items-start')}>
                    {items.map(card)}
                </div>
            </SkipImages>
        </div>
    );
}

/** Infinite scroll: page after page, each added as the end of the list comes into view. */
function ScrollingCards<T>({ id, items, className, card }: { id: string; items: T[]; className: string; card: (item: T) => ReactNode }) {
    const { desktop, root, ruler, starts } = usePageStarts(items, { room: false });
    const [loaded, setLoaded] = useState(() => remembered.get(`scroll:${id}`) ?? 1);
    const end = useRef<HTMLDivElement>(null);
    const pages = starts?.length ?? 1;
    const more = !!starts && loaded < pages;

    useEffect(() => {
        if (!more || !end.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                setLoaded((n) => {
                    remembered.set(`scroll:${id}`, n + 1);
                    return n + 1;
                });
            },
            { rootMargin: `0px 0px ${LOAD_AHEAD}px 0px` },
        );
        observer.observe(end.current);
        return () => observer.disconnect();
    }, [more, loaded, id]);

    const shown = starts ? items.slice(0, starts[loaded] ?? items.length) : [];
    return (
        <div ref={root} className="relative xl:flex xl:flex-1 xl:flex-col">
            {desktop && <Ruler ruler={ruler} items={items} className={className} card={card} />}
            {/* Centred while it fits the screen, like a page; from the top once it's longer */}
            <div className="xl:flex xl:flex-1 xl:flex-col xl:justify-center-safe">
                <div className={className}>{shown.map(card)}</div>
            </div>
            {more && <div ref={end} aria-hidden className="h-px" />}
        </div>
    );
}

/** Page buttons under the list. */
function PagedCards<T>({ id, items, className, card }: { id: string; items: T[]; className: string; card: (item: T) => ReactNode }) {
    const { desktop, root, ruler, starts } = usePageStarts(items, { room: true });
    const [page, setPage] = useState(() => remembered.get(id) ?? 0);
    const pages = starts?.length ?? 1;
    const current = Math.min(page, pages - 1);
    const shown = starts ? items.slice(starts[current], starts[current + 1]) : [];

    const go = (next: number) => {
        remembered.set(id, next);
        setPage(next);
        if (!desktop) root.current?.scrollIntoView();
    };

    return (
        <div ref={root} className="relative xl:flex xl:flex-1 xl:flex-col">
            {desktop && <Ruler ruler={ruler} items={items} className={className} card={card} />}
            <div className="xl:flex xl:flex-1 xl:flex-col xl:justify-center">
                <div className={className}>{shown.map(card)}</div>
            </div>
            {pages > 1 && <Pager page={current} pages={pages} onPage={go} />}
        </div>
    );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
    return (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
                <ChevronLeft className="size-4" />
            </Button>
            {pageNumbers(page, pages).map((n, i) =>
                n === null ? (
                    <span key={`gap-${i}`} className="w-8 text-center text-muted-foreground">
                        ...
                    </span>
                ) : (
                    <Button key={n} variant={n === page ? 'default' : 'ghost'} size="icon" aria-label={`Page ${n + 1}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
                        {String(n + 1).padStart(2, '0')}
                    </Button>
                ),
            )}
            <Button variant="ghost" size="icon" aria-label="Next page" disabled={page === pages - 1} onClick={() => onPage(page + 1)}>
                <ChevronRight className="size-4" />
            </Button>
        </nav>
    );
}
