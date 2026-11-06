import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { MyAvailability, Prefs, PrefsInput, SetupInput } from '../shared/schemas';

const DEFAULTS: Prefs = { reminders: true, playerView: false, timezone: null };

/** A jsonb list of hours. Anything else is dropped. */
export const hourList = (value: Prisma.JsonValue): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []);

/** Each person's own choices: reminders, their timezone and when they can play. */
@Injectable()
export class PrefsService {
    constructor(private readonly prisma: PrismaService) {}

    async get(userId: string): Promise<Prefs> {
        const row = await this.prisma.userPrefs.findUnique({ where: { userId } });
        return row ? { reminders: row.reminders, playerView: row.playerView, timezone: row.timezone } : DEFAULTS;
    }

    /** Changes only what's given. */
    async set(userId: string, prefs: PrefsInput) {
        await this.prisma.userPrefs.upsert({ where: { userId }, create: { userId, ...prefs }, update: prefs });
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
