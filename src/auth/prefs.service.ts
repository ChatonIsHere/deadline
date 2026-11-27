import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type MyAvailability, NEW_GIG_SCOPES, NOTIFY_DEFAULTS, NOTIFY_KINDS, type NotifySettings, type Prefs, type PrefsInput, type SetupInput } from '../shared/schemas';

const DEFAULTS: Prefs = { reminders: true, notify: NOTIFY_DEFAULTS, playerView: false, timezone: null, infiniteScroll: false };

/** Stored notification settings over the defaults. Anything unknown or the wrong type is dropped. */
export function notifySettings(value: Prisma.JsonValue): NotifySettings {
    const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const settings: NotifySettings = { ...NOTIFY_DEFAULTS, newGigFixers: [] };
    for (const kind of NOTIFY_KINDS) if (typeof stored[kind] === 'boolean') settings[kind] = stored[kind];
    if (NEW_GIG_SCOPES.includes(stored.newGigs as never)) settings.newGigs = stored.newGigs as NotifySettings['newGigs'];
    if (Array.isArray(stored.newGigFixers)) settings.newGigFixers = stored.newGigFixers.filter((f): f is string => typeof f === 'string');
    return settings;
}

/** A jsonb list of hours. Anything else is dropped. */
export const hourList = (value: Prisma.JsonValue): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []);

/** Each person's own choices: reminders and notifications, their timezone and when they can play. */
@Injectable()
export class PrefsService {
    constructor(private readonly prisma: PrismaService) {}

    async get(userId: string): Promise<Prefs> {
        const row = await this.prisma.userPrefs.findUnique({ where: { userId } });
        return row ? { reminders: row.reminders, notify: notifySettings(row.notify), playerView: row.playerView, timezone: row.timezone, infiniteScroll: row.infiniteScroll } : DEFAULTS;
    }

    /** Notification settings for several people at once. People without a row get the defaults. */
    async notifyFor(userIds: string[]): Promise<Map<string, NotifySettings>> {
        const rows = await this.prisma.userPrefs.findMany({ where: { userId: { in: userIds } }, select: { userId: true, notify: true } });
        const stored = new Map(rows.map((r) => [r.userId, notifySettings(r.notify)]));
        return new Map(userIds.map((id) => [id, stored.get(id) ?? NOTIFY_DEFAULTS]));
    }

    /** Everyone who asked to hear about new gigs, with how. */
    async newGigWatchers(): Promise<{ userId: string; notify: NotifySettings }[]> {
        const rows = await this.prisma.userPrefs.findMany({ where: { notify: { path: ['newGigs'], not: 'off' } }, select: { userId: true, notify: true } });
        return rows.map((r) => ({ userId: r.userId, notify: notifySettings(r.notify) })).filter((w) => w.notify.newGigs !== 'off');
    }

    /** Changes only what's given. Notification settings merge into the ones already saved. */
    async set(userId: string, { notify, ...prefs }: PrefsInput) {
        const data = { ...prefs, ...(notify && { notify: { ...notifySettings((await this.prisma.userPrefs.findUnique({ where: { userId }, select: { notify: true } }))?.notify ?? {}), ...notify } }) };
        await this.prisma.userPrefs.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    }

    /** Whether they've been through first-time setup. */
    async setUp(userId: string): Promise<boolean> {
        const row = await this.prisma.userPrefs.findUnique({ where: { userId }, select: { setupAt: true } });
        return !!row?.setupAt;
    }

    /** Ends first-time setup. They need a runner first, unless they're an admin. */
    async finishSetup(userId: string, isAdmin: boolean, { timezone, reminders }: SetupInput) {
        if (!isAdmin && !(await this.prisma.runner.count({ where: { ownerId: userId } }))) throw new BadRequestException('Make a runner first.');
        const data = { timezone, reminders, setupAt: new Date() };
        await this.prisma.userPrefs.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    }

    async availability(userId: string): Promise<MyAvailability> {
        const row = await this.prisma.userPrefs.findUnique({ where: { userId }, select: { timezone: true, availability: true } });
        return { timezone: row?.timezone ?? null, hours: row ? hourList(row.availability) : [] };
    }

    async setAvailability(userId: string, hours: number[]) {
        await this.prisma.userPrefs.upsert({ where: { userId }, create: { userId, availability: hours }, update: { availability: hours } });
    }
}
