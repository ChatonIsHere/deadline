import { canCreateGig } from '@shared/permissions';
import { isLive } from '@shared/schemas';
import { LogOut, Plus, Search } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { CommandPalette } from '@/components/command-palette';
import { Avatar, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { api, useCrew, useGig, useGigs, useMe, useRunner, useSettings } from '@/lib/api';
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

interface Channel {
    to: string;
    label: string;
    /** Three letters for the phone bar. */
    short: string;
}

/**
 * The board's terminal. Desktop: a rail on the left with numbered channels and a status
 * readout. Phones: the channels along the bottom (easier to reach with a thumb) and a
 * floating button for new gigs. Everyone gets the prompt bar on top, which shows where
 * you are and opens the command palette (Ctrl+K).
 */
export function Layout() {
    const { data: me, isPending, isError } = useMe();
    const { pathname } = useLocation();
    const [palette, setPalette] = useState(false);

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

    const channels: Channel[] = [
        { to: '/', label: 'Board', short: 'BRD' },
        { to: '/runners', label: 'Runners', short: 'RNS' },
        { to: '/fixers', label: 'Fixers', short: 'FIX' },
        { to: '/crews', label: 'Crews', short: 'CRW' },
        ...(me.isAdmin ? [{ to: '/settings', label: 'Settings', short: 'SET' }] : []),
    ];

    return (
        <div className="min-h-screen md:grid md:grid-cols-[13rem_1fr]">
            <Rail channels={channels} />

            <div className="flex min-w-0 flex-col">
                <PromptBar onOpen={() => setPalette(true)} />
                {/* Bottom padding on phones keeps content clear of the channel bar */}
                <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-40 md:px-8 md:pb-10">
                    {me.isAdmin && <SetupReminder />}
                    <Outlet />
                </main>
            </div>

            {canCreateGig(me) && pathname !== '/gigs/new' && (
                <Button asChild size="icon" className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 size-14 [--cut:12px] md:hidden">
                    <Link to="/gigs/new" aria-label="New gig" title="New gig">
                        <Plus className="size-6" />
                    </Link>
                </Button>
            )}

            <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-primary/40 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
                <div className="flex">
                    {channels.map((c, i) => (
                        <BarLink key={c.to} to={c.to} label={c.label} number={i + 1}>
                            <span className="font-display text-sm tracking-widest">{c.short}</span>
                        </BarLink>
                    ))}
                    <BarLink to="/me" label="You">
                        <Avatar member={me} className="size-6" />
                    </BarLink>
                </div>
            </nav>

            <CommandPalette open={palette} onOpenChange={setPalette} />
        </div>
    );
}

const channelNo = (n: number) => String(n).padStart(2, '0');

/** Desktop: the board's bezel. Logo, numbered channels, new gig, then status and the user at the bottom. */
function Rail({ channels }: { channels: Channel[] }) {
    const { data: me } = useMe();
    if (!me) return null;
    return (
        <aside className="sticky top-0 hidden h-screen flex-col border-r border-primary/40 bg-card/60 md:flex">
            <Link to="/" className="flex h-12 items-center gap-2 border-b border-primary/40 px-4">
                <img src="/logo.svg" alt="" className="size-6" />
                <span className="font-display text-lg font-bold tracking-[0.2em] text-primary">DEADLINE</span>
            </Link>

            <p className="px-4 pt-5 pb-2 text-[10px] tracking-widest text-muted-foreground">// CHANNELS</p>
            <nav className="flex flex-col">
                {channels.map((c, i) => (
                    <NavLink
                        key={c.to}
                        to={c.to}
                        end={c.to === '/'}
                        className={({ isActive }) =>
                            cn(
                                'flex items-center gap-3 border-l-2 px-4 py-2 font-display tracking-wider uppercase',
                                isActive ? 'border-primary bg-primary/20 text-primary' : 'border-transparent text-muted-foreground hover:border-primary/60 hover:bg-muted hover:text-foreground',
                            )
                        }
                    >
                        <span className="text-xs tabular-nums opacity-60">{channelNo(i + 1)}</span>
                        {c.label}
                    </NavLink>
                ))}
            </nav>

            {canCreateGig(me) && (
                <div className="px-4 pt-5">
                    <Button asChild size="sm" className="w-full">
                        <Link to="/gigs/new">
                            <Plus className="size-4" /> New gig
                        </Link>
                    </Button>
                </div>
            )}

            <div className="mt-auto space-y-3 border-t border-primary/40 px-4 py-4">
                <p className="text-[10px] tracking-widest text-muted-foreground">// STATUS</p>
                <Readout />
                <div className="flex items-center gap-2">
                    <Link to="/me" className="flex min-w-0 flex-1 items-center gap-2 hover:text-primary" title="Your settings">
                        <Avatar member={me} />
                        <span className="truncate text-sm">{me.name}</span>
                    </Link>
                    <Button variant="ghost" size="icon" onClick={logout} title="Log out">
                        <LogOut className="size-4" />
                    </Button>
                </div>
            </div>
        </aside>
    );
}

/** Live gigs, the time in Night City and whether the browser is online. */
function Readout() {
    const gigs = useGigs().data ?? [];
    const live = gigs.filter((g) => isLive(g.status)).length;
    const now = useNow();
    const online = useOnline();
    const ncTime = now.toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });

    return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">LIVE</dt>
            <dd className="text-primary tabular-nums">
                {live} contract{live === 1 ? '' : 's'}
            </dd>
            <dt className="text-muted-foreground">NC</dt>
            <dd className="tabular-nums">{ncTime}</dd>
            <dt className="text-muted-foreground">LINK</dt>
            <dd className={cn('flex items-center gap-1.5', online ? 'text-success' : 'text-destructive')}>
                <span className={cn('size-1.5', online ? 'animate-pulse bg-success' : 'bg-destructive')} />
                {online ? 'uplink stable' : 'no signal'}
            </dd>
        </dl>
    );
}

