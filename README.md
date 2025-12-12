# Filesystem Context MCP Server

A secure Model Context Protocol (MCP) server for filesystem scanning, searching, and analysis. Built with TypeScript and the official MCP SDK.

## Security Features

- **Path Validation**: All file operations are restricted to explicitly allowed directories
- **Symlink Attack Prevention**: Symlinks are resolved before validation to prevent escaping allowed directories
- **Path Traversal Protection**: Attempts to access paths outside allowed directories are blocked
- **Read-Only Operations**: All tools are marked with `readOnlyHint` annotation

## Features

This server provides the following tools for filesystem operations:

| Tool                       | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `list_allowed_directories` | List directories this server is allowed to access            |
| `list_directory`           | List files and directories with optional recursive traversal |
| `search_files`             | Search for files using glob patterns                         |
| `read_file`                | Read file contents with optional line range                  |
| `read_multiple_files`      | Read multiple files in parallel efficiently                  |
| `get_file_info`            | Get detailed file/directory metadata                         |
| `search_content`           | Search for text within files using regex patterns            |
| `analyze_directory`        | Analyze directory structure and get statistics               |
| `directory_tree`           | Get JSON tree structure of a directory                       |
| `read_media_file`          | Read binary/media files as base64-encoded data               |

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd filesystem-context-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Running the Server

**Important**: You must specify at least one allowed directory when starting the server:

```bash
# Production mode - specify allowed directories
node dist/index.js /path/to/allowed/dir1 /path/to/allowed/dir2

# Development mode with tsx
npx tsx src/index.ts /path/to/allowed/dir

# Windows example
node dist/index.js C:\Users\Projects C:\Users\Documents
```

### Testing with MCP Inspector

```bash
npm run inspector
```

Then connect to the server via stdio, providing allowed directories as arguments.

### Configuration with MCP Clients

#### Claude Desktop

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "filesystem-context": {
      "command": "node",
      "args": [
        "C:\\path\\to\\filesystem-context-mcp\\dist\\index.js",
        "C:\\Users\\Projects",
        "C:\\Users\\Documents"
      ]
    }
  }
}
```

#### VS Code with Copilot

Add to your VS Code settings or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "filesystem-context": {
        "command": "node",
        "args": ["${workspaceFolder}/dist/index.js", "${workspaceFolder}"]
      }
    }
  }
}
```

## Tool Documentation

All tools return both a human-readable `content` text block and a machine-friendly `structuredContent` payload (with `outputSchema` declared in the server).

### list_directory

List all files and directories in a given path.

**Parameters:**

- `path` (string, required): The directory path to list
- `recursive` (boolean, default: false): Whether to list recursively
- `includeHidden` (boolean, default: false): Include hidden files (dotfiles)
- `maxDepth` (number, default: 10): Maximum depth for recursive listing
- `maxEntries` (number, optional): Maximum number of entries to return (prevents huge responses)

**Example:**

```json
{
  "path": "C:\\Users\\Projects",
  "recursive": true,
  "maxDepth": 2
}
```

### search_files

Search for files and directories matching a glob pattern.

**Parameters:**

- `path` (string, required): Base directory to search from
- `pattern` (string, required): Glob pattern to match (e.g. `**/*.ts`)
- `excludePatterns` (string[], optional): Glob patterns to exclude
- `maxResults` (number, optional): Maximum number of matches to return (prevents huge responses)

**Example:**

```json
{
  "path": "./src",
  "pattern": "**/*.ts",
  "excludePatterns": ["**/*.test.ts"]
}
```

### read_file

Read the contents of a file (optionally a line range).

**Parameters:**

- `path` (string, required): Path to the file
- `encoding` (string, default: "utf-8"): File encoding
- `maxSize` (number, default: 10485760): Maximum file size in bytes (default 10MB)
- `lineStart` (number, optional): Start line (1-based)
- `lineEnd` (number, optional): End line (inclusive)

**Example:**

```json
{
  "path": "./src/index.ts",
  "lineStart": 1,
  "lineEnd": 50
}
```

### get_file_info

Get detailed information about a file or directory.

**Parameters:**

- `path` (string, required): Path to the file or directory

**Returns:** File metadata including size, timestamps, permissions, and type.

### search_content

Search for text content within files using a regular expression.

**Parameters:**

