import { canCreateCrew, canCreateGig } from '@shared/permissions';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { logout } from '@/components/layout';
import { api, useAction, useCrews, useFixers, useGigs, useRunners, useUser } from '@/lib/api';

/**
 * Ctrl+K (or a click on the prompt bar): type to jump to any page, gig, runner, fixer or
 * crew. Built on cmdk, the library behind shadcn's Command component.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const me = useUser();
    const navigate = useNavigate();
    const gigs = useGigs().data ?? [];
    const runners = useRunners().data ?? [];
    const fixers = useFixers().data ?? [];
    const crews = useCrews().data ?? [];

    // The owner's player view: admin powers hidden, so they see what a player sees
    const playerView = useAction(
        (on: boolean) => api('/api/prefs', 'PUT', { playerView: on }),
        () => (me.playerView ? 'admin powers back.' : 'player view on. admin tools hidden.'),
    );

    const go = (to: string) => {
        onOpenChange(false);
        navigate(to);
    };

    const pages = [
        { to: '/gigs', label: 'Gigs' },
        { to: '/runners', label: 'Runners' },
        { to: '/fixers', label: 'Fixers' },
        { to: '/crews', label: 'Crews' },
        { to: '/me', label: 'Me' },
        ...(me.isAdmin ? [{ to: '/availability', label: 'Availability' }, { to: '/settings', label: 'Settings' }, { to: '/settings/library', label: 'Picture library' }] : []),
        ...(canCreateGig(me) ? [{ to: '/gigs/new', label: 'New gig' }] : []),
        { to: '/runners/new', label: 'New runner' },
        ...(canCreateCrew(me) ? [{ to: '/crews/new', label: 'Register a crew' }] : []),
        ...(me.isAdmin ? [{ to: '/fixers/new', label: 'New NPC fixer' }] : []),
    ];
    // Live gigs first, finished ones after
    const live = (s: string) => s === 'open' || s === 'closed' || s === 'pending';
    const sortedGigs = [...gigs].sort((a, b) => Number(live(b.status)) - Number(live(a.status)));

    return (
        <D.Root open={open} onOpenChange={onOpenChange}>
            <D.Portal>
                {/* No blur here: it made the browser redraw the whole page under the palette on every frame */}
                <D.Overlay className="fixed inset-0 z-40 bg-background/90" />
                <D.Content className="cut-frame fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 [--frame:var(--color-primary)]" aria-describedby={undefined}>
                    <D.Title className="sr-only">Jump to</D.Title>
                    {/* The mouse highlights with CSS hover; only the keyboard moves the selection, so hovering costs nothing */}
                    <Command loop disablePointerSelection className="flex max-h-[70vh] flex-col">
                        <div className="flex items-center gap-2 border-b border-border px-4">
                            <span className="font-display text-primary">&gt;</span>
                            <Command.Input autoFocus placeholder="jump to..." className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                            <kbd className="hidden text-xs text-muted-foreground sm:block">esc</kbd>
                        </div>
                        <Command.List className="overflow-y-auto p-2">
                            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">// DEADLINE: no match on the wire.</Command.Empty>
                            <Group heading="Pages">
                                {pages.map((p) => (
                                    <Item key={p.to} value={`page ${p.label}`} tag="PAGE" onSelect={() => go(p.to)}>
                                        {p.label}
                                    </Item>
                                ))}
                            </Group>
                            <Group heading="Gigs">
                                {sortedGigs.map((g) => (
                                    <Item key={g.id} value={`gig ${g.ref} ${g.name} ${g.fixerName} ${g.location}`} tag={g.status.toUpperCase()} onSelect={() => go(`/gigs/${g.ref}`)}>
                                        {g.name}
                                    </Item>
                                ))}
                            </Group>
                            <Group heading="Runners">
                                {runners.map((r) => (
                                    <Item key={r.id} value={`runner ${r.id} ${r.slug} ${r.handle} ${r.role}`} tag={r.role.toUpperCase()} onSelect={() => go(`/runners/${r.slug}`)}>
                                        {r.handle}
                                    </Item>
                                ))}
                            </Group>
                            <Group heading="Fixers">
                                {fixers
                                    .filter((f) => !f.ownerId)
                                    .map((f) => (
                                        <Item key={f.id} value={`fixer ${f.id} ${f.slug} ${f.handle}`} tag="NPC" onSelect={() => go(`/fixers/${f.slug}`)}>
                                            {f.handle}
                                        </Item>
                                    ))}
                            </Group>
                            <Group heading="Crews">
                                {crews.map((c) => (
                                    <Item key={c.id} value={`crew ${c.id} ${c.slug} ${c.name}`} tag="CREW" onSelect={() => go(`/crews/${c.slug}`)}>
                                        {c.name}
                                    </Item>
                                ))}
                            </Group>
                            <Group heading="Session">
                                {me.isOwner && (
                                    <Item
                                        value={me.playerView ? 'back to admin player view off' : 'view as a player player view on'}
                                        tag="VIEW"
                                        onSelect={() => {
                                            onOpenChange(false);
                                            playerView.mutate(!me.playerView);
                                        }}
                                    >
                                        {me.playerView ? 'Back to admin' : 'View as a player'}
                                    </Item>
                                )}
                                <Item value="log out sign out" tag="EXIT" onSelect={() => void logout()}>
                                    Log out
                                </Item>
                            </Group>
                        </Command.List>
                    </Command>
                </D.Content>
            </D.Portal>
        </D.Root>
    );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
    return (
        <Command.Group
            heading={heading}
            className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-display [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-accent [&_[cmdk-group-heading]]:uppercase"
        >
            {children}
        </Command.Group>
    );
}

function Item({ value, tag, onSelect, children }: { value: string; tag: string; onSelect: () => void; children: ReactNode }) {
    return (
        <Command.Item
            value={value}
            onSelect={onSelect}
            className="group flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
        >
            <span className="min-w-0 flex-1 truncate">{children}</span>
            <span className="shrink-0 text-xs tracking-widest text-muted-foreground group-data-[selected=true]:text-primary-foreground/70">{tag}</span>
        </Command.Item>
    );
}
