import { z } from 'zod';

// Shared by the server (request validation) and the client (forms).

export const GIG_STATUSES = ['pending', 'open', 'closed', 'completed', 'cancelled', 'rejected'] as const;
export type GigStatus = (typeof GIG_STATUSES)[number];

/** interested: no session time yet. awaiting: asked to confirm a time. confirmed: coming. */
export const RUNNER_STATES = ['interested', 'awaiting', 'confirmed'] as const;
export type RunnerState = (typeof RUNNER_STATES)[number];

/** Cyberpunk RED's core roles. Admins can change the list in Settings. */
export const CORE_ROLES = ['Rockerboy', 'Solo', 'Netrunner', 'Tech', 'Medtech', 'Media', 'Exec', 'Lawman', 'Fixer', 'Nomad'];
/** The role that makes a runner a fixer (if their player has the Discord fixer role). */
export const FIXER_ROLE = 'Fixer';

/** Statuses an admin can move a posted gig to. Completing has its own form (completeInput). */
export const SET_STATUSES = ['open', 'closed', 'cancelled'] as const;

export const MAX_SLOTS = 20;

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
/** Optional text: blank becomes null. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullable()
        .transform((s) => s || null);
const optionalAmount = z.number().int().min(0).nullable();

export const gigInput = z.object({
    name: text(100),
    /** Admins can type any name. Fixers' gigs use their fixer character, so this is ignored. */
    fixerName: z.string().trim().max(60),
    /** A fixer character. Required for fixers, optional for admins (who can type a name instead). */
    fixerRunnerId: z.number().int().nullable(),
    location: text(100),
    type: z.string().trim().max(40).nullable(),
    pay: z.number({ error: 'Set the pay' }).int().min(1, 'Set the pay'),
    objective: text(2000),
    imageId: z.number().int().nullable(),
    objectives: z
        // One line each: they're list items in the Discord post
        .array(z.object({ text: text(150).transform((s) => s.replace(/\s*\n+\s*/g, ' ')), bonus: z.number().int().min(1).nullable() }))
        .max(8),
    slots: z
        .array(z.object({ crewId: z.number().int().nullable(), count: z.number().int().min(1) }))
        .min(1, 'Add at least one slot')
        .refine((groups) => groups.reduce((sum, g) => sum + g.count, 0) <= MAX_SLOTS, `${MAX_SLOTS} slots max`),
});
export type GigInput = z.infer<typeof gigInput>;
export type SlotGroup = GigInput['slots'][number];

export const statusInput = z.object({ status: z.enum(SET_STATUSES) });
export type StatusInput = z.infer<typeof statusInput>;

/** An admin wrapping up a gig. Crew rewards go to everyone on it, runner rewards on top. */
export const completeInput = z.object({
    summary: optionalText(2000),
    eb: optionalAmount,
    ip: optionalAmount,
    hqIp: optionalAmount,
    text: optionalText(200),
    runners: z
        .array(z.object({ runnerId: z.number().int(), eb: optionalAmount, ip: optionalAmount, text: optionalText(200) }))
        .max(MAX_SLOTS),
});
export type CompleteInput = z.infer<typeof completeInput>;

export const ratingInput = z.object({ stars: z.number().int().min(1).max(5) });

/** Signing up. A player with one runner can leave it out. */
export const joinInput = z.object({ runnerId: z.number().int().optional() });
export const runnerRefInput = z.object({ runnerId: z.number().int() });

export const runnerInput = z.object({
    handle: text(40),
    role: text(30),
    extraRoles: z.array(text(30)).max(9),
    imageId: z.number().int().nullable(),
    // Fixer profile, shown when the runner counts as a fixer
    officeLocation: optionalText(100),
    specialties: optionalText(150),
    contact: optionalText(150),
    bio: optionalText(2000),
    /** Admins only: who plays this runner. null makes an NPC fixer. Left out means the person saving it (new) or no change (edit). */
    ownerId: z
        .string()
        .regex(/^\d+$/)
        .nullable()
        .optional(),
});
export type RunnerInput = z.infer<typeof runnerInput>;

export const crewInput = z.object({
    name: text(50),
    tagline: z.string().trim().max(120),
    ownerId: z.string().optional(),
});
export type CrewInput = z.infer<typeof crewInput>;

/** Unix ms, or null to clear the session time. */
export const sessionInput = z.object({ sessionAt: z.number().int().positive().nullable() });

export const prefsInput = z.object({ reminders: z.boolean() });
export type Prefs = z.infer<typeof prefsInput>;

