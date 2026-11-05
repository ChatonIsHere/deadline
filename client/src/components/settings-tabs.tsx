import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

const TABS = [
    { to: '/settings', label: 'Discord' },
    { to: '/settings/scheduling', label: 'Scheduling' },
    { to: '/settings/roles', label: 'Runner roles' },
    { to: '/settings/bot', label: 'Bot' },
    { to: '/settings/library', label: 'Library' },
];

/** The heading and tabs shared by the admin pages under Settings. */
export function SettingsTabs() {
    return (
        <div className="mb-5">
            <h1 className="mb-3 text-3xl text-primary">Settings</h1>
            {/* Bottom line as an inset shadow so the tabs sit on it without hanging over (which made a scrollbar) */}
            <nav className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none]">
                {TABS.map((t) => (
                    <NavLink
                        key={t.to}
                        to={t.to}
                        end
                        className={({ isActive }) =>
                            cn(
                                'shrink-0 border-b-2 px-3 py-2 font-display text-sm tracking-wider uppercase hover:text-foreground',
                                isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground',
                            )
                        }
                    >
                        {t.label}
                    </NavLink>
                ))}
            </nav>
        </div>
    );
}
