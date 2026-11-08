import { type BotProfile, FIXER_ROLE, type GuildOptions, type Option, type Settings, type SettingsView, settingsInput } from '@shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { type ComponentProps, type FormEvent, useState } from 'react';
import { Loading, Say } from '@/components/common';
import { SettingsTabs } from '@/components/settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { api, imageUrl, thumbUrl, useAction, useLibrary, useSettings, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

// Settings on one page: the config in one form with one save, and the bot's profile beside it,
// which saves straight to Discord. The image library has its own tab (library.tsx).

const ROLES: { key: 'adminRoleId' | 'fixerRoleId' | 'edgerunnerRoleId'; label: string }[] = [
    { key: 'adminRoleId', label: 'Admin' },
    { key: 'fixerRoleId', label: 'Fixer' },
    { key: 'edgerunnerRoleId', label: 'Edgerunner' },
];

/** Admins only. Desktop: three columns, with the tabs at the top and the columns centred under them (see the layout). */
export function SettingsPage() {
    const me = useUser();
    const { data } = useSettings(me.isAdmin);
    if (!me.isAdmin) return <Say>admins only.</Say>;
    return (
        <div className="flex flex-col xl:flex-1">
            <SettingsTabs />
            {data ? (
                <div className="grid items-start gap-5 xl:my-auto xl:grid-cols-3">
                    <ConfigForm view={data} isOwner={me.isOwner} />
                    <BotProfileCard />
                </div>
            ) : (
                <Loading>loading config...</Loading>
            )}
        </div>
    );
}

/**
 * The config being edited. Saving sends all of it.
 * `changed` compares it with the saved config; `invalid` holds the fields the server would refuse.
 */
function useConfig(view: SettingsView) {
    const [form, setForm] = useState(view.settings);
    const set = (patch: Partial<Settings>) => setForm((f) => ({ ...f, ...patch }));
    const changed = JSON.stringify(form) !== JSON.stringify(view.settings);
    const check = settingsInput.safeParse(form);
    const invalid = new Set(check.success ? [] : check.error.issues.map((i) => String(i.path[0])));
    const save = useAction(() => api('/api/settings', 'PUT', form), 'config saved.');
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (changed && !invalid.size) save.mutate();
    };
    return { form, set, save, submit, changed, invalid };
}

/**
 * Grey until something changes, dim red while a change is invalid (the field is marked red too),
 * then the usual colour once it can be saved.
 */
function SaveButton({ pending, changed, invalid, label = 'Save config', ...props }: ComponentProps<'button'> & { pending: boolean; changed: boolean; invalid: boolean; label?: string }) {
    return (
        <Button
            type="submit"
            {...props}
            className="enter w-full disabled:opacity-100 data-[state=clean]:bg-muted data-[state=clean]:text-muted-foreground data-[state=invalid]:bg-destructive/20 data-[state=invalid]:text-destructive/80"
            data-state={!changed ? 'clean' : invalid ? 'invalid' : 'ready'}
            title={!changed ? 'Nothing to save yet' : invalid ? 'Fix the fields marked in red first' : undefined}
            disabled={pending || !changed || invalid}
        >
            {pending ? 'Saving' : label}
        </Button>
    );
}