/** Where you are, as a path the board's AI would print. Click it (or Ctrl+K) to jump anywhere. */
function PromptBar({ onOpen }: { onOpen: () => void }) {
    const path = usePath();
    return (
        <button
            type="button"
            onClick={onOpen}
            className="sticky top-0 z-20 flex h-12 w-full cursor-text items-center gap-2 border-b border-primary/40 bg-background/95 px-4 text-left text-sm backdrop-blur md:px-8"
            title="Jump to... (Ctrl+K)"
        >
            <img src="/logo.svg" alt="" className="size-5 md:hidden" />
            <span className="text-primary">&gt;</span>
            <span className="min-w-0 truncate">
                <span className="text-muted-foreground">DEADLINE://</span>
                {path}
                <span className="blink ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-primary" />
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
                <Search className="size-4 md:hidden" />
                <kbd className="cut hidden bg-muted px-2 py-0.5 text-[10px] tracking-widest [--cut:4px] md:block">CTRL K</kbd>
            </span>
        </button>
    );
}

const slug = (name: string) =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

/** The current path, with gig, runner and crew IDs swapped for their names once loaded. */
function usePath(): string {
    const { pathname } = useLocation();
    const parts = pathname.split('/').filter(Boolean);
    const [kind, id] = parts;
    const numeric = !!id && /^\d+$/.test(id);
    // Same queries as the pages, so these come from the cache
    const gig = useGig(kind === 'gigs' && numeric ? id : undefined).data;
    const runner = useRunner(kind === 'runners' && numeric ? id : undefined).data;
    const crew = useCrew(kind === 'crews' && numeric ? id : undefined).data;
    const name = gig?.name ?? runner?.handle ?? crew?.name;
    if (!parts.length) return 'board';
    if (numeric && name) parts[1] = slug(name);
    return parts.join('/');
}

function useNow() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 15_000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

function useOnline() {
    const [online, setOnline] = useState(() => navigator.onLine);
    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);
    return online;
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
                    'flex h-16 flex-1 flex-col items-center justify-center gap-1 border-t-2',
                    isActive ? 'border-primary bg-primary/20 text-primary' : 'border-transparent text-muted-foreground',
                )
            }
        >
            {number && <span className="font-display text-[10px] tracking-widest opacity-60">{channelNo(number)}</span>}
            {children}
            {!number && <span className="font-display text-[10px] tracking-widest">YOU</span>}
        </NavLink>
    );
}
