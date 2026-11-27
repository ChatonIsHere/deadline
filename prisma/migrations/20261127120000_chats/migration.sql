-- Chats between characters: direct, group, crew and gig, mirrored into private Discord threads
-- CreateEnum
CREATE TYPE "chat_kind" AS ENUM ('direct', 'group', 'crew', 'gig');

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "dm_channel_id" TEXT;

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "chat_kind" NOT NULL,
    "name" TEXT,
    "crew_id" UUID,
    "gig_id" UUID,
    "direct_key" TEXT,
    "thread_id" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_members" (
    "chat_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("chat_id","runner_id")
);

-- CreateTable
CREATE TABLE "chat_reads" (
    "chat_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("chat_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_staff" (
    "chat_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "chat_staff_pkey" PRIMARY KEY ("chat_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,
    "sent_by" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "discord_message_id" TEXT,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_images" (
    "message_id" UUID NOT NULL,
    "image_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "chat_message_images_pkey" PRIMARY KEY ("message_id","image_id")
);

-- CreateTable
CREATE TABLE "chat_voices" (
    "chat_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "runner_id" UUID NOT NULL,

    CONSTRAINT "chat_voices_pkey" PRIMARY KEY ("chat_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_notify" (
    "chat_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_notify_pkey" PRIMARY KEY ("chat_id","user_id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chats_crew_id_key" ON "chats"("crew_id");

-- CreateIndex
CREATE UNIQUE INDEX "chats_gig_id_key" ON "chats"("gig_id");

-- CreateIndex
CREATE UNIQUE INDEX "chats_direct_key_key" ON "chats"("direct_key");

-- CreateIndex
CREATE UNIQUE INDEX "chats_thread_id_key" ON "chats"("thread_id");

-- CreateIndex
CREATE INDEX "chats_last_message_at_idx" ON "chats"("last_message_at");

-- CreateIndex
CREATE INDEX "chat_members_runner_id_idx" ON "chat_members"("runner_id");

-- CreateIndex
CREATE INDEX "chat_reads_user_id_idx" ON "chat_reads"("user_id");

-- CreateIndex
CREATE INDEX "chat_staff_user_id_idx" ON "chat_staff"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_discord_message_id_key" ON "chat_messages"("discord_message_id");

-- CreateIndex
CREATE INDEX "chat_messages_chat_id_created_at_idx" ON "chat_messages"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_runner_id_idx" ON "chat_messages"("runner_id");

-- CreateIndex
CREATE INDEX "chat_message_images_image_id_idx" ON "chat_message_images"("image_id");

-- CreateIndex
CREATE INDEX "chat_voices_runner_id_idx" ON "chat_voices"("runner_id");

-- CreateIndex
CREATE INDEX "chat_notify_user_id_idx" ON "chat_notify"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_staff" ADD CONSTRAINT "chat_staff_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_images" ADD CONSTRAINT "chat_message_images_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_images" ADD CONSTRAINT "chat_message_images_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_voices" ADD CONSTRAINT "chat_voices_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_voices" ADD CONSTRAINT "chat_voices_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_notify" ADD CONSTRAINT "chat_notify_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A direct chat's key is its two runners, so there's one chat per pair
ALTER TABLE "chats" ADD CONSTRAINT "chats_direct_key_check" CHECK (("kind" = 'direct') = ("direct_key" IS NOT NULL));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_check" CHECK (char_length("body") <= 2000);

-- Every crew has its chat, with the crew's runners in it
INSERT INTO "chats" ("kind", "name", "crew_id") SELECT 'crew', "name", "id" FROM "crews";
INSERT INTO "chat_members" ("chat_id", "runner_id")
    SELECT c."id", m."runner_id" FROM "chats" c JOIN "crew_members" m ON m."crew_id" = c."crew_id";

-- Every live gig has its chat: the runners in its slots, and its fixer
INSERT INTO "chats" ("kind", "name", "gig_id") SELECT 'gig', "name", "id" FROM "gigs" WHERE "status" IN ('open', 'closed');
INSERT INTO "chat_members" ("chat_id", "runner_id")
    SELECT c."id", s."runner_id" FROM "chats" c JOIN "gig_slots" s ON s."gig_id" = c."gig_id" WHERE s."user_id" IS NOT NULL AND s."runner_id" IS NOT NULL
    UNION
    SELECT c."id", g."fixer_runner_id" FROM "chats" c JOIN "gigs" g ON g."id" = c."gig_id" WHERE g."fixer_runner_id" IS NOT NULL
    ON CONFLICT DO NOTHING;
