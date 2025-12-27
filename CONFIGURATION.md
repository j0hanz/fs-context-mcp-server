# Configuration Guide

Environment variables for tuning performance and resource limits. **All variables are optional**—defaults work for most use cases.

## Environment Variables

### Performance & Concurrency

| Variable                         | Default         | Range   | Description                              | Increase For         | Decrease For           |
| -------------------------------- | --------------- | ------- | ---------------------------------------- | -------------------- | ---------------------- |
| `UV_THREADPOOL_SIZE`             | `4`             | 1-128   | libuv threadpool size (set before start) | Heavy fs/crypto load | Memory-constrained     |
| `FILESYSTEM_CONTEXT_CONCURRENCY` | Auto (2x cores) | 1-100   | Parallel file operations (auto-detects)  | SSDs, many CPU cores | HDDs, shared systems   |
| `TRAVERSAL_JOBS`                 | `8`             | 1-50    | Directory traversal parallelism          | Fast storage         | Network drives         |
| `REGEX_TIMEOUT`                  | `100`           | 50-1000 | Regex timeout per line (prevents ReDoS)  | Complex patterns     | CI/CD, simple searches |

> **Note:** `UV_THREADPOOL_SIZE` is a Node/libuv setting that must be set **before** the process starts. It affects fs, crypto, dns, and zlib work queued on the threadpool.

### File Size Limits

| Variable          | Default | Range      | Applies To        | Increase For       | Decrease For        |
| ----------------- | ------- | ---------- | ----------------- | ------------------ | ------------------- |
| `MAX_FILE_SIZE`   | 10MB    | 1MB-100MB  | `read_file`       | Large logs/data    | Low memory          |
| `MAX_MEDIA_SIZE`  | 50MB    | 1MB-500MB  | `read_media_file` | High-res images    | Basic image support |
| `MAX_SEARCH_SIZE` | 1MB     | 100KB-10MB | `search_content`  | Large source files | Performance focus   |

### Default Operation Limits

| Variable                      | Default | Range       | Applies To                            |
| ----------------------------- | ------- | ----------- | ------------------------------------- |
| `DEFAULT_DEPTH`               | `10`    | 1-100       | `list_directory`, `analyze_directory` |
| `DEFAULT_RESULTS`             | `100`   | 10-10000    | `search_content`                      |
| `DEFAULT_LIST_MAX_ENTRIES`    | `10000` | 100-100000  | `list_directory`                      |
| `DEFAULT_SEARCH_MAX_FILES`    | `20000` | 100-100000  | `search_content`, `search_files`      |
| `DEFAULT_SEARCH_TIMEOUT`      | `30000` | 100-3600000 | `search_content`, `search_files`      |
| `DEFAULT_TOP`                 | `10`    | 1-1000      | `analyze_directory`                   |
| `DEFAULT_ANALYZE_MAX_ENTRIES` | `20000` | 100-100000  | `analyze_directory`                   |
| `DEFAULT_TREE`                | `5`     | 1-50        | `directory_tree`                      |

## Configuration Examples

### Basic Configuration (VS Code)

```json
{
  "servers": {
    "filesystem-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-context-mcp@latest",
        "${workspaceFolder}"
      ]
    }
  }
}
```

### With Environment Variables

```json
{
  "servers": {
    "filesystem-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-context-mcp@latest",
        "${workspaceFolder}"
      ],
      "env": {
        "PARALLEL_JOBS": "30",
        "REGEX_TIMEOUT": "150",
        "MAX_FILE_SIZE": "20971520"
      }
    }
  }
}
```

### Multiple Directories

```json
{
  "servers": {
    "filesystem-context": {
      "command": "npx",
      "args": [
        "-y",
        "@j0hanz/filesystem-context-mcp@latest",
        "${workspaceFolder}",
        "C:\\additional\\path"
      ]
    }
  }
}
```

## Use Case Profiles

**High-Performance Workstation**

```json
{
  "env": {
    "PARALLEL_JOBS": "40",
    "TRAVERSAL_JOBS": "16",
    "REGEX_TIMEOUT": "200",
    "MAX_FILE_SIZE": "20971520"
  }
}
```

_Use for: Fast SSD, many CPU cores, complex regex searches_

**CI/CD Pipeline**

```json
{
  "env": {
    "PARALLEL_JOBS": "10",
    "REGEX_TIMEOUT": "50",
    "MAX_SEARCH_SIZE": "524288"
  }
}
```

_Use for: Fast execution, minimal resources, literal searches_

**Resource-Constrained**

```json
{
  "env": {
    "PARALLEL_JOBS": "5",
    "TRAVERSAL_JOBS": "3",
    "MAX_FILE_SIZE": "5242880"
  }
}
```

_Use for: Containers, shared servers, slow disks_

## Troubleshooting

| Issue                            | Solution                                     |
| -------------------------------- | -------------------------------------------- |
| Regex timeout warnings           | Increase `REGEX_TIMEOUT` or simplify pattern |
| Environment variable not applied | Restart client, verify JSON syntax           |
| Invalid value warning            | Check range limits in tables above           |

## Command Line Arguments

```bash
# Single directory
filesystem-context-mcp /path/to/project

# Multiple directories
filesystem-context-mcp /path/to/dir1 /path/to/dir2

# Auto use current directory
filesystem-context-mcp --allow-cwd
```

---

**Notes:**

- All `env` values must be strings: `"150"` not `150`
- `${workspaceFolder}` auto-expands in VS Code
- Only configure variables that differ from defaults
