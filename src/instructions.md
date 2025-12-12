# Filesystem Context MCP Server

> **Read-only** filesystem tools for exploring directories, searching files, and analyzing codebases. All operations are safe and idempotent.

---

## Tool Selection Guide

### Which Tool Should I Use?

| Goal                              | Tool                       | Key Parameters                                    |
| --------------------------------- | -------------------------- | ------------------------------------------------- |
| See what directories I can access | `list_allowed_directories` | _(none)_                                          |
| Visualize project structure       | `directory_tree`           | `maxDepth`, `excludePatterns`, `includeSize`      |
| List directory contents           | `list_directory`           | `recursive`, `sortBy`, `maxEntries`               |
| Get directory statistics          | `analyze_directory`        | `topN`, `excludePatterns`                         |
| Find files by name/pattern        | `search_files`             | `pattern` (glob), `excludePatterns`, `maxResults` |
| Search inside file contents       | `search_content`           | `pattern` (regex), `filePattern`, `contextLines`  |
| Read a single file                | `read_file`                | `head`, `tail`, `lineStart`/`lineEnd`             |
| Read multiple files               | `read_multiple_files`      | `paths[]`, `head`, `tail`                         |
| Get file metadata                 | `get_file_info`            | _(path only)_                                     |
| Read images/binary files          | `read_media_file`          | `maxSize`                                         |

---

## Quick Start Workflow

**Always start here:**

```text
1. list_allowed_directories         → Know your boundaries
2. directory_tree(path, maxDepth=3) → See project structure
3. analyze_directory(path)          → Get statistics
```

---

## Tool Reference

### `list_allowed_directories`

Returns all directories this server can access. **Call first** to understand scope.

### `directory_tree`

Returns a JSON tree structure—ideal for AI parsing.

| Parameter         | Type     | Default | Description                 |
| ----------------- | -------- | ------- | --------------------------- |
| `path`            | string   | —       | Directory to visualize      |
| `maxDepth`        | number   | 5       | How deep to traverse (0-50) |
| `excludePatterns` | string[] | []      | Glob patterns to skip       |
| `includeHidden`   | boolean  | false   | Include dotfiles            |
| `includeSize`     | boolean  | false   | Show file sizes             |
| `maxFiles`        | number   | —       | Limit total files returned  |

**Example:** `directory_tree(path, maxDepth=3, excludePatterns=["node_modules", "dist"])`

### `list_directory`

Flat listing with metadata. Use for detailed file information.

| Parameter       | Type    | Default | Description                        |
| --------------- | ------- | ------- | ---------------------------------- |
| `path`          | string  | —       | Directory to list                  |
| `recursive`     | boolean | false   | Include subdirectories             |
| `sortBy`        | enum    | "name"  | `name`, `size`, `modified`, `type` |
| `maxDepth`      | number  | 10      | Depth limit when recursive         |
| `maxEntries`    | number  | —       | Limit results (up to 100,000)      |
| `includeHidden` | boolean | false   | Include dotfiles                   |

### `analyze_directory`

Statistics: file counts, sizes, types, largest files, recent changes.

| Parameter         | Type     | Default | Description                    |
| ----------------- | -------- | ------- | ------------------------------ |
| `path`            | string   | —       | Directory to analyze           |
| `maxDepth`        | number   | 10      | How deep to analyze            |
| `topN`            | number   | 10      | Number of largest/recent files |
| `excludePatterns` | string[] | []      | Patterns to skip               |
| `includeHidden`   | boolean  | false   | Include dotfiles               |

### `search_files`

Find files by glob pattern. Returns paths, sizes, and modification dates.

| Parameter         | Type     | Default | Description                            |
| ----------------- | -------- | ------- | -------------------------------------- |
| `path`            | string   | —       | Base directory                         |
| `pattern`         | string   | —       | **Glob**: `**/*.ts`, `src/**/test*.js` |
| `excludePatterns` | string[] | []      | Patterns to skip                       |
| `maxResults`      | number   | —       | Limit results (up to 10,000)           |
| `maxDepth`        | number   | —       | Depth limit                            |
| `sortBy`          | enum     | "path"  | `name`, `size`, `modified`, `path`     |

**Common patterns:**

- `**/*.ts` — All TypeScript files
- `src/**/*.{js,jsx}` — JS/JSX in src
- `**/test/**` — All test directories
- `**/*.test.ts` — Test files by convention

### `search_content`

Grep-like search inside files. Returns matching lines with context.

