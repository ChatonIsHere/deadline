import { fitPages, pageNumbers } from '@shared/pages';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';

/** Cards per page on phones and tablets, where the list scrolls. */
const SCROLLING_PAGE = 12;
/** What the desktop layout keeps under the page: the prompt bar (3rem) and bottom padding (1.5rem). */
const BELOW_PAGE = 72;
/** The page buttons (2rem) and the gap above them (1rem). */
const PAGER_HEIGHT = 48;

/** The page each list was on, so going to a card and back returns to it. */
const remembered = new Map<string, number>();

/**
 * A list of cards in pages. On desktop each page holds as many rows as fit on the screen, so
 * there's nothing to scroll. Card heights differ, so a hidden copy of the list is measured to
 * see where the pages break. `className` sets the columns (card-rows).
 */
export function CardPages<T>({ id, items, className, card }: { id: string; items: T[]; className: string; card: (item: T) => ReactNode }) {
    const desktop = useMediaQuery('(min-width: 1280px)');
    const root = useRef<HTMLDivElement>(null);
    const ruler = useRef<HTMLDivElement>(null);
    const [fitted, setFitted] = useState<number[] | null>(null);
    const [page, setPage] = useState(() => remembered.get(id) ?? 0);

    const measure = useCallback(() => {
        if (!root.current || !ruler.current) return;
        const style = getComputedStyle(ruler.current);
        const cols = Number(style.getPropertyValue('--cols')) || 1;
        const gap = parseFloat(style.rowGap) || 0;
        const room = window.innerHeight - BELOW_PAGE - (root.current.getBoundingClientRect().top + window.scrollY);
        // offsetHeight ignores the entrance animation's transforms. It rounds, so 1px to be safe.
        const heights = [...ruler.current.children].map((c) => (c as HTMLElement).offsetHeight + 1);
        let starts = fitPages(heights, cols, gap, room);
        if (starts.length > 1) starts = fitPages(heights, cols, gap, room - PAGER_HEIGHT);
        setFitted((old) => (old?.join() === starts.join() ? old : starts));
    }, []);

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
            {desktop && (
                <div aria-hidden className="invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
                    <div ref={ruler} className={cn(className, 'items-start')}>
                        {items.map(card)}
                    </div>
                </div>
            )}
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
