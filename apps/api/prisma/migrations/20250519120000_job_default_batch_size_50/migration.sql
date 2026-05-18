-- New jobs default to 50 strings per Bedrock batch (existing rows unchanged).
ALTER TABLE "Job" ALTER COLUMN "batchSize" SET DEFAULT 50;
