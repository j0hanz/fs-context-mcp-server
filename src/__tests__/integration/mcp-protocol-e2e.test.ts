import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const EXPECTED_TOOL_NAMES = [
  'roots',
  'ls',
  'find',
  'tree',
  'read',
  'read_many',
  'stat',
  'stat_many',
  'grep',
  'mkdir',
  'write',
  'edit',
  'mv',
  'rm',
  'calculate_hash',
  'diff_files',
  'apply_patch',
  'search_and_replace',
] as const;

interface ClientSession {
  client: Client;
  transport: StdioClientTransport;
}

function comparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

async function startSession(args: string[]): Promise<ClientSession> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx/esm', 'src/index.ts', ...args],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const client = new Client({
    name: 'filesystem-mcp-e2e',
    version: '1.0.0',
  });
  await client.connect(transport);
  return { client, transport };
}

async function closeSession(session: ClientSession | undefined): Promise<void> {
  if (!session) return;
  await session.transport.close();
}

function getToolText(result: unknown): string {
  assert.ok(
    result && typeof result === 'object',
    'Expected tool result object'
  );
  const content = (result as { content?: unknown[] }).content;
  assert.ok(
    Array.isArray(content) && content.length > 0,
    'Expected non-empty content array'
  );
  const textBlock = (content as Array<{ type?: string; text?: string }>).find(
    (block) => block.type === 'text'
  );
  assert.ok(textBlock?.text !== undefined, 'Expected text content block');
  return textBlock.text as string;
}

function getResourceUri(result: unknown): string | undefined {
  assert.ok(result && typeof result === 'object');
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return undefined;
  const link = (content as Array<{ type?: string; uri?: string }>).find(
    (block) => block.type === 'resource_link'
  );
  return link?.uri;
}

function assertToolOk(result: unknown, toolName: string): string {
  assert.ok(
    result && typeof result === 'object',
    `${toolName}: expected result object`
  );
  const isError = (result as { isError?: unknown }).isError;
  assert.ok(!isError, `${toolName} should succeed but returned isError=true`);
  return getToolText(result);
}

function assertToolErrorCode(
  result: unknown,
  toolName: string,
  expectedCode: string
): void {
  assert.ok(
    result && typeof result === 'object',
    `${toolName}: expected result object`
  );
  const isError = (result as { isError?: unknown }).isError;
  assert.ok(isError, `${toolName} should be an error`);
  const text = getToolText(result);
  assert.match(
    text,
    new RegExp(`\\[${expectedCode}\\]`),
    `${toolName}: expected error code ${expectedCode}`
  );
}

function resourceText(resourceResult: unknown): string {
  assert.ok(resourceResult && typeof resourceResult === 'object');
  const contents = (resourceResult as { contents?: unknown }).contents;
  assert.ok(Array.isArray(contents));
  const first = contents[0] as { text?: unknown } | undefined;
  assert.ok(first && typeof first === 'object');
  assert.equal(typeof first.text, 'string');
  return first.text;
}

