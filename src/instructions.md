# FS Context MCP Server — AI Usage Instructions

Use this server to explore, search, and read filesystem content within allowed workspace roots. All operations are read-only. Prefer using these tools over "remembering" file contents in chat.

---

## Operating Rules

- Use tools only when you need to verify, discover, or read filesystem state.
- Call `roots` first to confirm accessible directories before any other operation.
- Operate by paths (relative to roots when practical) rather than guessing file locations.
- Batch operations when available: use `read_many` for 2+ files, `stat_many` for 2+ metadata checks.
- All tools are read-only; no destructive operations exist.
- Keep operations atomic; if a request is vague, ask a clarifying question before calling tools.

### Quick Decision Rules

- If you are unsure what directories are accessible: call `roots` first.
- If you need to locate files by name or pattern: use `find` (glob search).
- If you need to locate text inside files: use `grep` (content search).
- If reading multiple files: use `read_many` (up to 100 paths).
- If unsure whether a file is text or binary: use `stat` to check `mimeType` first.
- If a file is too large: use `head` parameter to preview first N lines.

### Client UX Notes (VS Code)

- Non-read-only tools typically require user confirmation — this server has none.
- Tool lists can be cached; users can reset cached tools via **MCP: Reset Cached Tools**.
- Only run MCP servers from trusted sources; VS Code prompts users to trust servers.

---

## Data Model (What the Server Operates On)

### Workspace Roots

- Absolute directory paths the server is allowed to access.
- Configured via CLI arguments, `--allow-cwd` flag, or client-provided MCP Roots protocol.
- All path operations are validated against these roots.

### File/Directory Entries

- `name` — basename of the entry
- `path` — absolute or relative path
- `type` — `file` | `directory` | `symlink` | `other`
- `size` — bytes (optional for directories)
- `modified` — ISO 8601 timestamp
- `mimeType` — extension-based MIME type (for `stat` results)

### Search Matches (grep)

- `file` — relative path from search base
- `line` — 1-based line number
- `content` — matched line text (truncated to 200 chars)

---

## Workflows (Recommended)

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

### 3) Check Before Reading (Avoid Binary/Huge Files)

```text
stat(path="docs/logo.png")                     → confirm type/size
stat_many(paths=["README.md", "dist/index.js"])→ batch metadata check
```

---

## Tools (What to Use, When)

### roots

List workspace roots this server can access.

- Use when: first call in any session, or when access errors occur.
- Args: none
- Notes: If empty, no other tools will work until roots are configured.

### ls

List immediate contents of a directory (non-recursive).

- Use when: orienting in a directory, seeing what files exist.
- Args:
  - `path` (optional) — directory to list; omit for first root
  - `includeHidden` (optional, default false) — include dotfiles
- Notes: Returns name, relativePath, type, size, modified. Use `find` for recursive search.

### find

Find files by glob pattern (e.g., `**/*.ts`).

- Use when: locating files by name/extension pattern.
- Args:
  - `pattern` (required) — glob pattern (max 1000 chars, no absolute paths)
  - `path` (optional) — base directory; omit for first root
  - `maxResults` (optional, default 100, max 10000)
  - `includeIgnored` (optional, default false) — include node_modules, dist, .git, etc.
- Notes: Default excludes common build/dependency directories. Returns relative paths.

### grep

Search for text within file contents (case-insensitive, literal match).

- Use when: finding references, function usages, or specific text in code.
- Args:
  - `pattern` (required) — text to search for (max 1000 chars)
  - `path` (optional) — directory or single file to search; omit for first root
  - `includeHidden` (optional, default false) — include dotfiles
- Notes: Skips binary files and files > 1MB (configurable). Returns file, line, content.

### read

Read text contents of a single file.

- Use when: opening one file, previewing large files.
- Args:
  - `path` (required) — file path
  - `head` (optional, 1-100000) — read only first N lines
- Notes: Rejects binary files. Use `head` for large files to avoid E_TOO_LARGE.

### read_many

Read multiple text files in one request.

- Use when: opening 2+ files efficiently.
- Args:
  - `paths` (required) — array of file paths (max 100)
  - `head` (optional) — limit lines per file
- Notes: Does not detect binary; use `stat_many` first if unsure. Returns per-file results with content or error.

### stat

Get metadata for a single file or directory.

- Use when: checking file type, size, or mimeType before reading.
- Args:
  - `path` (required) — file or directory path
- Notes: Returns name, path, type, size, modified, permissions, mimeType, symlinkTarget.

### stat_many

Get metadata for multiple files/directories in one request.

- Use when: batch checking 2+ paths.
- Args:
  - `paths` (required) — array of paths (max 100)
- Notes: Returns per-path results with info or error.

---

## Response Shape

All tools return structured JSON with:

```json
{
  "ok": true
  // ... tool-specific data
}
```

On error:

```json
{
  "ok": false,
  "error": {
    "code": "E_NOT_FOUND",
    "message": "File not found: src/missing.ts",
    "path": "src/missing.ts",
    "suggestion": "Check the path exists within allowed roots"
  }
}
```

### Common Error Codes

| Code                  | Meaning                 | Resolution                        |
| --------------------- | ----------------------- | --------------------------------- |
| `E_ACCESS_DENIED`     | Path outside roots      | Check `roots`, use valid path     |
| `E_NOT_FOUND`         | Path does not exist     | Verify path with `ls` or `find`   |
| `E_NOT_FILE`          | Expected file, got dir  | Use `ls` instead                  |
| `E_NOT_DIRECTORY`     | Expected dir, got file  | Use `read` instead                |
| `E_TOO_LARGE`         | File exceeds size limit | Use `head` parameter              |
| `E_TIMEOUT`           | Operation took too long | Narrow scope, reduce `maxResults` |
| `E_INVALID_PATTERN`   | Malformed glob pattern  | Simplify pattern                  |
| `E_PERMISSION_DENIED` | OS-level access denied  | Check file permissions            |

---

## Limits & Defaults

| Limit                   | Default    | Configurable Via          |
| ----------------------- | ---------- | ------------------------- |
| Max file size (read)    | 10 MB      | `MAX_FILE_SIZE` env       |
| Max search file size    | 1 MB       | `MAX_SEARCH_SIZE` env     |
| Search timeout          | 30 seconds | `DEFAULT_SEARCH_TIMEOUT`  |
| Max results (find)      | 100        | `maxResults` arg (≤10000) |
| Max paths (read_many)   | 100        | —                         |
| Line content truncation | 200 chars  | —                         |

---

## Security Notes

- **Read-only:** no writes, deletes, or modifications.
- **Path validation:** symlinks cannot escape allowed roots.
- **Binary detection:** `read` rejects binary files; `grep` skips them.
- **Input sanitization:** glob patterns validated to prevent ReDoS.
