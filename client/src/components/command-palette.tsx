import { canCreateCrew, canCreateGig } from '@shared/permissions';
import { Command } from 'cmdk';
import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { logout } from '@/components/layout';
import { api, useAction, useCrews, useFixers, useGigs, useRunners, useUser } from '@/lib/api';
import { usePhone, useVisualViewport } from '@/lib/media';

/**
 * Ctrl+K (or a click on the prompt bar): type to jump to any page, gig, runner, fixer or
 * crew. Built on cmdk, the library behind shadcn's Command component.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const me = useUser();
    const phone = usePhone();
    const visible = useVisualViewport();
    const navigate = useNavigate();
    const gigQuery = useGigs();
    const runnerQuery = useRunners();
    const fixerQuery = useFixers();
    const crewQuery = useCrews();
    const gigs = gigQuery.data ?? [];
    const runners = runnerQuery.data ?? [];
    const fixers = fixerQuery.data ?? [];
    const crews = crewQuery.data ?? [];
    // Until the lists are in, no match might just mean not loaded yet
    const loading = gigQuery.isPending || runnerQuery.isPending || fixerQuery.isPending || crewQuery.isPending;

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
        ...(me.isAdmin ? [{ to: '/availability', label: 'Availability' }, { to: '/settings', label: 'Settings' }, { to: '/settings/library', label: 'Image library' }] : []),
        ...(canCreateGig(me) ? [{ to: '/gigs/new', label: 'New gig' }] : []),
        { to: '/runners/new', label: 'New runner' },
        ...(canCreateCrew(me) ? [{ to: '/crews/new', label: 'Register a crew' }] : []),
        ...(me.isAdmin ? [{ to: '/fixers/new', label: 'New NPC fixer' }] : []),
    ];
    // Live gigs first, finished ones after
    const live = (s: string) => s === 'open' || s === 'closed' || s === 'pending' || s === 'draft';
    const sortedGigs = [...gigs].sort((a, b) => Number(live(b.status)) - Number(live(a.status)));

    return (
        <D.Root open={open} onOpenChange={onOpenChange}>
            <D.Portal>
                {/* No blur here: it made the browser redraw the whole page under the palette on every frame */}
                <D.Overlay className="fixed inset-0 z-40 bg-background/90" />
                <D.Content
                    className="cut-frame fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 [--frame:var(--color-primary)]"
                    style={phone && visible ? { top: visible.offsetTop + 16 } : undefined}
                    aria-describedby={undefined}
                >
                    <D.Title className="sr-only">Jump to</D.Title>
                    {/* The mouse highlights with CSS hover; only the keyboard moves the selection, so hovering costs nothing */}
                    <Command loop disablePointerSelection className="flex max-h-[70vh] flex-col" style={phone && visible ? { maxHeight: visible.height - 32 } : undefined}>
                        <div className="flex items-center gap-2 border-b-2 border-border px-4">
                            <span className="font-display text-primary">&gt;</span>
                            <Command.Input autoFocus placeholder="jump to..." className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                            <kbd className="hidden text-xs text-muted-foreground sm:block">esc</kbd>
                        </div>
                        <Command.List className="overflow-y-auto p-2">
                            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{loading ? '// DEADLINE: pulling records...' : '// DEADLINE: no match on the wire.'}</Command.Empty>
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
                                {/* Player fixers without an alias are under Runners, with the same name */}
                                {fixers
                                    .filter((f) => !f.ownerId || f.fixerName !== f.handle)
                                    .map((f) => (
                                        <Item key={f.id} value={`fixer ${f.id} ${f.fixerSlug} ${f.fixerName}`} tag={f.ownerId ? 'FIXER' : 'NPC'} onSelect={() => go(`/fixers/${f.fixerSlug}`)}>
                                            {f.fixerName}
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
