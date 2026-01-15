# FS Context MCP Server Instructions

> **Guidance for the Agent:** These instructions are available as a resource (`internal://instructions`). Load them when you are confused about tool usage.

## 1. Core Capability

- **Domain:** Read-only filesystem exploration, search, and inspection within allowed roots.
- **Primary Resources:** `Roots`, `DirectoryEntries`, `TreeEntries`, `SearchMatches`, `FileInfo`.
- **Available Tools:** `roots`, `ls`, `tree`, `find`, `grep`, `read`, `read_many`, `stat`, `stat_many` (9 read-only tools).

## 2. The "Golden Path" Workflows (Critical)

_Follow this order; do not guess paths._

### Workflow A: Workspace Discovery

1. Call `roots` to confirm access.
2. Call `tree` or `ls` to map structure.
3. Call `read` or `read_many` to inspect files.
   > **Constraint:** Never assume a path; list or tree first.

### Workflow B: Find and Inspect Code

1. Call `find` to locate files by glob.
2. Call `grep` to confirm content matches.
3. Call `read` (or `read_many`) to open the exact file.
   > **Constraint:** `find` is path-only; use `grep` for content.

### Workflow C: File Metadata Inspection

1. Call `stat` for single file/directory metadata (size, modified, permissions, MIME type).
2. Call `stat_many` for batch operations (up to 100 paths).
3. Use `tokenEstimate` field to gauge content size before reading.
   > **Constraint:** `stat` does not read file content; use `read` for that.

## 3. Tool Nuances & "Gotchas"

- **`roots`**: Returns allowed directories (MCP roots or CLI `--allowed-dirs`). Call this first to confirm access.
- **`ls`**: Non-recursive listing. Returns name, type, size, modified date. Use `includeHidden` for dotfiles.
- **`find`**: Glob-only path matching. When `includeIgnored=false`, built-in ignores and a root `.gitignore` are honored.
- **`tree`**: Bounded by `maxDepth`/`maxEntries`; may truncate when entry limits are hit. Returns both ASCII art and JSON structure.
- **`grep`**: Literal, case-insensitive search; skips binaries and files >1MB. Returns line numbers and match context.
- **`read` / `read_many`**: `head` is mutually exclusive with `startLine`/`endLine`. Large content may return a resource link (`fs-context://result/{id}`).
- **`read_many`**: No binary detection; use `stat` first if unsure. Max 100 files per call.
- **`stat` / `stat_many`**: Returns metadata only (no content). Includes `tokenEstimate` (approx. size/4). Max 100 paths for batch.
- **Resource Caching:** Large results return `resourceUri` (e.g., `fs-context://result/{id}`) instead of inline content. These are ephemeral and not guaranteed to persist.

## 4. Error Handling Strategy

- `E_ACCESS_DENIED`: Call `roots` and retry with an allowed path.
- `E_TOO_LARGE`: Use `head` or `startLine`/`endLine` to reduce size.
- `E_TIMEOUT`: Narrow the path scope or reduce `maxResults`/`maxEntries`.
