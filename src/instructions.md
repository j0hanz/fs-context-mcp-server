# FS-CONTEXT INSTRUCTIONS

These instructions are available as a resource (internal://instructions) or prompt (get-help). Load them when unsure about tool usage.

---

## CORE CAPABILITY

- Domain: Filesystem operations via an MCP server, enabling LLMs to interact with the filesystem securely and efficiently.
- Primary Resources: Files, Directories, Search Results, File Metadata.
- Tools: `ls`, `roots`, `find`, `tree`, `read`, `read_many`, `stat`, `stat_many`, `grep` (READ); `mkdir`, `write`, `edit`, `mv`, `rm` (WRITE).

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

## RESOURCES

- `internal://instructions`: This document.
- `fs-context://result/{id}`: Cached large output (ephemeral).
