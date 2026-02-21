import { ALL_TOOLS } from '../tools.js';
import type { ToolContract } from '../tools/contract.js';

const INSTRUCTIONS_HEADER = `# FILESYSTEM-MCP INSTRUCTIONS

> Resource: \`internal://instructions\` | Prompt: \`get-help\`

## CORE CAPABILITY

- **Domain:** Safe local filesystem operations (read/write/diff/patch) within allowed roots.
- **Tools:**
  - READ: \`roots\`, \`ls\`, \`find\`, \`tree\`, \`read\`, \`read_many\`, \`stat\`, \`stat_many\`, \`grep\`, \`calculate_hash\`, \`diff_files\`.
  - WRITE: \`mkdir\`, \`write\`, \`edit\`, \`mv\`, \`rm\`, \`apply_patch\`, \`search_and_replace\`.

## RESOURCES

- \`filesystem-mcp://result/{id}\`: Ephemeral cached output.
- \`filesystem-mcp://metrics\`: Live tool stats.
- **Tip:** If response has \`resourceUri\`, call \`resources/read\` to fetch full content.

## PROGRESS & TASKS

- Support \`_meta.progressToken\` for updates.
- Task tools: \`find\`, \`tree\`, \`read\`, \`read_many\`, \`stat_many\`, \`grep\`, \`mkdir\`, \`write\`, \`mv\`, \`rm\`, \`calculate_hash\`, \`apply_patch\`, \`search_and_replace\`.
- Flow: \`tools/call\` (task) → \`tasks/get\` → \`tasks/result\`.

## GOLDEN PATH WORKFLOWS

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
`;

const INSTRUCTIONS_FOOTER = `
## CONSTRAINTS

- **Scope:** Allowed roots only (negotiated via CLI).
- **Security:** Sensitive files denylisted by default.
- **Limits:** Max file size & search results enforced.
- **Cache:** Externalized results are ephemeral (in-memory).

## ERROR HANDLING

- \`E_ACCESS_DENIED\` → Call \`roots\`; use allowed path.
- \`E_NOT_FOUND\`     → Call \`ls\`/\`find\`; verify spelling.
- \`E_TOO_LARGE\`     → Use range/head or \`read_many\`.
- \`E_TIMEOUT\`       → Reduce scope or result limits.
`;

function formatToolSection(tool: ToolContract): string {
  const parts = [`${tool.name}: ${tool.description}`];

  if (tool.annotations) {
    const attrs: string[] = [];
    if (tool.annotations.destructiveHint) attrs.push('[Destructive]');
    if (tool.annotations.idempotentHint) attrs.push('[Idempotent]');
    if (tool.annotations.readOnlyHint) attrs.push('[Read-Only]');
    if (attrs.length > 0) parts.push(attrs.join(' '));
  }

  if (tool.nuances && tool.nuances.length > 0) {
    parts.push(...tool.nuances.map((n) => `! ${n}`));
  }

  if (tool.gotchas && tool.gotchas.length > 0) {
    parts.push(...tool.gotchas.map((g) => `! ${g}`));
  }

  return parts.join('\n');
}

export function buildServerInstructions(): string {
  const toolSections = ALL_TOOLS.map(formatToolSection).join('\n\n');
  return [
    INSTRUCTIONS_HEADER,
    '## TOOL REFERENCE',
    '',
    toolSections,
    '',
    '---',
    INSTRUCTIONS_FOOTER,
  ].join('\n');
}
