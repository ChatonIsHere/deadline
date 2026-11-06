import { z } from 'zod';

// Shared by the server (request validation) and the client (forms).

export const GIG_STATUSES = ['pending', 'open', 'closed', 'completed', 'cancelled', 'rejected'] as const;
export type GigStatus = (typeof GIG_STATUSES)[number];

/** Live gigs are posted and not finished: open, or with sign-ups locked. */
export const LIVE_STATUSES: GigStatus[] = ['open', 'closed'];
export const isLive = (status: GigStatus) => LIVE_STATUSES.includes(status);

/** interested: no session time yet. awaiting: asked to confirm a time. confirmed: coming. */
export const RUNNER_STATES = ['interested', 'awaiting', 'confirmed'] as const;
export type RunnerState = (typeof RUNNER_STATES)[number];

/** Cyberpunk RED's core roles. Admins can change the list in Settings. */
export const CORE_ROLES = ['Rockerboy', 'Solo', 'Netrunner', 'Tech', 'Medtech', 'Media', 'Exec', 'Lawman', 'Fixer', 'Nomad'];
/** The role that makes a runner a fixer (if their player has the Discord fixer role). */
export const FIXER_ROLE = 'Fixer';

/** A crew's ranks, highest first. Whoever holds the first (Founder unless renamed) runs the crew. */
export const DEFAULT_RANKS = ['Founder', 'Member'];

/** Statuses an admin can move a posted gig to. Completing has its own form (completeInput). */
export const SET_STATUSES = ['open', 'closed', 'cancelled'] as const;

export const MAX_SLOTS = 20;

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
/** Required text on one line: line breaks become spaces. For list items in the Discord post. */
const oneLine = (max: number) => text(max).transform((s) => s.replace(/\s*\n+\s*/g, ' '));
/** Optional text: blank becomes null. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullable()
        .transform((s) => s || null);
const optionalAmount = z.number().int().min(0).nullable();
/** A record's ID: a UUID. */
const id = z.uuid();

export const gigInput = z.object({
    name: text(100),
    /** Admins can type any name. Fixers' gigs use their fixer character, so this is ignored. */
    fixerName: z.string().trim().max(60),
    /** A fixer character. Required for fixers, optional for admins (who can type a name instead). */
    fixerRunnerId: id.nullable(),
    location: text(100),
    type: z.string().trim().max(40).nullable(),
    /** The brief: everything about the job. It's the post's description, which Discord caps at 4096. */
    brief: text(4000),
    /** What the crew has to do to get paid: one or more parts, one line each, with one payout. */
    primaryObjective: z.array(oneLine(150)).min(1, 'Add the primary objective').max(8),
    /** What the primary objective pays. */
    pay: z.number({ error: 'Set the pay' }).int().min(1, 'Set the pay'),
    imageId: id.nullable(),
    objectives: z
        // `each`: paid for each time it's done ("x for each y"), not once on completion.
        // `hidden`: players see "not disclosed" until the gig begins.
        .array(
            z
                .object({ text: oneLine(150), bonus: z.number().int().min(1).nullable(), each: z.boolean(), hidden: z.boolean() })
                .refine((o) => !o.each || o.bonus, 'A per-each objective needs a bonus'),
        )
        .max(8),
    slots: z
        .array(z.object({ crewId: id.nullable(), count: z.number().int().min(1) }))
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
        .array(z.object({ runnerId: id, eb: optionalAmount, ip: optionalAmount, text: optionalText(200) }))
        .max(MAX_SLOTS),
});
export type CompleteInput = z.infer<typeof completeInput>;

export const ratingInput = z.object({ stars: z.number().int().min(1).max(5), comment: optionalText(300).default(null) });
export type RatingInput = z.infer<typeof ratingInput>;

/** Signing up. A player with one runner can leave it out. */
export const joinInput = z.object({ runnerId: id.optional() });
export const runnerRefInput = z.object({ runnerId: id });

