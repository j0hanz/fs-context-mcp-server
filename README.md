# Filesystem Context MCP Server

A secure, read-only MCP server for filesystem scanning, searching, and analysis with comprehensive security validation.

[![npm version](https://img.shields.io/npm/v/@j0hanz/filesystem-context-mcp.svg)](https://www.npmjs.com/package/@j0hanz/filesystem-context-mcp)
[![License](https://img.shields.io/npm/l/@j0hanz/filesystem-context-mcp)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.12.0-purple)](https://modelcontextprotocol.io)

## ✨ Features

| Feature                    | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| 📂 **Directory Listing**   | List and explore directory contents with recursive support             |
| 🔍 **File Search**         | Find files using glob patterns like `**/*.ts`                          |
| 📝 **Content Search**      | Search text within files using regex with context lines                |
| 📊 **Directory Analysis**  | Get statistics, file types, largest files, and recently modified files |
| 🌳 **Directory Tree**      | JSON tree structure optimized for AI parsing                           |
| 📄 **File Reading**        | Read single or multiple files with head/tail and line range support    |
| 🖼️ **Media File Support**  | Read binary files (images, audio, video) as base64                     |
| 🔒 **Security First**      | Path validation, symlink escape protection, and access control         |
| ⚡ **Parallel Operations** | Efficient batch file reading with configurable concurrency             |

## 🎯 When to Use

| Task                             | Tool                       |
| -------------------------------- | -------------------------- |
| Explore project structure        | `list_directory`           |
| Find specific file types         | `search_files`             |
| Search for code patterns/text    | `search_content`           |
| Understand codebase statistics   | `analyze_directory`        |
| Get AI-friendly project overview | `directory_tree`           |
| Read source code                 | `read_file`                |
| Batch read multiple files        | `read_multiple_files`      |
| Get file metadata (size, dates)  | `get_file_info`            |
| Read images or binary files      | `read_media_file`          |
| Check available directories      | `list_allowed_directories` |

## 🚀 Quick Start

### NPX (Recommended)

```bash
npx -y @j0hanz/filesystem-context-mcp@latest /path/to/your/project
```

### VS Code

Add to your VS Code settings (`.vscode/settings.json` or User Settings):

```json
{
  "mcp": {
    "servers": {
      "filesystem-context": {
        "command": "npx",
        "args": ["-y", "@j0hanz/filesystem-context-mcp@latest"]
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "filesystem-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/filesystem-context-mcp@latest"]
    }
  }
}
```

## 📦 Installation

### NPX (No Installation)

```bash
npx -y @j0hanz/filesystem-context-mcp@latest /path/to/dir1 /path/to/dir2
```

### Global Installation

```bash
npm install -g @j0hanz/filesystem-context-mcp
filesystem-context-mcp /path/to/your/project
```

### From Source

```bash
git clone https://github.com/j0hanz/filesystem-context-mcp-server.git
cd filesystem-context-mcp-server
npm install
npm run build
node dist/index.js /path/to/your/project
```

## ⚙️ Configuration

### Command Line Arguments

The server accepts one or more directory paths as arguments. Only these directories (and their contents) will be accessible:

```bash
filesystem-context-mcp /home/user/project /home/user/docs
```

### MCP Roots Protocol

If no CLI arguments are provided, the server will use the MCP Roots protocol to receive allowed directories from the client. This is useful for dynamic directory configuration.

### Environment Variables

| Variable   | Description                                   |
| ---------- | --------------------------------------------- |
| `NODE_ENV` | Set to `production` for optimized performance |

## 🔧 Tools

### `list_allowed_directories`

List all directories that this server is allowed to access.

| Parameter | Type | Required | Default | Description            |
| --------- | ---- | -------- | ------- | ---------------------- |
| _(none)_  | -    | -        | -       | No parameters required |

**Returns:** Array of allowed directory paths.

---

### `list_directory`

List contents of a directory with optional recursive listing.

| Parameter               | Type    | Required | Default | Description                                 |
| ----------------------- | ------- | -------- | ------- | ------------------------------------------- |
| `path`                  | string  | ✅       | -       | Directory path to list                      |
| `recursive`             | boolean | ❌       | `false` | List recursively                            |
| `includeHidden`         | boolean | ❌       | `false` | Include hidden files                        |
| `maxDepth`              | number  | ❌       | `10`    | Maximum depth for recursive listing (0-100) |
| `maxEntries`            | number  | ❌       | -       | Maximum entries to return (1-100,000)       |
| `sortBy`                | string  | ❌       | `name`  | Sort by: `name`, `size`, `modified`, `type` |
| `includeSymlinkTargets` | boolean | ❌       | `false` | Include symlink target paths                |

**Returns:** List of entries with name, type, size, and modified date.

---

### `search_files`

Search for files using glob patterns.

| Parameter         | Type     | Required | Default | Description                                   |
| ----------------- | -------- | -------- | ------- | --------------------------------------------- |
| `path`            | string   | ✅       | -       | Base directory to search from                 |
| `pattern`         | string   | ✅       | -       | Glob pattern (e.g., `**/*.ts`, `src/**/*.js`) |
| `excludePatterns` | string[] | ❌       | `[]`    | Patterns to exclude                           |
| `maxResults`      | number   | ❌       | -       | Maximum matches to return (1-10,000)          |
| `sortBy`          | string   | ❌       | `path`  | Sort by: `name`, `size`, `modified`, `path`   |
| `maxDepth`        | number   | ❌       | -       | Maximum directory depth to search (1-100)     |

**Returns:** List of matching files with path, type, size, and modified date.

**Example:**

```json
{
  "path": "/project",
  "pattern": "**/*.ts",
  "excludePatterns": ["node_modules/**", "dist/**"]
}
```

---

### `read_file`

Read the contents of a text file.

| Parameter   | Type   | Required | Default | Description                                      |
| ----------- | ------ | -------- | ------- | ------------------------------------------------ |
| `path`      | string | ✅       | -       | File path to read                                |
| `encoding`  | string | ❌       | `utf-8` | File encoding (`utf-8`, `ascii`, `base64`, etc.) |
| `maxSize`   | number | ❌       | 10MB    | Maximum file size in bytes                       |
| `lineStart` | number | ❌       | -       | Start line (1-indexed) for reading a range       |
| `lineEnd`   | number | ❌       | -       | End line (inclusive) for reading a range         |
| `head`      | number | ❌       | -       | Read only first N lines                          |
| `tail`      | number | ❌       | -       | Read only last N lines                           |

> **Note:** Cannot specify both `head` and `tail` simultaneously. Use `lineStart`/`lineEnd` for range reading.

**Returns:** File contents as text.

---

### `read_multiple_files`

Read multiple files in parallel for efficient batch operations.

| Parameter  | Type     | Required | Default | Description                          |
| ---------- | -------- | -------- | ------- | ------------------------------------ |
| `paths`    | string[] | ✅       | -       | Array of file paths (max 100)        |
| `encoding` | string   | ❌       | `utf-8` | File encoding                        |
| `maxSize`  | number   | ❌       | 10MB    | Maximum file size per file           |
| `head`     | number   | ❌       | -       | Read only first N lines of each file |
| `tail`     | number   | ❌       | -       | Read only last N lines of each file  |

**Returns:** Array of results with content or error for each file.

---

### `get_file_info`

Get detailed metadata about a file or directory.

| Parameter | Type   | Required | Default | Description               |
| --------- | ------ | -------- | ------- | ------------------------- |
| `path`    | string | ✅       | -       | Path to file or directory |

**Returns:** Metadata including name, type, size, created/modified/accessed timestamps, permissions, MIME type, and symlink target (if applicable).

---

### `search_content`

Search for text content within files using regular expressions.

| Parameter         | Type     | Required | Default | Description                                      |
| ----------------- | -------- | -------- | ------- | ------------------------------------------------ |
| `path`            | string   | ✅       | -       | Base directory to search in                      |
| `pattern`         | string   | ✅       | -       | Regex pattern to search for                      |
| `filePattern`     | string   | ❌       | `**/*`  | Glob pattern to filter files                     |
| `excludePatterns` | string[] | ❌       | `[]`    | Glob patterns to exclude                         |
| `caseSensitive`   | boolean  | ❌       | `false` | Case-sensitive search                            |
| `maxResults`      | number   | ❌       | `100`   | Maximum number of results (1-10,000)             |
| `maxFileSize`     | number   | ❌       | 1MB     | Maximum file size to scan                        |
| `maxFilesScanned` | number   | ❌       | -       | Maximum files to scan before stopping            |
| `timeoutMs`       | number   | ❌       | -       | Timeout in milliseconds (100-3,600,000)          |
| `skipBinary`      | boolean  | ❌       | `true`  | Skip binary files                                |
| `contextLines`    | number   | ❌       | `0`     | Lines of context before/after match (0-10)       |
| `wholeWord`       | boolean  | ❌       | `false` | Match whole words only                           |
| `isLiteral`       | boolean  | ❌       | `false` | Treat pattern as literal string (escape special) |

**Returns:** Matching lines with file path, line number, content, and optional context.

**Example:**

```json
{
  "path": "/project/src",
  "pattern": "TODO|FIXME",
  "filePattern": "**/*.ts",
  "contextLines": 2
}
```

---

### `analyze_directory`

Analyze a directory structure and return statistics.

| Parameter         | Type     | Required | Default | Description                            |
| ----------------- | -------- | -------- | ------- | -------------------------------------- |
| `path`            | string   | ✅       | -       | Directory to analyze                   |
| `maxDepth`        | number   | ❌       | `10`    | Maximum depth to analyze (0-100)       |
| `topN`            | number   | ❌       | `10`    | Number of top items to return (1-1000) |
| `excludePatterns` | string[] | ❌       | `[]`    | Glob patterns to exclude               |
| `includeHidden`   | boolean  | ❌       | `false` | Include hidden files and directories   |

**Returns:** Statistics including total files/directories, total size, file type distribution, largest files, and recently modified files.

---

### `directory_tree`

Get a JSON tree structure of a directory, optimized for AI parsing.

| Parameter         | Type     | Required | Default | Description                             |
| ----------------- | -------- | -------- | ------- | --------------------------------------- |
| `path`            | string   | ✅       | -       | Directory path to build tree from       |
| `maxDepth`        | number   | ❌       | `5`     | Maximum depth to traverse (0-50)        |
| `excludePatterns` | string[] | ❌       | `[]`    | Glob patterns to exclude                |
| `includeHidden`   | boolean  | ❌       | `false` | Include hidden files and directories    |
| `includeSize`     | boolean  | ❌       | `false` | Include file sizes in the tree          |
| `maxFiles`        | number   | ❌       | -       | Maximum total files to include (1-100k) |

**Returns:** Hierarchical tree structure with file/directory nodes.

---

### `read_media_file`

Read a binary/media file and return it as base64-encoded data.

| Parameter | Type   | Required | Default | Description                            |
| --------- | ------ | -------- | ------- | -------------------------------------- |
| `path`    | string | ✅       | -       | Path to the media file                 |
| `maxSize` | number | ❌       | 50MB    | Maximum file size in bytes (max 500MB) |

**Supported formats:** Images (PNG, JPG, GIF, WebP, SVG, etc.), Audio (MP3, WAV, FLAC, etc.), Video (MP4, WebM, etc.), Fonts (TTF, WOFF, etc.), PDFs, and more.

**Returns:** Base64-encoded data with MIME type, size, and dimensions (for images).

## 🔌 Client Configuration

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/settings.json`:

```json
{
  "mcp": {
    "servers": {
      "filesystem-context": {
        "command": "npx",
        "args": ["-y", "@j0hanz/filesystem-context-mcp@latest"]
      }
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
    "filesystem-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/filesystem-context-mcp@latest"]
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
    "filesystem-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/filesystem-context-mcp@latest"]
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
    "filesystem-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/filesystem-context-mcp@latest"]
    }
  }
}
```

</details>

## 🔒 Security

This server implements multiple layers of security:

| Protection                    | Description                                                               |
| ----------------------------- | ------------------------------------------------------------------------- |
| **Access Control**            | Only explicitly allowed directories are accessible                        |
| **Path Validation**           | All paths are validated before any filesystem operation                   |
| **Symlink Protection**        | Symlinks that resolve outside allowed directories are blocked             |
| **Path Traversal Prevention** | Attempts to escape via `../` are detected and blocked                     |
| **Read-Only Operations**      | Server only performs read operations—no writes, deletes, or modifications |
| **Safe Regex**                | Regular expressions are validated to prevent ReDoS attacks                |
| **Size Limits**               | Configurable limits prevent resource exhaustion                           |

### Security Model

```text
┌─────────────────────────────────────────────────────────┐
│                    MCP Client                           │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│            Filesystem Context MCP Server                │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Path Validation Layer                │  │
│  │  • Normalize paths                                │  │
│  │  • Check against allowed directories              │  │
│  │  • Resolve and validate symlinks                  │  │
│  │  • Block traversal attempts                       │  │
│  └───────────────────────────────────────────────────┘  │
│                         │                               │
│                         ▼                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │            Read-Only File Operations              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Allowed Directories Only                   │
│  /home/user/project  ✅                                 │
│  /home/user/docs     ✅                                 │
│  /etc/passwd         ❌ (blocked)                       │
│  ../../../etc        ❌ (blocked)                       │
└─────────────────────────────────────────────────────────┘
```

## 🛠️ Development

### Prerequisites

- Node.js >= 20.0.0
- npm

### Scripts

| Command                 | Description                      |
| ----------------------- | -------------------------------- |
| `npm run build`         | Compile TypeScript to JavaScript |
| `npm run dev`           | Watch mode with tsx              |
| `npm run start`         | Run compiled server              |
| `npm run test`          | Run tests with Vitest            |
| `npm run test:watch`    | Run tests in watch mode          |
| `npm run test:coverage` | Run tests with coverage report   |
| `npm run lint`          | Run ESLint                       |
| `npm run format`        | Format code with Prettier        |
| `npm run type-check`    | TypeScript type checking         |
| `npm run inspector`     | Test with MCP Inspector          |

### Project Structure

```text
src/
├── index.ts              # Entry point, CLI argument parsing
├── server.ts             # MCP server setup, roots protocol handling
├── config/
│   └── types.ts          # Shared TypeScript types
├── lib/
│   ├── constants.ts      # Configuration constants and limits
│   ├── errors.ts         # Error handling utilities
│   ├── file-operations.ts# Core filesystem operations
│   ├── formatters.ts     # Output formatting utilities
│   ├── fs-helpers.ts     # Low-level filesystem helpers
│   ├── path-utils.ts     # Path manipulation utilities
│   └── path-validation.ts# Security: path validation layer
├── schemas/
│   ├── common.ts         # Shared Zod schemas
│   ├── inputs.ts         # Input validation schemas
│   ├── outputs.ts        # Output validation schemas
│   └── index.ts          # Schema exports
├── tools/
│   ├── analyze-directory.ts
│   ├── directory-tree.ts
│   ├── get-file-info.ts
│   ├── list-allowed-dirs.ts
│   ├── list-directory.ts
│   ├── read-file.ts
│   ├── read-media-file.ts
│   ├── read-multiple-files.ts
│   ├── search-content.ts
│   ├── search-files.ts
│   └── index.ts          # Tool registration
└── __tests__/            # Test files
```

### Testing with MCP Inspector

```bash
npm run inspector
```

This launches the MCP Inspector for interactive testing of all tools.

## ❓ Troubleshooting

| Issue                       | Solution                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| "Access denied" error       | Ensure the path is within an allowed directory. Use `list_allowed_directories` to check. |
| "Path does not exist" error | Verify the path exists. Use `list_directory` to explore available files.                 |
| "File too large" error      | Use `head` or `tail` parameters for partial reading, or increase `maxSize`.              |
| "Binary file" warning       | Use `read_media_file` for binary files, or set `skipBinary=false` in content search.     |
| No directories configured   | Pass directories as CLI arguments or ensure client provides roots via MCP protocol.      |
| Symlink blocked             | Symlinks that resolve outside allowed directories are blocked for security.              |
| Regex timeout               | Simplify the regex pattern or use `isLiteral=true` for literal string search.            |

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests and linting (`npm run lint && npm run test`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Code Style

- Use TypeScript with strict mode
- Follow ESLint configuration
- Use Prettier for formatting
- Write tests for new features
