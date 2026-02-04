# FS Context MCP Server

<img src="assets/logo.svg" alt="SuperFetch MCP Logo" width="300">

[![npm version](https://img.shields.io/npm/v/@j0hanz/fs-context-mcp.svg)](https://www.npmjs.com/package/@j0hanz/fs-context-mcp) [![License](https://img.shields.io/npm/l/@j0hanz/fs-context-mcp)](LICENSE) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.19.8-brightgreen)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue)](https://www.typescriptlang.org/) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.25.3-purple)](https://modelcontextprotocol.io)

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=fs-context&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%2C%22%24%7BworkspaceFolder%7D%22%5D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=fs-context&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%2C%22%24%7BworkspaceFolder%7D%22%5D%7D&quality=insiders)

Read-only Model Context Protocol (MCP) server for secure filesystem exploration, searching, and analysis.

## Overview

This server enables AI assistants to navigate your filesystem through a set of read-only tools. It provides capabilities to explore directory structures, find files using glob patterns, search file contents with grep, read files (including batch operations), and access file metadata—all restricted to explicitly approved directories.

## Key Features

- **Read-Only Security**: No write, delete, or modify permissions.
- **Allowed Roots**: Access is strictly limited to configured directories.
- **Directory Exploration**: List contents (`ls`) and visualize structures (`tree`).
- **File Search**: Find files by name or pattern (`find`) and search content (`grep`).
- **File Reading**: Read single (`read`) or multiple (`read_many`) files with line-range support.
- **Metadata**: Retrieve file stats (`stat`, `stat_many`) including size and timestamps.
- **Large File Handling**: Automatic truncation and pagination for large outputs.
- **Ignore Support**: Respects `.gitignore` and common ignore patterns by default.

## Tech Stack

- **Runtime**: Node.js >= 22.19.8
- **Language**: TypeScript 5.9.3
- **MCP SDK**: @modelcontextprotocol/sdk 1.25.3
- **Libraries**: `zod` (validation), `re2` (safe regex), `ignore` (filtering)

## Repository Structure

```text
src/
├── tools/             # Tool implementations (read, find, grep, etc.)
├── lib/               # Core logic (filesystem, validation, errors)
├── index.ts           # CLI entrypoint
├── server.ts          # MCP server setup and roots management
├── tools.ts           # Tool registration
├── resources.ts       # Resource registration
├── schemas.ts         # Zod schemas for inputs/outputs
└── config.ts          # Shared configuration types
```

## Requirements

- Node.js >= 22.19.8

## Quickstart

Use `npx` to run the server directly.

```bash
npx -y @j0hanz/fs-context-mcp@latest --allow-cwd
```

### VS Code Configuration

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

## Installation

### NPX (Recommended)

```bash
npx -y @j0hanz/fs-context-mcp@latest /path/to/directory
```

### Global Installation

```bash
npm install -g @j0hanz/fs-context-mcp
fs-context-mcp /path/to/directory
```

### From Source

1. Clone the repository:

   ```bash
   git clone https://github.com/j0hanz/fs-context-mcp-server.git
   cd fs-context-mcp-server
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Run the server:

   ```bash
   node dist/index.js /path/to/directory
   ```

## Configuration

### Runtime Modes

This server runs over **stdio** by default.

### CLI Arguments

| Argument      | Description                                         |
| :------------ | :-------------------------------------------------- |
| `[paths...]`  | List of allowed root directories.                   |
| `--allow-cwd` | Add the current working directory to allowed roots. |

### Environment Variables

| Variable                     | Default     | Description                                        |
| :--------------------------- | :---------- | :------------------------------------------------- |
| `MAX_FILE_SIZE`              | 10MB        | Max file size for read operations.                 |
| `MAX_READ_MANY_TOTAL_SIZE`   | 512KB       | Max combined size for `read_many`.                 |
| `MAX_SEARCH_SIZE`            | 1MB         | Max file size for `grep`.                          |
| `DEFAULT_SEARCH_TIMEOUT`     | 30000       | Timeout (ms) for search/list operations.           |
| `FS_CONTEXT_SEARCH_WORKERS`  | min(cpu, 8) | Number of worker threads for search.               |
| `FS_CONTEXT_ALLOW_SENSITIVE` | false       | Allow reading sensitive files (disables denylist). |
| `FS_CONTEXT_DENYLIST`        | (empty)     | Additional comma-separated glob patterns to block. |
| `FS_CONTEXT_ALLOWLIST`       | (empty)     | Comma-separated globs to allow despite denylist.   |
| `FS_CONTEXT_TOOL_LOG_ERRORS` | false       | Log tool failures to stderr.                       |

## MCP Surface

### Tools

#### `roots`

List the workspace roots this server can access.

- **Returns**: List of allowed directory paths.

#### `ls`

List the immediate contents of a directory.

| Parameter        | Type    | Required | Default | Description                                      |
| :--------------- | :------ | :------- | :------ | :----------------------------------------------- |
| `path`           | string  | No       | (root)  | Directory path to list.                          |
| `includeHidden`  | boolean | No       | false   | Include hidden files.                            |
| `includeIgnored` | boolean | No       | false   | Include ignored directories (node_modules, etc). |

#### `find`

Find files by glob pattern.

| Parameter        | Type    | Required | Default | Description                     |
| :--------------- | :------ | :------- | :------ | :------------------------------ |
| `pattern`        | string  | Yes      | -       | Glob pattern (e.g., `**/*.ts`). |
| `path`           | string  | No       | (root)  | Base directory to search from.  |
| `includeIgnored` | boolean | No       | false   | Include ignored directories.    |
| `maxResults`     | number  | No       | 100     | Maximum matches to return.      |

#### `tree`

Render a directory tree.

| Parameter        | Type    | Required | Default | Description                    |
| :--------------- | :------ | :------- | :------ | :----------------------------- |
| `path`           | string  | No       | (root)  | Base directory to render.      |
| `maxDepth`       | number  | No       | 5       | Maximum recursion depth.       |
| `maxEntries`     | number  | No       | 1000    | Max entries before truncating. |
| `includeHidden`  | boolean | No       | false   | Include hidden files.          |
| `includeIgnored` | boolean | No       | false   | Include ignored directories.   |

#### `read`

Read the text contents of a file.

| Parameter   | Type   | Required | Default | Description              |
| :---------- | :----- | :------- | :------ | :----------------------- |
| `path`      | string | Yes      | -       | Path to the file.        |
| `head`      | number | No       | -       | Read only first N lines. |
| `startLine` | number | No       | -       | 1-based start line.      |
| `endLine`   | number | No       | -       | 1-based end line.        |

#### `read_many`

Read multiple text files in a single request.

| Parameter   | Type     | Required | Default | Description                            |
| :---------- | :------- | :------- | :------ | :------------------------------------- |
| `paths`     | string[] | Yes      | -       | Array of file paths to read (max 100). |
| `head`      | number   | No       | -       | Read only first N lines of each file.  |
| `startLine` | number   | No       | -       | 1-based start line per file.           |
| `endLine`   | number   | No       | -       | 1-based end line per file.             |

#### `stat`

Get metadata for a file or directory.

| Parameter | Type   | Required | Default | Description                |
| :-------- | :----- | :------- | :------ | :------------------------- |
| `path`    | string | Yes      | -       | Path to file or directory. |

#### `stat_many`

Get metadata for multiple files/directories.

| Parameter | Type     | Required | Default | Description              |
| :-------- | :------- | :------- | :------ | :----------------------- |
| `paths`   | string[] | Yes      | -       | Array of paths to query. |

#### `grep`

Search for text within file contents.

| Parameter       | Type    | Required | Default | Description                       |
| :-------------- | :------ | :------- | :------ | :-------------------------------- |
| `pattern`       | string  | Yes      | -       | Text pattern to search for.       |
| `path`          | string  | No       | (root)  | Base directory or file to search. |
| `includeHidden` | boolean | No       | false   | Include hidden files.             |

### Resources

| Pattern                    | Description                             |
| :------------------------- | :-------------------------------------- |
| `internal://instructions`  | Usage guidance and server instructions. |
| `fs-context://result/{id}` | Access to cached large tool outputs.    |

## Client Configuration Examples

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/mcp.json`:

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
<summary><b>Claude Desktop</b></summary>

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/fs-context-mcp@latest",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

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

## Security

- **Read-Only**: This server is designed to be read-only. It provides no tools for writing or modifying files.
- **Path Validation**: All file access is validated against the allowed root directories.
- **Path Traversal**: Attempts to access files outside allowed roots using `..` are blocked.
- **Symlinks**: Symlinks resolving outside allowed roots are blocked.
- **Sensitive Files**: Common sensitive files (e.g., `.env`, `.ssh/id_rsa`) are denied by default unless explicitly allowed via configuration.
- **Stdio**: The server communicates via stdio. Ensure your client does not pipe untrusted data into the server's input.

## Development Workflow

1. **Install dependencies**: `npm ci`
2. **Run in dev mode**: `npm run dev` (watches for changes)
3. **Build**: `npm run build`
4. **Test**: `npm test`
5. **Lint**: `npm run lint`

## Troubleshooting

- **Access Denied**: Ensure the directory is included in the CLI arguments or client roots configuration.
- **File Too Large**: Large files are truncated. Use the `head` parameter or `startLine`/`endLine` to read specific sections, or follow the resource URI provided in the tool output.
- **Timeout**: Complex searches (`grep` or `find`) may timeout on large codebases. Try narrowing the search path.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
