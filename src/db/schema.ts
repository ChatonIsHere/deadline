import { relations } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { GIG_STATUSES, RUNNER_STATES } from '../shared/schemas';

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
});

export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    userId: text().notNull(),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
});

export const crews = sqliteTable('crews', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    tagline: text().notNull().default(''),
    ownerId: text().notNull(),
    createdAt: createdAt(),
});

export const crewMembers = sqliteTable(
    'crew_members',
    {
        crewId: integer()
            .notNull()
            .references(() => crews.id, { onDelete: 'cascade' }),
        userId: text().notNull(),
    },
    (t) => [primaryKey({ columns: [t.crewId, t.userId] })],
);

export const gigs = sqliteTable('gigs', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull(),
    fixerName: text().notNull(),
    // Set when the fixer is a real person with the fixer role. NPC fixers are just a name.
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
    createdAt: createdAt(),
});

/** Night City districts, suggested for gig locations. Seeded on first start, editable by admins. */
export const regions = sqliteTable('regions', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    district: text(),
});

/**
 * Pictures for gig posts. Library images (inLibrary) get picked at random: a region's own
 * first, then the general pool (no region). Uploads for a single gig stay out of the library.
 */
export const images = sqliteTable('images', {
    id: integer().primaryKey({ autoIncrement: true }),
    regionId: integer().references(() => regions.id, { onDelete: 'set null' }),
    inLibrary: integer({ mode: 'boolean' }).notNull(),
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

// One row per slot. No crew means any edgerunner can take it. No user means it's empty.
export const gigSlots = sqliteTable('gig_slots', {
    id: integer().primaryKey({ autoIncrement: true }),
    gigId: integer()
        .notNull()
        .references(() => gigs.id, { onDelete: 'cascade' }),
    crewId: integer().references(() => crews.id, { onDelete: 'set null' }),
    userId: text(),
    // Where the runner stands. Only meaningful while userId is set.
    state: text({ enum: RUNNER_STATES }).notNull().default('interested'),
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
        joinedAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.gigId, t.userId] })],
);

export const crewsRelations = relations(crews, ({ many }) => ({ members: many(crewMembers) }));

export const crewMembersRelations = relations(crewMembers, ({ one }) => ({
    crew: one(crews, { fields: [crewMembers.crewId], references: [crews.id] }),
}));

export const gigsRelations = relations(gigs, ({ many }) => ({
    objectives: many(gigObjectives),
    slots: many(gigSlots),
    reserves: many(gigReserves),
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
