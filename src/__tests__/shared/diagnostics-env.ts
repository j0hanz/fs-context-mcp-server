import assert from 'node:assert/strict';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAllTools } from '../../tools.js';
import { withFileOpsFixture } from '../lib/fixtures/file-ops-hooks.js';

export interface DiagnosticsEnvSnapshot {
  diagnostics?: string;
  diagnosticsDetail?: string;
}

const restoreEnv = (key: string, previous: string | undefined): void => {
  if (previous === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = previous;
};

export function enableDiagnosticsEnv(): DiagnosticsEnvSnapshot {
  const previousEnabled = process.env.FS_CONTEXT_DIAGNOSTICS;
  const previousDetail = process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL;
  process.env.FS_CONTEXT_DIAGNOSTICS = '1';
  process.env.FS_CONTEXT_DIAGNOSTICS_DETAIL = '0';
  return {
    diagnostics: previousEnabled,
    diagnosticsDetail: previousDetail,
  };
}

export function restoreDiagnosticsEnv(snapshot: DiagnosticsEnvSnapshot): void {
  restoreEnv('FS_CONTEXT_DIAGNOSTICS', snapshot.diagnostics);
  restoreEnv('FS_CONTEXT_DIAGNOSTICS_DETAIL', snapshot.diagnosticsDetail);
}

export type ToolHandler = (args?: unknown, extra?: unknown) => Promise<unknown>;

function createNamedToolCapture(): {
  fakeServer: McpServer;
  getHandler: (name: string) => ToolHandler;
} {
  const handlers = new Map<string, ToolHandler>();

  const fakeServer = {
    registerTool: (name: string, _definition: unknown, handler: unknown) => {
      handlers.set(name, handler as ToolHandler);
    },
  } as const;

  return {
    fakeServer: fakeServer as unknown as McpServer,
    getHandler: (name: string) => {
      const handler = handlers.get(name);
      assert.ok(handler, `Expected tool handler to be registered: ${name}`);
      return handler;
    },
  };
}

export function createSingleToolCapture(): {
  fakeServer: McpServer;
  getHandler: () => ToolHandler;
} {
  let captured: ToolHandler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _definition: unknown, handler: unknown) => {
      captured = handler as ToolHandler;
    },
  } as const;

  return {
    fakeServer: fakeServer as unknown as McpServer,
    getHandler: () => {
      assert.ok(captured);
      return captured;
    },
  };
}

export function withAllToolsFixture(
  fn: (
    getHandler: (name: string) => ToolHandler,
    getTestDir: () => string
  ) => void
): void {
  withFileOpsFixture((getTestDir) => {
    const { fakeServer, getHandler } = createNamedToolCapture();
    registerAllTools(fakeServer);
    fn(getHandler, getTestDir);
  });
}
