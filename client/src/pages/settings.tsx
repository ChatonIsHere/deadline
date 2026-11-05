import type { GuildOptions, Option, Settings, SettingsView } from '@shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Say } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { api, useAction, useSettings, useUser } from '@/lib/api';

const ROLES: { key: 'adminRoleId' | 'fixerRoleId' | 'edgerunnerRoleId'; label: string; hint: string }[] = [
    { key: 'adminRoleId', label: 'Admin', hint: 'Approves and manages gigs and crews. People with Manage Server count too.' },
    { key: 'fixerRoleId', label: 'Fixer', hint: 'Submits gigs for approval.' },
    { key: 'edgerunnerRoleId', label: 'Edgerunner', hint: 'Takes gigs and runs crews. @everyone works.' },
];

export function SettingsPage() {
    const me = useUser();
    const { data } = useSettings();
    if (!me.isAdmin) return <Say>admins only.</Say>;
    if (!data) return <Say>loading config...</Say>;
    return <SettingsForm view={data} isOwner={me.isOwner} />;
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
            <h1 className="text-3xl text-primary">Settings</h1>

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

            <Card className="space-y-4">
                <CardTitle>Sessions</CardTitle>
                <div>
                    <Label htmlFor="reminder-hours">Day-of reminder (hours before)</Label>
                    <Input
                        id="reminder-hours"
                        type="number"
                        min={1}
                        max={72}
                        value={form.reminderHours}
                        onChange={(e) => set({ reminderHours: Number(e.target.value) })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Confirmed runners also get one 30 minutes before. They can turn reminders off.</p>
                </div>
                <div>
                    <Label htmlFor="confirm-hours">Time to confirm (hours)</Label>
                    <Input
                        id="confirm-hours"
                        type="number"
                        min={1}
                        max={168}
                        value={form.confirmHours}
                        onChange={(e) => set({ confirmHours: Number(e.target.value) })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        After being asked. Ends an hour before the session if that's sooner. One nudge with 12 hours left, then their slot goes to the reserves.
                    </p>
                </div>
            </Card>

            <Button type="submit" className="w-full" disabled={save.isPending}>
                Save config
            </Button>
        </form>
    );
}

const toOptions = (list: Option[]): SelectOption[] => list.map((o) => ({ value: o.id, label: o.name, color: o.color }));
