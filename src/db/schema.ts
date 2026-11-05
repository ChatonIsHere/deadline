import { relations } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { GIG_STATUSES } from '../shared/schemas';

const createdAt = () =>
    integer({ mode: 'timestamp_ms' })
        .notNull()
        .$defaultFn(() => new Date());

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
    location: text().notNull(),
    type: text(),
    pay: integer().notNull(),
    objective: text().notNull(),
    status: text({ enum: GIG_STATUSES }).notNull().default('pending'),
    createdBy: text().notNull(),
    // Forum post. In a forum the starter message shares the thread's ID.
    threadId: text(),
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
    position: integer().notNull(),
});

export const crewsRelations = relations(crews, ({ many }) => ({ members: many(crewMembers) }));

export const crewMembersRelations = relations(crewMembers, ({ one }) => ({
    crew: one(crews, { fields: [crewMembers.crewId], references: [crews.id] }),
}));

export const gigsRelations = relations(gigs, ({ many }) => ({
    objectives: many(gigObjectives),
    slots: many(gigSlots),
}));

export const gigObjectivesRelations = relations(gigObjectives, ({ one }) => ({
    gig: one(gigs, { fields: [gigObjectives.gigId], references: [gigs.id] }),
}));

export const gigSlotsRelations = relations(gigSlots, ({ one }) => ({
    gig: one(gigs, { fields: [gigSlots.gigId], references: [gigs.id] }),
    crew: one(crews, { fields: [gigSlots.crewId], references: [crews.id] }),
}));