| Parameter         | Type     | Default | Description                             |
| ----------------- | -------- | ------- | --------------------------------------- |
| `path`            | string   | —       | Base directory                          |
| `pattern`         | string   | —       | **Regex**: `TODO\|FIXME`, `function\s+` |
| `filePattern`     | string   | `**/*`  | Glob to filter files                    |
| `excludePatterns` | string[] | []      | Patterns to skip                        |
| `caseSensitive`   | boolean  | false   | Case-sensitive matching                 |
| `wholeWord`       | boolean  | false   | Match whole words only                  |
| `isLiteral`       | boolean  | false   | Treat pattern as literal (not regex)    |
| `contextLines`    | number   | 0       | Lines before/after match (0-10)         |
| `maxResults`      | number   | 100     | Limit matches                           |
| `maxFilesScanned` | number   | —       | Limit files to scan                     |
| `maxFileSize`     | number   | 1MB     | Skip files larger than this             |
| `timeoutMs`       | number   | —       | Operation timeout                       |
| `skipBinary`      | boolean  | true    | Skip binary files                       |

**Example:** `search_content(path, pattern="export (function|class)", filePattern="**/*.ts", contextLines=2)`

### `read_file`

Read a single file with optional line selection.

| Parameter   | Type   | Default | Description                                 |
| ----------- | ------ | ------- | ------------------------------------------- |
| `path`      | string | —       | File to read                                |
| `encoding`  | enum   | "utf-8" | `utf-8`, `ascii`, `base64`, `hex`, `latin1` |
| `maxSize`   | number | 10MB    | Maximum file size                           |
| `head`      | number | —       | Read first N lines only                     |
| `tail`      | number | —       | Read last N lines only                      |
| `lineStart` | number | —       | Start line (1-indexed)                      |
| `lineEnd`   | number | —       | End line (inclusive)                        |

**⚠️ Cannot combine:** `head`/`tail` with `lineStart`/`lineEnd`

### `read_multiple_files`

**Preferred for 2+ files** — runs in parallel, individual failures don't block others.

| Parameter  | Type     | Default | Description             |
| ---------- | -------- | ------- | ----------------------- |
| `paths`    | string[] | —       | Files to read (max 100) |
| `encoding` | enum     | "utf-8" | Encoding for all files  |
| `maxSize`  | number   | 10MB    | Max size per file       |
| `head`     | number   | —       | First N lines from each |
| `tail`     | number   | —       | Last N lines from each  |

### `get_file_info`

Metadata only: size, timestamps, permissions, MIME type.

| Parameter | Type   | Description       |
| --------- | ------ | ----------------- |
| `path`    | string | File or directory |

### `read_media_file`

Returns binary files as base64 with MIME type. Includes image dimensions.

| Parameter | Type   | Default | Description        |
| --------- | ------ | ------- | ------------------ |
| `path`    | string | —       | Path to media file |
| `maxSize` | number | 50MB    | Maximum file size  |

---

## Efficiency Best Practices

### ✅ Do

- **Batch reads**: Use `read_multiple_files` for 2+ files
- **Limit scope**: Always set `maxResults`, `maxDepth`, `maxEntries`
- **Exclude noise**: Use `excludePatterns=["node_modules", ".git", "dist"]`
- **Preview large files**: Use `head=50` or `tail=50` before full read
- **Search then read**: `search_files` → `read_multiple_files`

### ❌ Don't

- Call `read_file` in a loop — use `read_multiple_files`
- Use `recursive=true` without `maxDepth` on large directories
- Search with `maxResults` unset on large codebases
- Read entire large files when you only need a section

---

## Common Workflows

### Project Discovery

```text
list_allowed_directories
directory_tree(path, maxDepth=3, excludePatterns=["node_modules",".git"])
analyze_directory(path, excludePatterns=["node_modules"])
read_multiple_files([package.json, README.md, tsconfig.json])
```

### Find and Read Code

```text
search_files(path, pattern="**/*.service.ts")
read_multiple_files([...results])
```

### Search Code Patterns

```text
search_content(path, pattern="async function", filePattern="**/*.ts", contextLines=2)
```

### Investigate Large Files

```text
analyze_directory(path)  → See largestFiles
get_file_info(largefile) → Check exact size
read_file(largefile, head=100) → Preview beginning
```

---

## Error Recovery

| Error Code          | Meaning                       | Solution                                    |
| ------------------- | ----------------------------- | ------------------------------------------- |
| `E_ACCESS_DENIED`   | Path outside allowed dirs     | Run `list_allowed_directories`              |
| `E_NOT_FOUND`       | Path doesn't exist            | Use `list_directory` to explore             |
| `E_NOT_FILE`        | Expected file, got directory  | Use `list_directory` or `directory_tree`    |
| `E_NOT_DIRECTORY`   | Expected directory, got file  | Use `read_file` or `get_file_info`          |
| `E_TOO_LARGE`       | File exceeds size limit       | Use `head`/`tail` or increase `maxSize`     |
| `E_BINARY_FILE`     | Binary file in text operation | Use `read_media_file` instead               |
| `E_TIMEOUT`         | Operation too slow            | Reduce `maxResults`, `maxDepth`, `maxFiles` |
| `E_INVALID_PATTERN` | Bad glob/regex syntax         | Check pattern syntax                        |

---

## Security Notes

- **Read-only**: No writes, deletes, or modifications possible
- **Path validation**: Symlinks cannot escape allowed directories
- **Binary detection**: Prevents accidental large base64 in text output
