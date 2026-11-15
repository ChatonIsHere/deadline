-- HQ IP a crew earned on a gig (positive) or spent (negative). The crew's balance is the sum.
CREATE TABLE "crew_hq_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "crew_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "gig_id" UUID,
    "note" TEXT,
    "by_user_id" TEXT,
    "by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_hq_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crew_hq_entries_amount_check" CHECK ("amount" <> 0)
);

CREATE INDEX "crew_hq_entries_crew_id_idx" ON "crew_hq_entries"("crew_id");
CREATE INDEX "crew_hq_entries_gig_id_idx" ON "crew_hq_entries"("gig_id");

ALTER TABLE "crew_hq_entries" ADD CONSTRAINT "crew_hq_entries_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_hq_entries" ADD CONSTRAINT "crew_hq_entries_gig_id_fkey" FOREIGN KEY ("gig_id") REFERENCES "gigs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
