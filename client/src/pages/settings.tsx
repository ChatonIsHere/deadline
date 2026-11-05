import { type BotProfile, FIXER_ROLE, type GuildOptions, type Option, type Settings, type SettingsView } from '@shared/schemas';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Say } from '@/components/common';
import { SettingsTabs } from '@/components/settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { api, imageUrl, plainImageUrl, useAction, useLibrary, useSettings, useUser } from '@/lib/api';
import { cn } from '@/lib/utils';

const ROLES: { key: 'adminRoleId' | 'fixerRoleId' | 'edgerunnerRoleId'; label: string; hint: string }[] = [
    { key: 'adminRoleId', label: 'Admin', hint: 'Approves and manages gigs and crews. People with Manage Server count too.' },
    { key: 'fixerRoleId', label: 'Fixer', hint: 'Submits gigs from their fixer characters for approval.' },
    { key: 'edgerunnerRoleId', label: 'Edgerunner', hint: 'Takes gigs and runs crews. @everyone works.' },
];

export function SettingsPage() {
    const me = useUser();
    const { data } = useSettings(me.isAdmin);
    if (!me.isAdmin) return <Say>admins only.</Say>;
    if (!data) return <Say>loading config...</Say>;
    return (
        <>
            <SettingsTabs />
            <SettingsForm view={data} isOwner={me.isOwner} />
            <BotProfileCard />
        </>
    );
}

function SettingsForm({ view, isOwner }: { view: SettingsView; isOwner: boolean }) {
    const [form, setForm] = useState(view.settings);
    const set = (patch: Partial<Settings>) => setForm((f) => ({ ...f, ...patch }));

    // Forums and roles come with the saved server. Picking another one loads its own.
    const sameGuild = form.guildId === view.settings.guildId;
    const other = useQuery({
        queryKey: ['guild-options', form.guildId],
        queryFn: () => api<GuildOptions>(`/api/settings/guilds/${form.guildId}`),
        enabled: !!form.guildId && !sameGuild,
    });
    const options = sameGuild ? view.options : other.data;

    const save = useAction(() => api('/api/settings', 'PUT', form), 'Config saved.');
    const submit = (e: FormEvent) => {
        e.preventDefault();
        save.mutate();
    };

    return (
        <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5">

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

            {form.guildId && !options && <Say>scanning server...</Say>}

            {options && (
                <>
                    <Card className="space-y-3">
                        <CardTitle>Gig forum</CardTitle>
                        <Select
                            value={form.forumId ?? ''}
                            placeholder="Pick a forum"
                            options={toOptions(options.forums)}
                            onChange={(forumId) => set({ forumId: forumId || null })}
                        />
                        <p className="text-xs text-muted-foreground">
                            {options.forums.length
                                ? 'Approved gigs get posted here. Live gigs move over on their next update if you change it.'
                                : "No forums the bot can see. Make one, or check the bot's permissions."}
                        </p>
                    </Card>

                    <Card className="space-y-4">
                        <CardTitle>Roles</CardTitle>
                        {ROLES.map((r) => (
                            <div key={r.key}>
                                <Label htmlFor={r.key}>{r.label}</Label>
                                <Select
                                    id={r.key}
                                    value={form[r.key] ?? ''}
                                    options={[{ value: '', label: 'Nobody' }, ...toOptions(options.roles)]}
                                    onChange={(roleId) => set({ [r.key]: roleId || null })}
                                />
                                <p className="mt-1 text-xs text-muted-foreground">{r.hint}</p>
                            </div>
                        ))}
                    </Card>
                </>
            )}

            <RoleList roles={form.runnerRoles} onChange={(runnerRoles) => set({ runnerRoles })} />

            <Card className="space-y-4">
                <CardTitle>Sessions</CardTitle>
                <div>
                    <Label htmlFor="reminder-hours" help="confirmed runners also get one 30 minutes before. they can turn reminders off.">Day-of reminder (hours before)</Label>
                    <Input
                        id="reminder-hours"
                        type="number"
                        min={1}
                        max={72}
                        value={form.reminderHours}
                        onChange={(e) => set({ reminderHours: Number(e.target.value) })}
                    />
                </div>
                <div>
                    <Label htmlFor="confirm-hours" help="counted from when they're asked. ends an hour before the session if that's sooner. one nudge with 12 hours left, then their slot goes to the reserves.">Time to confirm (hours)</Label>
                    <Input
                        id="confirm-hours"
                        type="number"
                        min={1}
                        max={168}
                        value={form.confirmHours}
                        onChange={(e) => set({ confirmHours: Number(e.target.value) })}
                    />
                </div>
            </Card>

            <Button type="submit" className="w-full" disabled={save.isPending}>
                Save config
            </Button>
        </form>
    );
}

