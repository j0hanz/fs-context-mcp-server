# FS Context MCP Server — AI Usage Instructions

Use this server to explore, search, and read filesystem content within allowed workspace roots. All operations are read-only. Prefer using these tools over "remembering" file contents in chat.

---

## Operating Rules

- Call `roots` first to confirm accessible directories.
- Operate by paths relative to roots rather than guessing locations.
- Batch operations: `read_many` for 2+ files, `stat_many` for 2+ checks.
- If request is vague, ask clarifying questions before calling tools.

### Strategies

- **Discovery:** Unsure directories? Call `roots`. Directory structure? `tree` / `ls`. File name pattern (glob)? `find`. Content text? `grep`.
- **Reading:** Multiple files? `read_many`. Large file? `read` with `head`. Binary check? `stat`.

---

## Data Model

- **Workspace Roots:** Absolute paths; all operations validated against these.
- **Entries:** `name`, `path` (abs/rel), `type` (file/directory/symlink), `size`, `modified`.
- **Search Matches:** `file` (relative), `line`, `content` (truncated).

---

## Workflows

### 1) Project Discovery

```text
roots                                          → confirm access
ls(path=".")                                   → see top-level structure
read_many(paths=["package.json", "README.md"]) → understand project
```

### 2) Find & Read Code

```text
find(pattern="**/*.ts", maxResults=500)        → locate candidates
grep(path="src", pattern="registerTool")       → find references
read(path="src/tools.ts", head=100)            → read implementation
```

### 3) Check Before Reading

```text
stat(path="docs/logo.png")                     → confirm type/size
stat_many(paths=["README.md", "dist/index.js"])→ batch metadata check
```

---

## Tools

### roots

List accessible workspace roots.

- **Use when:** First call, or access errors.

### ls

List immediate directory contents (non-recursive).

- **Args:** `path` (opt), `includeHidden` (opt/false).
- **Returns:** Name, type, size, modified.

### find

Find files by glob pattern.

- **Args:** `pattern` (req, max 1000ch), `path` (opt), `maxResults` (opt/100), `includeIgnored` (opt/false).
- **Ref:** `**/*.ts` (recursive), `src/*` (flat). Matches relative paths.
- **Notes:**
  - `find` matches file paths via glob patterns (it does not search file contents).
  - `find` returns files only (directories like `src/` will not match unless you use `tree` / `ls`).
  - When `includeIgnored=false`, results also respect a root `.gitignore` file (if present under the search base path).

Examples:

```text
find(path="src", pattern="**/*.ts", maxResults=500)  → find TypeScript files under src/
find(pattern="**/*.md")                               → find markdown files from the default base path
grep(path="src", pattern="buildToolResponse")        → find text inside files (use grep, not find)
```

### tree

Render a directory tree (bounded recursion) for quick structure discovery.

- **Args:** `path` (opt), `maxDepth` (opt/5), `maxEntries` (opt/1000), `includeHidden` (opt/false), `includeIgnored` (opt/false)
- **Returns:** ASCII tree text plus a structured JSON tree.
- **Notes:**
  - When `includeIgnored=false`, the tree respects both built-in ignore rules (e.g., `node_modules`, `dist`, `.git`) and a root `.gitignore` file (if present under the base `path`).
  - When `includeIgnored=true`, both built-in ignores and `.gitignore` filtering are disabled.
  - Results may be truncated when `maxEntries` is reached.

Example:

```text
tree(path="src", maxDepth=3, maxEntries=500)
```

### grep

Search text within file contents (literal, case-insensitive).

- **Args:** `pattern` (req), `path` (opt), `includeHidden` (opt/false).
- **Ref:** Skips binary files and >1MB files.

### read

Read single text file content.

- **Args:** `path` (req), `head` (opt/lines), `startLine`/`endLine` (opt, 1-based; mutually exclusive with `head`).
- **Ref:** Rejects binary. Use `head` for large files.

### read_many

Read multiple text files.

- **Args:** `paths` (req, max 100), `head` (opt), `startLine`/`endLine` (opt, 1-based; mutually exclusive with `head`).
- **Ref:** No binary detection (use `stat` first). Returns per-file result/error.

### stat / stat_many

Get metadata for single or multiple paths.

- **Args:** `path` (req) / `paths` (req).
- **Returns:** Type, size, modified, permissions, mimeType (and `tokenEstimate` when available).

---

## Response Shape

Success: `{ "ok": true, ...data }`
Error: `{ "ok": false, "error": { "code": "E_...", "message": "...", "suggestion": "..." } }`

### Common Errors

- `E_ACCESS_DENIED`: Path outside roots.
- `E_NOT_FOUND`: Path missing.
- `E_TOO_LARGE`: File exceeds limit (use `head`).
- `E_TIMEOUT`: Reduce scope/results.

---

## Limits

- **Max Read:** 10MB (file), 1MB (search).
- **Max Items:** 100 (read/stat batch), 100 (find default).
- **Timeout:** 30s.

## Security

- **Read-only:** No writes/deletes.
- **Sandboxed:** Symlinks cannot escape roots.
