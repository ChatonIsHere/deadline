import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(path: string): Db {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const sqlite = new Database(path);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    const db = drizzle({ client: sqlite, schema, casing: 'snake_case' });
    migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
    return db;
}

