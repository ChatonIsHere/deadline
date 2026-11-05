import { canCreateGig } from '@shared/permissions';
import { LogOut, Plus } from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Avatar, Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { api, useMe, useSettings } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Nags admins until there's a server and forum to post to. */
function SetupReminder() {
    const { data } = useSettings();
    const { pathname } = useLocation();
    if (!data || pathname === '/settings' || (data.settings.guildId && data.settings.forumId)) return null;
    return (
        <div className="cut-frame mb-6 flex flex-wrap items-center gap-3 p-4 [--frame:var(--color-primary)]">
            <Say className="flex-1">not configured. pick a server and a gig forum before posting gigs.</Say>
            <Button asChild size="sm">
                <Link to="/settings">Settings</Link>
            </Button>
        </div>
    );
}

export function Layout() {
    const { data: me, isPending, isError } = useMe();
    if (isError) return <Navigate to="/login" replace />;
    if (isPending) return <Say className="p-6">connecting to the board...</Say>;

    const logout = async () => {
        await api('/auth/logout', 'POST');
        location.href = '/login';
    };

    const navClass = ({ isActive }: { isActive: boolean }) =>
        cn('font-display tracking-wider uppercase hover:text-primary', isActive ? 'text-primary' : 'text-muted-foreground');

    return (
        <div className="flex min-h-screen flex-col">
            <header className="border-b border-primary/40">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                    <Link to="/" className="flex items-center gap-2">
                        <img src="/logo.svg" alt="" className="size-7" />
                        <span className="font-display text-xl font-bold tracking-[0.2em] text-primary">DEADLINE</span>
                    </Link>
                    <nav className="flex gap-4">
                        <NavLink to="/" end className={navClass}>
                            Board
                        </NavLink>
                        <NavLink to="/crews" className={navClass}>
                            Crews
                        </NavLink>
                        {me.isAdmin && (
                            <NavLink to="/settings" className={navClass}>
                                Settings
                            </NavLink>
                        )}
                    </nav>
                    <div className="ml-auto flex items-center gap-3">
                        {canCreateGig(me) && (
                            <Button asChild size="sm">
                                <Link to="/gigs/new">
                                    <Plus className="size-4" /> New gig
                                </Link>
                            </Button>
                        )}
                        <span className="flex items-center gap-2">
                            <Avatar member={me} />
                            <span className="hidden sm:inline">{me.name}</span>
                        </span>
                        <Button variant="ghost" size="icon" onClick={logout} title="Log out">
                            <LogOut className="size-4" />
                        </Button>
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
                {me.isAdmin && <SetupReminder />}
                <Outlet />
            </main>
            <footer className="mx-auto w-full max-w-6xl px-4 py-4 text-xs">
                <Say>fixer board node. uplink stable.</Say>
            </footer>
        </div>
    );
}
