import { createContext, type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Where a page's own buttons and help go: the right of the prompt bar. Set by the layout. */
export const PageActionsSlot = createContext<HTMLElement | null>(null);

/** A page's buttons and "?" help, shown in the prompt bar instead of under a page title. */
export function PageActions({ children }: { children: ReactNode }) {
    const slot = useContext(PageActionsSlot);
    return slot ? createPortal(children, slot) : null;
}
