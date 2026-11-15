-- When a runner turned down a crew's invite, so the crew waits before asking again
CREATE TABLE "crew_invite_declines" (
    "crew_id" UUID NOT NULL,
    "runner_id" UUID NOT NULL,
    "declined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_invite_declines_pkey" PRIMARY KEY ("crew_id","runner_id")
);

ALTER TABLE "crew_invite_declines" ADD CONSTRAINT "crew_invite_declines_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_invite_declines" ADD CONSTRAINT "crew_invite_declines_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
