import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { RequestTaskStore } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Result } from '@modelcontextprotocol/sdk/types.js';

import { createToolTaskHandler } from '../../tools/task-support.js';

interface TaskState {
  status: string;
  result?: Result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(5);
  }
  assert.fail('Timed out waiting for task completion');
}

function createInMemoryTaskStore(): {
  taskStore: RequestTaskStore;
  tasks: Map<string, TaskState>;
} {
  const tasks = new Map<string, TaskState>();
  let nextId = 1;

  const taskStore = {
    createTask: async () => {
      const taskId = `task-${String(nextId++)}`;
      tasks.set(taskId, { status: 'running' });
      return { taskId, status: 'running' };
    },
    getTask: async (taskId: string) => {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error('task not found');
      }
      return { taskId, status: task.status };
    },
    storeTaskResult: async (
      taskId: string,
      status: 'completed' | 'failed',
      result: Result
    ) => {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error('task not found');
      }
      if (task.status === 'completed' || task.status === 'failed') {
        throw new Error('task has terminal status');
      }
      task.status = status;
      task.result = result;
    },
    getTaskResult: async (taskId: string) => {
      const task = tasks.get(taskId);
      if (!task || !task.result) {
        throw new Error('task result not found');
      }
      return task.result;
    },
  } as unknown as RequestTaskStore;

  return { taskStore, tasks };
}

await it('stores completed background task results', async () => {
  const { taskStore, tasks } = createInMemoryTaskStore();

  const handler = createToolTaskHandler(async () => {
    return {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true },
    };
  });

  const createResult = await handler.createTask({ taskStore });
  const taskId = createResult.task.taskId;

  await waitFor(() => tasks.get(taskId)?.status === 'completed');

  const taskResult = await handler.getTaskResult({ taskStore, taskId });
  assert.strictEqual(taskResult.isError, undefined);
});

await it('does not emit unhandled rejections when result storage races terminal task status', async () => {
  const tasks = new Map<string, TaskState>();
  let storeAttempts = 0;

  const taskStore = {
    createTask: async () => {
      const taskId = 'task-race';
      tasks.set(taskId, { status: 'running' });
      return { taskId, status: 'running' };
    },
    getTask: async (taskId: string) => {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error('task not found');
      }
      return { taskId, status: task.status };
    },
    storeTaskResult: async (
      taskId: string,
      _status: 'completed' | 'failed',
      _result: Result
    ) => {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error('task not found');
      }
      storeAttempts += 1;
      task.status = 'cancelled';
      throw new Error('task has terminal status cancelled');
    },
    getTaskResult: async () => {
      throw new Error('not used');
    },
  } as unknown as RequestTaskStore;

  const unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason);
  };

  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const handler = createToolTaskHandler(async () => {
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { ok: true },
      };
    });

    await handler.createTask({ taskStore });
    await sleep(50);

    assert.strictEqual(storeAttempts, 1);
    assert.strictEqual(tasks.get('task-race')?.status, 'cancelled');
    assert.strictEqual(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
});
