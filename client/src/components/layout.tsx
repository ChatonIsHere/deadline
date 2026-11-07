import { canCreateCrew, canCreateGig } from '@shared/permissions';
import { Plus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { CommandPalette } from '@/components/command-palette';
import { Avatar, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { api, useCrew, useGig, useMe, useRunner, useSettings } from '@/lib/api';
import { useLiveUpdates } from '@/lib/live';
import { cn } from '@/lib/utils';

export const logout = async () => {
    await api('/auth/logout', 'POST');
    location.href = '/login';
};

/** Nags admins until there's a server and forum to post to. */
function SetupReminder() {
    const { data } = useSettings();
    const { pathname } = useLocation();
    if (!data || pathname.startsWith('/settings') || (data.settings.guildId && data.settings.forumId)) return null;
    return (
        <div className="cut-frame mb-6 flex flex-wrap items-center gap-3 p-4 [--frame:var(--color-primary)]">
            <Say className="flex-1">not configured. pick a server and a gig forum before posting gigs.</Say>
            <Button asChild size="sm">
                <Link to="/settings">Settings</Link>
            </Button>
        </div>
    );
}

/** Where someone can be before they've finished first-time setup. */
const SETUP_PATHS = ['/setup', '/runners/new'];

interface Channel {
    to: string;
    label: string;
    /** Three letters for the phone bar. */
    short: string;
}

/**
 * The board's terminal. Desktop (1280px and up): a channel tab stuck to the left edge. Phones and tablets: the channels along the bottom (easier to reach with a thumb) and a
 * floating button for new gigs. Everyone gets the prompt bar (top on phones, bottom on desktop), which shows where
 * you are and opens the command palette (Ctrl+K).
 */
export function Layout() {
    const { data: me, isPending, isError } = useMe();
    useLiveUpdates(!!me);
    const { pathname } = useLocation();
    const [palette, setPalette] = useState(false);
    // On phones the page scrolls inside this, so a new page starts at its top
    const scroller = useRef<HTMLDivElement>(null);
    // Braces: newer browsers return a promise from scrollTo, which React would take as a cleanup
    useEffect(() => {
        scroller.current?.scrollTo(0, 0);
    }, [pathname]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPalette((open) => !open);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    if (isError) return <Navigate to="/login" replace />;
    if (isPending) return <Say className="p-6">connecting to the board...</Say>;
    // First time in: setup comes first (making a runner is part of it)
    if (me.needsSetup && !SETUP_PATHS.includes(pathname)) return <Navigate to="/setup" replace />;

    const channels: Channel[] = [
        { to: '/gigs', label: 'Gigs', short: 'GIG' },
        { to: '/runners', label: 'Runners', short: 'RNS' },
        { to: '/fixers', label: 'Fixers', short: 'FIX' },
        { to: '/crews', label: 'Crews', short: 'CRW' },
        ...(me.isAdmin
            ? [
                  { to: '/availability', label: 'Availability', short: 'AVL' },
                  { to: '/settings', label: 'Settings', short: 'SET' },
              ]
            : []),
    ];

    // The corner + makes whatever the list page shows. Nowhere else.
    const fab =
        pathname === '/gigs' && canCreateGig(me)
            ? { to: '/gigs/new', label: 'New gig' }
            : pathname === '/runners'
              ? { to: '/runners/new', label: 'New runner' }
              : pathname === '/fixers' && me.isAdmin
                ? { to: '/fixers/new', label: 'New NPC fixer' }
                : pathname === '/crews' && canCreateCrew(me)
                  ? { to: '/crews/new', label: 'Register a crew' }
                  : null;

    return (
        // Phones: the whole app is pinned to the screen's edges, so the page itself never scrolls;
        // only the content inside does, with the prompt bar and channel bar as the last rows. A
        // page that could scroll even a little let Firefox slide its toolbar away and took our
        // bars with it. Desktop scrolls the page, and the prompt bar sticks to the bottom of the
        // window, like a terminal's command line.
        <div className="fixed inset-0 flex flex-col xl:static xl:block xl:min-h-screen">
            <Rail channels={channels} />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:min-h-screen">
                <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:overflow-visible">
                    {/* Bottom padding keeps content clear of the corner + */}
                    {/* Desktop: centred on the whole window, and narrow enough to clear the channel tab on the left (13rem tab, then the 2rem padding as a gap) */}
                    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 md:px-8 xl:w-[min(72rem,calc(100%-26rem))]">
                        {me.isAdmin && <SetupReminder />}
                        <Outlet />
                    </main>
                </div>
                <PromptBar onOpen={() => setPalette(true)} />
            </div>

            {fab && (
                <Button
                    asChild
                    size="icon"
                    // Above the channel bar on phones, and the prompt bar on desktop
                    className="fixed right-4 bottom-20 z-30 size-14 [--cut:12px] xl:right-8 xl:bottom-16"
                >
                    <Link to={fab.to} aria-label={fab.label} title={fab.label}>
                        <Plus className="size-6" />
                    </Link>
                </Button>
            )}

            <nav className="shrink-0 border-t-2 border-primary/40 bg-background xl:hidden">
                <div className="flex">
                    {channels.map((c, i) => (
                        <BarLink key={c.to} to={c.to} label={c.label} number={i + 1}>
                            <span className="font-display text-sm tracking-widest">{c.short}</span>
                        </BarLink>
                    ))}
                </div>
            </nav>

            <CommandPalette open={palette} onOpenChange={setPalette} />
        </div>
    );
}

const channelNo = (n: number) => String(n).padStart(2, '0');

/**
 * Desktop: the channel tab, a panel stuck to the left edge of the window halfway down, with
 * its right-hand corners cut. Logo and numbered
 * channels. It floats beside the page rather than taking a column, so the page centres on
 * the whole window and the prompt bar runs the full width under it. You are in the prompt bar.
 */
function Rail({ channels }: { channels: Channel[] }) {
    const { data: me } = useMe();
    if (!me) return null;
    return (
        <aside className="tab-frame fixed top-1/2 left-0 z-30 hidden w-52 -translate-y-1/2 flex-col pb-4 [--cut:16px] [--frame:color-mix(in_oklab,var(--color-primary)_40%,transparent)] xl:flex">
            <Link to="/gigs" className="flex h-12 items-center gap-2 border-b-2 border-primary/40 px-4">
                <img src="/logo.svg" alt="" className="size-6" />
                <span className="font-display text-lg font-bold tracking-[0.2em] text-primary">DEADLINE</span>
            </Link>

            <p className="px-4 pt-5 pb-2 text-xs tracking-widest text-muted-foreground">// CHANNELS</p>
            <nav className="flex flex-col">
                {channels.map((c, i) => (
                    <NavLink
                        key={c.to}
                        to={c.to}
                        end={c.to === '/'}
                        className={({ isActive }) =>
                            cn(
                                'flex items-center gap-3 border-l-3 px-4 py-2 font-display tracking-wider uppercase',
                                isActive ? 'border-primary bg-primary/20 text-primary' : 'border-transparent text-muted-foreground hover:border-primary/60 hover:bg-muted hover:text-foreground',
                            )
                        }
                    >
                        <span className="text-xs tabular-nums opacity-60">{channelNo(i + 1)}</span>
                        {c.label}
                    </NavLink>
                ))}
            </nav>
        </aside>
    );
}

/**
 * Where you are, as a shell prompt (name@DEADLINE:~/gigs$), in place of page titles. Your
 * picture, name and @DEADLINE go to your settings. The rest of the bar (or Ctrl+K) opens
 * the jump-anywhere palette.
 */
function PromptBar({ onOpen }: { onOpen: () => void }) {
    const { data: me } = useMe();
    const path = usePath();
    return (
        // Phones: the first row, under the browser bar. Desktop: stuck to the bottom of the window.
        <div className="order-first flex h-12 w-full shrink-0 items-center gap-2 border-b-2 border-primary/40 bg-background px-4 text-sm xl:sticky xl:bottom-0 xl:z-20 xl:order-none xl:border-t xl:border-b-0 xl:px-8">
            <span className="flex min-w-0 flex-1 items-center self-stretch">
                {me && (
                    // The whole of picture, name and @DEADLINE, full height, goes to your settings
                    <Link to="/me" title="Your settings" className="group flex max-w-[60%] shrink-0 items-center gap-2 self-stretch text-primary">
                        <Avatar member={me} />
                        <span className="flex min-w-0 group-hover:underline">
                            <span className="truncate">{me.name}</span>
                            <span>@DEADLINE</span>
                        </span>
                    </Link>
                )}
                <button type="button" onClick={onOpen} aria-label="Jump to... (Ctrl+K)" className="flex min-w-0 flex-1 cursor-text items-center self-stretch text-left outline-none">
                    <span className="min-w-0 truncate">
                        <span className="text-muted-foreground">:</span>
                        <span className="text-accent">~{path && `/${path}`}</span>
                        <span className="text-muted-foreground">$</span>
                        <span className="blink ml-1.5 inline-block h-4 w-2 translate-y-0.5 bg-primary" />
                    </span>
                </button>
            </span>
            {/* Desktop only: on phones the prompt itself is the button */}
            <button type="button" onClick={onOpen} aria-label="Jump to... (Ctrl+K)" className="hidden shrink-0 cursor-pointer items-center text-muted-foreground outline-none xl:flex">
                <kbd className="cut bg-muted px-2 py-0.5 text-xs tracking-widest [--cut:4px]">CTRL K</kbd>
            </button>
        </div>
    );
}

/**
 * The current path, with a record's readable link in place of whatever got you there (UUID,
 * link or old numeric ID) once it's loaded. Gig links show in capitals:
 * gigs/3F2A9C1B-OVERZEALOUS-SQUANCH.
 */
function usePath(): string {
    const { pathname } = useLocation();
    const parts = pathname.split('/').filter(Boolean);
    const [kind, id] = parts;
    const record = !!id && id !== 'new';
    // Same queries as the pages, so these come from the cache
    const gig = useGig(kind === 'gigs' && record ? id : undefined).data;
    const runner = useRunner((kind === 'runners' || kind === 'fixers') && record ? id : undefined).data;
    const crew = useCrew(kind === 'crews' && record ? id : undefined).data;
    const name = gig ? gig.ref.toUpperCase() : (runner?.slug ?? crew?.slug);
    if (record && name) parts[1] = name;
    return parts.join('/');
}

/** One channel in the phone bar: its number over its short name. The active one gets a bar on top. */
function BarLink({ to, label, number, children }: { to: string; label: string; number?: number; children: ReactNode }) {
    return (
        <NavLink
            to={to}
            end={to === '/'}
            aria-label={label}
            title={label}
            className={({ isActive }) =>
                cn(
                    'flex h-16 flex-1 flex-col items-center justify-center gap-1 border-t-3',
                    isActive ? 'border-primary bg-primary/20 text-primary' : 'border-transparent text-muted-foreground',
                )
            }
        >
            {number && <span className="font-display text-xs tracking-widest">{channelNo(number)}</span>}
            {children}
            {!number && <span className="font-display text-xs tracking-widest">YOU</span>}
        </NavLink>
    );
}
