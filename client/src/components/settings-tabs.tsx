import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

const TABS = [
    { to: '/settings', label: 'Config' },
    { to: '/settings/library', label: 'Library' },
];

/** The heading and tabs shared by the admin pages under Settings. */
export function SettingsTabs() {
    return (
        <div className="mb-5">
            <h1 className="mb-3 text-3xl text-primary">Settings</h1>
            <nav className="flex gap-1 border-b border-border">
                {TABS.map((t) => (
                    <NavLink
                        key={t.to}
                        to={t.to}
                        end
                        className={({ isActive }) =>
                            cn(
                                '-mb-px border-b-2 px-3 py-2 font-display text-sm tracking-wider uppercase hover:text-foreground',
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
