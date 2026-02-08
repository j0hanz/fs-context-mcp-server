# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Filesystem operations via an MCP server, enabling LLMs to interact with the filesystem securely and efficiently.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9 (see `package.json`), Node.js 24+ (see `package.json` engines).
  - **Frameworks:** Node.js Native Test Runner (`node:test`) (see `scripts/tasks.mjs`, `src/__tests__/tools/grep-regex-mode.test.ts`).
  - **Key Libraries:**
    - `@modelcontextprotocol/sdk` (MCP implementation) (see `package.json`).
    - `zod` (Schema validation) (see `package.json`, `src/schemas.ts`).
    - `re2` (Safe regular expressions) (see `package.json`).
- **Architecture:**
  - Central `McpServer` instance managed in `src/server.ts`.
  - Tools registered in `src/tools.ts` and implemented in `src/tools/`.
  - Resource management in `src/resources.ts` and `src/lib/resource-store.ts`.
  - Permission/Roots management via `RootsManager` in `src/server.ts`.

## 2) Repository Map (High-Level)

- `src/`: Source code root.
- `src/__tests__/`: Test files (unit and integration) using `node:test`.
- `src/tools/`: Individual MCP tool implementations.
- `src/lib/`: Shared utilities (path validation, error handling, helpers).
- `scripts/`: Build and task orchestration scripts (see `scripts/tasks.mjs`).
- `.github/workflows/`: CI/CD pipelines (see `.github/workflows/publish.yml`).

## 3) Operational Commands (Verified)

- **Environment:** Node.js >=24.
- **Install:** `npm ci` (see `.github/workflows/publish.yml`).
- **Dev:** `npm run dev` (Runs `tsc --watch`) or `npm run dev:run` (Runs server with watch) (see `package.json`).
- **Test:** `npm run test` (Executes `node scripts/tasks.mjs test` which uses `node --test`) (see `package.json`, `scripts/tasks.mjs`).
- **Build:** `npm run build` (Executes `node scripts/tasks.mjs build`) (see `package.json`).
- **Lint/Format:**
  - Lint: `npm run lint` (`eslint .`) (see `package.json`).
  - Format: `npm run format` (`prettier --write .`) (see `package.json`).
- **Type Check:** `npm run type-check` (see `package.json`).

## 4) Coding Standards (Style & Patterns)

- **Naming:** standard TypeScript camelCase; tools are hyphen-separated in usage but likely camelCase in code.
- **Structure:**
  - Tools are distinct modules in `src/tools/`.
  - Validation schemas are centralized or co-located with tools using `zod`.
  - Strict separation of concern between `server.ts` (setup) and `index.ts` (entry point).
- **Typing/Strictness:** strict TypeScript (`strict: true`, `noImplicitOverride`, `noUncheckedIndexedAccess`) (see `tsconfig.json`).
- **Patterns Observed:**
  - Use of `node:fs/promises` for filesystem operations.
  - Custom `scripts/tasks.mjs` for build/test orchestration instead of complex `package.json` chains.
  - Use of `withAllToolsFixture` for integration testing tools (observed in `src/__tests__/tools/grep-regex-mode.test.ts`).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and `package-lock.json`. (see `package.json`)
- Do not edit `package-lock.json` manually.
- Do not commit secrets; never print `.env` values.
- Do not disable or bypass existing lint/type rules without explicit approval (see `eslint.config.mjs`, `tsconfig.json`).
- Do not use `console.log` for logging within the server logic; use the `Logger` or MCP logging capabilities if available (observed `logToMcp` in `src/server.ts`).

## 6) Testing Strategy (Verified)

- **Framework:** `node:test` (Node.js native test runner) (see `scripts/tasks.mjs`).
- **Where tests live:** `src/__tests__/**/*.test.ts` (see `scripts/tasks.mjs`).
- **Approach:**
  - Unit/Integration tests co-located in `src/__tests__`.
  - Heavy use of fixtures (e.g., `withAllToolsFixture`) to simulate server/filesystem state.
  - Assertions using `node:assert/strict`.

## 7) Common Pitfalls (Optional; Verified Only)

- **Large File Handling:** The server has checks for large files (see `src/server.ts` icon check); ensure tools respect size limits.
- **Path Validation:** Windows drive-relative paths and null bytes are explicitly rejected (see `src/server.ts` `validateCliPath`).

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
