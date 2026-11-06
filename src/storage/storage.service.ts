import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

/** Where stored files go. Keys look like "images/<id>/plain.webp". */
export interface Storage {
    put(key: string, data: Buffer, contentType: string): Promise<void>;
    get(key: string): Promise<Buffer | null>;
    /** Every key starting with `prefix`. */
    list(prefix: string): Promise<string[]>;
    delete(keys: string[]): Promise<void>;
}

/** The bucket. Private: files are only reached through Deadline's /images route. */
class S3Storage implements Storage {
    private readonly client: S3Client;

    constructor(
        endpoint: string,
        private readonly bucket: string,
    ) {
        this.client = new S3Client({
            endpoint,
            region: config.S3_REGION,
            credentials: { accessKeyId: config.S3_ACCESS_KEY!, secretAccessKey: config.S3_SECRET_KEY! },
            forcePathStyle: true,
        });
    }

    async put(key: string, data: Buffer, contentType: string) {
        await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
    }

    async get(key: string) {
        try {
            const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
            return Buffer.from(await res.Body!.transformToByteArray());
        } catch (err) {
            if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
            throw err;
        }
    }

    async list(prefix: string) {
        const keys: string[] = [];
        let token: string | undefined;
        do {
            const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
            keys.push(...(res.Contents ?? []).map((o) => o.Key!));
            token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        return keys;
    }

    async delete(keys: string[]) {
        // S3 takes up to 1000 keys per request
        for (let i = 0; i < keys.length; i += 1000) {
            const batch = keys.slice(i, i + 1000);
            if (batch.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }));
        }
    }
}

/** A folder, for local dev and tests, so neither needs S3 credentials. */
export class DiskStorage implements Storage {
    constructor(private readonly root: string) {}

    private path(key: string) {
        if (key.includes('..')) throw new Error(`Bad key: ${key}`);
        return join(this.root, ...key.split('/'));
    }

    async put(key: string, data: Buffer) {
        await mkdir(dirname(this.path(key)), { recursive: true });
        await writeFile(this.path(key), data);
    }

    async get(key: string) {
        try {
            return await readFile(this.path(key));
        } catch {
            return null;
        }
    }

    async list(prefix: string) {
        const files = await readdir(this.root, { recursive: true, withFileTypes: true }).catch(() => []);
        return files
            .filter((f) => f.isFile())
            .map((f) => relative(this.root, join(f.parentPath, f.name)).split(sep).join('/'))
            .filter((key) => key.startsWith(prefix));
    }

    async delete(keys: string[]) {
        for (const key of keys) await rm(this.path(key), { force: true });
    }
}

/** Stored files: S3 when it's configured, ./data/objects otherwise. */
@Injectable()
export class StorageService implements Storage {
    private readonly logger = new Logger(StorageService.name);
    private readonly store: Storage;

    /** Tests pass their own store. */
    constructor(store?: Storage) {
        if (store) {
            this.store = store;
        } else if (config.S3_ENDPOINT && config.S3_BUCKET && config.S3_ACCESS_KEY && config.S3_SECRET_KEY) {
            this.store = new S3Storage(config.S3_ENDPOINT, config.S3_BUCKET);
        } else {
            this.logger.warn('No S3 settings: keeping pictures in ./data/objects');
            this.store = new DiskStorage(join(process.cwd(), 'data', 'objects'));
        }
    }

    put(key: string, data: Buffer, contentType: string) {
        return this.store.put(key, data, contentType);
    }
    get(key: string) {
        return this.store.get(key);
    }
    list(prefix: string) {
        return this.store.list(prefix);
    }
    delete(keys: string[]) {
        return this.store.delete(keys);
    }
}
