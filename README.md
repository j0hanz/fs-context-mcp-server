# FS-Context MCP Server

<img src="assets/logo.svg" alt="SuperFetch MCP Logo" width="200">

[![npm version](https://img.shields.io/npm/v/%40j0hanz%2Ffs-context-mcp)](https://www.npmjs.com/package/@j0hanz/fs-context-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-brightgreen)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26+-purple)](https://modelcontextprotocol.io/)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0078d7?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22fs-context%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22fs-context%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%5D%7D) [![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install-f79a2e?logo=claude&logoColor=white)](https://modelcontextprotocol.io/quickstart/user#2-add-the-filesystem-server) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?logo=cursor&logoColor=white)](https://cursor.com/deeplink/mcp-install?name=fs-context&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovZnMtY29udGV4dC1tY3BAbGF0ZXN0Il19)

Read-only Model Context Protocol (MCP) server for secure filesystem exploration, searching, and analysis.

## Overview

FS-Context MCP gives AI agents structured, read-only access to local filesystems through the Model Context Protocol. It provides 9 tools for navigating directory trees, reading files, searching by glob patterns or regex, and inspecting file metadata — all within configurable security boundaries. Sensitive files are blocked by default, paths are validated against allowed roots, and all output is optimized for LLM consumption with both human-readable text and structured JSON.

## Key Features

- **9 read-only tools** — directory listing, file search, content grep, tree visualization, file reading, and metadata inspection
- **Security-first design** — path validation, sensitive file blocking, symlink escape protection, configurable allow/deny lists
- **Structured + text output** — every tool returns both human-readable text and machine-parseable `structuredContent` JSON
- **Batch operations** — read up to 100 files or stat up to 100 paths in a single request
- **Large output handling** — content exceeding 20KB is externalized to MCP resources with inline previews
- **Multi-root workspaces** — supports multiple allowed directories via CLI args or MCP Roots protocol
- **Worker-based search** — parallel content search using configurable worker threads with RE2 regex
- **Configurable limits** — file sizes, timeouts, and search parameters are tunable via environment variables

## Tech Stack

| Component       | Version                             |
| --------------- | ----------------------------------- |
| Runtime         | Node.js >= 24                       |
| Language        | TypeScript 5.9                      |
| MCP SDK         | `@modelcontextprotocol/sdk` ^1.26.0 |
| Validation      | Zod 4.x (`z.strictObject`)          |
| Regex Engine    | RE2 (via `re2`) + `safe-regex2`     |
| Gitignore       | `ignore` ^7.0.5                     |
| Package Manager | npm                                 |

## Repository Structure

```text
├── src/
│   ├── index.ts              # CLI entrypoint, signal handling, shutdown
│   ├── server.ts             # McpServer setup, roots management, transport
│   ├── tools.ts              # Tool registration orchestrator
│   ├── schemas.ts            # Zod input/output schemas for all tools
│   ├── config.ts             # Type definitions, error codes, formatters
│   ├── resources.ts          # MCP resource registration
│   ├── instructions.md       # Server instructions (loaded at startup)
│   ├── tools/                # Individual tool implementations
│   │   ├── roots.ts          # roots tool
│   │   ├── list-directory.ts # ls tool
│   │   ├── search-files.ts   # find tool
│   │   ├── tree.ts           # tree tool
│   │   ├── read.ts           # read tool
│   │   ├── read-multiple.ts  # read_many tool
│   │   ├── stat.ts           # stat tool
│   │   ├── stat-many.ts      # stat_many tool
│   │   ├── search-content.ts # grep tool
│   │   └── shared.ts         # Shared tool utilities
│   └── lib/                  # Core utilities
│       ├── constants.ts      # Defaults, env var parsing, exclude patterns
│       ├── errors.ts         # Error classification, McpError
│       ├── fs-helpers.ts     # File I/O, abort signals, binary detection
│       ├── path-validation.ts # Path security, root enforcement
│       ├── path-policy.ts    # Sensitive file policy
│       ├── resource-store.ts # In-memory resource cache
│       ├── observability.ts  # Tool diagnostics/tracing
│       └── file-operations/  # File operation implementations
├── scripts/
│   └── tasks.mjs             # Build, test, type-check tasks
├── assets/
│   └── logo.svg              # Server icon
├── package.json
└── tsconfig.json
```

## Requirements

- **Node.js >= 24**

## Quickstart

```bash
npx -y @j0hanz/fs-context-mcp@latest /path/to/your/project
```

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "/path/to/your/project"]
    }
  }
}
```

## Installation

### NPX (recommended)

No installation required:

```bash
npx -y @j0hanz/fs-context-mcp@latest /path/to/dir
```

### Global Install

```bash
npm install -g @j0hanz/fs-context-mcp
fs-context-mcp /path/to/dir
```

### From Source

```bash
git clone https://github.com/j0hanz/fs-context-mcp-server.git
cd fs-context-mcp-server
npm ci
npm run build
node dist/index.js /path/to/dir
```

## Configuration

### CLI Arguments

```text
fs-context-mcp [options] [directories...]
```

| Argument         | Type       | Default  | Description                                               |
| ---------------- | ---------- | -------- | --------------------------------------------------------- |
| `directories...` | positional | _(none)_ | One or more directory paths to allow access to            |
| `--allow-cwd`    | boolean    | `false`  | Allow the current working directory as an additional root |

If no directories are provided, the server uses MCP Roots from the client (or cwd if `--allow-cwd` is set).

### Environment Variables

| Variable                     | Default            | Range                   | Description                                         |
| ---------------------------- | ------------------ | ----------------------- | --------------------------------------------------- |
| `MAX_FILE_SIZE`              | `10485760` (10 MB) | 1 MB – 100 MB           | Maximum file size for `read` / `read_many`          |
| `MAX_SEARCH_SIZE`            | `1048576` (1 MB)   | 100 KB – 10 MB          | Maximum file size for `grep` to scan                |
| `MAX_READ_MANY_TOTAL_SIZE`   | `524288` (512 KB)  | 10 KB – 100 MB          | Total content budget for `read_many`                |
| `DEFAULT_SEARCH_TIMEOUT`     | `30000` (30 s)     | 100 ms – 3,600,000 ms   | Timeout for search operations                       |
| `FS_CONTEXT_SEARCH_WORKERS`  | min(CPU cores, 8)  | 0 – 16                  | Number of search worker threads                     |
| `FS_CONTEXT_ALLOW_SENSITIVE` | `false`            | `true` / `false`        | Allow reading sensitive files (`.env`, keys, certs) |
| `FS_CONTEXT_DENYLIST`        | _(empty)_          | comma/newline separated | Additional file patterns to block                   |
| `FS_CONTEXT_ALLOWLIST`       | _(empty)_          | comma/newline separated | File patterns to explicitly allow                   |

## Usage

FS-Context MCP uses **stdio** transport exclusively. Connect via any MCP client that supports stdio:

```bash
# Direct invocation
npx -y @j0hanz/fs-context-mcp@latest /path/to/project

