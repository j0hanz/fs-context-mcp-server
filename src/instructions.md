# FS Context MCP Server

> Read-only tools for exploring directories, searching files, and reading
> content via the Model Context Protocol (MCP).

This server lets assistants inspect files safely. All operations are limited to
explicitly allowed directories and never write to disk.

---

## Quick Reference

| Goal                | Tool        | Key Parameters                    |
| ------------------- | ----------- | --------------------------------- |
| Check access        | `roots`     | -                                 |
| List contents       | `ls`        | `path`                            |
| Find files          | `find`      | `pattern` (glob), `maxResults`    |
| Search in files     | `grep`      | `pattern` (regex), `contextLines` |
| Read file           | `read`      | `head`                            |
| Read multiple files | `read_many` | `paths[]` - preferred for 2+      |
| File metadata       | `stat`      | `path`                            |
| Batch file metadata | `stat_many` | `paths[]` - preferred for 2+      |

---

## Core Concepts

- **Allowed directories:** All tools only operate inside the allowed roots.
  Run `roots` first to confirm scope.
- **Globs vs regex:** `find` uses glob patterns, `grep` uses
  regex (set `isLiteral=true` to search for exact text).
- **Symlinks:** Symlinks are never followed for security.

---

## Workflows

### Project discovery

```text
roots
ls(path=".")
read_many(["package.json", "README.md"])
```

### Find and read code

```text
find(pattern="**/*.ts")
read_many([...results])
```

### Search patterns in code

```text
grep(pattern="TODO|FIXME", filePattern="**/*.ts", contextLines=2)
```

---

## Common Glob Patterns

| Pattern               | Matches                                   |
| --------------------- | ----------------------------------------- |
| `**/*.ts`             | All TypeScript files                      |
| `src/**/*.{js,jsx}`   | JS/JSX files under `src/`                 |
| `**/test/**`          | All files in any `test/` directory        |
| `**/*.test.ts`        | Test files by naming convention           |
| `!**/node_modules/**` | Exclude `node_modules/` (use in excludes) |

---

## Best Practices

**Do:**

- Use `read_many` for 2+ files (parallel, resilient).
- Set `maxResults` limits on searches for large codebases.
- Preview large files with `head=50` before full reads.

**Don't:**

- Loop `read` for multiple files.
- Search without `maxResults` on large codebases.

---

## Tool Details

### `roots`

List all directories this server can access.

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| (none)    | -       | -           |

---

### `ls`

List the immediate contents of a directory (non-recursive). Returns entry name,
relative path, type, size, and modified date. Symlinks are not followed.

| Parameter | Default | Description    |
| --------- | ------- | -------------- |
| `path`    | -       | Directory path |

For recursive or filtered file searches, use `find` instead.

---

### `find`

Find files using glob patterns. Automatically excludes common dependency/build
directories (node_modules, dist, .git, etc.).

| Parameter    | Default | Description               |
| ------------ | ------- | ------------------------- |
| `path`       | -       | Base directory            |
| `pattern`    | -       | Glob: `**/*.ts`, `src/**` |
| `maxResults` | 100     | Limit (up to 10,000)      |

---

### `grep`

Grep-like search across file contents using regex.

| Parameter       | Default | Description                          |
| --------------- | ------- | ------------------------------------ |
| `path`          | -       | Base directory                       |
| `pattern`       | -       | Regex: `TODO\|FIXME`                 |
| `filePattern`   | `**/*`  | Glob filter for files                |
| `caseSensitive` | false   | Case-sensitive matching              |
| `isLiteral`     | false   | Treat pattern as literal string      |
| `maxResults`    | 100     | Maximum matches to return            |
| `contextLines`  | 0       | Lines of context before/after (0-10) |

---

### `read`

Read a single text file.

| Parameter | Default | Description   |
| --------- | ------- | ------------- |
| `path`    | -       | File path     |
| `head`    | -       | First N lines |

---

### `read_many`

Read multiple files in parallel. Each file reports success or error.

| Parameter | Default | Description     |
| --------- | ------- | --------------- |
| `paths`   | -       | Array (max 100) |
| `head`    | -       | First N lines   |

---

### `stat`

Get metadata about a file or directory without reading contents.

| Parameter | Default | Description               |
| --------- | ------- | ------------------------- |
| `path`    | -       | Path to file or directory |

Returns: name, path, type, size, modified, mimeType, symlinkTarget.

---

### `stat_many`

Get metadata for multiple files/directories in parallel.

| Parameter | Default | Description              |
| --------- | ------- | ------------------------ |
| `paths`   | -       | Array of paths (max 100) |

---

## Error Codes

| Code                  | Cause                        | Solution               |
| --------------------- | ---------------------------- | ---------------------- |
| `E_ACCESS_DENIED`     | Path outside allowed dirs    | Check `roots`          |
| `E_NOT_FOUND`         | Path does not exist          | Verify path with `ls`  |
| `E_NOT_FILE`          | Expected file, got directory | Use `ls` instead       |
| `E_NOT_DIRECTORY`     | Expected directory, got file | Use `read` instead     |
| `E_TOO_LARGE`         | File exceeds size limit      | Use `head` for partial |
| `E_TIMEOUT`           | Operation took too long      | Use `maxResults`       |
| `E_INVALID_PATTERN`   | Malformed glob/regex         | Check pattern syntax   |
| `E_PERMISSION_DENIED` | OS-level access denied       | Check file permissions |

---

## Security

- Read-only: no writes, deletes, or modifications.
- Path validation: symlinks cannot escape allowed directories.
- Binary detection: prevents accidental binary reads.
- Input sanitization: patterns validated for ReDoS protection.
