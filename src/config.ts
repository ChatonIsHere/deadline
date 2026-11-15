import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const optional = z
    .string()
    .optional()
    .transform((s) => s || undefined);
/** A limit from the environment. 0 turns it off. */
const limit = (fallback: number) => z.coerce.number().int().min(0).default(fallback);
/** Postgres whole-number columns stop at about 2.1 billion. */
const amount = (fallback: number) => z.coerce.number().int().min(1).max(2_000_000_000).default(fallback);

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

    // Limits on what people can make and how often (see .env.example). Admins aren't held to the
    // per-person ones. The money and IP ceilings apply to everyone. 0 turns a limit off.
    MAX_ACTIVE_RUNNERS: limit(5),
    MAX_CREWS_FOUNDED: limit(2),
    MAX_CREWS_PER_RUNNER: limit(3),
    MAX_CREW_MEMBERS: limit(30),
    MAX_CREW_ALLIES: limit(50),
    MAX_PENDING_INVITES: limit(10),
    INVITE_COOLDOWN_DAYS: limit(7),
    MAX_DRAFTS: limit(10),
    MAX_PENDING_GIGS: limit(5),
    // Live gigs per player, when the Settings page leaves it at 0
    MAX_SIGNUPS: limit(3),
    REJOIN_COOLDOWN_MINUTES: limit(10),
    MAX_FRAME_CHANGES_PER_DAY: limit(6),
    MAX_UPLOADS_PER_DAY: limit(30),
    MAX_WRITES_PER_MINUTE: limit(60),
    MAX_PAY: amount(1_000_000),
    MAX_IP: amount(1_000),
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
