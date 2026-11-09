-- How much storage each picture takes, for the limit per person
ALTER TABLE "images" ADD COLUMN "bytes" INTEGER NOT NULL DEFAULT 0;
