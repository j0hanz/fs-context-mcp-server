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
  if (!task || typeof task !== 'object') return undefined;
  const { status } = task as { status?: unknown };
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
    const extra = (maybeExtra ?? argsOrExtra) as CreateTaskRequestHandlerExtra;
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

    void (async () => {
      try {
        const result = await run(args, extra as TaskToolExtra);
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
    const extra = (maybeExtra ?? argsOrExtra) as TaskRequestHandlerExtra;
    const taskStore = getTaskStore(extra);
    const taskId = getTaskId(extra);
    const task = await taskStore.getTask(taskId);
    return task as GetTaskResult;
  }) as ToolTaskHandler<Args>['getTask'];

  const getTaskResult = (async (
    argsOrExtra: ToolArgs<Args> | TaskRequestHandlerExtra,
    maybeExtra?: TaskRequestHandlerExtra
  ): Promise<CallToolResult> => {
    const extra = (maybeExtra ?? argsOrExtra) as TaskRequestHandlerExtra;
    const taskStore = getTaskStore(extra);
    const taskId = getTaskId(extra);
    return (await taskStore.getTaskResult(taskId)) as CallToolResult;
  }) as ToolTaskHandler<Args>['getTaskResult'];

  return {
    createTask,
    getTask,
    getTaskResult,
  };
}
