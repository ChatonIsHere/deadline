import { relations } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { CORE_ROLES, GIG_STATUSES, RUNNER_STATES } from '../shared/schemas';

const createdAt = () =>
    integer({ mode: 'timestamp_ms' })
        .notNull()
        .$defaultFn(() => new Date());

// A single row (id 1). Set from the web settings page.
export const settings = sqliteTable('settings', {
    id: integer().primaryKey(),
    guildId: text(),
    forumId: text(),
    adminRoleId: text(),
    fixerRoleId: text(),
    edgerunnerRoleId: text(),
    // Day-of reminder, hours before a session
    reminderHours: integer().notNull().default(8),
    // How long runners get to confirm a session time
    confirmHours: integer().notNull().default(48),
    // Roles runners can pick. Starts as RED's core ten.
    runnerRoles: text({ mode: 'json' }).$type<string[]>().notNull().default(CORE_ROLES),
});

/** Per-person choices. No row means the defaults. */
export const userPrefs = sqliteTable('user_prefs', {
    userId: text().primaryKey(),
    reminders: integer({ mode: 'boolean' }).notNull().default(true),
    // The bot owner browsing as a normal player, admin powers hidden
    playerView: integer({ mode: 'boolean' }).notNull().default(false),
});

export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    userId: text().notNull(),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
});

/** A crew of runners. Whoever holds its top rank (Founder by default) runs it. */
export const crews = sqliteTable('crews', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    // Typed ID for URLs (/crews/static-wolves). Set when the crew is made. See shared/slug.ts.
    slug: text().unique(),
    tagline: text().notNull().default(''),
    // The player who made it. Kept for the record; the top rank runs the crew.
    ownerId: text().notNull(),
    // Rank names, highest first. The first is the founder rank and is never removed.
    // The column default is from the first version. New crews get DEFAULT_RANKS from CrewsService.
    // Don't change it here: SQLite can only change a default by rebuilding the table, which would empty crew_members.
    ranks: text({ mode: 'json' }).$type<string[]>().notNull().default(['Founder', 'Lieutenant', 'Member', 'Prospect']),
    createdAt: createdAt(),
});

export const crewMembers = sqliteTable(
    'crew_members',
    {
        crewId: integer()
            .notNull()
            .references(() => crews.id, { onDelete: 'cascade' }),
        runnerId: integer()
            .notNull()
            .references(() => runners.id, { onDelete: 'cascade' }),
        // One of the crew's ranks, by name
        rank: text().notNull().default('Member'),
    },
    (t) => [primaryKey({ columns: [t.crewId, t.runnerId] })],
);

/** Runners a crew knows and trusts, without them being members. */
export const crewAllies = sqliteTable(
    'crew_allies',
    {
        crewId: integer()
            .notNull()
            .references(() => crews.id, { onDelete: 'cascade' }),
        runnerId: integer()
            .notNull()
            .references(() => runners.id, { onDelete: 'cascade' }),
    },
    (t) => [primaryKey({ columns: [t.crewId, t.runnerId] })],
);

/** A crew asking a runner to join. Their player accepts or declines (DM or web). */
export const crewInvites = sqliteTable(
    'crew_invites',
    {
        crewId: integer()
            .notNull()
            .references(() => crews.id, { onDelete: 'cascade' }),
        runnerId: integer()
            .notNull()
            .references(() => runners.id, { onDelete: 'cascade' }),
        invitedBy: text().notNull(),
        createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.crewId, t.runnerId] })],
);

/**
 * A character. Players can have several. A runner with the Fixer role counts as a fixer
 * (Fixers tab, gig fixer, ratings) only while its player has the Discord fixer role.
 * NPC fixers are added by admins and have no player.
 */
export const runners = sqliteTable('runners', {
    id: integer().primaryKey({ autoIncrement: true }),
    // The player. Empty for NPC fixers.
    ownerId: text(),
    handle: text().notNull(),
    // Typed ID for URLs (/runners/vex). Set when the runner is made. See shared/slug.ts.
    slug: text().unique(),
    role: text().notNull(),
    extraRoles: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
    imageId: integer().references(() => images.id),
    // Fixer profile
    officeLocation: text(),
    specialties: text(),
    contact: text(),
    bio: text(),
    createdAt: createdAt(),
});

export const gigs = sqliteTable('gigs', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull(),
    fixerName: text().notNull(),
    // The fixer character, if there is one. Admins can also type a name for a one-off NPC.
    fixerRunnerId: integer().references(() => runners.id, { onDelete: 'set null' }),
    // The fixer character's player, if they have one
    fixerId: text(),
    location: text().notNull(),
    type: text(),
    pay: integer().notNull(),
    objective: text().notNull(),
    imageId: integer().references(() => images.id),
    status: text({ enum: GIG_STATUSES }).notNull().default('pending'),
    createdBy: text().notNull(),
    // Forum post. In a forum the starter message shares the thread's ID.
    threadId: text(),
    // When the session is played. Set by an admin. Until then runners are only "interested".
    sessionAt: integer({ mode: 'timestamp_ms' }),
    // Reminders already sent for the current session time
    remindedDay: integer({ mode: 'boolean' }).notNull().default(false),
    remindedSoon: integer({ mode: 'boolean' }).notNull().default(false),
    // Filled in when an admin completes the gig. Rewards here go to everyone on it.
    summary: text(),
    rewardEb: integer(),
    rewardIp: integer(),
    rewardHqIp: integer(),
    rewardText: text(),
    // Thread messages carrying whatever didn't fit in the post's first message
    overflowMessageIds: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
});

