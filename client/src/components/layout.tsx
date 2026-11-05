import { canCreateGig } from '@shared/permissions';
import { Briefcase, LayoutGrid, LogOut, type LucideIcon, Plus, Settings, Shield, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Avatar, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { api, useMe, useSettings } from '@/lib/api';
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

/**
 * Desktop gets a header with text links. Phones get a slim header, an icon bar along
 * the bottom (easier to reach with a thumb) and a floating button for new gigs.
 */
export function Layout() {
    const { data: me, isPending, isError } = useMe();
    const { pathname } = useLocation();
    if (isError) return <Navigate to="/login" replace />;
    if (isPending) return <Say className="p-6">connecting to the board...</Say>;

    const links: { to: string; label: string; icon: LucideIcon; show: boolean }[] = [
        { to: '/', label: 'Board', icon: LayoutGrid, show: true },
        { to: '/runners', label: 'Runners', icon: Users, show: true },
        { to: '/fixers', label: 'Fixers', icon: Briefcase, show: true },
        { to: '/crews', label: 'Crews', icon: Shield, show: true },
        { to: '/settings', label: 'Settings', icon: Settings, show: me.isAdmin },
    ];
    const shown = links.filter((l) => l.show);
    const textLink = ({ isActive }: { isActive: boolean }) =>
        cn('font-display tracking-wider uppercase hover:text-primary', isActive ? 'text-primary' : 'text-muted-foreground');

    return (
        <div className="flex min-h-screen flex-col">
            <header className="border-b border-primary/40">
                <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
                    <Link to="/" className="flex items-center gap-2">
                        <img src="/logo.svg" alt="" className="size-7" />
                        <span className="font-display text-xl font-bold tracking-[0.2em] text-primary">DEADLINE</span>
                    </Link>
                    <nav className="hidden gap-4 sm:flex">
                        {shown.map((l) => (
                            <NavLink key={l.to} to={l.to} end={l.to === '/'} className={textLink}>
                                {l.label}
                            </NavLink>
                        ))}
                    </nav>
                    <div className="ml-auto hidden items-center gap-3 sm:flex">
                        {canCreateGig(me) && (
                            <Button asChild size="sm">
                                <Link to="/gigs/new">
                                    <Plus className="size-4" /> New gig
                                </Link>
                            </Button>
                        )}
                        <Link to="/me" className="flex items-center gap-2 hover:text-primary" title="Your settings">
                            <Avatar member={me} />
                            {me.name}
                        </Link>
                        <Button variant="ghost" size="icon" onClick={logout} title="Log out">
                            <LogOut className="size-4" />
                        </Button>
                    </div>
                </div>
            </header>

            {/* Bottom padding on phones keeps content clear of the icon bar */}
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-40 sm:pb-6">
                {me.isAdmin && <SetupReminder />}
                <Outlet />
            </main>
            <footer className="mx-auto hidden w-full max-w-6xl px-4 py-4 text-xs sm:block">
                <Say>fixer board node. uplink stable.</Say>
            </footer>

            {canCreateGig(me) && pathname !== '/gigs/new' && (
                <Button asChild size="icon" className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 size-14 [--cut:12px] sm:hidden">
                    <Link to="/gigs/new" aria-label="New gig" title="New gig">
                        <Plus className="size-6" />
                    </Link>
                </Button>
            )}

            <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-primary/40 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
                <div className="flex">
                    {shown.map((l) => (
                        <BarLink key={l.to} to={l.to} label={l.label}>
                            <l.icon className="size-6" />
                        </BarLink>
                    ))}
                    <BarLink to="/me" label="You">
                        <Avatar member={me} className="size-7" />
                    </BarLink>
                </div>
            </nav>
        </div>
    );
}

/** One icon in the phone nav bar. The active one gets a bar on top and the primary colour. */
function BarLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
    return (
        <NavLink
            to={to}
            end={to === '/'}
            aria-label={label}
            title={label}
            className={({ isActive }) =>
                cn('flex h-16 flex-1 items-center justify-center border-t-2', isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')
            }
        >
            {children}
        </NavLink>
    );
}
