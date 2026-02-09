# FS-CONTEXT INSTRUCTIONS

These instructions are available as a resource (internal://instructions) or prompt (get-help). Load them when unsure about tool usage.

---

## CORE CAPABILITY

- Domain: Filesystem operations via an MCP server, enabling LLMs to interact with the filesystem securely and efficiently.
- Primary Resources: Files, Directories, Search Results, File Metadata.
- Tools: `ls`, `roots`, `find`, `tree`, `read`, `read_many`, `stat`, `stat_many`, `grep`, `calculate_hash`, `diff_files` (READ); `mkdir`, `write`, `edit`, `mv`, `rm`, `apply_patch`, `search_and_replace` (WRITE).

---

## PROMPTS

- `get-help`: Returns these instructions for quick recall.

---

## RESOURCES & RESOURCE LINKS

- `internal://instructions`: This document.
- `fs-context://result/{id}`: Cached large output (ephemeral).
- If a tool response includes a `resourceUri` or `resource_link`, call `resources/read` with the URI to fetch the full payload.

---

## PROGRESS & TASKS

- Include `_meta.progressToken` in requests to receive `notifications/progress` updates for long-running tools.
- Task-augmented tool calls are supported for `grep`, `find`, and `search_and_replace`:
  - Send `tools/call` with `task` to get a task id.
  - Poll `tasks/get` and fetch results via `tasks/result`.
  - Use `tasks/cancel` to abort.
  - Task data is stored in memory and cleared on restart.

---

## THE "GOLDEN PATH" WORKFLOWS (CRITICAL)

### WORKFLOW A: DISCOVERY & NAVIGATION

- Call `roots` to see allowed directories.
- Call `ls` (single dir) or `tree` (recursive) to map layout.
- Call `stat` or `stat_many` to check file types/sizes before reading.
  NOTE: Never guess paths. Always list first.

### WORKFLOW B: SEARCH & RETRIEVAL

- Call `find` to locate files by glob (e.g., `**/*.ts`).
- Call `grep` to search contents by regex (e.g., `function.*test`).
- Call `read` or `read_many` to inspect files.
- If content is truncated, use `resourceUri` from response or paginated `read` with `startLine`.

### WORKFLOW C: MODIFICATION (IF PERMITTED)

- Call `mkdir` to ensure paths exist.
- Call `write` to create/overwrite files.
- Call `edit` for targeted replacements.
- Call `mv` or `rm` for organization.
  NOTE: Always confirm destructive actions (delete/overwrite) with the user first.

---

## TOOL NUANCES & GOTCHAS

`ls`

- Purpose: List directory contents (non-recursive).
- Input: `path` (optional, default root), `includeIgnored` (bool).
- Limits: Use `tree` for recursion (depth limited).

`find`

- Purpose: Search file paths by glob.
- Input: `pattern` (required), `path` (optional root).
- Nuance: Respects `.gitignore` unless `includeIgnored=true`.

`grep`

- Purpose: Search file content.
- Input: `pattern` (string/regex), `isRegex` (bool).
- Limits: Skips binaries/large files. Returns max 50 inline matches.

`read` / `read_many`

- Purpose: Read file text.
- Input: `path`, `head` (lines), `startLine`/`endLine`.
- Gotcha: Large files return `resourceUri`; read it or use pagination.

`calculate_hash`

- Purpose: Compute a SHA-256 hash for a file.
- Input: `path` (file).

`diff_files`

- Purpose: Create a unified diff between two files.
- Input: `original`, `modified`, optional `context`, `ignoreWhitespace`, `stripTrailingCr`.
- Gotcha: Large diffs may be returned via `resourceUri`.

`apply_patch`

- Purpose: Apply a unified diff patch to a file.
- Input: `path`, `patch`, optional `fuzzy`/`fuzzFactor`, `autoConvertLineEndings`, `dryRun`.

`search_and_replace`

- Purpose: Replace text across files matching a glob.
- Input: `filePattern`, `searchPattern`, `replacement`, optional `isRegex`, `dryRun`.
- Gotcha: Review `failedFiles` and `failures` for partial errors.

`edit`

- Purpose: Sequential string replacement.
- Input: `edits` (array of {oldText, newText}).
- Gotcha: `oldText` must match exactly. First occurrence only per edit.

---

## ERROR HANDLING STRATEGY

- `E_NOT_FOUND`: Check path with `ls` or `find`.
- `E_ACCESS_DENIED`: Path outside allowed `roots`.
- `E_TIMEOUT`: Reduce scope (e.g., specific subdir) or batch size.
- `E_INVALID_PATTERN`: Fix glob/regex syntax.

---
