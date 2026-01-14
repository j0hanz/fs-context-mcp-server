# AGENTS.md

## Project Overview

- **Goal**: Secure, read-only Model Context Protocol (MCP) server for filesystem operations.
- **Stack**: Node.js (>=22.17.0), TypeScript 5.9.x, MCP SDK.
- **Key Libraries**: `zod`, `re2`, `safe-regex2`.

## Repo Map / Structure

- `src/`: Source code (`index.ts`, `server.ts`, `tools.ts`, `lib/`).
- `dist/`: Compiled JavaScript output.
- `docs/`: Documentation assets.
- `metrics/`: JSON reports for code quality and churn.
- `node-tests/`: Isolated Node.js runtime tests.
- `scripts/`: PowerShell automation (`Quality-Gates.ps1`).
- `eslint.config.mjs`: Flat config for ESLint.

## Setup & Environment

- **Package Manager**: `npm` (manifest: `package-lock.json`).
- **Install**: `npm install`
- **Requirement**: Node.js >= 22.17.0 (engine).

## Development Workflow

- **Dev Server**: `npm run dev` (runs `src/index.ts` with `tsx watch`).
- **Build**: `npm run build` (cleans, validates, copies assets, compiles).
- **Start Production**: `npm run start` (runs `dist/index.js`).
- **MCP Inspector**: `npm run inspector` (debugs with `@modelcontextprotocol/inspector`).

## Testing

- **Unit Tests**: `npm test` (uses native `node --test` runner).
- **Watch Mode**: `npm run test:watch`
- **Coverage**: `npm run test:coverage`
- **Isolated Node Tests**: `npm run test:node`
- **Locations**: `src/__tests__/**/*.test.ts`, `node-tests/*.test.ts`.

## Code Style & Conventions

- **Lint**: `npm run lint` (ESLint with strict type-checking).
- **Format**: `npm run format` (Prettier).
- **Type Check**: `npm run type-check` (TSC no-emit).
- **Strictness**: `noImplicitOverride`, `noUncheckedIndexedAccess`, `strict` enabled in `tsconfig.json`.

## Build / Release

- **Output Directory**: `dist/`
- **Pre-publish**: `npm run prepublishOnly` (runs lint, type-check, and build).
- **Clean**: `npm run clean`.
- **Assets**: `npm run copy:assets` (syncs `src/instructions.md` to `dist/`).

## Security & Safety

- **Read-Only**: Server is designed to be read-only; no write operations in `src/`.
- **Regex Safety**: Uses `re2` and `safe-regex2` to prevent ReDoS.
- **Path Validation**: `src/lib/path-validation.ts` enforces root containment and blocks symlink escapes.
- **Audit**: `scripts/Quality-Gates.ps1` includes `npm audit` checks (`Get-SecurityMetrics`).
