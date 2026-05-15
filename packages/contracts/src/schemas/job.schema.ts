import { z } from 'zod';

export const JobStatusEnum = z.enum([
  'pending',
  'extracting',
  'translating',
  'scoring',
  'regenerating',
  'completed',
  'failed',
  'cancelled',
]);

export type JobStatus = z.infer<typeof JobStatusEnum>;
