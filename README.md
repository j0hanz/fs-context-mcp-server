# FS Context MCP Server

<img src="docs/logo.png" alt="FS Context MCP Server Logo" width="125">

A read-only MCP server that provides AI assistants with secure filesystem access for exploring, searching, and reading files within approved directories.

[![npm version](https://img.shields.io/npm/v/@j0hanz/fs-context-mcp.svg)](https://www.npmjs.com/package/@j0hanz/fs-context-mcp)
[![License](https://img.shields.io/npm/l/@j0hanz/fs-context-mcp)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.17.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.25.2-purple)](https://modelcontextprotocol.io)

## One-Click Install

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=fs-context&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%2C%22%24%7BworkspaceFolder%7D%22%5D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=fs-context&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%2C%22%24%7BworkspaceFolder%7D%22%5D%7D&quality=insiders)

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=fs-context&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovZnMtY29udGV4dC1tY3BAbGF0ZXN0IiwiJHt3b3Jrc3BhY2VGb2xkZXJ9Il19)

## Overview

This server enables AI assistants to navigate your filesystem through a set of read-only tools:

- Explore directory structures with `ls` and `tree`
- Find files using glob patterns with `find`
- Search file contents with `grep`
- Read files with options for previews, line ranges, and batch operations
- Access file metadata through `stat` and `stat_many`

All operations are restricted to explicitly approved directories, with no write or modification capabilities.

## Features

### Directory Operations

- List directory contents with `ls`
- Render directory trees with configurable depth using `tree`
- Find files by glob patterns with `find`

### File Operations

- Read single files with optional line ranges or head preview
- Batch read up to 100 files in a single operation
- Get file metadata (size, timestamps, permissions) with `stat` and `stat_many`

### Search

- Content search across files using `grep`
- Respects root `.gitignore` patterns and common ignore directories
- Configurable search timeout and worker threads

### Security

- Read-only operations only
- Access restricted to explicitly approved directories
- Path traversal protection (blocks `..` and symlink escapes)
- RE2-based regex engine prevents ReDoS attacks
- Sensitive files (e.g., `.env`, `.npmrc`) are blocked by default; override via env allowlist

## When to Use

| Task                            | Tool        |
| ------------------------------- | ----------- |
| Explore project structure       | `ls`        |
| Render a directory tree         | `tree`      |
| Find files                      | `find`      |
| Search for code patterns/text   | `grep`      |
| Read source code                | `read`      |
| Batch read multiple files       | `read_many` |
| Get file metadata (size, dates) | `stat`      |
| Batch get file metadata         | `stat_many` |
| Check available directories     | `roots`     |

## Quick Start

### NPX (Recommended)

**For current directory:**

```bash
npx -y @j0hanz/fs-context-mcp@latest --allow-cwd
```

**For specific projects:**

```bash
npx -y @j0hanz/fs-context-mcp@latest /path/to/project /path/to/docs
```

> **Note:** If your MCP client supports the Roots protocol, you can omit directory arguments—the client will provide them automatically.

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "${workspaceFolder}"]
    }
  }
}
```

## Installation

### NPX

Run without installation:

```bash
npx -y @j0hanz/fs-context-mcp@latest /path/to/dir1 /path/to/dir2
```

### Global Installation

For permanent setup across all projects:

```bash
npm install -g @j0hanz/fs-context-mcp
fs-context-mcp /path/to/your/project
```

### From Source

For contributors or custom builds:

```bash
git clone https://github.com/j0hanz/fs-context-mcp-server.git
cd fs-context-mcp-server
npm install
npm run build
node dist/index.js /path/to/your/project
```

## Directory Access and Resolution

Access is always restricted to explicitly allowed directories.

1. CLI directories are validated and added first (if provided).
2. `--allow-cwd` optionally adds the current working directory.
3. MCP Roots from the client are used next:
   - If CLI and/or `--allow-cwd` are provided, only roots inside those baseline directories are accepted.
   - If no baseline is provided, roots become the allowed directories.
4. If nothing is configured and the client provides no roots, the server starts with no accessible directories and logs a warning until roots are provided.

Notes:

- Windows drive-relative paths like `C:path` are rejected. Use `C:\path` or `C:/path`.
- Reserved Windows device names (e.g., `CON`, `NUL`) are blocked.
- If multiple roots are configured, tools require an explicit `path` to disambiguate.

## Configuration

All configuration is optional. Sizes in bytes, timeouts in milliseconds.

### Environment Variables

| Variable                     | Default           | Description                                                       |
| ---------------------------- | ----------------- | ----------------------------------------------------------------- |
| `MAX_FILE_SIZE`              | 10MB              | Max file size for read operations (range: 1MB-100MB)              |
| `MAX_READ_MANY_TOTAL_SIZE`   | 512KB             | Max combined size for `read_many` (range: 10KB-100MB)             |
| `MAX_SEARCH_SIZE`            | 1MB               | Max file size for content search (range: 100KB-10MB)              |
| `DEFAULT_SEARCH_TIMEOUT`     | 30000             | Timeout for search/list operations (range: 100-3600000ms)         |
| `FS_CONTEXT_SEARCH_WORKERS`  | min(cpu cores, 8) | Search worker threads (range: 0-16; 0 disables)                   |
| `FS_CONTEXT_ALLOW_SENSITIVE` | false             | Allow reading sensitive files (set to `true` to disable denylist) |
| `FS_CONTEXT_DENYLIST`        | (empty)           | Additional denylist patterns (comma-separated globs)              |
| `FS_CONTEXT_ALLOWLIST`       | (empty)           | Allowlist patterns that override denylist (comma-separated globs) |
| `FS_CONTEXT_TOOL_LOG_ERRORS` | false             | Log tool failures to stderr with duration                         |

See [CONFIGURATION.md](CONFIGURATION.md) for examples and CLI usage.

### Sensitive File Policy

By default, reads and content searches are blocked for common secret filenames to reduce accidental leakage. The default denylist includes patterns like `.env`, `.npmrc`, `.aws/credentials`, `*.pem`, and `.mcpregistry_*_token`.

You can customize with:

- `FS_CONTEXT_ALLOW_SENSITIVE=true` to disable the default denylist.
- `FS_CONTEXT_DENYLIST` to add extra deny patterns (comma-separated globs using `*`).
- `FS_CONTEXT_ALLOWLIST` to allow specific paths even if they match the denylist.

## Resources

This server exposes standard MCP resources to provide static documentation and handle large content efficiently.

| Resource URI               | Description                                                                         |
| :------------------------- | :---------------------------------------------------------------------------------- |
| `internal://instructions`  | Returns the detailed usage instructions (Markdown) for this server.                 |
| `fs-context://result/{id}` | Access to large file content or search results that were truncated in tool outputs. |

