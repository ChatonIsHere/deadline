-- On their own: a new enum value can't be used in the migration that adds it
ALTER TYPE "gig_status" ADD VALUE 'draft';
ALTER TYPE "image_kind" ADD VALUE 'art';