/** Two columns: the server, its gig forum and scheduling, then who does what and the runner roles. One save for all of it. */
function ConfigForm({ view, isOwner }: { view: SettingsView; isOwner: boolean }) {
    const { form, set, save, submit, changed, invalid } = useConfig(view);
    const [adding, setAdding] = useState('');

    // Forums and roles come with the saved server. Picking another one loads its own.
    const sameGuild = form.guildId === view.settings.guildId;
    const other = useQuery({
        queryKey: ['guild-options', form.guildId],
        queryFn: () => api<GuildOptions>(`/api/settings/guilds/${form.guildId}`),
        enabled: !!form.guildId && !sameGuild,
    });
    const options = sameGuild ? view.options : other.data;

    const roles = form.runnerRoles;
    const addRole = () => {
        const role = adding.trim();
        if (role && !roles.some((r) => r.toLowerCase() === role.toLowerCase())) set({ runnerRoles: [...roles, role] });
        setAdding('');
    };

    return (
        <form onSubmit={submit} className="space-y-5 xl:col-span-2">
            <div className="grid items-start gap-5 md:grid-cols-2">
                <div className="space-y-5">
                    <Card className="space-y-3">
                        <CardTitle>Server</CardTitle>
                        {view.guilds.length ? (
                            <Select
                                value={form.guildId ?? ''}
                                disabled={!isOwner}
                                placeholder="Pick a server"
                                options={toOptions(view.guilds)}
                                onChange={(guildId) => set({ guildId: guildId || null, forumId: null, adminRoleId: null, fixerRoleId: null, edgerunnerRoleId: null })}
                            />
                        ) : (
                            <Say>the bot isn't in any server yet.</Say>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {isOwner ? 'Changing this orphans existing gig posts. ' : 'Only the bot owner can change this. '}
                            <a href={view.inviteUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                                Invite the bot to a server
                            </a>
                        </p>
                    </Card>

                    {form.guildId && !options && <Loading>scanning server...</Loading>}

                    {options && (
                        <Card className="space-y-3">
                            <CardTitle>Gig forum</CardTitle>
                            <Select value={form.forumId ?? ''} placeholder="Pick a forum" options={toOptions(options.forums)} onChange={(forumId) => set({ forumId: forumId || null })} />
                            {!options.forums.length && <Say>no forums the bot can see. make one, or check the bot's permissions.</Say>}
                        </Card>
                    )}

                    <Card className="space-y-4">
                        <CardTitle>Gig scheduling</CardTitle>
                        <div>
                            <Label htmlFor="reminder-hours">Day-of reminder (hours before)</Label>
                            <Input
                                id="reminder-hours"
                                type="number"
                                min={1}
                                max={72}
                                value={form.reminderHours}
                                aria-invalid={invalid.has('reminderHours') || undefined}
                                onChange={(e) => set({ reminderHours: Number(e.target.value) })}
                            />
                            {invalid.has('reminderHours') && <p className="mt-1 text-xs text-destructive">Whole hours, 1 to 72.</p>}
                            <p className="mt-1 text-xs text-muted-foreground">A second one goes out 30 minutes before.</p>
                        </div>
                        <div>
                            <Label htmlFor="confirm-hours">Time to confirm (hours)</Label>
                            <Input
                                id="confirm-hours"
                                type="number"
                                min={1}
                                max={168}
                                value={form.confirmHours}
                                aria-invalid={invalid.has('confirmHours') || undefined}
                                onChange={(e) => set({ confirmHours: Number(e.target.value) })}
                            />
                            {invalid.has('confirmHours') && <p className="mt-1 text-xs text-destructive">Whole hours, 1 to 168.</p>}
                            <p className="mt-1 text-xs text-muted-foreground">Ends an hour before the session if that's sooner. One nudge with 12 hours left, then the slot goes to the reserves.</p>
                        </div>
                        <div>
                            <Label htmlFor="max-signups">Most live gigs per player</Label>
                            <Input
                                id="max-signups"
                                type="number"
                                min={0}
                                max={50}
                                value={form.maxSignups}
                                aria-invalid={invalid.has('maxSignups') || undefined}
                                onChange={(e) => set({ maxSignups: Number(e.target.value) })}
                            />
                            {invalid.has('maxSignups') && <p className="mt-1 text-xs text-destructive">Whole number, 0 to 50.</p>}
                            <p className="mt-1 text-xs text-muted-foreground">Across all of a player's runners, reserves included. 0 for no limit. Admins adding someone can go over it.</p>
                        </div>
                    </Card>
                </div>

                <div className="space-y-5">
                    {options && (
                        <Card className="space-y-4">
                            <div>
                                <CardTitle className="mb-1">Roles</CardTitle>
                                <p className="text-xs text-muted-foreground">Anyone with Manage Server counts as an admin too. @everyone works for edgerunners.</p>
                            </div>
                            {ROLES.map((r) => (
                                <div key={r.key}>
                                    <Label htmlFor={r.key}>{r.label}</Label>
                                    <Select
                                        id={r.key}
                                        value={form[r.key] ?? ''}
                                        options={[{ value: '', label: 'Nobody' }, ...toOptions(options.roles)]}
                                        onChange={(roleId) => set({ [r.key]: roleId || null })}
                                    />
                                </div>
                            ))}
                        </Card>
                    )}

                    <Card className="space-y-3">
                        <div>
                            <CardTitle className="mb-1">Runner roles</CardTitle>
                            <p className="text-xs text-muted-foreground">Fixer can't be removed: it's what puts a runner on the Fixers tab.</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {roles.map((r) => (
                                <span key={r} className="cut inline-flex items-center gap-1 bg-muted py-1 pr-1 pl-2 font-display text-xs tracking-wider uppercase [--cut:5px]">
                                    {r}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${r}`}
                                        disabled={r === FIXER_ROLE}
                                        onClick={() => set({ runnerRoles: roles.filter((x) => x !== r) })}
                                        className="cursor-pointer px-1 text-muted-foreground hover:text-destructive disabled:hidden"
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={adding}
                                onChange={(e) => setAdding(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addRole();
                                    }
                                }}
                                placeholder="Add a role"
                                maxLength={30}
                            />
                            <Button type="button" variant="outline" className="mt-0.5" disabled={!adding.trim()} onClick={addRole}>
                                Add
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>

            <SaveButton pending={save.isPending} changed={changed} invalid={invalid.size > 0} />
        </form>
    );
}

const toOptions = (list: Option[]): SelectOption[] => list.map((o) => ({ value: o.id, label: o.name, color: o.color }));

/** The bot's Discord banner (a library picture, framed) and About me. Saved straight to Discord. */
function BotProfileCard() {
    const { data: profile } = useQuery({ queryKey: ['bot-profile'], queryFn: () => api<BotProfile>('/api/settings/bot-profile') });
    const library = useLibrary().data;
    const [about, setAbout] = useState<string | null>(null);
    const [bannerImageId, setBannerImageId] = useState<string | null>(null);
    const save = useAction(() => api('/api/settings/bot-profile', 'PUT', { about: about ?? profile?.about ?? '', bannerImageId }), 'bot profile updated.', () => setBannerImageId(null));

    // About me can't be over the limit: the field stops at 400.
    const changed = !!profile && (bannerImageId !== null || (about !== null && about !== profile.about));
    const pictures = library ? [...library.pool, ...library.regions.flatMap((r) => r.images)] : [];

    return (
        <Card className="space-y-4">
            <CardTitle>Bot profile</CardTitle>
            <div>
                <Label>Banner</Label>
                {profile?.bannerUrl && !bannerImageId && <img src={profile.bannerUrl} alt="" className="mb-2 aspect-[5/2] w-full object-cover" />}
                {bannerImageId && <img src={imageUrl(bannerImageId)} alt="" className="mb-2 aspect-[5/2] w-full object-cover" />}
                <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6 xl:grid-cols-4">
                    {pictures.map((id) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setBannerImageId(id)}
                            className={cn('cursor-pointer outline-2 outline-offset-1', bannerImageId === id ? 'outline-primary' : 'outline-transparent')}
                        >
                            <img src={thumbUrl(id)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <Label htmlFor="about">About me</Label>
                <Input id="about" value={about ?? profile?.about ?? ''} onChange={(e) => setAbout(e.target.value)} maxLength={400} />
            </div>
            <SaveButton type="button" label="Update bot profile" pending={save.isPending} changed={changed} invalid={false} onClick={() => save.mutate()} />
        </Card>
    );
}