**Note on Large Outputs:**
Tools like `read`, `read_many`, and `grep` automatically cache content exceeding value limits (default 20k chars). In these cases, the tool returns a preview and a `resource_link` (URI) that can be read by the client to retrieve the full content.

## Tools

All tools return both human-readable text and structured JSON. Structured
responses include `ok`, optional `error` (with `code`, `message`, `path`,
`suggestion`), plus the tool-specific fields documented below.

### `roots`

List all directories that this server can access.

| Parameter | Type | Required | Default | Description |
| --------- | ---- | -------- | ------- | ----------- |
| (none)    | -    | -        | -       | -           |

Returns: Allowed directory paths. Structured output includes `ok` and
`directories`.

---

### `ls`

List the immediate contents of a directory (non-recursive). Omit `path` to use
the sole allowed root (when only one root is configured).

| Parameter       | Type    | Required | Default     | Description                                             |
| --------------- | ------- | -------- | ----------- | ------------------------------------------------------- |
| `path`          | string  | No       | `only root` | Directory path to list (omit when only one root exists) |
| `includeHidden` | boolean | No       | `false`     | Include hidden files and directories                    |

Returns: Entries with name, relativePath, type, size, and modified time.
Structured output includes `ok`, `path`, `entries`, and `totalEntries`.

---

### `find`

Search for files using glob patterns. Omit `path` to search from the sole
allowed root (when only one root is configured). By default, `find` excludes common dependency/build directories
(node_modules, dist, .git, etc.); set `includeIgnored: true` to include ignored
directories and disable built-in excludes.

| Parameter        | Type    | Required | Default     | Description                                                    |
| ---------------- | ------- | -------- | ----------- | -------------------------------------------------------------- |
| `path`           | string  | No       | `only root` | Base directory to search from (omit when only one root exists) |
| `pattern`        | string  | Yes      | -           | Glob pattern (e.g., `**/*.ts`, `src/**/*.js`)                  |
| `includeIgnored` | boolean | No       | `false`     | Include ignored dirs and disable built-in excludes             |
| `maxResults`     | number  | No       | `100`       | Maximum matches to return (1-10000)                            |

Notes:

- When `includeIgnored=false`, results also respect a root `.gitignore` file (if present under the base `path`).
- Nested `.gitignore` files are not parsed.

Returns: Matching paths (relative) with size and modified date. Structured
output includes `ok`, `results`, `totalMatches`, and `truncated`.

---

### `tree`

Render a directory tree (bounded recursion). Omit `path` to use the sole
allowed root (when only one root is configured).

- `path` (string, optional; default: `only root`): Base directory to render
- `maxDepth` (number, optional; default: `5`): Maximum recursion depth (0 = just the root)
- `maxEntries` (number, optional; default: `1000`): Maximum number of entries before truncating
- `includeHidden` (boolean, optional; default: `false`): Include hidden files/directories
- `includeIgnored` (boolean, optional; default: `false`): Include ignored dirs and disable built-in + `.gitignore` filtering

