-- Drafts an admin has scheduled to post
ALTER TABLE "gigs" ADD COLUMN "post_at" TIMESTAMPTZ(3);
ALTER TABLE "gigs" ADD COLUMN "post_by" TEXT;
