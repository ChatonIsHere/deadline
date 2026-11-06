import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prefs } from '../shared/schemas';

const DEFAULTS: Prefs = { reminders: true, playerView: false };

/** Each person's own choices, like whether they get session reminders. */
@Injectable()
export class PrefsService {
    constructor(private readonly prisma: PrismaService) {}

    async get(userId: string): Promise<Prefs> {
        const row = await this.prisma.userPrefs.findUnique({ where: { userId } });
        return row ? { reminders: row.reminders, playerView: row.playerView } : DEFAULTS;
    }

    async set(userId: string, prefs: Prefs) {
        await this.prisma.userPrefs.upsert({ where: { userId }, create: { userId, ...prefs }, update: prefs });
    }
}