Notes:

- When `includeIgnored=false`, the tree respects both built-in ignore rules (e.g., `node_modules`, `dist`, `.git`) and a root `.gitignore` file (if present).

Returns: ASCII tree output plus a structured JSON tree (`ok`, `root`, `tree`,
`ascii`, `truncated`, `totalEntries`).

---

### `read`

Read the contents of a text file.

| Parameter   | Type   | Required | Default | Description                    |
| ----------- | ------ | -------- | ------- | ------------------------------ |
| `path`      | string | Yes      | -       | File path to read              |
| `head`      | number | No       | -       | Read only first N lines        |
| `startLine` | number | No       | -       | 1-based start line (inclusive) |
| `endLine`   | number | No       | -       | 1-based end line (inclusive)   |

Notes:

- Reads are UTF-8 text only; binary files are rejected.
- Full reads are capped by `MAX_FILE_SIZE` (default 10MB). When `head` is set,
  output stops at the line limit or size budget, whichever comes first.
- `head` cannot be combined with `startLine`/`endLine`.
- If the content exceeds a size limit (default 20k chars), the tool returns a `resource_link` instead of inline content.

Returns: File content plus structured metadata (`ok`, `path`, `content`,
`truncated`, `totalLines`, and range metadata when applicable).

---

### `read_many`

Read multiple files in parallel.

| Parameter   | Type     | Required | Default | Description                             |
| ----------- | -------- | -------- | ------- | --------------------------------------- |
| `paths`     | string[] | Yes      | -       | Array of file paths (max 100)           |
| `head`      | number   | No       | -       | Read only first N lines of each file    |
| `startLine` | number   | No       | -       | 1-based start line (inclusive) per file |
| `endLine`   | number   | No       | -       | 1-based end line (inclusive) per file   |

Notes:

- Reads files as UTF-8 text; binary files are not filtered. Max size per file
  is capped by `MAX_FILE_SIZE` (default 10MB).
- Total read budget across all files is capped by `MAX_READ_MANY_TOTAL_SIZE`.
- No binary detection is performed; use `read` for single-file safety checks.
- `head` cannot be combined with `startLine`/`endLine`.
- If any file content exceeds the inline limit, it is returned as a `resource_link`.

Returns: Per-file content or error, plus structured summary (`total`,
`succeeded`, `failed`).

---

### `stat`

Get detailed metadata about a file or directory.

| Parameter | Type   | Required | Default | Description               |
| --------- | ------ | -------- | ------- | ------------------------- |
| `path`    | string | Yes      | -       | Path to file or directory |

Returns: name, path, type, size, timestamps (created/modified/accessed),
permissions, hidden status, MIME type (for files), and symlink target (if
applicable). Structured results may include `tokenEstimate` (rule of thumb:
ceil(size/4)).

---

### `stat_many`

Get metadata for multiple files/directories in parallel.

| Parameter | Type     | Required | Default | Description                       |
| --------- | -------- | -------- | ------- | --------------------------------- |
| `paths`   | string[] | Yes      | -       | Array of paths to query (max 100) |

Returns: Array of file info with individual success/error status, plus summary
(total, succeeded, failed).

---

### `grep`

Search for text content within files.

- Omit `path` to search from the first allowed root.
- Pass a file path in `path` to search only that file.

`pattern` is treated as a literal string and matched case-insensitively.

| Parameter       | Type    | Required | Default     | Description                                                               |
| --------------- | ------- | -------- | ----------- | ------------------------------------------------------------------------- |
| `path`          | string  | No       | `only root` | Base directory or file path to search in (omit when only one root exists) |
| `pattern`       | string  | Yes      | -           | Text pattern to search for                                                |
| `includeHidden` | boolean | No       | `false`     | Include hidden files and directories                                      |

Example (search a single file):

```json
{ "path": "src/transform.ts", "pattern": "TODO" }
```

Returns: Matching lines with file path, line number, content, and optional
context.

Notes:

- `grep` skips binary files by default.
- Very large files are skipped based on `MAX_SEARCH_SIZE` (default 1MB).
  “No matches” is not proof the text is absent from skipped files.

Note: the `grep` tool currently exposes only `path`, `pattern`, and
`includeHidden`. Context fields are omitted unless enabled internally.

Structured output includes `ok`, `matches`, `totalMatches`, and `truncated`.
Matched line content is trimmed to 200 characters.

---

Built-in exclude list: `grep` skips common dependency/build/output directories
and files: `node_modules`, `dist`, `build`, `coverage`, `.git`, `.vscode`,
`.idea`, `.DS_Store`, `.next`, `.nuxt`, `.output`, `.svelte-kit`, `.cache`,
`.yarn`, `jspm_packages`, `bower_components`, `out`, `tmp`, `.temp`,
`npm-debug.log`, `yarn-debug.log`, `yarn-error.log`, `Thumbs.db`.