/** Extra rewards for one runner, on top of the crew's. */
export const gigRewards = sqliteTable('gig_rewards', {
    id: integer().primaryKey({ autoIncrement: true }),
    gigId: integer()
        .notNull()
        .references(() => gigs.id, { onDelete: 'cascade' }),
    runnerId: integer()
        .notNull()
        .references(() => runners.id, { onDelete: 'cascade' }),
    eb: integer(),
    ip: integer(),
    text: text(),
});

/** A player's star rating (1 to 5) for a gig's fixer, given after the gig. */
export const fixerRatings = sqliteTable(
    'fixer_ratings',
    {
        gigId: integer()
            .notNull()
            .references(() => gigs.id, { onDelete: 'cascade' }),
        userId: text().notNull(),
        stars: integer().notNull(),
        comment: text(),
        ratedAt: integer({ mode: 'timestamp_ms' }),
    },
    (t) => [primaryKey({ columns: [t.gigId, t.userId] })],
);

/** Night City districts, suggested for gig locations. Seeded on first start, editable by admins. */
export const regions = sqliteTable('regions', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    district: text(),
});

/**
 * Pictures for gig posts and runners. Library images (inLibrary) get picked at random:
 * the region's own, then its district's, then the general pool (no region). Uploads for a
 * single gig, and runner pictures, stay out of the library.
 */
export const images = sqliteTable('images', {
    id: integer().primaryKey({ autoIncrement: true }),
    regionId: integer().references(() => regions.id, { onDelete: 'set null' }),
    inLibrary: integer({ mode: 'boolean' }).notNull(),
    // gig: 16:9 post picture. avatar: square runner picture.
    kind: text({ enum: ['gig', 'avatar'] }).notNull().default('gig'),
    createdBy: text(),
    createdAt: createdAt(),
});

export const gigObjectives = sqliteTable('gig_objectives', {
    id: integer().primaryKey({ autoIncrement: true }),
    gigId: integer()
        .notNull()
        .references(() => gigs.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    bonus: integer(),
    position: integer().notNull(),
});

// One row per slot. No crew means any runner can take it. No player means it's empty.
export const gigSlots = sqliteTable('gig_slots', {
    id: integer().primaryKey({ autoIncrement: true }),
    gigId: integer()
        .notNull()
        .references(() => gigs.id, { onDelete: 'cascade' }),
    crewId: integer().references(() => crews.id, { onDelete: 'set null' }),
    // The player (one runner each per gig) and which of their runners is going
    userId: text(),
    runnerId: integer().references(() => runners.id, { onDelete: 'set null' }),
    // Where the runner stands. Only meaningful while userId is set.
    state: text({ enum: RUNNER_STATES }).notNull().default('interested'),
    // When an awaiting runner was asked to confirm, and whether they've been nudged since
    askedAt: integer({ mode: 'timestamp_ms' }),
    nudged: integer({ mode: 'boolean' }).notNull().default(false),
    position: integer().notNull(),
});

/** Runners waiting for a slot, first come first served. */
export const gigReserves = sqliteTable(
    'gig_reserves',
    {
        gigId: integer()
            .notNull()
            .references(() => gigs.id, { onDelete: 'cascade' }),
        userId: text().notNull(),
        runnerId: integer().references(() => runners.id, { onDelete: 'cascade' }),
        joinedAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.gigId, t.userId] })],
);

export const crewsRelations = relations(crews, ({ many }) => ({ members: many(crewMembers), allies: many(crewAllies), invites: many(crewInvites) }));

export const crewMembersRelations = relations(crewMembers, ({ one }) => ({
    crew: one(crews, { fields: [crewMembers.crewId], references: [crews.id] }),
}));

export const gigsRelations = relations(gigs, ({ many }) => ({
    objectives: many(gigObjectives),
    slots: many(gigSlots),
    reserves: many(gigReserves),
    rewards: many(gigRewards),
}));

export const gigObjectivesRelations = relations(gigObjectives, ({ one }) => ({
    gig: one(gigs, { fields: [gigObjectives.gigId], references: [gigs.id] }),
}));

export const gigSlotsRelations = relations(gigSlots, ({ one }) => ({
    gig: one(gigs, { fields: [gigSlots.gigId], references: [gigs.id] }),
    crew: one(crews, { fields: [gigSlots.crewId], references: [crews.id] }),
}));

export const gigReservesRelations = relations(gigReserves, ({ one }) => ({
    gig: one(gigs, { fields: [gigReserves.gigId], references: [gigs.id] }),
}));

export const gigRewardsRelations = relations(gigRewards, ({ one }) => ({
    gig: one(gigs, { fields: [gigRewards.gigId], references: [gigs.id] }),
}));

export const crewAlliesRelations = relations(crewAllies, ({ one }) => ({
    crew: one(crews, { fields: [crewAllies.crewId], references: [crews.id] }),
}));

export const crewInvitesRelations = relations(crewInvites, ({ one }) => ({
    crew: one(crews, { fields: [crewInvites.crewId], references: [crews.id] }),
}));
