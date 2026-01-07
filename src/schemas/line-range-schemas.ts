import { z } from 'zod';

export const HeadLinesSchema = z
  .int({ error: 'head must be an integer' })
  .min(1, 'head must be at least 1')
  .max(100000, 'head cannot exceed 100,000 lines')
  .optional()
  .describe('Read only the first N lines');
