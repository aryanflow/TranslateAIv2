-- Optional per-job extractor options (e.g. CSV column selection).
ALTER TABLE "Job" ADD COLUMN "extractOptions" JSONB;
