# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Read-only Model Context Protocol (MCP) server for secure filesystem exploration, searching, and analysis.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9.x (see `package.json`, `tsconfig.json`), Node.js >=24 (see `package.json`, `.github/workflows/publish.yml`).
  - **Frameworks:** Node.js native test runner (see `scripts/tasks.mjs`), MCP SDK (`@modelcontextprotocol/sdk`).
  - **Key Libraries:** `zod` (validation), `knip` (unused exports), `tsx` (execution).
- **Architecture:** Modular MCP server with tools separated in `src/tools/`, core server logic in `src/server.ts`, and shared utilities in `src/lib/`.

## 2) Repository Map (High-Level)

- `src/`: Source code root.
  - `server.ts`: Main `McpServer` setup and entry point logic.
  - `tools.ts`: Tool registration and orchestration.
  - `tools/`: Individual tool implementations (e.g., `list-directory.ts`, `read.ts`).
  - `lib/`: Shared utilities (path validation, error handling).
  - `schemas.ts`: Zod schemas for tool inputs.
  - `__tests__/`: Unit and integration tests.
- `scripts/`: Build and maintenance scripts (e.g., `tasks.mjs`).
- `node-tests/`: Additional Node.js specific tests.
- `dist/`: Compiled output (ignored).

## 3) Operational Commands (Verified)

- **Environment:** Node.js >=24 (see `package.json` engines).
- **Install:** `npm ci` (see `.github/workflows/publish.yml`).
- **Dev:** `npm run dev` (runs `tsc --watch`).
- **Dev Run:** `npm run dev:run` (runs `node --watch dist/index.js`).
- **Test:** `npm run test` (runs `node scripts/tasks.mjs test` -> `node --test`).
- **Build:** `npm run build` (runs `node scripts/tasks.mjs build`).
- **Lint:** `npm run lint` (runs `eslint .`).
- **Type Check:** `npm run type-check` (runs `node scripts/tasks.mjs type-check`).
- **Format:** `npm run format` (runs `prettier --write .`).

## 4) Coding Standards (Style & Patterns)

- **Naming:** CamelCase for functions/variables, PascalCase for classes/types.
- **Structure:**
  - Tools are registered in `src/tools.ts` and implemented in `src/tools/*.ts`.
  - Shared logic (like error handling) resides in `src/lib/`.
- **Typing/Strictness:** strict mode enabled (see `tsconfig.json`).
- **Patterns Observed:**
  - Use `node:` prefix for built-in modules (e.g., `import * as fs from 'node:fs/promises'`; observed in `src/server.ts`).
  - Zod schemas used for runtime validation of inputs (observed in `src/schemas.ts`, `src/server.ts`).
  - Custom `McpError` class for error handling (observed in `src/server.ts`).
  - Use of `void` operator for floating promises in tests (e.g., `void it(...)`; observed in `src/__tests__/tools/tool-defaults.test.ts`).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and running `npm install`.
- Do not edit `package-lock.json` manually.
- Do not use `console.log` for production logging; use MCP logging facilities or structured error responses.
- Do not bypass `eslint` or `prettier` rules; ensure `npm run lint` passes.
- Do not use `require` syntax; use ES Modules (`import`/`export`) as per `type: module` in `package.json`.

## 6) Testing Strategy (Verified)

- **Framework:** Node.js native test runner (`node --test`).
- **Where tests live:** `src/__tests__/**/*.test.ts` and `node-tests/`.
- **Approach:**
  - Unit tests for individual tools using `node:test` and `node:assert`.
  - Integration tests for server capabilities.
  - Tests typically use `await it(...)` or `void it(...)`.

## 7) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
