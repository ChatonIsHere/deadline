-- AlterTable
ALTER TABLE "runners" ADD COLUMN     "fixer_alias" TEXT,
ADD COLUMN     "fixer_slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "runners_fixer_slug_key" ON "runners"("fixer_slug");