## Error Codes

| Code                    | Meaning                       |
| ----------------------- | ----------------------------- |
| `E_ACCESS_DENIED`       | Path outside allowed roots    |
| `E_NOT_FOUND`           | Path does not exist           |
| `E_NOT_FILE`            | Expected file, got directory  |
| `E_NOT_DIRECTORY`       | Expected directory, got file  |
| `E_TOO_LARGE`           | File exceeds size limits      |
| `E_TIMEOUT`             | Operation timed out           |
| `E_INVALID_PATTERN`     | Invalid glob/regex pattern    |
| `E_INVALID_INPUT`       | Invalid argument(s)           |
| `E_PERMISSION_DENIED`   | OS-level permission denied    |
| `E_SYMLINK_NOT_ALLOWED` | Symlink escapes allowed roots |
| `E_UNKNOWN`             | Unexpected error              |

## Client Configuration

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/mcp.json` (recommended) or `.vscode/settings.json`:

```json
{
  "servers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "${workspaceFolder}"]
    }
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "C:\\path\\to\\project"]
    }
  }
}
```

If your client supports MCP Roots, you can omit the path. Otherwise, pass a path or `--allow-cwd`.

</details>

<details>
<summary><b>Cursor</b></summary>

Add to Cursor's MCP configuration:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "${workspaceFolder}"]
    }
  }
}
```

</details>

<details>
<summary><b>Codex</b></summary>

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.fs-context]
command = "npx"
args = ["-y", "@j0hanz/fs-context-mcp@latest", "/path/to/your/project"]
```

If your client supports MCP Roots, you can omit the path. Otherwise, pass a path or `--allow-cwd`.

</details>

<details>
<summary><b>Windsurf</b></summary>

Add to Windsurf's MCP configuration:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "${workspaceFolder}"]
    }
  }
}
```

</details>

## Security Details

This server implements multiple layers of security:

| Protection                | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| Access control            | Only explicitly allowed directories are accessible            |
| Path validation           | All paths are validated before any filesystem operation       |
| Symlink protection        | Symlinks that resolve outside allowed directories are blocked |
| Path traversal prevention | Attempts to escape via `..` are detected and blocked          |
| Read-only operations      | No writes, deletes, or modifications                          |
| Safe regex                | Regex validation with RE2 prevents ReDoS                      |
| Size limits               | Configurable limits prevent resource exhaustion               |

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm

### Scripts

| Command                 | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run build`         | Compile TypeScript to JavaScript                                   |
| `npm run dev`           | Watch mode with tsx                                                |
| `npm run start`         | Run compiled server                                                |
| `npm run test`          | Run tests (node --test with tsx/esm)                               |
| `npm run test:watch`    | Run tests in watch mode (node --test --watch)                      |
| `npm run test:coverage` | Run tests with coverage (node --test --experimental-test-coverage) |
| `npm run test:node`     | Run node-tests (isolated checks)                                   |
| `npm run lint`          | Run ESLint                                                         |
| `npm run format`        | Format code with Prettier                                          |
| `npm run type-check`    | TypeScript type checking                                           |
| `npm run inspector`     | Test with MCP Inspector                                            |

### Project Structure

```text
src/
  index.ts                 # CLI entry point
  server.ts                # MCP server wiring and roots handling
  tools.ts                 # MCP tool registration + response helpers
  schemas.ts               # Zod input/output schemas
  config.ts                # Shared types and formatting helpers
  instructions.md          # Tool usage instructions (bundled in dist)
  lib/                     # Core logic and filesystem operations
  __tests__/               # node:test + tsx tests
node-tests/                # Additional Node.js checks
docs/                      # Static docs assets
dist/                      # Build output (generated)
```

## Troubleshooting

| Issue                    | Solution                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- |
| "Access denied" error    | Ensure the path is within an allowed directory. Use `roots` to check.        |
| "Path does not exist"    | Verify the path exists. Use `ls` to explore available files.                 |
| "File too large"         | Use `head` or increase `MAX_FILE_SIZE`.                                      |
| "Binary file" warning    | `read` only supports UTF-8 text and rejects binary files.                    |
| No directories available | Pass explicit paths, use `--allow-cwd`, or ensure the client provides Roots. |
| Symlink blocked          | Symlinks that resolve outside allowed directories are blocked.               |
| Invalid pattern          | Simplify the pattern (note: `grep` treats `pattern` as literal text).        |

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run format, lint, type-check, build, and tests (`npm run format && npm run lint && npm run type-check && npm run build && npm run test`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Code Style

- Use TypeScript with strict mode
- Follow ESLint configuration
- Use Prettier for formatting
- Write tests for new features