# With environment variables
MAX_FILE_SIZE=52428800 DEFAULT_SEARCH_TIMEOUT=60000 npx -y @j0hanz/fs-context-mcp@latest /path/to/project

# Using MCP Inspector for debugging
npx @modelcontextprotocol/inspector npx -y @j0hanz/fs-context-mcp@latest /path/to/project
```

## MCP Surface

### Tools

#### `roots`

List the workspace roots this server can access. Call this first to see available directories. All other tools only work within these directories.

| Parameter | Type | Required | Default | Description         |
| --------- | ---- | -------- | ------- | ------------------- |
| _(none)_  | —    | —        | —       | No input parameters |

Returns:

```json
{
  "ok": true,
  "directories": ["/path/to/project"]
}
```

---

#### `ls`

List the immediate contents of a directory (non-recursive). Returns name, relative path, type, size, and modified date.

| Parameter        | Type    | Required | Default        | Description                                                  |
| ---------------- | ------- | -------- | -------------- | ------------------------------------------------------------ |
| `path`           | string  | no       | workspace root | Base directory for the operation                             |
| `includeHidden`  | boolean | no       | `false`        | Include hidden files and directories                         |
| `includeIgnored` | boolean | no       | `false`        | Include ignored directories (node_modules, dist, .git, etc.) |

Returns:

```json
{
  "ok": true,
  "path": "/project",
  "entries": [
    {
      "name": "src",
      "relativePath": "src",
      "type": "directory",
      "size": 0,
      "modified": "2026-01-15T12:00:00.000Z"
    }
  ],
  "totalEntries": 5
}
```

---

#### `find`

Find files by glob pattern. Returns a list of matching files with metadata.

| Parameter        | Type    | Required | Default        | Description                                                             |
| ---------------- | ------- | -------- | -------------- | ----------------------------------------------------------------------- |
| `path`           | string  | no       | workspace root | Base directory for the operation                                        |
| `pattern`        | string  | **yes**  | —              | Glob pattern (e.g., `**/*.ts`, `src/**/*.js`, `*.json`). Max 1000 chars |
| `maxResults`     | integer | no       | `100`          | Maximum matches to return (1–10,000)                                    |
| `includeIgnored` | boolean | no       | `false`        | Include ignored directories                                             |

Returns:

```json
{
  "ok": true,
  "results": [
    {
      "path": "src/index.ts",
      "size": 2048,
      "modified": "2026-01-15T12:00:00.000Z"
    }
  ],
  "totalMatches": 15,
  "truncated": false
}
```

---

#### `tree`

Render a directory tree with bounded recursion. Returns an ASCII tree for quick scanning and a structured JSON tree for programmatic use.

| Parameter        | Type    | Required | Default        | Description                                  |
| ---------------- | ------- | -------- | -------------- | -------------------------------------------- |
| `path`           | string  | no       | workspace root | Base directory for the operation             |
| `maxDepth`       | integer | no       | `5`            | Maximum depth to recurse (0–50)              |
| `maxEntries`     | integer | no       | `1000`         | Maximum entries before truncating (1–20,000) |
| `includeHidden`  | boolean | no       | `false`        | Include hidden files and directories         |
| `includeIgnored` | boolean | no       | `false`        | Include ignored directories                  |

Returns:

```json
{
  "ok": true,
  "root": "/project",
  "ascii": "project\n├── src\n│   └── index.ts\n└── package.json",
  "tree": {
    "name": "project",
    "type": "directory",
    "relativePath": ".",
    "children": []
  },
  "truncated": false,
  "totalEntries": 3
}
```

---

#### `read`

Read the text contents of a file. Supports reading the first N lines (`head`), or a specific line range (`startLine`/`endLine`).

| Parameter   | Type    | Required | Default | Description                                                                            |
| ----------- | ------- | -------- | ------- | -------------------------------------------------------------------------------------- |
| `path`      | string  | **yes**  | —       | Absolute or relative path to the file                                                  |
| `head`      | integer | no       | —       | Read only the first N lines (1–100,000). Mutually exclusive with `startLine`/`endLine` |
| `startLine` | integer | no       | —       | 1-based line number to start reading from (inclusive)                                  |
| `endLine`   | integer | no       | —       | 1-based line number to stop reading at (inclusive). Requires `startLine`               |

Returns:

```json
{
  "ok": true,
  "path": "src/index.ts",
  "content": "#!/usr/bin/env node\n...",
  "readMode": "full",
  "totalLines": 100,
  "linesRead": 100,
  "hasMoreLines": false,
  "truncated": false
}
```

---

#### `read_many`

Read multiple text files in a single request. Returns contents and metadata for each file.

| Parameter   | Type     | Required | Default | Description                                          |
| ----------- | -------- | -------- | ------- | ---------------------------------------------------- |
| `paths`     | string[] | **yes**  | —       | Array of file paths (1–100 files)                    |
| `head`      | integer  | no       | —       | Read only the first N lines of each file             |
| `startLine` | integer  | no       | —       | 1-based start line for each file                     |
| `endLine`   | integer  | no       | —       | 1-based end line for each file. Requires `startLine` |

Returns:

```json
{
  "ok": true,
  "results": [
    {
      "path": "src/index.ts",
      "content": "...",
      "readMode": "full",
      "totalLines": 100,
      "linesRead": 100,
      "hasMoreLines": false
    }
  ],
  "summary": { "total": 2, "succeeded": 2, "failed": 0 }
}
```

---

#### `stat`

Get metadata (size, modified time, permissions, MIME type) for a file or directory.

| Parameter | Type   | Required | Default | Description                                    |
| --------- | ------ | -------- | ------- | ---------------------------------------------- |
| `path`    | string | **yes**  | —       | Absolute or relative path to file or directory |

Returns:

```json
{
  "ok": true,
  "info": {
    "name": "index.ts",
    "path": "/project/src/index.ts",
    "type": "file",
    "size": 2048,
    "tokenEstimate": 512,
    "created": "2026-01-01T00:00:00.000Z",
    "modified": "2026-01-15T12:00:00.000Z",
    "accessed": "2026-02-08T00:00:00.000Z",
    "permissions": "rw-r--r--",
    "isHidden": false,
    "mimeType": "text/typescript"
  }
}
```

---

#### `stat_many`

Get metadata for multiple files or directories in one request.

| Parameter | Type     | Required | Default | Description                              |
| --------- | -------- | -------- | ------- | ---------------------------------------- |
| `paths`   | string[] | **yes**  | —       | Array of file or directory paths (1–100) |

Returns:

```json
{
  "ok": true,
  "results": [
    {
      "path": "src",
      "info": { "name": "src", "type": "directory", "size": 0, "...": "..." }
    }
  ],
  "summary": { "total": 2, "succeeded": 2, "failed": 0 }
}
```

---

#### `grep`

Search for text within file contents. By default this is a literal substring match; set `isRegex=true` to use RE2 regular expressions. Returns matching lines with context. Skips binary files and files larger than `MAX_SEARCH_SIZE`.

| Parameter       | Type    | Required | Default        | Description                                                                                              |
| --------------- | ------- | -------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `path`          | string  | no       | workspace root | Base directory or single file to search                                                                  |
| `pattern`       | string  | **yes**  | —              | Text (or regex if `isRegex=true`) to search for (max 1000 chars). Examples: `console\.log`, `class User` |
| `isRegex`       | boolean | no       | `false`        | Treat `pattern` as a regular expression (RE2)                                                            |
| `includeHidden` | boolean | no       | `false`        | Include hidden files and directories                                                                     |

Notes: RE2 does not support backreferences or lookahead assertions. If your pattern uses those features, `grep` will reject it.

Returns:

```json
{
  "ok": true,
  "matches": [
    {
      "file": "src/server.ts",
      "line": 42,
      "content": "  const server = new McpServer({",
      "matchCount": 1,
      "contextBefore": ["..."],
      "contextAfter": ["..."]
    }
  ],
  "totalMatches": 5,
  "truncated": false
}
```

When results exceed 50 matches, a preview is returned inline and full results are stored as an MCP resource (`fs-context://result/{id}`).

