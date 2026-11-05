import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { userPrefs } from '../db/schema';
import type { Prefs } from '../shared/schemas';

const DEFAULTS: Prefs = { reminders: true, playerView: false };

/** Each person's own choices, like whether they get session reminders. */
@Injectable()
export class PrefsService {
    constructor(@Inject(DB) private readonly db: Db) {}

    get(userId: string): Prefs {
        const { userId: _, ...prefs } = this.db.query.userPrefs.findFirst({ where: eq(userPrefs.userId, userId) }).sync() ?? { userId, ...DEFAULTS };
        return prefs;
    }

    set(userId: string, prefs: Prefs) {
        this.db.insert(userPrefs).values({ userId, ...prefs }).onConflictDoUpdate({ target: userPrefs.userId, set: prefs }).run();
    }
}
