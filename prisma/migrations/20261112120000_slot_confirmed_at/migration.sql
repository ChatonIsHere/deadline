-- When a slot's runner confirmed, so a reminder doesn't follow straight after
ALTER TABLE "gig_slots" ADD COLUMN "confirmed_at" TIMESTAMPTZ(3);
