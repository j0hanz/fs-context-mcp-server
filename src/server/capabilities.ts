import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

let cachedTaskToolSupport: boolean | undefined;

function detectTaskToolSupport(): boolean {
  if (cachedTaskToolSupport !== undefined) {
    return cachedTaskToolSupport;
  }

  try {
    const probe = new McpServer(
      {
        name: 'filesystem-mcp-capability-probe',
        version: '0.0.0',
      },
      { capabilities: { tools: {} } }
    );
    cachedTaskToolSupport =
      typeof probe.experimental.tasks.registerToolTask === 'function';
    void probe.close().catch(() => {});
  } catch {
    cachedTaskToolSupport = false;
  }

  return cachedTaskToolSupport;
}

export interface CapabilityOptions {
  enablePromptListChanged?: boolean;
  enableTaskToolRequests?: boolean;
}

type ServerCapabilities = NonNullable<
  ConstructorParameters<typeof McpServer>[1]
>['capabilities'];

type NonOptionalServerCapabilities = NonNullable<ServerCapabilities>;

export function buildServerCapabilities(
  options: CapabilityOptions = {}
): NonOptionalServerCapabilities {
  const capabilities: NonOptionalServerCapabilities = {
    logging: {},
    resources: {},
    tools: {},
    prompts: options.enablePromptListChanged ? { listChanged: true } : {},
    completions: {},
  };

  if (options.enableTaskToolRequests) {
    capabilities.tasks = {
      list: {},
      cancel: {},
      requests: { tools: { call: {} } },
    };
  }

  return capabilities;
}

export function supportsTaskToolRequests(): boolean {
  return detectTaskToolSupport();
}
