-- Overall pay: one pot split between the runners
ALTER TABLE "gigs" ADD COLUMN "split_pay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "gig_rewards" ADD COLUMN "share" INTEGER;

-- A draft can be saved before the pay is set
ALTER TABLE "gigs" DROP CONSTRAINT "gigs_pay_positive";
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_pay_positive" CHECK ("pay" > 0 OR "status" = 'draft');

-- How many live gigs a player can be signed up to. 0 is no limit.
ALTER TABLE "settings" ADD COLUMN "max_signups" INTEGER NOT NULL DEFAULT 0;

-- Runner profiles
ALTER TABLE "runners" ADD COLUMN "tagline" TEXT;
ALTER TABLE "runners" ADD COLUMN "art_id" UUID;
CREATE INDEX "runners_art_id_idx" ON "runners"("art_id");
ALTER TABLE "runners" ADD CONSTRAINT "runners_art_id_fkey" FOREIGN KEY ("art_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
