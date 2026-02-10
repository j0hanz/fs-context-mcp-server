# FILESYSTEM-MCP INSTRUCTIONS

These instructions are available as a resource (internal://instructions) or prompt (get-help). Load them when unsure about tool usage.

---

## CORE CAPABILITY

- Domain: Filesystem operations via an MCP server, enabling LLMs to interact with the local filesystem — read, write, search, diff, patch, and manage files/directories securely.
- Primary Resources: Files, Directories, Search Results, File Metadata.
- Tools: `roots`, `ls`, `find`, `tree`, `read`, `read_many`, `stat`, `stat_many`, `grep`, `calculate_hash`, `diff_files` (READ); `mkdir`, `write`, `edit`, `mv`, `rm`, `apply_patch`, `search_and_replace` (WRITE).

---

## PROMPTS

- `get-help`: Returns these instructions for quick recall.

---

## RESOURCES & RESOURCE LINKS

- `internal://instructions`: This document.
- `filesystem-mcp://result/{id}`: Cached large output (ephemeral).
- If a tool response includes a `resourceUri` or `resource_link`, call `resources/read` with the URI to fetch the full payload.

---

## PROGRESS & TASKS

- Include `_meta.progressToken` in requests to receive `notifications/progress` updates for long-running tools.
- Task-augmented tool calls are supported for `grep`, `find`, `search_and_replace`, `tree`, `read_many`, and `stat_many`:
  - These tools declare `execution.taskSupport: "optional"` — invoke normally or as a task.
  - Send `tools/call` with `task` to get a task id.
  - Poll `tasks/get` and fetch results via `tasks/result`.
  - Use `tasks/cancel` to abort.
  - Task data is stored in memory and cleared on restart.
- Tools without task support (e.g., `read`, `stat`, `ls`) execute synchronously and do not support `task` invocation.

---

## THE "GOLDEN PATH" WORKFLOWS (CRITICAL)

### WORKFLOW A: DISCOVERY & NAVIGATION

- Call `roots` to see allowed directories.
- Call `ls` (single dir) or `tree` (recursive) to map layout.
- Call `stat` or `stat_many` to check file types/sizes before reading.
  NOTE: Never guess paths. Always list first.

### WORKFLOW B: SEARCH & RETRIEVAL

- Call `find` to locate files by glob (e.g., `**/*.ts`).
- Call `grep` to search contents by regex or literal text.
- Call `read` or `read_many` to inspect files.
- If content is truncated, use `resourceUri` from response or paginated `read` with `startLine`.

### WORKFLOW C: MODIFICATION (IF PERMITTED)

- Call `mkdir` to ensure paths exist.
- Call `write` to create/overwrite files.
- Call `edit` for targeted replacements.
- Call `mv` or `rm` for organization.
  NOTE: Always confirm destructive actions (delete/overwrite) with the user first.

### WORKFLOW D: DIFF, PATCH & BULK REPLACE

- Call `diff_files` to compare two files (unified diff).
- Call `apply_patch` to apply a unified patch to a file. Use `dryRun: true` first.
- Call `search_and_replace` for bulk text replacement across files matching a glob. Use `dryRun: true` first.
  NOTE: Always dry-run before applying patches or bulk replacements.

---

## TOOL NUANCES & GOTCHAS

`roots`

- Purpose: List allowed workspace roots. Call this first in every session.
- Output: Includes `rootsCount` and `hasMultipleRoots`.

`ls`

- Purpose: List directory contents (non-recursive).
- Input: `path` (optional, default root), `includeIgnored`, `includeHidden`, optional `pattern`, `maxDepth`, `maxEntries`, `sortBy`, `includeSymlinkTargets`.
- Limits: Use `tree` for recursion (depth limited).

`find`

- Purpose: Search file paths by glob.
- Input: `pattern` (required), `path` (optional root), optional `includeHidden`, `includeIgnored`, `sortBy`, `maxDepth`, `maxFilesScanned`.
- Output: Includes `root` and `pattern` for traceability.
- Nuance: Respects `.gitignore` unless `includeIgnored=true`.

`tree`

- Purpose: Render a bounded directory tree (ASCII + JSON).
- Input: `path`, `maxDepth` (0–50, default 5), `maxEntries` (default 1000).
- Gotcha: `maxDepth=0` returns only the root node with empty children array.

`read`

- Purpose: Read file text.
- Input: `path`, `head` (first N lines), `startLine`/`endLine` (range).
- Gotcha: `head` is mutually exclusive with `startLine`/`endLine`. Large files return `resourceUri`; read it or use pagination.

`read_many`

- Purpose: Read multiple files in one call.
- Input: `paths` (max 100), `head`, `startLine`/`endLine`.
- Output: per-file `truncationReason` when truncated.
- Limits: Total budget capped by `MAX_READ_MANY_TOTAL_SIZE` (default 512 KB).

`stat` / `stat_many`

- Purpose: Get file/directory metadata (size, modified, permissions, MIME type).
- Output: Includes `tokenEstimate` (≈ size/4) for LLM context budgeting.

`grep`

- Purpose: Search file content (grep-like).
- Input: `pattern` (literal by default), `isRegex` (opt-in), `caseSensitive`, `wholeWord`, `contextLines`, `filePattern`, `maxResults`, `maxFilesScanned`.
- Output: Includes `patternType` and `caseSensitive`.
- Limits: Skips binaries and files larger than `MAX_SEARCH_SIZE` (default 1 MB). Returns max results per `maxResults` (default 500).
- Gotcha: Regex uses RE2 engine — no backreferences or lookahead/lookbehind.

`calculate_hash`

- Purpose: Compute a SHA-256 hash for a file or directory.
- Input: `path` (file or directory).
- Behavior: Auto-detects file vs directory using `fs.stat`.
  - **Files**: Returns `{ hash, isDirectory: false }`.
  - **Directories**: Returns `{ hash, isDirectory: true, fileCount }`. Uses deterministic hash-of-hashes pattern (lexicographically sorted paths, respects `.gitignore`).

`diff_files`

- Purpose: Create a unified diff between two files.
- Input: `original`, `modified`, optional `context`, `ignoreWhitespace`, `stripTrailingCr`.
- Output: Includes `isIdentical` (diff may be empty when true).
- Gotcha: Large diffs may be returned via `resourceUri`.

`edit`

- Purpose: Sequential string replacement in a file.
- Input: `path`, `edits` (array of `{oldText, newText}`), `dryRun`.
- Output: `unmatchedEdits` lists any `oldText` values not found.
- Gotcha: `oldText` must match exactly. First occurrence only per edit.

`apply_patch`

- Purpose: Apply a unified diff patch to a file.
- Input: `path`, `patch`, optional `fuzzy`/`fuzzFactor`, `autoConvertLineEndings`, `dryRun`.

`search_and_replace`

- Purpose: Replace text across files matching a glob.
- Input: `filePattern`, `searchPattern`, `replacement`, optional `isRegex`, `dryRun`.
- Output: Includes `changedFiles` with per-file match counts (may be truncated).
- Gotcha: Review `processedFiles`, `failedFiles`, and `failures` for partial errors.

`write`

- Purpose: Create or overwrite a file.
- Side effects: Destructive — overwrites existing content without confirmation.

`rm`

- Purpose: Delete a file or directory.
- Input: `path`, `recursive` (for non-empty dirs), `ignoreIfNotExists`.
- Side effects: Destructive and irreversible.

---

## ERROR HANDLING STRATEGY

- `E_NOT_FOUND`: Check path with `ls` or `find`.
- `E_ACCESS_DENIED`: Path outside allowed `roots`.
- `E_NOT_FILE`: Path is a directory. Use `ls` to explore its contents.
- `E_NOT_DIRECTORY`: Path is a file. Use `read` to read file contents.
- `E_TOO_LARGE`: File exceeds size limit. Use `head` to preview, or narrow scope.
- `E_TIMEOUT`: Reduce scope (narrower path), fewer results (`maxResults`), or search fewer files.
- `E_INVALID_PATTERN`: Fix glob/regex syntax.
- `E_INVALID_INPUT`: Check tool documentation for correct parameter usage.
- `E_PERMISSION_DENIED`: OS-level permission denied. Check file permissions.
- `E_SYMLINK_NOT_ALLOWED`: Symlinks escaping allowed directories are blocked for security.
- `E_UNKNOWN`: Unexpected error. Check the error message for details.

---
