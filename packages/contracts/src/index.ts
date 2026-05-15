import { z } from "zod";

/** Mirrors Prisma `JobStatus` for API validation & shared use. */
export const jobStatusSchema = z.enum([
  "pending",
  "extracting",
  "chunking",
  "translating",
  "scoring",
  "regenerating",
  "completed",
  "failed",
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const createJobBodySchema = z.object({
  fileKey: z.string().min(1),
  sourceLang: z.string().min(2).max(32),
  targetLangs: z.array(z.string().min(2).max(32)).min(1),
  batchSize: z.coerce.number().int().min(1).max(2000).optional().default(200),
  minTranslationScore: z.coerce.number().min(0).max(1).optional(),
  maxBatchRetries: z.coerce.number().int().min(0).max(20).optional(),
});

export type CreateJobBody = z.infer<typeof createJobBodySchema>;

export const presignedUrlRequestSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});

export const putPromptBodySchema = z.object({
  systemText: z.string(),
  userText: z.string(),
  /** Optimistic concurrency: reject if `PromptTemplate.version` does not match */
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

export type PutPromptBody = z.infer<typeof putPromptBodySchema>;

export const termPreferenceCreateSchema = z.object({
  sourceLang: z.string().min(2).max(32),
  targetLang: z.string().min(2).max(32),
  sourceTerm: z.string().min(1),
  preferredTarget: z.string().min(1),
  notes: z.string().optional(),
});

export const termPreferencePatchSchema = z
  .object({
    sourceTerm: z.string().min(1).optional(),
    preferredTarget: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field required" });

export const activeModelsBodySchema = z.object({
  translator: z.string().min(1).optional(),
  scorer: z.string().min(1).optional(),
});

export type ActiveModelsBody = z.infer<typeof activeModelsBodySchema>;