/** Which crew's slots to open to anyone. */
export const openSlotsInput = z.object({ crewId: z.number().int() });

export const regionInput = z.object({
    name: text(40),
    district: z.string().trim().max(40).nullable(),
});
export type RegionInput = z.infer<typeof regionInput>;

export interface RegionView {
    id: number;
    name: string;
    district: string | null;
    /** Library image IDs. See shared/images.ts for the URLs. */
    images: number[];
}

export interface LibraryView {
    regions: RegionView[];
    /** General pool image IDs, used when a region has none. */
    pool: number[];
}

const snowflake = z.string().regex(/^\d+$/).nullable();

export const settingsInput = z.object({
    guildId: snowflake,
    forumId: snowflake,
    adminRoleId: snowflake,
    fixerRoleId: snowflake,
    edgerunnerRoleId: snowflake,
    reminderHours: z.number().int().min(1).max(72),
    confirmHours: z.number().int().min(1).max(168),
    runnerRoles: z.array(text(30)).min(1).max(30),
});
export type Settings = z.infer<typeof settingsInput>;

// API responses

export interface Member {
    id: string;
    name: string;
    avatar: string | null;
}

export interface Me extends Member {
    /** Owns the Discord application. Can pick the server. */
    isOwner: boolean;
    isAdmin: boolean;
    isFixer: boolean;
    isEdgerunner: boolean;
}

/** A runner as shown in lists and slots. */
export interface RunnerCard {
    id: number;
    handle: string;
    role: string;
    extraRoles: string[];
    imageId: number | null;
    /** The player. Null for NPC fixers. */
    ownerId: string | null;
}

export interface RunnerSummary extends RunnerCard {
    owner: Member | null;
    /** Has the Fixer role and is an NPC or played by someone with the Discord fixer role. */
    isFixer: boolean;
}

export interface FixerSummary extends RunnerSummary {
    officeLocation: string | null;
    specialties: string | null;
    rating: Rating;
    gigCount: number;
}

export interface Rating {
    /** Average stars, or null with no ratings yet. */
    average: number | null;
    count: number;
}

export interface GigLink {
    id: number;
    name: string;
    status: GigStatus;
    sessionAt: number | null;
}

export interface RunnerView extends RunnerSummary {
    officeLocation: string | null;
    specialties: string | null;
    contact: string | null;
    bio: string | null;
    crews: { id: number; name: string }[];
    /** Gigs this runner went on (or is signed up for). */
    gigs: GigLink[];
    /** Gigs this runner was the fixer for. */
    fixerGigs: GigLink[];
    rating: Rating;
}

export interface SlotView {
    id: number;
    crew: { id: number; name: string } | null;
    runner: RunnerCard | null;
    state: RunnerState;
    /** Unix ms. When an awaiting runner gets dropped if they haven't confirmed. */
    confirmBy: number | null;
}

export interface Rewards {
    eb: number | null;
    ip: number | null;
    text: string | null;
}

export interface GigView {
    id: number;
    name: string;
    /** The fixer's name: their character's handle, or what an admin typed. */
    fixerName: string;
    fixerRunnerId: number | null;
    fixerImageId: number | null;
    /** The fixer character's player, if they have one. */
    fixerId: string | null;
    location: string;
    type: string | null;
    pay: number;
    objective: string;
    imageId: number | null;
    objectives: { text: string; bonus: number | null }[];
    slots: SlotView[];
    /** Waiting for a slot, in order. */
    reserves: RunnerCard[];
    /** Unix ms. */
    sessionAt: number | null;
    status: GigStatus;
    createdBy: Member;
    threadUrl: string | null;
    createdAt: number;
    /** Set once completed. */
    summary: string | null;
    crewRewards: (Rewards & { hqIp: number | null }) | null;
    runnerRewards: (Rewards & { runner: RunnerCard })[];
    /** The signed in player's rating of the fixer for this gig. */
    myRating: number | null;
}

export interface Option {
    id: string;
    name: string;
    color?: string;
}

/** What a server offers for the settings page. */
export interface GuildOptions {
    forums: Option[];
    roles: Option[];
}

export interface SettingsView {
    settings: Settings;
    guilds: Option[];
    /** Forums and roles of the chosen server, if there is one. */
    options: GuildOptions | null;
    /** Adds the bot to a server with the permissions it needs. */
    inviteUrl: string;
}

export interface CrewView {
    id: number;
    name: string;
    tagline: string;
    owner: Member;
    members: RunnerCard[];
}
