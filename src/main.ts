import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config, isProd } from './config';
import { LinkPreviewService } from './link-preview/link-preview.service';
import { previewTags } from './link-preview/tags';

const ROOT = join(__dirname, '..');

/** Requests Nest handles (including stored pictures under /images). Everything else is the web app. */
const isServerRoute = (path: string) => path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/images/');

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.set('trust proxy', 1);
    app.use(cookieParser());
    app.use(
        helmet({
            contentSecurityPolicy: isProd && {
                directives: {
                    defaultSrc: ["'self'"],
                    // Pictures come straight from the bucket. blob: is the crop tool's preview of a picked file.
                    imgSrc: ["'self'", 'data:', 'blob:', 'https://cdn.discordapp.com', ...(config.S3_ENDPOINT ? [new URL(config.S3_ENDPOINT).origin] : [])],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                },
            },
        }),
    );
    app.useStaticAssets(join(ROOT, 'assets'));

    if (isProd) {
        const clientDir = join(ROOT, 'dist', 'client');
        app.useStaticAssets(clientDir, { index: false });
        const page = readFileSync(join(clientDir, 'index.html'), 'utf8');
        // Which web app this is. The page names its hashed scripts, so any change to the app changes it.
        const build = createHash('sha1').update(page).digest('hex').slice(0, 12);
        // A page opened before an update still runs the old app, whose forms may send what the server
        // no longer reads (and would quietly drop). Every answer says which build is current, so the
        // page can offer a reload, and changes from an old one are turned away until it reloads.
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (!req.path.startsWith('/api/')) return next();
            res.setHeader('X-Deadline-Build', build);
            const theirs = req.get('X-Deadline-Build');
            if (req.method !== 'GET' && theirs && theirs !== build) {
                return res.status(409).json({ message: 'Deadline was updated since you opened this page. Reload it to get the new version, then try again.' });
            }
            next();
        });
        const previews = app.get(LinkPreviewService);
        app.use(async (req: Request, res: Response, next: NextFunction) => {
            if (req.method !== 'GET' || isServerRoute(req.path) || req.path.includes('.')) return next();
            const tags = previewTags(await previews.forPath(req.path));
            res.setHeader('Cache-Control', 'no-cache');
            // A function, so a "$&" in someone's gig name stays as text
            res.type('html').send(page.replace('</head>', () => `    ${tags}\n    <meta name="deadline-build" content="${build}" />\n    </head>`));
        });
    } else {
        // Vite runs inside Nest in dev, so there's one port and hot reload works.
        const { createServer } = await import('vite');
        const vite = await createServer({
            configFile: join(ROOT, 'client', 'vite.config.ts'),
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use((req: Request, res: Response, next: NextFunction) => (isServerRoute(req.path) ? next() : vite.middlewares(req, res, next)));
    }

    await app.listen(config.PORT, '0.0.0.0');
    console.log(`Deadline running on ${config.PUBLIC_URL} (port ${config.PORT})`);
}

void bootstrap();