---

### Resources

| Name                | URI Pattern                | MIME Type                          | Description                                           |
| ------------------- | -------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Server Instructions | `internal://instructions`  | `text/markdown`                    | Guidance for using fs-context tools effectively       |
| Cached Tool Result  | `fs-context://result/{id}` | `text/plain` or `application/json` | Ephemeral cached output from tools with large results |

### Prompts

_No prompts are registered by this server._

## Client Configuration Examples

<details>
<summary>VS Code / VS Code Insiders</summary>

Add to your VS Code `settings.json` or `.vscode/mcp.json`:

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
<summary>Claude Desktop</summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "/path/to/your/project"]
    }
  }
}
```

</details>

<details>
<summary>Cursor</summary>

Add to Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "/path/to/your/project"]
    }
  }
}
```

Or use the [one-click install link](https://cursor.com/deeplink/mcp-install?name=fs-context&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovZnMtY29udGV4dC1tY3BAbGF0ZXN0Il19).

</details>

<details>
<summary>Windsurf</summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "/path/to/your/project"]
    }
  }
}
```

</details>

## Security

### Filesystem Boundaries

- All operations are **read-only** — no files are created, modified, or deleted.
- Paths are validated against explicitly allowed root directories using `realpath` resolution.
- Symlink targets are verified to remain within allowed roots (symlink escape protection).
- Windows reserved device names (CON, PRN, NUL, etc.) are rejected.
- Drive-relative paths (e.g., `C:path`) are blocked; only absolute paths like `C:\path` are accepted.

### Sensitive File Policy

By default, the server blocks access to sensitive files matching these patterns:

`.env`, `.env.*`, `.npmrc`, `.pypirc`, `.aws/credentials`, `.aws/config`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.cer`, `*id_rsa*`, `*id_dsa*`

