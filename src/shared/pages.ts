/**
 * Splits cards into pages that each fit in `room` pixels, given every card's height. Cards sit
 * in rows of `cols`, each row as tall as its tallest card. Returns the index each page starts
 * at. A row too tall for `room` still gets a page of its own.
 */
export function fitPages(heights: number[], cols: number, gap: number, room: number): number[] {
    const starts = [0];
    let used = 0;
    for (let i = 0; i < heights.length; i += cols) {
        const row = Math.max(...heights.slice(i, i + cols));
        if (used && used + gap + row > room) {
            starts.push(i);
            used = row;
        } else {
            used += (used ? gap : 0) + row;
        }
    }
    return starts;
}

/** Which page numbers to show: the first, the last, and those next to the current one. null is a gap. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
    const shown: (number | null)[] = [];
    for (let i = 0; i < pages; i++) {
        if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) shown.push(i);
        else if (shown[shown.length - 1] !== null) shown.push(null);
    }
    return shown;
}
