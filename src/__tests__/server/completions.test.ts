import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { getPathCompletions, registerCompletions } from '../../completions.js';
import {
  getAllowedDirectories,
  normalizePath,
  setAllowedDirectoriesResolved,
} from '../../lib/path-validation.js';

interface CompletionRequest {
  params: {
    argument: {
      name: string;
      value: string;
    };
    ref?: unknown;
    context?: {
      arguments?: Record<string, string>;
    };
  };
}

interface CompletionResponse {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
}

async function createCompletionRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'index.ts'),
    'export const value = 1;\n'
  );
  return normalizePath(root);
}

async function cleanupRoots(roots: readonly string[]): Promise<void> {
  await Promise.all(
    roots.map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    })
  );
}

async function withAllowedRoots(
  roots: readonly string[],
  run: () => Promise<void>
): Promise<void> {
  const previous = getAllowedDirectories();
  await setAllowedDirectoriesResolved(roots);
  try {
    await run();
  } finally {
    await setAllowedDirectoriesResolved(previous);
  }
}

function createCompletionHandlerCapture(): {
  fakeServer: McpServer;
  getHandler: () => (request: CompletionRequest) => Promise<CompletionResponse>;
} {
  let captured:
    | ((request: CompletionRequest) => Promise<CompletionResponse>)
    | undefined;

  const fakeServer = {
    server: {
      setRequestHandler: (_schema: unknown, handler: unknown) => {
        captured = handler as (
          request: CompletionRequest
        ) => Promise<CompletionResponse>;
      },
    },
  } as unknown as McpServer;

  return {
    fakeServer,
    getHandler: () => {
      assert.ok(captured);
      return captured;
    },
  };
}

await it('completes relative paths against a single allowed root', async () => {
  const root = await createCompletionRoot('mcp-completion-single-');
  const expected = path.join(root, 'src', 'index.ts');

  try {
    await withAllowedRoots([root], async () => {
      const result = await getPathCompletions(`src${path.sep}in`);
      assert.ok(result.values.includes(expected));
    });
  } finally {
    await cleanupRoots([root]);
  }
});

await it('suggests matching root prefixes when relative context is ambiguous', async () => {
  const alphaRoot = await createCompletionRoot('alpha-root-');
  const betaRoot = await createCompletionRoot('beta-root-');
  const expected = `${alphaRoot}${path.sep}`;

  try {
    await withAllowedRoots([alphaRoot, betaRoot], async () => {
      const result = await getPathCompletions('alpha');
      assert.ok(result.values.includes(expected));
      assert.strictEqual(
        result.values.some((value) => value.startsWith(betaRoot)),
        false
      );
    });
  } finally {
    await cleanupRoots([alphaRoot, betaRoot]);
  }
});

await it('treats plural path argument names as completion targets', async () => {
  const root = await createCompletionRoot('mcp-completion-handler-');

  try {
    await withAllowedRoots([root], async () => {
      const { fakeServer, getHandler } = createCompletionHandlerCapture();
      registerCompletions(fakeServer);
      const handler = getHandler();

      const nonPathResult = await handler({
        params: { argument: { name: 'query', value: '' } },
      });
      assert.deepStrictEqual(nonPathResult.completion.values, []);

      const pathResult = await handler({
        params: { argument: { name: 'paths', value: '' } },
      });
      assert.ok(pathResult.completion.values.includes(root));
    });
  } finally {
    await cleanupRoots([root]);
  }
});

await it('uses context arguments to scope path completions', async () => {
  const root = await createCompletionRoot('mcp-completion-context-');
  const expected = path.join(root, 'src', 'index.ts');

  try {
    await withAllowedRoots([root], async () => {
      const { fakeServer, getHandler } = createCompletionHandlerCapture();
      registerCompletions(fakeServer);
      const handler = getHandler();

      const result = await handler({
        params: {
          argument: { name: 'destination', value: '' },
          context: {
            arguments: {
              source: path.join(root, 'src', 'index.ts'),
            },
          },
        },
      });

      assert.ok(result.completion.values.includes(expected));
    });
  } finally {
    await cleanupRoots([root]);
  }
});

await it('treats resource template variables as path arguments when ref is path-like', async () => {
  const root = await createCompletionRoot('mcp-completion-ref-');

  try {
    await withAllowedRoots([root], async () => {
      const { fakeServer, getHandler } = createCompletionHandlerCapture();
      registerCompletions(fakeServer);
      const handler = getHandler();

      const result = await handler({
        params: {
          argument: { name: 'workspace', value: '' },
          ref: {
            type: 'ref/resource',
            uri: 'file:///{workspace}',
          },
        },
      });

      assert.ok(result.completion.values.includes(root));
    });
  } finally {
    await cleanupRoots([root]);
  }
});
