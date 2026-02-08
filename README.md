# FS-Context MCP Server

[![npm version](https://img.shields.io/npm/v/%40j0hanz%2Ffs-context-mcp)](https://www.npmjs.com/package/@j0hanz/fs-context-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-brightgreen)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26+-purple)](https://modelcontextprotocol.io/)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0078d7?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22fs-context%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22fs-context%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffs-context-mcp%40latest%22%5D%7D) [![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install-f79a2e?logo=claude&logoColor=white)](https://modelcontextprotocol.io/quickstart/user#2-add-the-filesystem-server) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?logo=cursor&logoColor=white)](https://cursor.com/deeplink/mcp-install?name=fs-context&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovZnMtY29udGV4dC1tY3BAbGF0ZXN0Il19)

Filesystem MCP Server that enables LLMs to interact with the local filesystem.

## Overview

The `fs-context-mcp` server provides a secure interface for language models to perform filesystem operations. By defining a set of tools that map to common file and directory actions, it allows LLMs to read, write, search, and manipulate files within specified allowed directories. This can be used for tasks like code analysis, content generation, data processing, and more, all while ensuring that the model's access is safely confined.

## Key Features

- **Filesystem Navigation**: List directories (`ls`), visualize structures (`tree`), and list allowed roots (`roots`).
- **File Operations**: Read (`read`, `read_many`), write (`write`), edit (`edit`), move (`mv`), and delete (`rm`) files.
- **Advanced Search**: Find files by glob pattern (`find`) or search file contents (`grep`) with regex support.
- **Batch Processing**: Efficiently read or stat multiple files in a single request (`read_many`, `stat_many`).
- **Security**: Operations are strictly confined to allowed directories specified at startup.

## Tech Stack

- **Runtime**: Node.js >=24
- **Language**: TypeScript 5.9
- **MCP SDK**: @modelcontextprotocol/sdk 1.26
- **Validation**: Zod
- **Regex**: re2 (safe regex execution)

## Quickstart

To run the server with access to your current directory:

```bash
npx -y @j0hanz/fs-context-mcp .
```

## Installation

### Using npx (Recommended)

```bash
npx -y @j0hanz/fs-context-mcp <allowed-directory>
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

3. Build the server:

   ```bash
   npm run build
   ```

4. Run:

   ```bash
   node dist/index.js <allowed-directory>
   ```

## Configuration

The server is configured primarily via command-line arguments.

### CLI Arguments

| Argument      | Description                                                                  |
| :------------ | :--------------------------------------------------------------------------- |
| `allowedDirs` | Positional arguments specifying which directories the server can access.     |
| `--allow-cwd` | Flag to automatically add the current working directory to the allowed list. |

### Environment Variables

Missing info. (No explicit environment variables found in configuration handling).

## MCP Surface

### Tools

#### `roots`

List the workspace roots this server can access.

| Parameter | Type | Required | Default | Description |
| :-------- | :--- | :------- | :------ | :---------- |
| (none)    | -    | -        | -       | -           |

#### `ls`

List the immediate contents of a directory (non-recursive).

| Parameter        | Type    | Required | Default | Description                                                     |
| :--------------- | :------ | :------- | :------ | :-------------------------------------------------------------- |
| `path`           | string  | No       | (root)  | Base directory for the operation.                               |
| `includeHidden`  | boolean | No       | `false` | Include hidden files and directories (starting with .).         |
| `includeIgnored` | boolean | No       | `false` | Include normally ignored directories (node_modules, dist, etc). |

#### `find`

Find files by glob pattern.

| Parameter        | Type    | Required | Default | Description                                    |
| :--------------- | :------ | :------- | :------ | :--------------------------------------------- |
| `pattern`        | string  | Yes      | -       | Glob pattern to match files (e.g., `**/*.ts`). |
| `path`           | string  | No       | (root)  | Base directory for the operation.              |
| `maxResults`     | number  | No       | `100`   | Maximum matches to return.                     |
| `includeIgnored` | boolean | No       | `false` | Include normally ignored directories.          |

#### `tree`

Render a directory tree.

| Parameter        | Type    | Required | Default | Description                                  |
| :--------------- | :------ | :------- | :------ | :------------------------------------------- |
| `path`           | string  | No       | (root)  | Base directory for the operation.            |
| `maxDepth`       | number  | No       | `5`     | Maximum depth to recurse.                    |
| `maxEntries`     | number  | No       | `1000`  | Maximum number of entries before truncating. |
| `includeHidden`  | boolean | No       | `false` | Include hidden files.                        |
| `includeIgnored` | boolean | No       | `false` | Include ignored directories.                 |

#### `read`

Read the text contents of a file.

| Parameter   | Type   | Required | Default | Description                             |
| :---------- | :----- | :------- | :------ | :-------------------------------------- |
| `path`      | string | Yes      | -       | Absolute path to file.                  |
| `head`      | number | No       | -       | Read only the first N lines.            |
| `startLine` | number | No       | -       | Start reading from this line (1-based). |
| `endLine`   | number | No       | -       | Stop reading at this line (inclusive).  |

#### `read_many`

Read multiple text files in a single request.

| Parameter   | Type   | Required | Default | Description                               |
| :---------- | :----- | :------- | :------ | :---------------------------------------- |
| `paths`     | array  | Yes      | -       | Array of file paths to read.              |
| `head`      | number | No       | -       | Read only the first N lines of each file. |
| `startLine` | number | No       | -       | Start line for each file.                 |
| `endLine`   | number | No       | -       | End line for each file.                   |

#### `stat`

Get metadata for a file or directory.

| Parameter | Type   | Required | Default | Description                         |
| :-------- | :----- | :------- | :------ | :---------------------------------- |
| `path`    | string | Yes      | -       | Absolute path to file or directory. |

#### `stat_many`

Get metadata for multiple files or directories.

| Parameter | Type  | Required | Default | Description                       |
| :-------- | :---- | :------- | :------ | :-------------------------------- |
| `paths`   | array | Yes      | -       | Array of file or directory paths. |

#### `grep`

Search for text within file contents.

| Parameter       | Type    | Required | Default | Description                            |
| :-------------- | :------ | :------- | :------ | :------------------------------------- |
| `pattern`       | string  | Yes      | -       | Text to search for.                    |
| `path`          | string  | No       | (root)  | Base directory for the operation.      |
| `isRegex`       | boolean | No       | `false` | Treat pattern as a regular expression. |
| `includeHidden` | boolean | No       | `false` | Include hidden files.                  |

#### `mkdir`

Create a new directory (recursive).

| Parameter | Type   | Required | Default | Description     |
| :-------- | :----- | :------- | :------ | :-------------- |
| `path`    | string | Yes      | -       | Path to create. |

#### `write`

Write content to a file.

| Parameter | Type   | Required | Default | Description       |
| :-------- | :----- | :------- | :------ | :---------------- |
| `path`    | string | Yes      | -       | Path to file.     |
| `content` | string | Yes      | -       | Content to write. |

#### `edit`

Edit a file by replacing text.

| Parameter | Type    | Required | Default | Description                                    |
| :-------- | :------ | :------- | :------ | :--------------------------------------------- |
| `path`    | string  | Yes      | -       | Path to file.                                  |
| `edits`   | array   | Yes      | -       | Array of objects with `oldText` and `newText`. |
| `dryRun`  | boolean | No       | `false` | Only check if edits would succeed.             |

#### `mv`

Move or rename a file or directory.

| Parameter     | Type   | Required | Default | Description   |
| :------------ | :----- | :------- | :------ | :------------ |
| `source`      | string | Yes      | -       | Current path. |
| `destination` | string | Yes      | -       | New path.     |

#### `rm`

Delete a file or directory.

| Parameter           | Type    | Required | Default | Description                           |
| :------------------ | :------ | :------- | :------ | :------------------------------------ |
| `path`              | string  | Yes      | -       | Path to delete.                       |
| `recursive`         | boolean | No       | `false` | Allow deleting non-empty directories. |
| `ignoreIfNotExists` | boolean | No       | `false` | Do not fail if path missing.          |

### Resources

| Pattern                    | Description         |
| :------------------------- | :------------------ |
| `internal://instructions`  | Server Instructions |
| `fs-context://result/{id}` | Cached Tool Result  |

## Client Configuration Examples

<details>
<summary><strong>VS Code (Claude Dev / Cline)</strong></summary>

Add to your `~/AppData/Roaming/Code/User/globalStorage/mcp-settings.json` (Windows) or `~/Library/Application Support/Code/User/globalStorage/mcp-settings.json` (macOS):

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/fs-context-mcp",
        "c:\\path\\to\\allowed\\directory"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fs-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/fs-context-mcp",
        "c:\\path\\to\\allowed\\directory"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Configure via the MCP settings panel:

- Name: `fs-context`
- Type: `command`
- Command: `npx -y @j0hanz/fs-context-mcp c:\path\to\allowed\directory`

</details>

## Security

- **Path Scope**: Operations are restricted to the directories specified in `allowedDirs` or the current working directory if `--allow-cwd` is used.
- **Path Validation**:
  - Null bytes are rejected.
  - Windows drive-relative paths (e.g., `C:path`) are rejected.
  - Windows reserved device names are rejected.
- **Symlinks**: Symlink targets are reported but not implicitly followed during recursion in some operations to prevent loops or escaping scope (specific behavior varies by tool).

## Development Workflow

1. **Install dependencies**:

   ```bash
   npm ci
   ```

2. **Run in development mode** (rebuilds on change):

   ```bash
   npm run dev
   ```

3. **Run tests**:

   ```bash
   npm run test
   ```

4. **Lint and Format**:

   ```bash
   npm run lint
   npm run format
   ```

## Contributing & License

This project is licensed under the [MIT License](LICENSE).