await it('runs protocol-level MCP regression coverage via SDK client', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-mcp-protocol-'));
  const nestedDir = path.join(tmpRoot, 'dirA', 'nested');
  const outsidePath =
    process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

  let mainSession: ClientSession | undefined;
  let multiRootSession: ClientSession | undefined;
  let allowCwdSession: ClientSession | undefined;
  let allowCwdAliasSession: ClientSession | undefined;

  try {
    await fs.mkdir(nestedDir, { recursive: true });
    await fs.mkdir(path.join(tmpRoot, '.hiddenDir'), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'node_modules', 'pkg'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpRoot, 'hello.txt'),
      'Hello world\nSecond line\nThird line\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'notes.md'),
      '# Notes\nalpha beta\nTODO: task\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpRoot, '.secret.env'),
      'TOKEN=abc123\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpRoot, '.gitignore'),
      'node_modules/\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'node_modules', 'pkg', 'ignored.js'),
      "console.log('ignored');\n",
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'dirA', 'nested', 'data.json'),
      '{"k":1,"name":"sample"}\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'replace-a.txt'),
      'apple banana apple\n'
    );
    await fs.writeFile(path.join(tmpRoot, 'replace-b.txt'), 'apple carrot\n');
    await fs.writeFile(
      path.join(tmpRoot, 'patch-target.txt'),
      'alpha\nbeta\ngamma\n'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'patch-target-mod.txt'),
      'alpha\nBETA\ngamma\n'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'large.txt'),
      `${'A'.repeat(25_050)}\nEND\n`,
      'utf-8'
    );

    mainSession = await startSession([tmpRoot]);
    const { client } = mainSession;

    const listedTools = await client.listTools();
    const listedToolNames = new Set(listedTools.tools.map((tool) => tool.name));
    for (const expectedToolName of EXPECTED_TOOL_NAMES) {
      assert.ok(
        listedToolNames.has(expectedToolName),
        `Missing tool: ${expectedToolName}`
      );
    }

    const prompts = await client.listPrompts();
    assert.ok(prompts.prompts.some((prompt) => prompt.name === 'get-help'));

    const resources = await client.listResources();
    assert.ok(
      resources.resources.some(
        (resource) => resource.uri === 'internal://instructions'
      )
    );

    const prompt = await client.getPrompt({ name: 'get-help' });
    assert.ok(prompt.messages.length > 0);

    const instructions = await client.readResource({
      uri: 'internal://instructions',
    });
    assert.match(resourceText(instructions), /filesystem-mcp/iu);

    const rootsText = assertToolOk(
      await client.callTool({ name: 'roots', arguments: {} }),
      'roots'
    );
    assert.match(rootsText, /\b1 workspace roots/u);

    const lsText = assertToolOk(
      await client.callTool({ name: 'ls', arguments: { path: tmpRoot } }),
      'ls'
    );
    assert.ok(!lsText.includes('.secret.env'));
    assert.ok(!lsText.includes('node_modules'));

    const lsIgnoredText = assertToolOk(
      await client.callTool({
        name: 'ls',
        arguments: { path: tmpRoot, includeIgnored: true },
      }),
      'ls(includeIgnored)'
    );
    assert.ok(lsIgnoredText.includes('node_modules'));

    const findText = assertToolOk(
      await client.callTool({
        name: 'find',
        arguments: { path: tmpRoot, pattern: '**/*.txt' },
      }),
      'find'
    );
    assert.match(findText, /hello\.txt/u);

    assertToolOk(
      await client.callTool({
        name: 'tree',
        arguments: { path: tmpRoot, maxDepth: 2 },
      }),
      'tree'
    );

    const readText = assertToolOk(
      await client.callTool({
        name: 'read',
        arguments: { path: path.join(tmpRoot, 'hello.txt') },
      }),
      'read'
    );
    assert.match(readText, /Hello world/u);

    assertToolOk(
      await client.callTool({
        name: 'read_many',
        arguments: {
          paths: [
            path.join(tmpRoot, 'hello.txt'),
            path.join(tmpRoot, 'notes.md'),
          ],
          head: 1,
        },
      }),
      'read_many'
    );

    const grepText = assertToolOk(
      await client.callTool({
        name: 'grep',
        arguments: {
          path: tmpRoot,
          pattern: 'TODO:\\s+\\w+',
          isRegex: true,
          filePattern: '**/*.md',
        },
      }),
      'grep(regex)'
    );
    assert.match(grepText, /Found \d+/u);

    const statText = assertToolOk(
      await client.callTool({
        name: 'stat',
        arguments: { path: path.join(tmpRoot, 'hello.txt') },
      }),
      'stat'
    );
    assert.match(statText, /\(file\)/u);

    const statManyText = assertToolOk(
      await client.callTool({
        name: 'stat_many',
        arguments: {
          paths: [
            path.join(tmpRoot, 'hello.txt'),
            path.join(tmpRoot, 'missing.txt'),
          ],
        },
      }),
      'stat_many'
    );
    assert.match(statManyText, /missing\.txt/u);

    const fileHashText = assertToolOk(
      await client.callTool({
        name: 'calculate_hash',
        arguments: { path: path.join(tmpRoot, 'hello.txt') },
      }),
      'calculate_hash(file)'
    );
    assert.match(fileHashText, /^[0-9a-f]{64}$/u);

    const dirHashText = assertToolOk(
      await client.callTool({
        name: 'calculate_hash',
        arguments: { path: path.join(tmpRoot, 'dirA') },
      }),
      'calculate_hash(dir)'
    );
    assert.match(dirHashText, /files/u);

    assertToolOk(
      await client.callTool({
        name: 'mkdir',
        arguments: { path: path.join(tmpRoot, 'newdir', 'sub') },
      }),
      'mkdir'
    );

    assertToolOk(
      await client.callTool({
        name: 'write',
        arguments: {
          path: path.join(tmpRoot, 'newdir', 'sub', 'written.txt'),
          content: 'x\ny\n',
        },
      }),
      'write'
    );

    assertToolOk(
      await client.callTool({
        name: 'edit',
        arguments: {
          path: path.join(tmpRoot, 'newdir', 'sub', 'written.txt'),
          edits: [{ oldText: 'x', newText: 'X' }],
          dryRun: true,
        },
      }),
      'edit(dryRun)'
    );

    assertToolOk(
      await client.callTool({
        name: 'edit',
        arguments: {
          path: path.join(tmpRoot, 'newdir', 'sub', 'written.txt'),
          edits: [{ oldText: 'x', newText: 'X' }],
        },
      }),
      'edit(apply)'
    );

    assertToolOk(
      await client.callTool({
        name: 'mv',
        arguments: {
          source: path.join(tmpRoot, 'newdir', 'sub', 'written.txt'),
          destination: path.join(tmpRoot, 'newdir', 'sub', 'moved.txt'),
        },
      }),
      'mv'
    );

    assertToolErrorCode(
      await client.callTool({
        name: 'rm',
        arguments: {
          path: path.join(tmpRoot, 'newdir'),
          recursive: false,
          ignoreIfNotExists: false,
        },
      }),
      'rm(nonRecursiveNonEmpty)',
      'E_INVALID_INPUT'
    );

    assertToolOk(
      await client.callTool({
        name: 'rm',
        arguments: { path: path.join(tmpRoot, 'newdir'), recursive: true },
      }),
      'rm(recursive)'
    );

    assertToolOk(
      await client.callTool({
        name: 'rm',
        arguments: {
          path: path.join(tmpRoot, 'missing-delete.txt'),
          ignoreIfNotExists: true,
        },
      }),
      'rm(ignoreIfNotExists)'
    );

    const diffText = assertToolOk(
      await client.callTool({
        name: 'diff_files',
        arguments: {
          original: path.join(tmpRoot, 'patch-target.txt'),
          modified: path.join(tmpRoot, 'patch-target-mod.txt'),
          context: 1,
        },
      }),
      'diff_files'
    );
    assert.match(diffText, /@@/u);

    assertToolOk(
      await client.callTool({
        name: 'apply_patch',
        arguments: {
          path: path.join(tmpRoot, 'patch-target.txt'),
          patch: diffText,
          dryRun: true,
        },
      }),
      'apply_patch(dryRun)'
    );

    assertToolOk(
      await client.callTool({
        name: 'apply_patch',
        arguments: {
          path: path.join(tmpRoot, 'patch-target.txt'),
          patch: diffText,
          fuzzFactor: 2,
        },
      }),
      'apply_patch(apply)'
    );

    const patchedReadText = assertToolOk(
      await client.callTool({
        name: 'read',
        arguments: { path: path.join(tmpRoot, 'patch-target.txt') },
      }),
      'read(patchedTarget)'
    );
    assert.match(patchedReadText, /BETA/u);

    assertToolOk(
      await client.callTool({
        name: 'search_and_replace',
        arguments: {
          path: tmpRoot,
          filePattern: 'replace-*.txt',
          searchPattern: 'apple',
          replacement: 'orange',
          dryRun: true,
        },
      }),
      'search_and_replace(dryRun)'
    );

    const searchReplaceText = assertToolOk(
      await client.callTool({
        name: 'search_and_replace',
        arguments: {
          path: tmpRoot,
          filePattern: 'replace-a.txt',
          searchPattern: 'apple',
          replacement: 'orange',
        },
      }),
      'search_and_replace(apply)'
    );
    assert.match(searchReplaceText, / 1 /u);

    assertToolErrorCode(
      await client.callTool({
        name: 'read',
        arguments: { path: outsidePath },
      }),
      'security(readOutsideRoot)',
      'E_ACCESS_DENIED'
    );

    assertToolErrorCode(
      await client.callTool({
        name: 'write',
        arguments: { path: outsidePath, content: 'blocked' },
      }),
      'security(writeOutsideRoot)',
      'E_ACCESS_DENIED'
    );

    const largeReadResult = await client.callTool({
      name: 'read',
      arguments: { path: path.join(tmpRoot, 'large.txt') },
    });
    assertToolOk(largeReadResult, 'read(large)');
    const largeResourceUri = getResourceUri(largeReadResult);
    assert.equal(typeof largeResourceUri, 'string');
    const largeResource = await client.readResource({
      uri: largeResourceUri as string,
    });
    const largeText = resourceText(largeResource);
    assert.ok(largeText.length > 20_000);

    multiRootSession = await startSession([
      tmpRoot,
      path.join(tmpRoot, 'dirA'),
    ]);
    assertToolErrorCode(
      await multiRootSession.client.callTool({ name: 'ls', arguments: {} }),
      'multiRoot(lsWithoutPath)',
      'E_INVALID_INPUT'
    );

    allowCwdSession = await startSession(['--allow-cwd']);
    const allowRootsText = assertToolOk(
      await allowCwdSession.client.callTool({ name: 'roots', arguments: {} }),
      'roots(--allow-cwd)'
    );
    assert.ok(
      comparablePath(allowRootsText).includes(comparablePath(process.cwd()))
    );

    allowCwdAliasSession = await startSession(['--allow_cwd']);
    const aliasRootsText = assertToolOk(
      await allowCwdAliasSession.client.callTool({
        name: 'roots',
        arguments: {},
      }),
      'roots(--allow_cwd)'
    );
    assert.ok(
      comparablePath(aliasRootsText).includes(comparablePath(process.cwd()))
    );
  } finally {
    await closeSession(allowCwdAliasSession);
    await closeSession(allowCwdSession);
    await closeSession(multiRootSession);
    await closeSession(mainSession);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