Control this behavior with:

- `FS_CONTEXT_ALLOW_SENSITIVE=true` — disable the default deny list
- `FS_CONTEXT_DENYLIST` — add custom patterns to block
- `FS_CONTEXT_ALLOWLIST` — explicitly allow specific patterns

### stdout Hygiene

The server uses **stdio** transport. All diagnostic output goes to `stderr` — **nothing is written to `stdout`** except MCP JSON-RPC messages, preventing protocol corruption.

## Development

### Install Dependencies

```bash
npm ci
```

### Scripts

| Script                  | Command                                      | Purpose                                |
| ----------------------- | -------------------------------------------- | -------------------------------------- |
| `npm run build`         | `node scripts/tasks.mjs build`               | Compile TypeScript to `dist/`          |
| `npm run dev`           | `tsc --watch`                                | Watch mode compilation                 |
| `npm run dev:run`       | `node --env-file=.env --watch dist/index.js` | Run server with auto-reload            |
| `npm start`             | `node dist/index.js`                         | Run compiled server                    |
| `npm run lint`          | `eslint .`                                   | Run ESLint                             |
| `npm run lint:fix`      | `eslint . --fix`                             | Auto-fix lint issues                   |
| `npm run format`        | `prettier --write .`                         | Format code with Prettier              |
| `npm run type-check`    | `node scripts/tasks.mjs type-check`          | TypeScript type checking               |
| `npm test`              | `node scripts/tasks.mjs test`                | Run tests (Node.js native test runner) |
| `npm run test:coverage` | `node scripts/tasks.mjs test --coverage`     | Run tests with coverage                |
| `npm run knip`          | `knip`                                       | Find unused exports/dependencies       |
| `npm run inspector`     | `npx @modelcontextprotocol/inspector`        | Launch MCP Inspector                   |
| `npm run clean`         | `node scripts/tasks.mjs clean`               | Clean build artifacts                  |

