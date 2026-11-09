-- A character's full art becomes a gallery
CREATE TABLE "runner_photos" (
    "runner_id" UUID NOT NULL,
    "image_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "runner_photos_pkey" PRIMARY KEY ("runner_id", "image_id")
);

CREATE INDEX "runner_photos_image_id_idx" ON "runner_photos"("image_id");

ALTER TABLE "runner_photos" ADD CONSTRAINT "runner_photos_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runner_photos" ADD CONSTRAINT "runner_photos_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "runner_photos" ("runner_id", "image_id", "position")
SELECT "id", "art_id", 0 FROM "runners" WHERE "art_id" IS NOT NULL;

ALTER TABLE "runners" DROP COLUMN "art_id";