- `path` (string, required): Base directory to search in
- `pattern` (string, required): Regular expression pattern
- `filePattern` (string, default: "\*_/_"): Glob pattern to filter files
- `excludePatterns` (string[], optional): Glob patterns to exclude (e.g. `node_modules/**`)
- `caseSensitive` (boolean, default: false): Case-sensitive search
- `maxResults` (number, default: 100): Maximum number of matches to return
- `maxFileSize` (number, optional): Maximum file size in bytes to scan (default 1MB)
- `maxFilesScanned` (number, optional): Maximum number of files to scan before stopping
- `timeoutMs` (number, optional): Timeout in milliseconds for the search operation
- `skipBinary` (boolean, default: true): Skip likely-binary files

**Example:**

```json
{
  "path": "./src",
  "pattern": "TODO:",
  "filePattern": "**/*.ts",
  "maxResults": 50
}
```

### analyze_directory

Analyze a directory structure and compute summary statistics.

**Parameters:**

- `path` (string, required): Directory path to analyze
- `maxDepth` (number, default: 10): Maximum depth to traverse
- `topN` (number, default: 10): Number of “top” items to return (largest/recent)

**Returns:** Statistics including file counts by extension, total size, largest files, and recently modified files.

### list_allowed_directories

List all directories that this server is allowed to access.

**Parameters:** None

**Returns:** Array of allowed directory paths. Use this to understand the scope of available file operations.

### read_multiple_files

Read the contents of multiple files in parallel. More efficient than reading files one by one.

**Parameters:**

- `paths` (string[], required): Array of file paths to read
- `encoding` (string, default: "utf-8"): File encoding
- `maxSize` (number, default: 10485760): Maximum file size in bytes per file (default 10MB)

**Example:**

```json
{
  "paths": ["./src/index.ts", "./src/server.ts", "./package.json"],
  "encoding": "utf-8"
}
```

**Returns:** Array of results, each containing the file path and either its content or an error message. Individual file errors do not fail the entire operation.

### directory_tree

Get a JSON tree structure of a directory. More efficient for AI parsing than flat file lists.

**Parameters:**

- `path` (string, required): Directory path to build tree from
- `maxDepth` (number, default: 5): Maximum depth to traverse
- `excludePatterns` (string[], optional): Glob patterns to exclude (e.g., `node_modules`, `*.log`)
- `includeHidden` (boolean, default: false): Include hidden files and directories
- `includeSize` (boolean, default: false): Include file sizes in the tree

**Example:**

```json
{
  "path": "./src",
  "maxDepth": 3,
  "excludePatterns": ["__tests__"],
  "includeSize": true
}
```

**Returns:** Nested tree structure with files and directories, useful for understanding project structure.

### read_media_file

Read a binary/media file (image, audio, video, etc.) and return it as base64-encoded data.

**Parameters:**

- `path` (string, required): Path to the media file
- `maxSize` (number, default: 52428800): Maximum file size in bytes (default 50MB)

**Example:**

```json
{
  "path": "./assets/logo.png"
}
```

**Returns:** Object containing the file path, MIME type, size in bytes, and base64-encoded data.

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint

# Build for production
npm run build
```

## Architecture

```text
filesystem-context-mcp/
├── src/
│   ├── index.ts           # Main server entry point
│   └── lib/
│       ├── types.ts       # TypeScript interfaces
│       ├── path-utils.ts  # Path normalization utilities
│       ├── path-validation.ts  # Security validation
│       ├── file-operations.ts  # Core file operations
│       └── formatters.ts  # Output formatting
├── dist/                  # Compiled JavaScript output
├── package.json           # Project configuration
├── tsconfig.json          # TypeScript configuration
└── README.md              # This file
```

The server uses:

- **Transport**: StdioServerTransport for local MCP client integration
- **Schema Validation**: Zod for input/output validation
- **Glob Matching**: `fast-glob` for file pattern matching and `minimatch` for pattern testing
- **Security**: Path validation against allowed directories with symlink resolution

## Security Considerations

- **Required Configuration**: You must specify allowed directories via command line arguments
- **Path Validation**: All paths are validated against allowed directories before any operation
- **Symlink Protection**: Symlinks are resolved to their real paths before validation
- **Read-Only**: The server only performs read operations (no file modifications)
- **Annotations**: All tools are marked with `readOnlyHint: true` for MCP client awareness

## Troubleshooting

### Server not starting

1. Ensure Node.js >= 20.0.0 is installed
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile TypeScript

### Connection issues with MCP clients

1. Check the path in your client configuration is correct
2. Ensure the server is built (`npm run build`)
3. Test with MCP Inspector first: `npx @modelcontextprotocol/inspector`

### File access errors

1. Verify the server process has read permissions
2. Check that file paths are absolute or relative to the working directory
3. Some files (binary, locked) may be skipped during search operations

## License

MIT
