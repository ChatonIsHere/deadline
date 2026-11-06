import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../storage/storage.service';

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png' };

/**
 * /images/<key>. With S3, pictures are linked straight from the bucket, so this only sends
 * anything that still asks here on to it. Without S3 (local dev), it serves the folder.
 */
@Controller('images')
export class ImagesController {
    constructor(private readonly storage: StorageService) {}

    @Get('*path')
    async get(@Param('path') path: string | string[], @Res() res: Response) {
        const key = `images/${Array.isArray(path) ? path.join('/') : path}`;
        const type = TYPES[key.split('.').pop() ?? ''];
        if (!type || key.includes('..')) throw new NotFoundException();
        if (this.storage.remote) return res.redirect(301, this.storage.url(key));

        const data = await this.storage.get(key);
        if (!data) throw new NotFoundException();
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(data);
    }
}

/** What the web app needs before it starts: where pictures live (the bucket, or this server). Public. */
@Controller('api/config')
export class ConfigController {
    constructor(private readonly storage: StorageService) {}

    @Get()
    get() {
        return { imageBase: this.storage.base };
    }
}
