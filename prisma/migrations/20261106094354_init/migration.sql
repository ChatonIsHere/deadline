-- CreateEnum
CREATE TYPE "gig_status" AS ENUM ('pending', 'open', 'closed', 'completed', 'cancelled', 'rejected');

-- CreateEnum
CREATE TYPE "runner_state" AS ENUM ('interested', 'awaiting', 'confirmed');

-- CreateEnum
CREATE TYPE "image_kind" AS ENUM ('gig', 'avatar');

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "guild_id" TEXT,
    "forum_id" TEXT,
    "admin_role_id" TEXT,
    "fixer_role_id" TEXT,
    "edgerunner_role_id" TEXT,
    "reminder_hours" INTEGER NOT NULL DEFAULT 8,
    "confirm_hours" INTEGER NOT NULL DEFAULT 48,
    "runner_roles" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_prefs" (
    "user_id" TEXT NOT NULL,
    "reminders" BOOLEAN NOT NULL DEFAULT true,
    "player_view" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "crews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "owner_id" TEXT NOT NULL,
    "ranks" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_members" (
    "crew_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,
    "rank" TEXT NOT NULL,

    CONSTRAINT "crew_members_pkey" PRIMARY KEY ("crew_id","runner_id")
);

-- CreateTable
CREATE TABLE "crew_allies" (
    "crew_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,

    CONSTRAINT "crew_allies_pkey" PRIMARY KEY ("crew_id","runner_id")
);

-- CreateTable
CREATE TABLE "crew_invites" (
    "crew_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,
    "invited_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_invites_pkey" PRIMARY KEY ("crew_id","runner_id")
);

-- CreateTable
CREATE TABLE "runners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" TEXT,
    "handle" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "extra_roles" JSONB NOT NULL DEFAULT '[]',
    "image_id" UUID,
    "office_location" TEXT,
    "specialties" TEXT,
    "contact" TEXT,
    "bio" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gigs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "fixer_name" TEXT NOT NULL,
    "fixer_runner_id" UUID,
    "fixer_id" TEXT,
    "location" TEXT NOT NULL,
    "type" TEXT,
    "brief" TEXT NOT NULL,
    "primary_objective" JSONB NOT NULL DEFAULT '[]',
    "pay" INTEGER NOT NULL,
    "image_id" UUID,
    "card_key" TEXT,
    "status" "gig_status" NOT NULL DEFAULT 'pending',
    "created_by" TEXT NOT NULL,
    "thread_id" TEXT,
    "overflow_message_ids" JSONB NOT NULL DEFAULT '[]',
    "session_at" TIMESTAMPTZ(3),
    "reminded_day" BOOLEAN NOT NULL DEFAULT false,
    "reminded_soon" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "reward_eb" INTEGER,
    "reward_ip" INTEGER,
    "reward_hq_ip" INTEGER,
    "reward_text" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gigs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gig_objectives" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gig_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "bonus" INTEGER,
    "each" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "gig_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gig_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gig_id" UUID NOT NULL,
    "crew_id" UUID,
    "user_id" TEXT,
    "runner_id" UUID,
    "state" "runner_state" NOT NULL DEFAULT 'interested',
    "asked_at" TIMESTAMPTZ(3),
    "nudged" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "gig_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gig_reserves" (
    "gig_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "runner_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gig_reserves_pkey" PRIMARY KEY ("gig_id","user_id")
);

-- CreateTable
CREATE TABLE "gig_rewards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "gig_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,
    "eb" INTEGER,
    "ip" INTEGER,
    "text" TEXT,

    CONSTRAINT "gig_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixer_ratings" (
    "gig_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "rated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixer_ratings_pkey" PRIMARY KEY ("gig_id","user_id")
);

