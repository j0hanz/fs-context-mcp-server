# AGENTS.md

## Project Overview

- **Filesystem Context MCP Server**: A read-only Model Context Protocol server for secure filesystem exploration, searching, and analysis.
- **Stack**: Node.js (>=20.0.0), TypeScript (5.9.3), MCP SDK (1.25.1).

## Repo Map / Structure

- `src/`: Source code (entry points `index.ts`, `server.ts`).
  - `lib/`: Core logic and helpers.
  - `tools/`: MCP tool implementations.
  - `schemas/`: Zod schemas for inputs/outputs.
  - `__tests__/`: Unit and integration tests.
- `dist/`: Compiled JavaScript output (generated).
- `docs/`: Documentation assets (images).
- `scripts/`: Utility scripts (e.g., benchmarks).
- `benchmark/`: Benchmark output results.
- `coverage/`: Test coverage reports.

## Setup & Environment

- Install deps: `npm install`
- Node version: `>=20.0.0` (enforced in package.json).

## Development Workflow

- Dev mode: `npm run dev` (runs `tsx watch src/index.ts`).
- Build: `npm run build` (compiles TS, validates instructions, copies assets).
- Start: `npm run start` (runs `node dist/index.js`).
- Inspector: `npm run inspector` (launches MCP Inspector).

## Testing

- All tests: `npm run test` (Vitest).
- Watch mode: `npm run test:watch`.
- Coverage: `npm run test:coverage`.
- Benchmarks: `npm run bench`.
- Test locations: `src/__tests__/` and `*.test.ts` files.

## Code Style & Conventions

- Language: TypeScript (Target ES2022, Module NodeNext).
- Lint: `npm run lint` (ESLint with `typescript-eslint` strict & stylistic rules).
- Format: `npm run format` (Prettier).
- Type-check: `npm run type-check` (tsc --noEmit).
- Conventions:
  - CamelCase for variables/functions.
  - PascalCase for types/classes.
  - Explicit return types required.
  - No `any` allowed.
  - Prefer type imports.

## Build / Release

- Build output: `dist/` directory.
- Pre-publish: `npm run prepublishOnly` (runs lint, type-check, and build).

## Security & Safety

- **Read-only**: No write, delete, or modification capabilities.
- **Path Validation**: Operations restricted to allowed directories; symlinks cannot escape roots.
- **Binary Detection**: Prevents accidental reading of binary files.
- **Input Sanitization**: Regex patterns validated for ReDoS protection.

## Pull Request / Commit Guidelines

- Required checks: `npm run lint`, `npm run type-check`, `npm run test`.
- Commit format: Conventional Commits (implied by repo history).

## Troubleshooting

- **Build errors**: Ensure `src/instructions.md` exists (required by `validate:instructions`).
- **Runtime errors**: Check `list_allowed_directories` if encountering `E_ACCESS_DENIED`.
