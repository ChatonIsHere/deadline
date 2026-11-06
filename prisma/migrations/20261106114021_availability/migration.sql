-- AlterTable
ALTER TABLE "user_prefs" ADD COLUMN     "availability" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "setup_at" TIMESTAMPTZ,
ADD COLUMN     "timezone" TEXT;
