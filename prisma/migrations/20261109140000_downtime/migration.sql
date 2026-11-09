-- What a character lives in and how, and which DT month they've been paid for
ALTER TABLE "runners" ADD COLUMN "living" TEXT;
ALTER TABLE "runners" ADD COLUMN "lifestyle" TEXT;
ALTER TABLE "runners" ADD COLUMN "custom_living" JSONB;
ALTER TABLE "runners" ADD COLUMN "downtime_granted_for" TEXT;
ALTER TABLE "runners" ADD COLUMN "last_gig_month" TEXT;

CREATE TYPE "downtime_kind" AS ENUM ('monthly', 'gig', 'spend', 'admin');

CREATE TABLE "downtime_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runner_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "downtime_kind" NOT NULL,
    "note" TEXT,
    "rent" INTEGER,
    "humanity" INTEGER,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "downtime_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "downtime_entries_runner_id_month_idx" ON "downtime_entries"("runner_id", "month");

ALTER TABLE "downtime_entries" ADD CONSTRAINT "downtime_entries_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
