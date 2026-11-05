import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const id = z.string().regex(/^\d+$/, 'should be a Discord ID');

const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3003),
    PUBLIC_URL: z.url().transform((url) => url.replace(/\/$/, '')),
    DATABASE_PATH: z.string().default('./data/deadline.db'),

    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: id,
    DISCORD_CLIENT_SECRET: z.string().min(1),
    DISCORD_GUILD_ID: id,

    ADMIN_ROLE_ID: id,
    FIXER_ROLE_ID: id,
    EDGERUNNER_ROLE_ID: id,
    GIG_FORUM_ID: id,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Bad environment:\n' + z.prettifyError(parsed.error));
    process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
