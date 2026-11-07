import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config, isProd } from './config';

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
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (req.method !== 'GET' || isServerRoute(req.path) || req.path.includes('.')) return next();
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(join(clientDir, 'index.html'));
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
