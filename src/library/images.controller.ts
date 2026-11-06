import { Controller, Get, Logger, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CacheService } from '../cache/cache.service';
import { StorageService } from '../storage/storage.service';

/** Pictures this small are kept in Redis for a while; bigger ones always come from storage. */
const CACHE_MAX_BYTES = 512 * 1024;
const CACHE_SECONDS = 6 * 3600;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png' };

/**
 * Serves stored pictures at the same path as their key: /images/<id>/web-v6.webp. The bucket
 * stays private. A key never changes content (versions and hashes are in the name), so browsers,
 * Discord and Caddy can keep them for good.
 */
@Controller('images')
export class ImagesController {
    private readonly logger = new Logger(ImagesController.name);

    constructor(
        private readonly storage: StorageService,
        private readonly cache: CacheService,
    ) {}

    @Get('*path')
    async get(@Param('path') path: string | string[], @Res() res: Response) {
        const key = `images/${Array.isArray(path) ? path.join('/') : path}`;
        const type = TYPES[key.split('.').pop() ?? ''];
        if (!type || key.includes('..')) throw new NotFoundException();

        let data = await this.cache.getBuffer(`img:${key}`).catch(() => null);
        if (!data) {
            data = await this.storage.get(key);
            if (!data) throw new NotFoundException();
            if (data.length <= CACHE_MAX_BYTES) await this.cache.setBuffer(`img:${key}`, data, CACHE_SECONDS).catch((err) => this.logger.warn(`Caching ${key}: ${err}`));
        }
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(data);
    }
}
