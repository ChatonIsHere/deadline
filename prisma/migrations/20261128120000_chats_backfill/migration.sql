-- Catches every crew and gig up with a chat, whenever they were made: crews and live gigs made
-- between the chats migration and the code that keeps them in step, and finished gigs from
-- before chats, which get an archived chat for the runners who were on them. Safe to run again.

-- Crews: a chat each, with the crew's runners
INSERT INTO "chats" ("kind", "name", "crew_id")
    SELECT 'crew', c."name", c."id" FROM "crews" c
    WHERE NOT EXISTS (SELECT 1 FROM "chats" x WHERE x."crew_id" = c."id");
INSERT INTO "chat_members" ("chat_id", "runner_id")
    SELECT ch."id", m."runner_id" FROM "chats" ch JOIN "crew_members" m ON m."crew_id" = ch."crew_id"
    ON CONFLICT DO NOTHING;

-- Gigs that were posted: live ones, and finished ones (archived from when they finished)
INSERT INTO "chats" ("kind", "name", "gig_id", "archived_at", "created_at", "last_message_at")
    SELECT 'gig', g."name", g."id",
        CASE WHEN g."status" IN ('completed', 'cancelled') THEN CURRENT_TIMESTAMP END,
        g."created_at", g."created_at"
    FROM "gigs" g
    WHERE g."status" IN ('open', 'closed', 'completed', 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM "chats" x WHERE x."gig_id" = g."id");

-- Their runners and fixer
INSERT INTO "chat_members" ("chat_id", "runner_id")
    SELECT ch."id", s."runner_id" FROM "chats" ch JOIN "gig_slots" s ON s."gig_id" = ch."gig_id" WHERE s."user_id" IS NOT NULL AND s."runner_id" IS NOT NULL
    UNION
    SELECT ch."id", g."fixer_runner_id" FROM "chats" ch JOIN "gigs" g ON g."id" = ch."gig_id" WHERE g."fixer_runner_id" IS NOT NULL
    ON CONFLICT DO NOTHING;

-- Gigs that finished since their chat was made
UPDATE "chats" ch SET "archived_at" = CURRENT_TIMESTAMP
    FROM "gigs" g
    WHERE g."id" = ch."gig_id" AND ch."archived_at" IS NULL AND g."status" IN ('completed', 'cancelled');
