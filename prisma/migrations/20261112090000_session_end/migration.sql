-- When the session is expected to finish
ALTER TABLE "gigs" ADD COLUMN "session_end_at" TIMESTAMPTZ(3);
