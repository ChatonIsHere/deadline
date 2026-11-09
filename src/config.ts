import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const optional = z
    .string()
    .optional()
    .transform((s) => s || undefined);

// Only what the bot needs to start. Server, forum and roles are set on the web (see settings/).
const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3003),
    PUBLIC_URL: z.url().transform((url) => url.replace(/\/$/, '')),
    DATABASE_URL: z.string().min(1),
    // Without it, an in-memory cache (fine for one process; sessions are lost on restart)
    REDIS_URL: optional,
    // Pictures. Without these they're kept on disk in ./data/objects (local dev and tests).
    S3_ENDPOINT: optional,
    S3_REGION: z.string().default('eu-central'),
    S3_ACCESS_KEY: optional,
    S3_SECRET_KEY: optional,
    S3_BUCKET: optional,
    // How much picture storage one person's uploads can take up. The library doesn't count.
    MAX_USER_STORAGE_MB: z.coerce.number().int().min(1).default(100),
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_SECRET: z.string().min(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Bad environment:\n' + z.prettifyError(parsed.error));
    process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