export const runnerInput = z.object({
    /** One of a kind: it's the runner's link (/runners/vex). */
    handle: text(40),
    role: text(30),
    extraRoles: z.array(text(30)).max(9),
    imageId: id.nullable(),
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

export const newCrewInput = z.object({
    /** One of a kind: it's the crew's link (/crews/static-wolves). */
    name: text(50),
    tagline: z.string().trim().max(120),
    /** The runner founding it. Your own, or anyone's for admins. */
    runnerId: id,
});
export type NewCrewInput = z.infer<typeof newCrewInput>;

export const crewInput = z.object({
    name: text(50),
    tagline: z.string().trim().max(120),
    /**
     * Highest first. The first is the founder rank. `was` is a rank's name before this edit
     * (null for a new one), so renaming a rank keeps its runners in it.
     */
    ranks: z
        .array(z.object({ name: text(30), was: z.string().nullable() }))
        .min(2, 'Keep at least two ranks')
        .max(10)
        .refine((ranks) => new Set(ranks.map((r) => r.name.toLowerCase())).size === ranks.length, 'Rank names must differ'),
});
export type CrewInput = z.infer<typeof crewInput>;

export const rankInput = z.object({ rank: text(30) });

/** Unix ms, or null to clear the session time. */
export const sessionInput = z.object({ sessionAt: z.number().int().positive().nullable() });

export const prefsInput = z.object({
    reminders: z.boolean(),
    /** Bot owner only: use the board as a normal player, admin powers hidden. */
    playerView: z.boolean().default(false),
});
export type Prefs = z.infer<typeof prefsInput>;

/** Which crew's slots to open to anyone. */
export const openSlotsInput = z.object({ crewId: id });

export const regionInput = z.object({
    name: text(40),
    district: z.string().trim().max(40).nullable(),
});
export type RegionInput = z.infer<typeof regionInput>;

export interface RegionView {
    id: string;
    name: string;
    district: string | null;
    /** Library image IDs. See shared/images.ts for the URLs. */
    images: string[];
}

export interface LibraryView {
    regions: RegionView[];
    /** General pool image IDs, used when a region has none. */
    pool: string[];
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

/** The bot's Discord profile. About me is the app's description (400 characters max). */
export const botProfileInput = z.object({
    about: z.string().trim().max(400),
    bannerImageId: id.nullable(),
});
export type BotProfileInput = z.infer<typeof botProfileInput>;
export interface BotProfile {
    about: string;
    bannerUrl: string | null;
}

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
    /** The owner has player view on: isAdmin is off until they turn it off on the Me page. */
    playerView?: boolean;
}

/** A runner as shown in lists and slots. */
export interface RunnerCard {
    id: string;
    /** The runner's link, made from the handle. */
    slug: string;
    handle: string;
    role: string;
    extraRoles: string[];
    imageId: string | null;
    /** The player. Null for NPC fixers. */
    ownerId: string | null;
}

export interface RunnerSummary extends RunnerCard {
    owner: Member | null;
    /** Their player is on the server with the edgerunner role, so they can be put on gigs. */
    canTakeGigs: boolean;
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
    id: string;
    ref: string;
    name: string;
    status: GigStatus;
    sessionAt: number | null;
}

export interface RunnerView extends RunnerSummary {
    officeLocation: string | null;
    specialties: string | null;
    contact: string | null;
    bio: string | null;
    crews: { id: string; slug: string; name: string }[];
    /** Gigs this runner went on (or is signed up for). */
    gigs: GigLink[];
    /** Gigs this runner was the fixer for. */
    fixerGigs: GigLink[];
    rating: Rating;
    /** Fixers only: the latest ratings, newest first. */
    reviews: Review[];
}

export interface Review {
    stars: number;
    comment: string | null;
    gig: { id: string; ref: string; name: string };
    /** The runner the rater had on the gig. */
    by: RunnerCard | null;
    /** Unix ms. Missing on ratings from before comments. */
    at: number | null;
}

export interface SlotView {
    id: string;
    crew: { id: string; name: string } | null;
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
    id: string;
    /** The gig's link: UUID start and name (see shared/slug.ts). */
    ref: string;
    name: string;
    /** The fixer's name: their character's handle, or what an admin typed. */
    fixerName: string;
    fixerRunnerId: string | null;
    fixerImageId: string | null;
    /** The fixer character's player, if they have one. */
    fixerId: string | null;
    location: string;
    type: string | null;
    /** What the primary objective pays. */
    pay: number;
    brief: string;
    /** One or more parts. */
    primaryObjective: string[];
    imageId: string | null;
    /**
     * `each`: the bonus is paid for each time it's done. `hidden`: the setting, kept from
     * players until the gig begins. `secret`: still kept from them right now. Players get a
     * secret one with no text or bonus; admins and the gig's fixer get the details.
     */
    objectives: { text: string; bonus: number | null; each: boolean; hidden: boolean; secret: boolean }[];
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
    /** Whether the signed in player had a runner on this finished gig and can rate its fixer. */
    canRate: boolean;
    /** The signed in player's rating of the fixer for this gig. */
    myRating: { stars: number; comment: string | null } | null;
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

export interface CrewMember extends RunnerCard {
    rank: string;
}

export interface CrewView {
    id: string;
    /** The crew's link, made from the name. */
    slug: string;
    name: string;
    tagline: string;
    /** Highest first. The first is the founder rank. */
    ranks: string[];
    /** Highest rank first. */
    members: CrewMember[];
    /** Known and trusted runners who aren't members. */
    allies: RunnerCard[];
    /** Runners asked to join who haven't answered yet. */
    invites: RunnerCard[];
}

/** A crew asking one of your runners to join. */
export interface CrewInvite {
    crew: { id: string; slug: string; name: string; tagline: string };
    runner: RunnerCard;
    invitedBy: Member;
    createdAt: number;
}

/**
 * A gig's pay: the primary objective alone, up to that plus every secondary bonus. Per-each
 * bonuses count once and make it open-ended (`open`: shown with a + after the top end).
 * Undisclosed objectives don't count (players can't know them) but make it open-ended too.
 */
export const payRange = (gig: { pay: number; objectives: { bonus: number | null; each?: boolean; secret?: boolean }[] }) => {
    const known = gig.objectives.filter((o) => !o.secret);
    return {
        min: gig.pay,
        max: gig.pay + known.reduce((sum, o) => sum + (o.bonus ?? 0), 0),
        open: known.some((o) => o.each && !!o.bonus) || gig.objectives.some((o) => o.secret),
    };
};

/** Undisclosed objectives come out when sign-ups lock and the job is on. */
export const objectivesRevealed = (status: GigStatus) => status === 'closed' || status === 'completed';