const toOptions = (list: Option[]): SelectOption[] => list.map((o) => ({ value: o.id, label: o.name, color: o.color }));

/** The roles runners can pick. Taking one off doesn't change runners who already have it. */
function RoleList({ roles, onChange }: { roles: string[]; onChange: (roles: string[]) => void }) {
    const [adding, setAdding] = useState('');
    const add = () => {
        const role = adding.trim();
        if (role && !roles.some((r) => r.toLowerCase() === role.toLowerCase())) onChange([...roles, role]);
        setAdding('');
    };

    return (
        <Card className="space-y-3">
            <CardTitle help="Fixer can't be removed: it's what puts a runner on the Fixers tab. save config to keep changes.">Runner roles</CardTitle>
            <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                    <span key={r} className="cut inline-flex items-center gap-1 bg-muted py-1 pr-1 pl-2 font-display text-xs tracking-wider uppercase [--cut:5px]">
                        {r}
                        <button
                            type="button"
                            title={`Remove ${r}`}
                            disabled={r === FIXER_ROLE}
                            onClick={() => onChange(roles.filter((x) => x !== r))}
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
                            add();
                        }
                    }}
                    placeholder="Add a role"
                    maxLength={30}
                />
                <Button type="button" variant="outline" className="mt-0.5" disabled={!adding.trim()} onClick={add}>
                    Add
                </Button>
            </div>
        </Card>
    );
}

/** The bot's Discord banner (a library picture, framed) and About me. Saved straight to Discord. */
function BotProfileCard() {
    const { data: profile } = useQuery({ queryKey: ['bot-profile'], queryFn: () => api<BotProfile>('/api/settings/bot-profile') });
    const library = useLibrary().data;
    const [about, setAbout] = useState<string | null>(null);
    const [bannerImageId, setBannerImageId] = useState<number | null>(null);
    const save = useAction(() => api('/api/settings/bot-profile', 'PUT', { about: about ?? profile?.about ?? '', bannerImageId }), () => {
        setBannerImageId(null);
        toast.success('Bot profile updated.');
    });

    const pictures = library ? [...library.pool, ...library.regions.flatMap((r) => r.images)] : [];

    return (
        <Card className="mx-auto mt-5 max-w-2xl space-y-4">
            <CardTitle>Bot profile</CardTitle>
            <div>
                <Label help="pick a library picture. it gets cropped to a banner with the board's frame. upload new ones under Library.">Banner</Label>
                {profile?.bannerUrl && !bannerImageId && <img src={profile.bannerUrl} alt="" className="mb-2 aspect-[5/2] w-full object-cover" />}
                {bannerImageId && <img src={imageUrl(bannerImageId)} alt="" className="mb-2 aspect-[5/2] w-full object-cover" />}
                <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
                    {pictures.map((id) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setBannerImageId(id)}
                            className={cn('cursor-pointer outline-2 outline-offset-1', bannerImageId === id ? 'outline-primary' : 'outline-transparent')}
                        >
                            <img src={plainImageUrl(id)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <Label htmlFor="about" help="shown on the bot's Discord profile.">About me</Label>
                <Input id="about" value={about ?? profile?.about ?? ''} onChange={(e) => setAbout(e.target.value)} maxLength={400} />
            </div>
            <Button type="button" className="w-full" disabled={save.isPending || !profile} onClick={() => save.mutate()}>
                {save.isPending ? 'Updating' : 'Update bot profile'}
            </Button>
        </Card>
    );
}
