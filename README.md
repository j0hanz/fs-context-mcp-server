# Filesystem MCP

![npm version](https://img.shields.io/npm/v/@j0hanz/filesystem-mcp) ![License](https://img.shields.io/npm/l/@j0hanz/filesystem-mcp) ![Node.js Version](https://img.shields.io/node/v/@j0hanz/filesystem-mcp) ![Docker Image](https://ghcr-badge.egpl.dev/j0hanz/filesystem-mcp/latest_tag?trim=major&label=docker)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0078d7?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22filesystem-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffilesystem-mcp%40latest%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22filesystem-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffilesystem-mcp%40latest%22%5D%7D) [![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install-f79a2e?logo=claude&logoColor=white)](https://modelcontextprotocol.io/quickstart/user#2-add-the-filesystem-server) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?logo=cursor&logoColor=white)](https://cursor.com/deeplink/mcp-install?name=filesystem-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovZmlsZXN5c3RlbS1tY3BAbGF0ZXN0Il19)

MCP Server that enables LLMs to interact with the local filesystem. Provides tools for navigation, file management, searching, and analysis, all within a secure, allowed set of directories. Ideal for agents needing to read/write files, explore directory structures, or perform file operations as part of their tasks.

## Key Features

- **Navigation**: List directories (`ls`), view trees (`tree`), and discover workspace roots (`roots`).
- **File Management**: Create (`mkdir`), write (`write`), edit (`edit`), move (`mv`), and delete (`rm`) files/directories.
- **Search**: Find files by glob pattern (`find`) or search content using regex (`grep`).
- **Analysis**: Inspect metadata (`stat`), calculate hashes (`calculate_hash`), and compare files (`diff_files`).
- **Batch Operations**: Read multiple files (`read_many`) or replace text across many files (`search_and_replace`).
- **Security**: Strictly scoped to allowed directories provided at startup.

## Tech Stack

- **Runtime**: Node.js >= 24
- **Language**: TypeScript
- **SDK**: `@modelcontextprotocol/sdk`
- **Libraries**: `zod`, `commander`, `re2`, `diff`

## Repository Structure

```text
.
├── src/
│   ├── index.ts        # Entry point
│   ├── server.ts       # MCP Server implementation
│   ├── tools/          # Individual tool implementations
│   └── lib/            # Shared utilities
├── assets/             # Images and static resources
├── scripts/            # Build and maintenance scripts
└── package.json
```

## Requirements

- Node.js >= 24

## Quickstart

Run directly with `npx`:

```bash
npx -y @j0hanz/filesystem-mcp@latest "C:\path\to\allowed\directory"
```

## Installation

### NPX (Recommended)

```bash
npx -y @j0hanz/filesystem-mcp@latest [options] [directories...]
```

### Docker

```bash
docker run -i --rm \
  -v /path/to/your/project:/projects/workspace:ro \
  ghcr.io/j0hanz/filesystem-mcp:latest \
  /projects/workspace
```

> Mount host directories as volumes to `/projects/` and pass the container paths as arguments.

### From Source

1. Clone the repository
2. Install dependencies:

   ```bash
   npm ci
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Run:

   ```bash
   node dist/index.js [options] [directories...]
   ```

## Configuration

Allowed directories can be provided via command-line arguments, via the MCP Roots protocol, or by using `--allow-cwd`.

### Arguments

| Argument           | Description                                                                 |
| :----------------- | :-------------------------------------------------------------------------- |
| `[allowedDirs...]` | Positional arguments specifying the root directories the server can access. |

### Options

| Option          | Description                                                |
| :-------------- | :--------------------------------------------------------- |
| `--allow-cwd`   | Allow the current working directory as an additional root. |
| `-v, --version` | Display server version.                                    |
| `-h, --help`    | Display command help.                                      |

## Usage

### Stdio Transport

The server communicates via `stdio`. Ensure your MCP client is configured to run the server command and capture standard input/output.

## MCP Surface

### Tools

| Tool                 | Description                         | Key Parameters                                |
| :------------------- | :---------------------------------- | :-------------------------------------------- |
| `roots`              | List allowed workspace roots        | None                                          |
| `ls`                 | List directory contents             | `path`, `includeHidden`                       |
| `find`               | Find files by glob pattern          | `pattern`, `path`, `maxDepth`                 |
| `tree`               | Generate directory tree             | `path`, `maxDepth`                            |
| `read`               | Read file content                   | `path`, `head`                                |
| `read_many`          | Read multiple files                 | `paths`                                       |
| `grep`               | Search file content (regex/literal) | `pattern`, `path`, `isRegex`                  |
| `stat`               | Get file metadata                   | `path`                                        |
| `stat_many`          | Get metadata for multiple files     | `paths`                                       |
| `calculate_hash`     | Calculate SHA-256 hash              | `path`                                        |
| `mkdir`              | Create directory (recursive)        | `path`                                        |
| `write`              | Write file (create/overwrite)       | `path`, `content`                             |
| `edit`               | Edit file (string replacement)      | `path`, `edits`                               |
| `mv`                 | Move or rename file/directory       | `source`, `destination`                       |
| `rm`                 | Delete file or directory            | `path`, `recursive`                           |
| `diff_files`         | Generate unified diff               | `original`, `modified`                        |
| `apply_patch`        | Apply unified patch                 | `path`, `patch`                               |
| `search_and_replace` | Search & replace across files       | `filePattern`, `searchPattern`, `replacement` |

### Behavioral Notes

- `rm` with `recursive: false`:
  - Deletes files and empty directories.
  - Returns `E_INVALID_INPUT` for non-empty directories with guidance to use `recursive: true`.
- `includeIgnored: false` (default) for navigation/search tools:
  - Excludes common generated/vendor directories such as `node_modules`, `dist`, `.git`, and similar patterns.
  - Set `includeIgnored: true` to include those entries.

### Resources

| URI Pattern                    | Description                                      |
| :----------------------------- | :----------------------------------------------- |
| `internal://instructions`      | Usage guidance and documentation                 |
| `filesystem-mcp://result/{id}` | Ephemeral cached tool output (for large results) |

### Prompts

| Prompt     | Description                               |
| :--------- | :---------------------------------------- |
| `get-help` | Returns usage instructions for the server |

## Client Configuration Examples

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-mcp@latest",
        "C:\\path\\to\\allowed\\directory"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to your `.cursor/mcp.json` or configure via UI:

```json
{
  "id": "filesystem",
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@j0hanz/filesystem-mcp@latest", "${workspaceFolder}"]
}
```

</details>

<details>
<summary><strong>VS Code</strong></summary>

Add to your `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@j0hanz/filesystem-mcp@latest", "${workspaceFolder}"]
    }
  }
}
```

</details>

<details>
<summary><strong>Docker (any MCP client)</strong></summary>

Use the Docker image with any MCP client that supports stdio transport:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-v",
        "/path/to/project:/projects/workspace:ro",
        "ghcr.io/j0hanz/filesystem-mcp:latest",
        "/projects/workspace"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Codex</strong></summary>

Add to your configuration:

```toml
[mcp_servers.filesystem-mcp]
command = "npx"
args = ["-y", "@j0hanz/filesystem-mcp@latest", "${workspaceFolder}"]
```

</details>

## Security

- **Path Restrictions**: All file operations are strictly validated against the allowed root directories provided at startup.
- **Path Validation**: Uses `isPathWithinDirectories` to prevent path traversal attacks.
- **Hidden Files**: Hidden files (starting with `.`) are excluded by default in listings and searches unless explicitly requested.
- **Ignored Directories**: Ignored directories (for example `node_modules`, `.git`, `dist`) are excluded by default unless `includeIgnored=true`.

## Testing Notes

- For protocol-level validation, prefer an MCP SDK client (`listTools`, `listResources`, `listPrompts`, `callTool`, `readResource`) as source-of-truth.
- Some third-party MCP CLIs may have URI parsing limitations when reading resources; if this happens, verify resource behavior through SDK client calls.

## Development Workflow

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Development Mode** (watch):

   ```bash
   npm run dev
   ```

3. **Run Locally**:

   ```bash
   npm start -- --allow-cwd
   ```

4. **Test**:

   ```bash
   npm run test
   ```

5. **Lint & Format**:

   ```bash
   npm run lint
   npm run format
   ```

## License

MIT
