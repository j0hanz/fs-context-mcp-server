# FS Context MCP Server Instructions

> **Guidance for the Agent:** These instructions are available as a resource (internal://instructions). Load them when you are confused about tool usage.

## 1. Core Capability

- **Domain:** Read-only filesystem exploration, search, and inspection within allowed roots.
- **Primary Resources:** `Roots`, `DirectoryEntries`, `TreeEntries`, `SearchMatches`, `FileInfo`.

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

## 3. Tool Nuances & "Gotchas"

- **`find`**: Glob-only path matching. When `includeIgnored=false`, built-in ignores and a root `.gitignore` are honored.
- **`tree`**: Bounded by `maxDepth`/`maxEntries`; may truncate when entry limits are hit.
- **`grep`**: Literal, case-insensitive search; skips binaries and files >1MB.
- **`read` / `read_many`**: `head` is mutually exclusive with `startLine`/`endLine`.
- **`read_many`**: No binary detection; use `stat` first if unsure.

## 4. Error Handling Strategy

- `E_ACCESS_DENIED`: Call `roots` and retry with an allowed path.
- `E_TOO_LARGE`: Use `head` or `startLine`/`endLine` to reduce size.
- `E_TIMEOUT`: Narrow the path scope or reduce `maxResults`/`maxEntries`.
