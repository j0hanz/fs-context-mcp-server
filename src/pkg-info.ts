import { z } from 'zod';

import packageJsonRaw from '../package.json' with { type: 'json' };

const PkgInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  homepage: z.string().optional(),
});

export const pkgInfo = PkgInfoSchema.parse(packageJsonRaw);
