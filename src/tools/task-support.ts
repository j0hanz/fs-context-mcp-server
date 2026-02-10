import type {
  CreateTaskRequestHandlerExtra,
  TaskRequestHandlerExtra,
  ToolTaskHandler,
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import type {
  AnySchema,
  SchemaOutput,
  ShapeOutput,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestTaskStore } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
  CreateTaskResult,
  GetTaskResult,
  Result,
} from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode, McpError } from '../lib/errors.js';
import type { ToolExtra, ToolResult } from './shared.js';
import { buildToolErrorResponse } from './shared.js';

type TaskToolExtra = ToolExtra & {
  taskId?: string;
  taskStore?: RequestTaskStore;
  taskRequestedTtl?: number | null;
};

type ToolArgs<Args extends ZodRawShapeCompat | AnySchema | undefined> =
  Args extends ZodRawShapeCompat
    ? ShapeOutput<Args>
    : Args extends AnySchema
      ? SchemaOutput<Args>
      : undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isRequestTaskStore(value: unknown): value is RequestTaskStore {
  if (!isRecord(value)) return false;
  return (
    typeof value['createTask'] === 'function' &&
    typeof value['getTask'] === 'function' &&
    typeof value['storeTaskResult'] === 'function' &&
    typeof value['getTaskResult'] === 'function'
  );
}

function isCreateTaskExtra(
  value: unknown
): value is CreateTaskRequestHandlerExtra {
  return isRecord(value) && isRequestTaskStore(value['taskStore']);
}

function isTaskExtra(value: unknown): value is TaskRequestHandlerExtra {
  return (
    isCreateTaskExtra(value) &&
    typeof value['taskId'] === 'string' &&
    value['taskId'].length > 0
  );
}

function asCreateTaskExtra(value: unknown): CreateTaskRequestHandlerExtra {
  if (!isCreateTaskExtra(value)) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Task store not configured for task-capable tool.'
    );
  }
  return value;
}

function asTaskRequestExtra(value: unknown): TaskRequestHandlerExtra {
  if (!isTaskExtra(value)) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Task id or task store missing for task operation.'
    );
  }
  return value;
}

const TASK_STATUSES = new Set<GetTaskResult['status']>([
  'working',
  'input_required',
  'completed',
  'failed',
  'cancelled',
]);

function parseTaskStatus(value: unknown): GetTaskResult['status'] | undefined {
  if (
    value === 'working' ||
    value === 'input_required' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return undefined;
}

function normalizeGetTaskResult(value: unknown): GetTaskResult {
  if (!isRecord(value) || typeof value['taskId'] !== 'string') {
    throw new McpError(ErrorCode.E_INVALID_INPUT, 'Invalid task object.');
  }

  const status = parseTaskStatus(value['status']);
  if (!status || !TASK_STATUSES.has(status)) {
    throw new McpError(ErrorCode.E_INVALID_INPUT, 'Invalid task status.');
  }

  const now = new Date().toISOString();
  const createdAt =
    typeof value['createdAt'] === 'string' ? value['createdAt'] : now;
  const lastUpdatedAt =
    typeof value['lastUpdatedAt'] === 'string'
      ? value['lastUpdatedAt']
      : createdAt;
  const ttl = typeof value['ttl'] === 'number' ? value['ttl'] : null;

  const normalized: GetTaskResult = {
    taskId: value['taskId'],
    status,
    ttl,
    createdAt,
    lastUpdatedAt,
  };

  if (typeof value['pollInterval'] === 'number') {
    normalized.pollInterval = value['pollInterval'];
  }
  if (typeof value['statusMessage'] === 'string') {
    normalized.statusMessage = value['statusMessage'];
  }
  if (isRecord(value['_meta'])) {
    normalized._meta = value['_meta'];
  }

  return normalized;
}

function normalizeCallToolResult(value: Result): CallToolResult {
  const parsed = CallToolResultSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new McpError(
    ErrorCode.E_INVALID_INPUT,
    'Stored task result is not a valid tool result.'
  );
}

function getTaskStore(extra: TaskToolExtra): RequestTaskStore {
  if (!extra.taskStore) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Task store not configured for task-capable tool.'
    );
  }
  return extra.taskStore;
}

function getTaskId(extra: TaskToolExtra): string {
  if (!extra.taskId) {
    throw new McpError(
      ErrorCode.E_INVALID_INPUT,
      'Task id missing for task operation.'
    );
  }
  return extra.taskId;
}

function isErrorResult(result: ToolResult<unknown>): boolean {
  return 'isError' in result && result.isError === true;
}

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function getTaskStatus(task: unknown): string | undefined {
  if (!isRecord(task)) return undefined;
  const { status } = task;
  return typeof status === 'string' ? status : undefined;
}

