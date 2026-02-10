# Filesystem MCP

[![npm version](https://img.shields.io/npm/v/%40j0hanz%2Ffilesystem-mcp)](https://www.npmjs.com/package/@j0hanz/filesystem-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-brightgreen)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.26+-purple)](https://modelcontextprotocol.io/)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0078d7?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22filesystem-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffilesystem-mcp%40latest%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%7B%22name%22%3A%22filesystem-mcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ffilesystem-mcp%40latest%22%5D%7D) [![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install-f79a2e?logo=claude&logoColor=white)](https://modelcontextprotocol.io/quickstart/user#2-add-the-filesystem-server) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?logo=cursor&logoColor=white)](https://cursor.com/deeplink/mcp-install?name=filesystem-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovZmlsZXN5c3RlbS1tY3BAbGF0ZXN0Il19)

MCP server that provides a secure interface for language models to perform filesystem operations.

## Overview

The `filesystem-mcp` server provides a secure interface for language models to perform filesystem operations. By defining a set of tools that map to common file and directory actions, it allows LLMs to read, write, search, and manipulate files within specified allowed directories. This can be used for tasks like code analysis, content generation, data processing, and more, all while ensuring that the model's access is safely confined.

## Key Features

- **Filesystem Navigation**: List directories (`ls`), visualize structures (`tree`), and list allowed roots (`roots`).
- **File Operations**: Read (`read`, `read_many`), write (`write`), edit (`edit`), move (`mv`), and delete (`rm`) files.
- **Advanced Search**: Find files by glob pattern (`find`) or search file contents (`grep`) with regex support.
- **Diff & Patch**: Hash files (`calculate_hash`), generate unified diffs (`diff_files`), apply patches (`apply_patch`), and bulk replace (`search_and_replace`).
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
npx -y @j0hanz/filesystem-mcp .
```

## Installation

### Using npx (Recommended)

```bash
npx -y @j0hanz/filesystem-mcp <allowed-directory>
```

### From Source

1. Clone the repository:

   ```bash
   git clone https://github.com/j0hanz/filesystem-mcp.git
   cd filesystem-mcp
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

| Argument                     | Description                                                                  |
| :--------------------------- | :--------------------------------------------------------------------------- |
| `allowedDirs`                | Positional arguments specifying which directories the server can access.     |
| `--allow-cwd`, `--allow_cwd` | Flag to automatically add the current working directory to the allowed list. |
| `-h`, `--help`               | Show CLI usage and exit.                                                     |
| `-v`, `--version`            | Show server version and exit.                                                |

### Environment Variables

| Variable                          | Default         | Description                                                             |
| :-------------------------------- | :-------------- | :---------------------------------------------------------------------- |
| `MAX_SEARCH_SIZE`                 | `1048576`       | Max file size (bytes) for `grep`/search content. Min 100 KB, max 10 MB. |
| `MAX_FILE_SIZE`                   | `10485760`      | Max file size (bytes) for `read`/`read_many`. Min 1 MB, max 100 MB.     |
| `MAX_READ_MANY_TOTAL_SIZE`        | `524288`        | Max total bytes returned by `read_many`. Min 10 KB, max 100 MB.         |
| `DEFAULT_SEARCH_TIMEOUT`          | `5000`          | Timeout (ms) for search operations. Min 100 ms, max 60 s.               |
| `FS_CONTEXT_ALLOW_SENSITIVE`      | `false`         | Allow access to sensitive files (set to `1`/`true` to allow).           |
| `FS_CONTEXT_DENYLIST`             | (empty)         | Additional denylist patterns (comma or newline separated).              |
| `FS_CONTEXT_ALLOWLIST`            | (empty)         | Allowlist patterns that override the denylist.                          |
| `FS_CONTEXT_SEARCH_WORKERS`       | `min(cores, 8)` | Worker threads for content search (0-16).                               |
| `FS_CONTEXT_SEARCH_WORKERS_DEBUG` | `0`             | Log worker debug details when set to `1`.                               |
| `FS_CONTEXT_DIAGNOSTICS`          | `0`             | Enable diagnostics channels when set to `1`.                            |
| `FS_CONTEXT_DIAGNOSTICS_DETAIL`   | `0`             | Diagnostics detail level: 0=off, 1=hashed paths, 2=full paths.          |
| `FS_CONTEXT_TOOL_LOG_ERRORS`      | `0`             | Emit tool error diagnostics when enabled.                               |

## MCP Surface

### Tools

#### `roots`

List the workspace roots this server can access.

| Parameter | Type | Required | Default | Description |
| :-------- | :--- | :------- | :------ | :---------- |
| (none)    | -    | -        | -       | -           |

#### `ls`

List the immediate contents of a directory (non-recursive).

| Parameter               | Type    | Required | Default | Description                                                     |
| :---------------------- | :------ | :------- | :------ | :-------------------------------------------------------------- |
| `path`                  | string  | No       | (root)  | Base directory for the operation.                               |
| `includeHidden`         | boolean | No       | `false` | Include hidden files and directories (starting with .).         |
| `includeIgnored`        | boolean | No       | `false` | Include normally ignored directories (node_modules, dist, etc). |
| `sortBy`                | string  | No       | `name`  | Sort by `name`, `size`, `modified`, or `type`.                  |
| `maxDepth`              | number  | No       | -       | Max recursion depth when `pattern` is provided.                 |
| `maxEntries`            | number  | No       | -       | Max entries before truncation.                                  |
| `pattern`               | string  | No       | -       | Optional glob filter (for recursive listing).                   |
| `includeSymlinkTargets` | boolean | No       | `false` | Include resolved symlink targets in output.                     |

#### `find`

Find files by glob pattern.

| Parameter         | Type    | Required | Default | Description                                    |
| :---------------- | :------ | :------- | :------ | :--------------------------------------------- |
| `pattern`         | string  | Yes      | -       | Glob pattern to match files (e.g., `**/*.ts`). |
| `path`            | string  | No       | (root)  | Base directory for the operation.              |
| `maxResults`      | number  | No       | `100`   | Maximum matches to return.                     |
| `includeIgnored`  | boolean | No       | `false` | Include normally ignored directories.          |
| `includeHidden`   | boolean | No       | `false` | Include hidden files and directories.          |
| `sortBy`          | string  | No       | `path`  | Sort by `path`, `name`, `size`, or `modified`. |
| `maxDepth`        | number  | No       | -       | Maximum directory depth to scan.               |
| `maxFilesScanned` | number  | No       | -       | Hard cap on scanned files.                     |

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

| Parameter         | Type    | Required | Default | Description                              |
| :---------------- | :------ | :------- | :------ | :--------------------------------------- |
| `pattern`         | string  | Yes      | -       | Text to search for.                      |
| `path`            | string  | No       | (root)  | Base directory or file for the search.   |
| `isRegex`         | boolean | No       | `false` | Treat pattern as a regular expression.   |
| `caseSensitive`   | boolean | No       | `false` | Enable case-sensitive matching.          |
| `wholeWord`       | boolean | No       | `false` | Match whole words only.                  |
| `contextLines`    | number  | No       | `0`     | Include N lines before/after each match. |
| `maxResults`      | number  | No       | `500`   | Maximum match rows to return.            |
| `maxFilesScanned` | number  | No       | `20000` | Hard cap on scanned files.               |
| `filePattern`     | string  | No       | `**/*`  | Glob filter for candidate files.         |
| `includeHidden`   | boolean | No       | `false` | Include hidden files.                    |
| `includeIgnored`  | boolean | No       | `false` | Include ignored directories.             |

#### `calculate_hash`

Compute a SHA-256 hash for a file.

| Parameter | Type   | Required | Default | Description            |
| :-------- | :----- | :------- | :------ | :--------------------- |
| `path`    | string | Yes      | -       | Absolute path to file. |

#### `diff_files`

Generate a unified diff between two files.

| Parameter          | Type    | Required | Default | Description                                        |
| :----------------- | :------ | :------- | :------ | :------------------------------------------------- |
| `original`         | string  | Yes      | -       | Path to original file.                             |
| `modified`         | string  | Yes      | -       | Path to modified file.                             |
| `context`          | number  | No       | -       | Lines of context to include in the diff.           |
| `ignoreWhitespace` | boolean | No       | `false` | Ignore leading/trailing whitespace in comparisons. |
| `stripTrailingCr`  | boolean | No       | `false` | Strip trailing carriage returns before diffing.    |

#### `apply_patch`

Apply a unified patch to a file.

| Parameter                | Type    | Required | Default | Description                                    |
| :----------------------- | :------ | :------- | :------ | :--------------------------------------------- |
| `path`                   | string  | Yes      | -       | Path to file to patch.                         |
| `patch`                  | string  | Yes      | -       | Unified diff content.                          |
| `fuzzy`                  | boolean | No       | `false` | Allow fuzzy patching (compatibility flag).     |
| `fuzzFactor`             | number  | No       | -       | Maximum fuzzy mismatches per hunk.             |
| `autoConvertLineEndings` | boolean | No       | `true`  | Auto-convert patch line endings to match file. |
| `dryRun`                 | boolean | No       | `false` | Check only, no writes.                         |

#### `search_and_replace`

Search and replace text across multiple files.

Response includes `processedFiles`, `failedFiles`, and a sample `failures`
list when some files cannot be processed.

| Parameter         | Type    | Required | Default | Description                       |
| :---------------- | :------ | :------- | :------ | :-------------------------------- |
| `path`            | string  | No       | (root)  | Base directory for the operation. |
| `filePattern`     | string  | Yes      | -       | Glob pattern (e.g., `**/*.ts`).   |
| `excludePatterns` | array   | No       | `[]`    | Glob patterns to exclude.         |
| `searchPattern`   | string  | Yes      | -       | Text or regex pattern to replace. |
| `replacement`     | string  | Yes      | -       | Replacement text.                 |
| `isRegex`         | boolean | No       | `false` | Treat search pattern as regex.    |
| `dryRun`          | boolean | No       | `false` | Check only, no writes.            |

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

| Pattern                        | Description         |
| :----------------------------- | :------------------ |
| `internal://instructions`      | Server Instructions |
| `filesystem-mcp://result/{id}` | Cached Tool Result  |

Tool responses may include a `resource_link` or a `resourceUri` when output is too large to inline. Fetch the full payload with `resources/read` using the provided URI. Cached results are ephemeral and may not appear in `resources/list`.

### Prompts

| Prompt     | Description                                          |
| :--------- | :--------------------------------------------------- |
| `get-help` | Returns the server instructions for quick reference. |

### Tasks

Long-running tools (`grep`, `find`, `search_and_replace`, `tree`, `read_many`,
`stat_many`) support task-augmented calls. When `task` is provided to
`tools/call`, the server returns a task id that can be polled with `tasks/get`
and resolved via `tasks/result`. Include `_meta.progressToken` on requests to
receive `notifications/progress` updates. Task data is stored in memory and is
cleared when the server restarts.

## Client Configuration Examples

<details>
<summary><strong>VS Code (Claude Dev / Cline)</strong></summary>

Add to your `~/AppData/Roaming/Code/User/globalStorage/mcp-settings.json` (Windows) or `~/Library/Application Support/Code/User/globalStorage/mcp-settings.json` (macOS):

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-mcp",
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
    "filesystem-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-mcp",
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

- Name: `filesystem-mcp`
- Type: `command`
- Command: `npx -y @j0hanz/filesystem-mcp c:\path\to\allowed\directory`

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
