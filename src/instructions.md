# FS-Context MCP Server Instructions

> Available as resource `internal://instructions`. Load when unsure about tool usage.

## Core Capability

- **Domain:** Read-only filesystem exploration, search, and inspection within allowed roots.
- **Tools (all READ-ONLY):** `roots` `ls` `find` `tree` `read` `read_many` `grep` `stat` `stat_many`

## Golden Path Workflows

### Discovery & Navigation

1. `roots` — see allowed directories.
2. `ls` (single dir) or `tree` (recursive) to map layout.
   > Never guess paths. Always list first.

### Search & Retrieval

1. `find` — locate files by glob.
2. `grep` — search contents (literal by default; set `isRegex=true` for regex).
3. `read` / `read_many` — inspect files.
   > Large results return `resourceUri`; read it for full content.

### Metadata

- `stat` / `stat_many` — size, type, permissions, token estimate.

## Tool Nuances

- **`roots`** — Call first; all tools are scoped to these directories.
- **`ls`** — Non-recursive. Multiple roots require absolute `path`.
- **`find`** — Glob (e.g. `**/*.ts`). `maxResults` default 100. Respects `.gitignore`; `includeIgnored=true` overrides.
- **`tree`** — ASCII+JSON tree. Default depth 5, max 1000 entries.
- **`grep`** — Literal search by default; supports RE2 regex when `isRegex=true`. RE2 does not support backreferences or lookahead. Skips binaries and files >1MB. Max 50 inline matches; excess via `resourceUri`.
- **`read`/`read_many`** — `head` is exclusive with `startLine`/`endLine`. Large content via `resourceUri`. Batch max 100.
- **`stat`/`stat_many`** — Includes `tokenEstimate ≈ ceil(size/4)`. Batch max 100.

## Errors

- `E_ACCESS_DENIED` — Outside allowed roots. Check `roots`.
- `E_NOT_FOUND` — Use `ls`/`find` to verify path.
- `E_TOO_LARGE` — Use `head` for preview.
- `E_TIMEOUT` — Narrow scope or reduce batch.
- `E_INVALID_PATTERN` — Check glob/regex syntax.

## Resources

- `internal://instructions` — This document.
- `fs-context://result/{id}` — Cached large output (ephemeral).
