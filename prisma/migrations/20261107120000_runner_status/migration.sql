-- CreateEnum
CREATE TYPE "runner_status" AS ENUM ('active', 'retired', 'dead');

-- AlterTable
ALTER TABLE "runners" ADD COLUMN     "obituary" TEXT,
ADD COLUMN     "retired_at" TIMESTAMPTZ(3),
ADD COLUMN     "status" "runner_status" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "gig_rewards" ADD COLUMN     "hq_ip" INTEGER;