function isTerminalTaskStatus(status: string | undefined): boolean {
  if (!status) return false;
  return TERMINAL_TASK_STATUSES.has(status);
}

function isTerminalTaskStoreError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('terminal status') ||
    normalized.includes('task not found')
  );
}

async function getCurrentTaskStatus(
  taskStore: RequestTaskStore,
  taskId: string
): Promise<string | undefined> {
  try {
    const task = await taskStore.getTask(taskId);
    return getTaskStatus(task);
  } catch {
    return undefined;
  }
}

async function tryStoreTaskResult(
  taskStore: RequestTaskStore,
  taskId: string,
  status: 'completed' | 'failed',
  result: Result
): Promise<void> {
  const beforeStatus = await getCurrentTaskStatus(taskStore, taskId);
  if (isTerminalTaskStatus(beforeStatus)) return;

  try {
    await taskStore.storeTaskResult(taskId, status, result);
  } catch (error) {
    const afterStatus = await getCurrentTaskStatus(taskStore, taskId);
    if (isTerminalTaskStatus(afterStatus) || isTerminalTaskStoreError(error)) {
      return;
    }
    throw error;
  }
}

export function createToolTaskHandler<Result>(
  run: (args: undefined, extra: TaskToolExtra) => Promise<ToolResult<Result>>,
  options?: { guard?: () => boolean }
): ToolTaskHandler;
export function createToolTaskHandler<
  Args extends ZodRawShapeCompat | AnySchema,
  Result,
>(
  run: (
    args: ToolArgs<Args>,
    extra: TaskToolExtra
  ) => Promise<ToolResult<Result>>,
  options?: { guard?: () => boolean }
): ToolTaskHandler<Args>;
export function createToolTaskHandler<
  Args extends ZodRawShapeCompat | AnySchema | undefined,
  Result,
>(
  run: (
    args: ToolArgs<Args>,
    extra: TaskToolExtra
  ) => Promise<ToolResult<Result>>,
  options?: { guard?: () => boolean }
): ToolTaskHandler<Args> {
  const createTask = (async (
    argsOrExtra: ToolArgs<Args> | CreateTaskRequestHandlerExtra,
    maybeExtra?: CreateTaskRequestHandlerExtra
  ): Promise<CreateTaskResult> => {
    const extra = asCreateTaskExtra(maybeExtra ?? argsOrExtra);
    const args = (maybeExtra ? argsOrExtra : undefined) as ToolArgs<Args>;

    if (options?.guard && !options.guard()) {
      throw new McpError(
        ErrorCode.E_INVALID_INPUT,
        'Client not initialized; wait for notifications/initialized'
      );
    }

    const taskStore = getTaskStore(extra);
    const task = await taskStore.createTask({
      ttl: extra.taskRequestedTtl ?? null,
    });
    const taskExtra: TaskToolExtra = {
      ...extra,
      taskStore,
      taskId: task.taskId,
    };

    void (async () => {
      try {
        const result = await run(args, taskExtra);
        const status = isErrorResult(result) ? 'failed' : 'completed';
        await tryStoreTaskResult(taskStore, task.taskId, status, result);
      } catch (error) {
        const fallback = buildToolErrorResponse(error, ErrorCode.E_UNKNOWN);
        try {
          await tryStoreTaskResult(taskStore, task.taskId, 'failed', fallback);
        } catch {
          // Swallow to avoid unhandled rejections from background task writes.
        }
      }
    })();

    return { task };
  }) as ToolTaskHandler<Args>['createTask'];

  const getTask = (async (
    argsOrExtra: ToolArgs<Args> | TaskRequestHandlerExtra,
    maybeExtra?: TaskRequestHandlerExtra
  ): Promise<GetTaskResult> => {
    const extra = asTaskRequestExtra(maybeExtra ?? argsOrExtra);
    const taskStore = getTaskStore(extra);
    const taskId = getTaskId(extra);
    const task = await taskStore.getTask(taskId);
    return normalizeGetTaskResult(task);
  }) as ToolTaskHandler<Args>['getTask'];

  const getTaskResult = (async (
    argsOrExtra: ToolArgs<Args> | TaskRequestHandlerExtra,
    maybeExtra?: TaskRequestHandlerExtra
  ): Promise<CallToolResult> => {
    const extra = asTaskRequestExtra(maybeExtra ?? argsOrExtra);
    const taskStore = getTaskStore(extra);
    const taskId = getTaskId(extra);
    const result = await taskStore.getTaskResult(taskId);
    return normalizeCallToolResult(result);
  }) as ToolTaskHandler<Args>['getTaskResult'];

  return {
    createTask,
    getTask,
    getTaskResult,
  };
}
