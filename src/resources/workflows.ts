import { getSharedConstraints } from './tool-info.js';

export function buildWorkflowGuide(): string {
  return `## Workflow Reference

### A: EXPLORE
1. \`roots\` (List allowed paths).
2. \`ls\` (files) | \`tree\` (structure).
3. \`stat\` | \`stat_many\` (size/type check).
4. \`read\` | \`read_many\` (content).
   > **Strict:** Never guess paths. Resolve first.

### B: SEARCH
1. \`find\` (glob candidates).
2. \`grep\` (content search).
3. \`read\` (verify context).
   > **Tip:** Content search requires \`grep\`, not \`find\`.

### C: EDIT
1. \`edit\` (precise string match).
2. \`search_and_replace\` (bulk regex/glob).
3. \`mv\` | \`rm\` (file layout).
4. \`mkdir\` (create dirs).
   > **Strict:** Confirm destructive ops (\`write\`, \`mv\`, \`rm\`, bulk replace).

### D: PATCH
1. \`diff_files\` (generate).
2. \`apply_patch\` (dryRun: true).
3. \`apply_patch\` (dryRun: false).
   > **Tip:** Use \`diff_files\` output directly.

## Shared Constraints
${getSharedConstraints()
  .map((c) => `- ${c}`)
  .join('\n')}
`;
}
