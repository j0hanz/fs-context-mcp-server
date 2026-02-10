# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Model Context Protocol (MCP) Server for filesystem operations (reading, writing, searching, analyzing files).
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9.3, Node.js >= 24 (see `package.json`, `.github/workflows/publish.yml`)
  - **Frameworks:** Node.js native test runner (see `package.json` scripts)
  - **Key Libraries:** `@modelcontextprotocol/sdk`, `zod`, `commander`, `diff` (see `package.json`)
- **Architecture:** Modular MCP Server with tool-based architecture.
  - Entry point: `src/index.ts` handles CLI and signals.
  - Server logic: `src/server.ts` manages the `McpServer` instance and `RootsManager`.
  - Tools: `src/tools/` contains individual tool implementations, registered via `src/tools.ts`.

## 2) Repository Map (High-Level)

- `src/`: Core source code (TypeScript).
- `src/tools/`: Individual tool implementations (read, write, search, etc.).
- `src/lib/`: Shared utilities (fs-helpers, path-validation, errors).
- `src/__tests__/`: Unit and integration tests (see `package.json` `test:fast` script).
- `scripts/`: Build and maintenance scripts (e.g., `tasks.mjs`).
- `.github/workflows/`: CI/CD pipelines (verified source of truth for commands).
- `node-tests/`: Additional specific Node.js tests.
  > Ignore generated/vendor dirs like `dist/`, `node_modules/`.

## 3) Operational Commands (Verified)

- **Environment:** Node.js v24 (see `.github/workflows/publish.yml`)
- **Install:** `npm ci` (see `.github/workflows/publish.yml`)
- **Dev:** `npm run dev` (runs `tsc --watch`) (see `package.json`)
- **Test:** `npm run test` (runs `node scripts/tasks.mjs test`) or `npm run test:fast` (runs `node --test ... src/__tests__/**/*.test.ts`) (see `package.json`, `.github/workflows/publish.yml`)
- **Build:** `npm run build` (runs `node scripts/tasks.mjs build`) (see `.github/workflows/publish.yml`)
- **Lint:** `npm run lint` (runs `eslint .`) (see `.github/workflows/publish.yml`)
- **Format:** `npm run format` (runs `prettier --write .`) (see `package.json`)
- **Type Check:** `npm run type-check` (runs `node scripts/tasks.mjs type-check`) (see `.github/workflows/publish.yml`)

## 4) Coding Standards (Style & Patterns)

- **Naming:** `kebab-case` for filenames (e.g., `src/tools/read-multiple.ts`), `camelCase` for functions/variables (observed in `src/tools/read.ts`).
- **Structure:**
  - Tools are isolated in `src/tools/` and must be registered in `src/tools.ts`.
  - Shared logic resides in `src/lib/`.
  - Schemas are often defined in `src/schemas.ts` or locally using `zod`.
- **Typing/Strictness:** strict TypeScript configuration (`strict: true`, `noImplicitOverride`, `noImplicitReturns` in `tsconfig.json`).
- **Patterns Observed:**
  - **Tool Wrapper Pattern:** Tools are wrapped with `withToolDiagnostics` and `withToolErrorHandling` for consistent observability and error reporting (observed in `src/tools/read.ts`).
  - **Resource Externalization:** Large content is externalized as a resource URI instead of being returned inline (observed in `src/tools/read.ts`).
  - **Roots Management:** `RootsManager` class in `src/server.ts` handles allowed directories and security.
  - **CLI/Server Split:** `src/cli.ts` handles arguments, `src/index.ts` drives the process, `src/server.ts` defines the MCP server.

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and `package-lock.json`.
- Do not edit `package-lock.json` manually; use `npm install`.
- Do not bypass strict type checks; use `any` only as a last resort and with a comment.
- Do not implement tools without adding them to `registerAllTools` in `src/tools.ts`.
- Do not ignore the `RootsManager` security model; all file access must be validated against allowed directories.

## 6) Testing Strategy (Verified)

- **Framework:** Node.js native test runner (`node --test`) (see `package.json`).
- **Where tests live:** `src/__tests__/` (main suite), `node-tests/` (specific scenarios).
- **Approach:**
  - Unit tests for individual tools and library functions.
  - Tests are written in TypeScript and run via `tsx` or compiled code (implied by `tsx/esm` in `test:fast` script).

## 7) Common Pitfalls (Verified Only)

- **Path Validation:** All file operations must use `normalizePath` and `isPathWithinDirectories` from `src/lib/path-validation.ts` to ensure security (observed in `src/server.ts`).
- **Large Files:** Reading large files must handle truncation or externalization to resources (observed in `src/tools/read.ts`).

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
