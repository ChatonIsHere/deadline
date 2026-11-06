import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';
import { config } from '../config';

/** What the cache needs from a store: Redis in production, a Map otherwise. */
interface Store {
    get(key: string): Promise<Buffer | null>;
    set(key: string, value: Buffer, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
}

/** For tests and local runs without Redis. Expiry is checked on read. */
export class MemoryStore implements Store {
    private readonly entries = new Map<string, { value: Buffer; until: number }>();
    async get(key: string) {
        const e = this.entries.get(key);
        if (!e) return null;
        if (e.until < Date.now()) {
            this.entries.delete(key);
            return null;
        }
        return e.value;
    }
    async set(key: string, value: Buffer, ttlSeconds: number) {
        this.entries.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
    }
    async del(key: string) {
        this.entries.delete(key);
    }
}

class RedisStore implements Store {
    constructor(private readonly client: ReturnType<typeof createClient>) {}
    async get(key: string) {
        return this.client.get(this.client.commandOptions({ returnBuffers: true }), key);
    }
    async set(key: string, value: Buffer, ttlSeconds: number) {
        await this.client.set(key, value, { EX: ttlSeconds });
    }
    async del(key: string) {
        await this.client.del(key);
    }
}

/**
 * Short-lived data: sessions, sign-in state, signed-in users' roles, Discord lookups and
 * recently served pictures. Keys are prefixed "deadline:" (Redis is shared with other apps,
 * though each has its own database index). Never the only copy of anything that matters,
 * except sessions, which just mean signing in again if lost.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(CacheService.name);
    private client?: ReturnType<typeof createClient>;
    private store: Store = new MemoryStore();

    /** Tests pass a store; the app connects to REDIS_URL if set. */
    constructor(store?: Store) {
        if (store) this.store = store;
    }

    async onModuleInit() {
        if (!config.REDIS_URL) {
            this.logger.warn('No REDIS_URL: caching in memory');
            return;
        }
        this.client = createClient({ url: config.REDIS_URL });
        this.client.on('error', (err) => this.logger.error(`Redis: ${err}`));
        await this.client.connect();
        this.store = new RedisStore(this.client);
    }

    async onModuleDestroy() {
        await this.client?.quit();
    }

    private key = (key: string) => `deadline:${key}`;

    async getBuffer(key: string): Promise<Buffer | null> {
        return this.store.get(this.key(key));
    }

    async setBuffer(key: string, value: Buffer, ttlSeconds: number): Promise<void> {
        await this.store.set(this.key(key), value, ttlSeconds);
    }

    async get<T>(key: string): Promise<T | null> {
        const raw = await this.store.get(this.key(key));
        return raw ? (JSON.parse(raw.toString('utf8')) as T) : null;
    }

    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
        await this.store.set(this.key(key), Buffer.from(JSON.stringify(value)), ttlSeconds);
    }

    async del(key: string): Promise<void> {
        await this.store.del(this.key(key));
    }

    /** The cached value, or `load()`'s result, cached for next time. */
    async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
        const hit = await this.get<T>(key);
        if (hit !== null) return hit;
        const value = await load();
        await this.set(key, value, ttlSeconds);
        return value;
    }
}
