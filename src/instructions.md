# FS Context MCP Server

Read-only tools for safe filesystem inspection via the Model Context Protocol (MCP).
This server can only access explicitly allowed “workspace roots” and never writes to disk.

---

## TL;DR (Agent Workflow)

1. `roots` → learn what you can access
2. `ls` → orient yourself in a directory
3. `find` → locate candidate files by glob
4. `grep` → find references/content (text search)
5. `read` / `read_many` → open the exact files you need
6. `stat` / `stat_many` → confirm type/size/mime before reading

---

## Key Rules (Avoid Surprises)

- **Access is root-scoped:** if `roots` returns an empty list, other tools will fail until the client/CLI config provides roots.
- **Paths must stay within roots:** attempts to escape (e.g., via `..` or symlinks that resolve outside roots) are denied.
- **`find` is glob search; `grep` is content search:** use `find` to locate files, `grep` to locate text inside files.
- **Symlink policy:** directory scans do not traverse symlinked directories; direct symlink targets are allowed only if they resolve within roots.

---

## Quick Reference

| Goal             | Tool        | Notes                                                                          |
| ---------------- | ----------- | ------------------------------------------------------------------------------ |
| Check access     | `roots`     | Always call first                                                              |
| List a directory | `ls`        | Non-recursive; `includeHidden` optional                                        |
| Find files       | `find`      | Glob patterns; default excludes common build/deps unless `includeIgnored=true` |
| Search text      | `grep`      | Literal, case-insensitive text search; can scan a dir or a single file         |
| Read one file    | `read`      | UTF-8 text; rejects binary; use `head` to preview                              |
| Read many files  | `read_many` | Up to 100 paths; may skip files if combined reads exceed budget                |
| File metadata    | `stat`      | Type, size, modified, permissions, mimeType (extension-based)                  |
| Metadata batch   | `stat_many` | Prefer for 2+ paths                                                            |

---

## Practical Recipes

### Project discovery

```text
roots
ls(path=".")
read_many(paths=["package.json", "README.md"], head=200)
```

### Locate & open implementation

```text
find(pattern="src/**/*.ts", maxResults=2000)
grep(path="src", pattern="registerTool")
read(path="src/tools.ts", head=200)
```

### Check before reading (avoid binary/huge files)

```text
stat(path="docs/logo.png")
stat_many(paths=["README.md", "dist/index.js"])
```

---

## Tool Notes (Behavior That Matters)

### `find` (glob)

- Uses glob patterns like `**/*.ts` or `src/**/index.*`.
- Default behavior excludes common directories like `node_modules`, `dist`, `.git`, etc.
  Use `includeIgnored=true` when you explicitly want to search those.
- Prefer scoping with `path` and limiting with `maxResults` for large repos.

Common patterns:

- `**/*.ts`
- `src/**/*.{ts,tsx}`
- `**/*.test.ts`

### `grep` (text search)

- Searches for **literal text** (not a user-supplied regex).
- Matching is **case-insensitive**.
- By design, it **skips binary files** and **skips very large files** (size limits are configurable by the server environment).
  “No matches” is not proof that a string doesn’t exist in a binary/large file.

### `read` vs `read_many`

- `read` is safest for text: it enforces size limits and refuses binary.
- `read_many` is best for efficiency (2+ files), but it does **not** do binary detection.
  If you’re unsure, do `stat_many` first and only read obvious text files.

---

## Output & Errors

- Each tool returns structured data with `ok: true|false`.
- On failure you’ll get `ok: false` with an `error` object containing at least `code` and `message` (often `path` and a `suggestion`).

Common error codes:

- `E_ACCESS_DENIED` (outside allowed roots)
- `E_NOT_FOUND`, `E_NOT_FILE`, `E_NOT_DIRECTORY`
- `E_TOO_LARGE` (use `head`)
- `E_INVALID_PATTERN` (glob pattern issues in `find`)
- `E_TIMEOUT` (narrow scope, reduce results)
- `E_PERMISSION_DENIED`
