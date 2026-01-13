# Configuration Guide

All configuration is optional. Defaults work for most use cases.

## Directory Access

- Pass directory paths as CLI arguments to define allowed roots.
- Use `--allow-cwd` to add the current working directory as an allowed root.
- If the MCP client supports Roots, its roots are used when no CLI paths are provided.
- If CLI paths and/or `--allow-cwd` are provided, client roots are only accepted if they are within those baseline directories.
- If nothing is configured and the client provides no roots, the server starts with no accessible directories and logs a warning until roots are provided.
- Windows drive-relative paths like `C:path` are rejected. Use `C:\path` or `C:/path`.
- Reserved Windows device names (e.g., `CON`, `NUL`) are blocked.

## Environment Variables

All optional. Sizes in bytes, timeouts in milliseconds.

| Variable                    | Default           | Description                                               |
| --------------------------- | ----------------- | --------------------------------------------------------- |
| `MAX_FILE_SIZE`             | 10MB              | Max file size for `read`/`read_many` (range: 1MB-100MB)   |
| `MAX_SEARCH_SIZE`           | 1MB               | Max file size scanned by `grep` (range: 100KB-10MB)       |
| `DEFAULT_SEARCH_TIMEOUT`    | 30000             | Timeout for search/list operations (range: 100-3600000ms) |
| `FS_CONTEXT_SEARCH_WORKERS` | min(cpu cores, 8) | Search worker threads (range: 0-16; 0 disables)           |

## Configuration Examples

### Basic Configuration (VS Code)

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

### With Environment Variables

```json
{
  "servers": {
    "fs-context": {
      "command": "npx",
      "args": ["-y", "@j0hanz/fs-context-mcp@latest", "${workspaceFolder}"],
      "env": {
        "MAX_FILE_SIZE": "20971520",
        "DEFAULT_SEARCH_TIMEOUT": "60000"
      }
    }
  }
}
```

### Multiple Directories

```json
{
  "servers": {
    "fs-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/fs-context-mcp@latest",
        "${workspaceFolder}",
        "C:\\additional\\path"
      ]
    }
  }
}
```

## Troubleshooting

| Issue                            | Solution                              |
| -------------------------------- | ------------------------------------- |
| Invalid pattern                  | Simplify the pattern                  |
| Environment variable not applied | Restart client, verify JSON syntax    |
| Invalid value warning            | Check range limits in the table above |

## Command Line Arguments

```bash
# Single directory
fs-context-mcp /path/to/project

# Multiple directories
fs-context-mcp /path/to/dir1 /path/to/dir2

# Allow current working directory (optional)
fs-context-mcp --allow-cwd

# Allow current directory plus explicit roots
fs-context-mcp --allow-cwd /path/to/project
```

---

Notes:

- All `env` values must be strings: `"150"` not `150`.
- `${workspaceFolder}` auto-expands in VS Code.
- Only configure variables that differ from defaults.
