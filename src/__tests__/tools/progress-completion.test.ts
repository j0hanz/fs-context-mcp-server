import * as path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withAllToolsFixture } from '../shared/diagnostics-env.js';

interface ProgressNotification {
  method: 'notifications/progress';
  params: {
    progress: number;
    total?: number;
    message?: string;
  };
}

function assertTerminalProgressOnFailure(
  notifications: ProgressNotification[]
): void {
  assert.ok(
    notifications.length >= 2,
    `Expected at least 2 progress notifications, got ${notifications.length}`
  );

  const start = notifications[0];
  assert.ok(start, 'Missing initial progress notification');
  assert.strictEqual(start.params.progress, 0);

  const terminal = notifications.at(-1);
  assert.ok(terminal, 'Missing terminal progress notification');
  assert.strictEqual(terminal.params.total, terminal.params.progress);
  assert.ok(terminal.params.progress > start.params.progress);
  assert.match(terminal.params.message ?? '', /• failed/u);
}

function assertMessagesDoNotContainPath(
  notifications: ProgressNotification[],
  fullPath: string
): void {
  for (const notification of notifications) {
    const message = notification.params.message;
    if (!message) continue;
    assert.strictEqual(
      message.includes(fullPath),
      false,
      `Progress message leaked full path: ${message}`
    );
  }
}

void describe('progress notifications', () => {
  withAllToolsFixture((getHandler, getTestDir) => {
    const missingPath = (): string => path.join(getTestDir(), 'missing-target');

    const createExtra = (
      notifications: ProgressNotification[]
    ): {
      _meta: { progressToken: string };
      sendNotification: (notification: ProgressNotification) => Promise<void>;
    } => ({
      _meta: { progressToken: 'progress-token' },
      sendNotification: async (notification) => {
        notifications.push(notification);
      },
    });

    void it('find emits terminal progress on failure', async () => {
      const handler = getHandler('find');
      const notifications: ProgressNotification[] = [];

      const result = (await handler(
        {
          path: missingPath(),
          pattern: '**/*',
        },
        createExtra(notifications)
      )) as { isError?: boolean };

      assert.strictEqual(result.isError, true);
      assertTerminalProgressOnFailure(notifications);
      assertMessagesDoNotContainPath(notifications, missingPath());
    });

    void it('grep emits terminal progress on failure', async () => {
      const handler = getHandler('grep');
      const notifications: ProgressNotification[] = [];

      const result = (await handler(
        {
          path: missingPath(),
          pattern: 'needle',
          filePattern: '**/*',
        },
        createExtra(notifications)
      )) as { isError?: boolean };

      assert.strictEqual(result.isError, true);
      assertTerminalProgressOnFailure(notifications);
    });

    void it('search_and_replace emits terminal progress on failure', async () => {
      const handler = getHandler('search_and_replace');
      const notifications: ProgressNotification[] = [];

      const result = (await handler(
        {
          path: missingPath(),
          filePattern: '**/*.ts',
          searchPattern: 'x',
          replacement: 'y',
          dryRun: true,
        },
        createExtra(notifications)
      )) as { isError?: boolean };

      assert.strictEqual(result.isError, true);
      assertTerminalProgressOnFailure(notifications);
    });

    void it('calculate_hash emits terminal progress on failure', async () => {
      const handler = getHandler('calculate_hash');
      const notifications: ProgressNotification[] = [];

      const result = (await handler(
        { path: missingPath() },
        createExtra(notifications)
      )) as { isError?: boolean };

      assert.strictEqual(result.isError, true);
      assertTerminalProgressOnFailure(notifications);
    });

    void it('tree emits terminal progress on failure', async () => {
      const handler = getHandler('tree');
      const notifications: ProgressNotification[] = [];

      const result = (await handler(
        { path: missingPath() },
        createExtra(notifications)
      )) as { isError?: boolean };

      assert.strictEqual(result.isError, true);
      assertTerminalProgressOnFailure(notifications);
    });
  });
});
