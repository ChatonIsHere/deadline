-- A crew's logo
ALTER TABLE "crews" ADD COLUMN "image_id" UUID;
CREATE INDEX "crews_image_id_idx" ON "crews"("image_id");
ALTER TABLE "crews" ADD CONSTRAINT "crews_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