## Build and Release

The project uses GitHub Actions for publishing to npm via **Trusted Publishing** (OIDC, no tokens required).

**Workflow:** `.github/workflows/publish.yml`

1. Triggered by GitHub release creation
2. Runs lint, type-check, and tests
3. Builds the package
4. Publishes to npm with `--access public`
5. Provenance is auto-generated

## Troubleshooting

### MCP Inspector

Use the MCP Inspector to test and debug tool calls interactively:

```bash
npx @modelcontextprotocol/inspector npx -y @j0hanz/fs-context-mcp@latest /path/to/dir
```

### Common Issues

| Issue                                 | Solution                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| "No workspace roots configured"       | Provide directory paths as CLI arguments or use `--allow-cwd`                             |
| "Multiple workspace roots configured" | Pass an explicit `path` parameter to disambiguate                                         |
| "E_ACCESS_DENIED"                     | The requested path is outside allowed directories. Check `roots` tool output              |
| "E_TOO_LARGE"                         | File exceeds the configured `MAX_FILE_SIZE`. Increase via env var or use `head` parameter |
| "E_TIMEOUT"                           | Operation timed out. Increase `DEFAULT_SEARCH_TIMEOUT` or narrow your search scope        |
| Tool returns `resourceUri`            | Output was too large for inline delivery. Read the linked resource for full content       |
| Binary file skipped                   | `grep` and `read` skip binary files automatically. This is expected behavior              |

## License

[MIT](https://opensource.org/licenses/MIT)
