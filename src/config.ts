import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

// Only what the bot needs to start. Server, forum and roles are set on the web (see settings/).
const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3003),
    PUBLIC_URL: z.url().transform((url) => url.replace(/\/$/, '')),
    DATABASE_PATH: z.string().default('./data/deadline.db'),
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
