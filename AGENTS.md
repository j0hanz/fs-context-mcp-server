# AGENTS.md

## Project Overview

- Secure, read-only MCP server for filesystem exploration (list/search/read/stat).
- Tech: TypeScript (ESM, `type: module`), Node.js `>=20.0.0`, `@modelcontextprotocol/sdk`.
- Published package: `@j0hanz/fs-context-mcp` (CLI bin: `fs-context-mcp`).

## Repo Map / Structure

- `src/`: TypeScript source for the MCP server.
  - `src/index.ts`: CLI entry point.
  - `src/server.ts`: Server wiring + roots handling.
  - `src/tools.ts`: Tool registration.
  - `src/schemas.ts`: Zod schemas.
  - `src/lib/`: Core logic (fs helpers, path validation, file operations, observability).
  - `src/__tests__/`: `node:test` test suite (`*.test.ts`).
  - `src/instructions.md`: Tool usage instructions copied into the build output.
- `node-tests/`: Extra Node.js tests (invoked by `npm run test:node`).
- `scripts/Quality-Gates.ps1`: PowerShell quality gates (measure/compare/safe-refactor).
- `.github/workflows/publish.yml`: Release-triggered CI publish workflow.
- `docs/`: Static assets (currently `docs/logo.png`).
- `dist/`: Build output (generated).
- `CONFIGURATION.md`: Environment variable + CLI configuration reference.

## Setup & Environment

- Node.js: `>=20.0.0` (see `package.json#engines`).
- Package manager: npm (repo includes `package-lock.json`).
- Install deps (local dev): `npm install`
- Install deps (CI/clean): `npm ci`
- Config docs: `CONFIGURATION.md` and `README.md`.

## Development Workflow

- Dev (watch): `npm run dev`
- Build: `npm run build`
  - Runs `tsc -p tsconfig.build.json`, then `npm run validate:instructions`, then `npm run copy:assets`.
- Run built server: `npm run start`
- Clean build output: `npm run clean`
- MCP Inspector (manual testing): `npm run inspector`

## Testing

- All tests: `npm test`
  - Uses Node’s built-in test runner with TS via `tsx/esm` (see `package.json#scripts.test`).
  - Test files live under `src/__tests__/` and match `src/__tests__/**/*.test.ts`.
- Watch mode: `npm run test:watch`
- Coverage: `npm run test:coverage`
- Extra Node test: `npm run test:node`

## Code Style & Conventions

- TypeScript config: `tsconfig.json` (ESM `NodeNext`, strict).
- Lint: `npm run lint` (config in `eslint.config.mjs`).
- Format: `npm run format` (config in `.prettierrc`, includes import sorting).
- Repo-specific implementation rules for TS/JS/package edits:
  - `.github/instructions/typescript-mcp-server.instructions.md`
  - `.github/instructions/zod-v4.instructions.md`

## Build / Release

- Build output: `dist/` (see `package.json#main`, `#types`, `#bin`).
- Publish pipeline: GitHub Release publish triggers `.github/workflows/publish.yml`.
  - CI runs: `npm ci`, `npm run lint`, `npm run type-check`, `npm run test`, `npm run build`.
  - Version is derived from the release tag name (strips leading `v`) and applied with `npm version ... --no-git-tag-version`.
  - Publishes with `npm publish --access public` (Trusted Publishing / OIDC).
- Local prepublish guard: `npm run prepublishOnly` runs `lint`, `type-check`, `build`.

## Security & Safety

- This server is intentionally read-only; do not add write/delete operations without a deliberate security review.
- Access is restricted to explicitly allowed roots (CLI args, `--allow-cwd`, and/or client-provided MCP Roots); see `README.md` / `CONFIGURATION.md`.
- Windows-specific constraints are documented (e.g., drive-relative paths like `C:path` are rejected; reserved device names blocked).
- Resource limits are configurable via env vars (see `CONFIGURATION.md`):
  - `MAX_FILE_SIZE`, `MAX_SEARCH_SIZE`, `DEFAULT_SEARCH_TIMEOUT`, `FS_CONTEXT_SEARCH_WORKERS`.
- Regex search is validated to avoid ReDoS (see dependencies like `re2` / `safe-regex2`).
