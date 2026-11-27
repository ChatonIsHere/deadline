-- Lists keep loading as they scroll, in place of page buttons
ALTER TABLE "user_prefs" ADD COLUMN "infinite_scroll" BOOLEAN NOT NULL DEFAULT false;