-- CreateTable
CREATE TABLE "regions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "district" TEXT,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "region_id" UUID,
    "in_library" BOOLEAN NOT NULL,
    "kind" "image_kind" NOT NULL DEFAULT 'gig',
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unused_since" TIMESTAMPTZ(3),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stale_objects" (
    "key" TEXT NOT NULL,
    "since" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stale_objects_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "crews_name_key" ON "crews"("name");

-- CreateIndex
CREATE UNIQUE INDEX "crews_slug_key" ON "crews"("slug");

-- CreateIndex
CREATE INDEX "crew_members_runner_id_idx" ON "crew_members"("runner_id");

-- CreateIndex
CREATE INDEX "crew_allies_runner_id_idx" ON "crew_allies"("runner_id");

-- CreateIndex
CREATE INDEX "crew_invites_runner_id_idx" ON "crew_invites"("runner_id");

-- CreateIndex
CREATE UNIQUE INDEX "runners_slug_key" ON "runners"("slug");

-- CreateIndex
CREATE INDEX "runners_owner_id_idx" ON "runners"("owner_id");

-- CreateIndex
CREATE INDEX "runners_image_id_idx" ON "runners"("image_id");

-- CreateIndex
CREATE UNIQUE INDEX "gigs_thread_id_key" ON "gigs"("thread_id");

-- CreateIndex
CREATE INDEX "gigs_status_idx" ON "gigs"("status");

-- CreateIndex
CREATE INDEX "gigs_fixer_runner_id_idx" ON "gigs"("fixer_runner_id");

-- CreateIndex
CREATE INDEX "gigs_image_id_idx" ON "gigs"("image_id");

-- CreateIndex
CREATE INDEX "gig_objectives_gig_id_idx" ON "gig_objectives"("gig_id");

-- CreateIndex
CREATE INDEX "gig_slots_gig_id_idx" ON "gig_slots"("gig_id");

-- CreateIndex
CREATE INDEX "gig_slots_user_id_idx" ON "gig_slots"("user_id");

-- CreateIndex
CREATE INDEX "gig_slots_runner_id_idx" ON "gig_slots"("runner_id");

-- CreateIndex
CREATE INDEX "gig_reserves_runner_id_idx" ON "gig_reserves"("runner_id");

-- CreateIndex
CREATE INDEX "gig_rewards_runner_id_idx" ON "gig_rewards"("runner_id");

-- CreateIndex
CREATE UNIQUE INDEX "gig_rewards_gig_id_runner_id_key" ON "gig_rewards"("gig_id", "runner_id");

-- CreateIndex
CREATE UNIQUE INDEX "regions_name_key" ON "regions"("name");

-- CreateIndex
CREATE INDEX "images_region_id_idx" ON "images"("region_id");

-- CreateIndex
CREATE INDEX "images_unused_since_idx" ON "images"("unused_since");

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_allies" ADD CONSTRAINT "crew_allies_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_allies" ADD CONSTRAINT "crew_allies_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_invites" ADD CONSTRAINT "crew_invites_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_invites" ADD CONSTRAINT "crew_invites_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runners" ADD CONSTRAINT "runners_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_fixer_runner_id_fkey" FOREIGN KEY ("fixer_runner_id") REFERENCES "runners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_objectives" ADD CONSTRAINT "gig_objectives_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_slots" ADD CONSTRAINT "gig_slots_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_slots" ADD CONSTRAINT "gig_slots_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_slots" ADD CONSTRAINT "gig_slots_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_reserves" ADD CONSTRAINT "gig_reserves_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_reserves" ADD CONSTRAINT "gig_reserves_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_rewards" ADD CONSTRAINT "gig_rewards_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gig_rewards" ADD CONSTRAINT "gig_rewards_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixer_ratings" ADD CONSTRAINT "fixer_ratings_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Checks Prisma can't express
ALTER TABLE "settings" ADD CONSTRAINT "settings_single_row" CHECK ("id" = 1);
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_pay_positive" CHECK ("pay" > 0);
ALTER TABLE "gig_objectives" ADD CONSTRAINT "gig_objectives_bonus_positive" CHECK ("bonus" IS NULL OR "bonus" > 0);
ALTER TABLE "fixer_ratings" ADD CONSTRAINT "fixer_ratings_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "gig_rewards" ADD CONSTRAINT "gig_rewards_not_negative" CHECK (coalesce("eb", 0) >= 0 AND coalesce("ip", 0) >= 0);
