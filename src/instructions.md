# FS-Context MCP Server Instructions

<!-- path: src/instructions.md -->

> Guidance for the Agent: These instructions are available as a resource (`internal://instructions`) or prompt (`get-help`). Load them when you are unsure about tool usage.

## 1. Core Capability

- **Domain:** Read-only filesystem exploration, search, and inspection within explicitly allowed roots.
- **Primary Resources:** Directory trees, file content, metadata, and search results.

## 2. The "Golden Path" Workflows (Critical)

_Describe the standard order of operations using ONLY tools that exist._

### Workflow A: Discovery & Navigation

1. Call `roots` to confirm designated access points.
2. Call `ls` (for single directory) or `tree` (for structure) to map layout.
   > Constraint: Never guess paths. Always list first.

### Workflow B: Search & Retrieval

1. Call `find` to locate files by name/glob pattern.
2. Call `grep` to find code by content/regex.
3. Call `read` (single) or `read_many` (batch) to inspect specific files.
   > Constraint: Large readings return incomplete previews with resource URIs.

## 3. Tool Nuances & Gotchas

_Do NOT repeat JSON schema. Focus on behavior and pitfalls._

- **`ls`**
  - **Purpose:** Non-recursive directory listing.
  - **Inputs:** `path` (relative to root). default: root.
  - **Limits:** Not recursive; use `tree` or `find` for depth.
  - **Multi-root:** When multiple roots are configured, pass an absolute path to disambiguate (relative paths are rejected).

- **`find`**
  - **Purpose:** Recursive file search by globs.
  - **Inputs:** `pattern` (glob like `**/*.ts`), `path` (base dir).
  - **Latency:** Scans disk; bounded by `maxResults` (default 100).

- **`grep`**
  - **Purpose:** Content search using RE2 regex.
  - **Inputs:** `pattern` (regex), `path` (base).
  - **Limits:** Skips binaries & files >1MB. Truncates results >50 matches.

- **`read` / `read_many`**
  - **Purpose:** Read file contents.
  - **Inputs:** `path`/`paths`. Optional: `head` (first N lines) OR `startLine`/`endLine`.
  - **Gotchas:** `head` is mutually exclusive with `startLine`/`endLine`. Large content returns `resourceUri` link.

- **`tree`**
  - **Purpose:** ASCII + JSON tree visualization.
  - **Limits:** Max depth/entries apply. Good for high-level "glance".

## 4. Error Handling Strategy

- **`E_ACCESS_DENIED`**: You are trying to access a path outside allowed `roots`.
- **`E_NOT_FOUND`**: Re-run `ls` or `find` to verify the path exists.
- **`E_TIMEOUT`**: Reduce scope (subdir) or batch size.
- **Resource Links**: Content was too large for inline. Read the provided URI to get full content.
