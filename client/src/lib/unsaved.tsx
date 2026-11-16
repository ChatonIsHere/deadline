import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Outlet, useBlocker, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

interface Guard {
    report: (id: string, dirty: boolean) => void;
    allowNext: () => void;
}

const GuardContext = createContext<Guard | null>(null);

/** Set while reloading for an update: drafts are kept, so there's nothing to warn about. */
let reloading = false;

/** Reloads the page without the "leave site?" warning. What's typed comes back as drafts (useDraft). */
export function reloadKeepingDrafts() {
    reloading = true;
    window.location.reload();
}

/**
 * Asks before leaving a page with unsaved changes: its own prompt for links and the back button,
 * the browser's for closing or reloading the tab (browsers don't let a page word that one).
 * Forms say when they have changes with useUnsavedChanges. A route element that guards
 * everything under it. One for the whole app, since a router allows only one blocker.
 */
export function UnsavedChangesGuard() {
    const dirty = useRef(new Set<string>());
    const [anyDirty, setAnyDirty] = useState(false);
    const allowed = useRef(false);

    // Moving within a page (its query string or hash) loses nothing
    const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty.current.size > 0 && !allowed.current && currentLocation.pathname !== nextLocation.pathname);

    useEffect(() => {
        if (!anyDirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            if (reloading) return;
            e.preventDefault();
            // Older browsers only ask when this is set
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [anyDirty]);

    const guard = useMemo<Guard>(
        () => ({
            report: (id, isDirty) => {
                if (isDirty) dirty.current.add(id);
                else dirty.current.delete(id);
                setAnyDirty(dirty.current.size > 0);
            },
            // Until the current task ends, which covers a navigate() straight after. What was saved
            // needn't come back after a reload, so the page's drafts go too.
            allowNext: () => {
                clearDrafts();
                allowed.current = true;
                setTimeout(() => (allowed.current = false));
            },
        }),
        [],
    );

    return (
        <GuardContext.Provider value={guard}>
            <Outlet />
            <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
                <DialogContent>
                    <DialogTitle>Leave without saving?</DialogTitle>
                    <DialogDescription>You've changed things on this page that aren't saved yet. Leaving throws them away.</DialogDescription>
                    <div className="mt-6 flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => blocker.reset?.()}>
                            Stay
                        </Button>
                        <Button variant="destructive" onClick={() => blocker.proceed?.()}>
                            Leave
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </GuardContext.Provider>
    );
}

/** Tells the guard whether this part of the page has changes that aren't saved. */
export function useUnsavedChanges(dirty: boolean) {
    const guard = useContext(GuardContext);
    const id = useId();
    useEffect(() => guard?.report(id, dirty), [guard, id, dirty]);
    useEffect(() => () => guard?.report(id, false), [guard, id]);
}

/** For a form that leaves the page when it saves: unsaved once its value differs from what it started as. */
export function useUnsavedForm(value: unknown) {
    const [initial] = useState(() => JSON.stringify(value));
    useUnsavedChanges(JSON.stringify(value) !== initial);
}

const DRAFT = 'deadline-draft:';
const draftPrefix = (pathname: string) => `${DRAFT}${pathname}:`;

/** Drops the drafts kept for the page you're on. */
function clearDrafts() {
    try {
        const prefix = draftPrefix(window.location.pathname);
        for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key);
    } catch {
        // Storage can be off. Drafts are a nicety.
    }
}

/**
 * useState that survives a reload, say for an update. While it differs from where it started,
 * it's kept in the tab's session storage under the page and `key` (one of a kind on the page),
 * and it comes back when the page loads again. Leaving the page drops it, as does any save.
 * Values must survive JSON.
 */
export function useDraft<T>(key: string, initial: T | (() => T)) {
    const { pathname } = useLocation();
    const storeKey = draftPrefix(pathname) + key;
    const [start] = useState(() => (typeof initial === 'function' ? (initial as () => T)() : initial));
    const [value, setValue] = useState<T>(() => {
        try {
            const saved = sessionStorage.getItem(storeKey);
            if (saved !== null) return JSON.parse(saved) as T;
        } catch {
            // Nothing kept, or storage is off
        }
        return start;
    });

    useEffect(() => {
        try {
            const json = JSON.stringify(value);
            if (json === JSON.stringify(start)) sessionStorage.removeItem(storeKey);
            else sessionStorage.setItem(storeKey, json);
        } catch {
            // Storage full or off: it just won't come back
        }
    }, [storeKey, start, value]);
    // A reload doesn't unmount, so this only runs when you leave the page
    useEffect(
        () => () => {
            try {
                sessionStorage.removeItem(storeKey);
            } catch {
                // As above
            }
        },
        [storeKey],
    );
    return [value, setValue] as const;
}

/** Lets the navigation a successful save starts go through: what it saved isn't unsaved any more. */
export const useAllowNextNavigation = () => useContext(GuardContext)?.allowNext;
