import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
    /** How many bytes everything starting with `prefix` takes up. */
    size(prefix: string): Promise<number>;
    delete(keys: string[]): Promise<void>;
    /** Where a key can be fetched from: the base URL, ending in "/", that keys are added to. */
    readonly base: string;
}

/**
 * The bucket. Files are public (it's only character art and location shots) and linked
 * directly, like the api's avatars: `<endpoint>/<bucket>/<key>`. A key never changes content
 * (versions and hashes are in the names), so they're cached for a year.
 */
class S3Storage implements Storage {
    private readonly client: S3Client;
    readonly base: string;

    constructor(
        endpoint: string,
        private readonly bucket: string,
    ) {
        this.base = `${endpoint.replace(/\/$/, '')}/${bucket}/`;
        this.client = new S3Client({
            endpoint,
            region: config.S3_REGION,
            credentials: { accessKeyId: config.S3_ACCESS_KEY!, secretAccessKey: config.S3_SECRET_KEY! },
            forcePathStyle: true,
        });
    }

    async put(key: string, data: Buffer, contentType: string) {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: data,
                ContentType: contentType,
                ACL: 'public-read',
                CacheControl: 'public, max-age=31536000, immutable',
            }),
        );
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

    private async objects(prefix: string) {
        const objects: { Key?: string; Size?: number }[] = [];
        let token: string | undefined;
        do {
            const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
            objects.push(...(res.Contents ?? []));
            token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        return objects;
    }

    async list(prefix: string) {
        return (await this.objects(prefix)).map((o) => o.Key!);
    }

    async size(prefix: string) {
        return (await this.objects(prefix)).reduce((sum, o) => sum + (o.Size ?? 0), 0);
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
    /** Served by Deadline itself at /images/ (keys start with "images/"). */
    readonly base = `${config.PUBLIC_URL}/`;

    constructor(readonly root: string) {}

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

    async size(prefix: string) {
        let total = 0;
        for (const key of await this.list(prefix)) total += (await stat(this.path(key))).size;
        return total;
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

    get base() {
        return this.store.base;
    }

    /** True for the bucket, false for the local folder (which Deadline serves itself). */
    get remote() {
        return !(this.store instanceof DiskStorage);
    }

    /** A stored file's full address, for the web and Discord. */
    url(key: string) {
        return `${this.store.base}${key}`;
    }

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
    size(prefix: string) {
        return this.store.size(prefix);
    }
    delete(keys: string[]) {
        return this.store.delete(keys);
    }
}
