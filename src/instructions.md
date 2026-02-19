# FILESYSTEM-MCP INSTRUCTIONS

These instructions are available as a resource (internal://instructions) or prompt (get-help). Load them when unsure about tool usage.

---

## CORE CAPABILITY

- Domain: Filesystem operations via an MCP server for LLM agents that need safe read/search/edit/diff/patch workflows within allowed roots.
- Primary Resources: Files, directories, metadata, search matches, and ephemeral cached result resources.
- Tools: READ: `roots`, `ls`, `find`, `tree`, `read`, `read_many`, `stat`, `stat_many`, `grep`, `calculate_hash`, `diff_files`. WRITE: `mkdir`, `write`, `edit`, `mv`, `rm`, `apply_patch`, `search_and_replace`.

---

## PROMPTS

- `get-help`: Returns these instructions for quick recall.

---

## RESOURCES & RESOURCE LINKS

- `internal://instructions`: This document.
- `filesystem-mcp://result/{id}`: Ephemeral cached tool output (in-memory); used when payloads are externalized.
- If a tool response includes a `resourceUri` or `resource_link`, call `resources/read` with that URI to fetch full content.

---

## PROGRESS & TASKS

- Include `_meta.progressToken` in requests to receive `notifications/progress` updates for long-running tools.
- Task-augmented tool calls are supported for `find`, `tree`, `read`, `read_many`, `stat_many`, `grep`, `mkdir`, `write`, `mv`, `rm`, `calculate_hash`, `apply_patch`, and `search_and_replace`:
  - Send `tools/call` with `task` to create a task.
  - Poll `tasks/get` and fetch final output with `tasks/result`.
  - Use `tasks/cancel` to abort.
  - Task status notifications are emitted via `notifications/tasks/status` when supported.

---

## THE "GOLDEN PATH" WORKFLOWS (CRITICAL)

### WORKFLOW A: DISCOVER AND INSPECT

- Call `roots` first to get allowed workspace roots.
- Call `ls` for non-recursive listing, or `tree` for bounded recursive overview.
- Call `stat` or `stat_many` to confirm path types/sizes before reading.
- Call `read` for one file or `read_many` for batches.
  NOTE: Never guess paths. Resolve from `roots`/`ls`/`find` first.

### WORKFLOW B: SEARCH CONTENT SAFELY

- Call `find` to locate candidate files by glob.
- Call `grep` with `filePattern` to search content only in relevant file types.
- If output is truncated or externalized, call `resources/read` on returned `resourceUri`.
- Call `read` on exact hits to inspect surrounding context.
  NOTE: `grep` regex uses RE2; do not rely on lookbehind/lookahead/backreferences.

### WORKFLOW C: MODIFY FILES WITH LOW RISK

- Call `mkdir` to prepare directories if needed.
- Use `edit` for precise first-occurrence replacements in one file.
- Use `search_and_replace` for bulk replacements across globs.
- Use `mv` to rename/move paths and `rm` to delete paths.
  NOTE: Confirm destructive operations (`write`, `mv`, `rm`, bulk replace) with the user before execution.

### WORKFLOW D: DIFF/PATCH LOOP

- Call `diff_files` to generate a unified diff.
- Call `apply_patch` with `dryRun: true` first.
- If dry run succeeds, call `apply_patch` again with `dryRun: false`.
- Call `diff_files` again to verify `isIdentical: true` when expected.
  NOTE: If patch apply fails, regenerate patch against current file content and retry.

---

## TOOL NUANCES & GOTCHAS

`roots`

- Purpose: Enumerate allowed workspace roots.
- Gotcha: Other tools are constrained to these roots.

`ls`

- Purpose: List directory contents (non-recursive by default).
- Nuance: `pattern` enables filtered recursive traversal up to `maxDepth`.

`find`

- Purpose: Find files by glob.
- Output: Returns relative paths plus metadata; may truncate based on limits.
- Nuance: Respects `.gitignore` unless `includeIgnored=true`.

`tree`

- Purpose: Return both ASCII and JSON tree views.
- Gotcha: `maxDepth=0` returns only the root node.

`read`

- Purpose: Read a single text file with optional head/range.
- Gotcha: Large content is externalized to `filesystem-mcp://result/{id}` and preview is returned inline.

`read_many`

- Purpose: Batch read multiple files.
- Gotcha: Per-file `truncationReason` can be `head`, `range`, or `externalized`.
- Limits: Total read budget is capped by `MAX_READ_MANY_TOTAL_SIZE`.

`stat` / `stat_many`

- Purpose: Return metadata including token estimate, MIME type, and timestamps.
- Nuance: Use before read/search when file size/type uncertainty exists.

`grep`

- Purpose: Search file contents by literal or RE2 regex.
- Gotcha: Inline match rows are capped (first 50); full structured results are externalized via `resourceUri`.
- Limits: Skips binary and oversized files; reports skips in structured output.

`write`

- Purpose: Create or overwrite a file atomically.
- Side effects: Creates parent directories automatically; overwrites existing content.

`edit`

- Purpose: Apply sequential literal replacements (first occurrence per edit).
- Gotcha: `oldText` must match exactly; unmatched items are reported in `unmatchedEdits`.

`mv`

- Purpose: Move or rename file/directory paths.
- Nuance: Cross-device moves fall back to copy+delete.

`rm`

- Purpose: Delete file/directory paths.
- Gotcha: Non-empty directory delete requires `recursive=true`; else returns actionable input error.

`calculate_hash`

- Purpose: SHA-256 for files or deterministic composite hash for directories.
- Nuance: Directory hashing respects root `.gitignore` and sorts paths for stable output.

`diff_files`

- Purpose: Generate unified diff between two files.
- Gotcha: `isIdentical=true` means no hunks (`@@`) and empty diff.

`apply_patch`

- Purpose: Apply unified diff text to a file.
- Gotcha: Patch must include valid hunk headers; use `dryRun=true` first.

`search_and_replace`

- Purpose: Replace all matches across files selected by `filePattern`.
- Gotcha: Literal mode is default; `isRegex=true` enables RE2 + capture replacements (`$1`, `$2`).
- Limits: Changed-file sample and failure sample are capped/truncated in output.

---

## CROSS-FEATURE RELATIONSHIPS

- Use `roots` output to scope all other tool calls.
- Use `find` → `grep` → `read` as the default search triad.
- Use `diff_files` output as input to `apply_patch`.
- Use `resourceUri` from `read`, `read_many`, `grep`, and `diff_files` with `resources/read` for full payload retrieval.
- Use `stat`/`stat_many` before `read`/`read_many` when size/type may violate limits.

---

## CONSTRAINTS & LIMITATIONS

- Access is restricted to allowed roots negotiated from CLI and MCP Roots.
- If multiple roots are configured and no path is provided, tools requiring base path fail with disambiguation error.
- Default timeouts and size caps are enforced (`DEFAULT_SEARCH_TIMEOUT`, `MAX_FILE_SIZE`, `MAX_SEARCH_SIZE`, `MAX_READ_MANY_TOTAL_SIZE`).
- Sensitive files are denylisted by default unless explicitly allowed via environment settings.
- Binary files are skipped for content search/read workflows where text is required.
- Externalized resource cache is in-memory, bounded (entry size/count/total bytes), and ephemeral.
- Regex engine is RE2-based; advanced PCRE features are unsupported.

---

## ERROR HANDLING STRATEGY

- `E_ACCESS_DENIED`: Path is outside allowed roots or roots are not configured. → Call `roots`, then retry with an allowed path.
- `E_NOT_FOUND`: Path or resource does not exist. → Call `ls`/`find` to verify existence and exact spelling.
- `E_NOT_FILE`: Path points to a directory/non-file for file-only operation. → Call `ls` or switch to directory tool.
- `E_NOT_DIRECTORY`: Path points to a file for directory operation. → Call `read` for file content or choose a directory path.
- `E_TOO_LARGE`: File/content exceeds limits. → Narrow scope, use range/head reads, or reduce candidate files.
- `E_TIMEOUT`: Operation exceeded timeout. → Reduce path scope, lower result limits, or simplify pattern.
- `E_INVALID_PATTERN`: Glob/regex invalid. → Fix syntax (RE2 for regex) and retry.
- `E_INVALID_INPUT`: Arguments are invalid for current context (e.g., ambiguous roots, bad patch, missing flags). → Correct parameters and retry.
- `E_PERMISSION_DENIED`: OS-level permission denied. → Adjust file permissions or choose accessible paths.
- `E_SYMLINK_NOT_ALLOWED`: Symlink traversal escapes allowed roots. → Use paths within allowed directories.
- `E_UNKNOWN`: Unclassified failure. → Inspect message details and retry with narrower, validated inputs.

---
