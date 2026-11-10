import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Outlet, useBlocker } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

interface Guard {
    report: (id: string, dirty: boolean) => void;
    allowNext: () => void;
}

const GuardContext = createContext<Guard | null>(null);

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
            // Until the current task ends, which covers a navigate() straight after
            allowNext: () => {
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

/** Lets the navigation a successful save starts go through: what it saved isn't unsaved any more. */
export const useAllowNextNavigation = () => useContext(GuardContext)?.allowNext;
