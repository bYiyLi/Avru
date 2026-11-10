/**
 * The six browser MCP tools (M1, T7). Pure dispatch over Executions plus the
 * static SDK docs table; the MCP transport lives in mcp.ts. Tool errors are
 * thrown as Error('CODE') (TOPIC_NOT_FOUND carries the topic after a colon);
 * the transport maps them to isError tool results. Per-tool OAuth scopes
 * (mcp.md, M1 provisional): read tools need browser:read, control tools
 * need browser:control. browser_sdk_docs needs no execution runtime; the
 * other five report DAEMON_UNAVAILABLE when none is attached.
 */
import type { Executions } from '../executions.js';
import { sdkDocIndex, sdkDocs, SDK_DOCS_VERSION } from './sdk-docs.js';
import { readScope, controlScope } from './config.js';

export interface ToolContext {
  executions?: Executions | undefined;
  owner: string;
  scopes: string[];
  /** Server-generated MCP correlation IDs; not script or page data. */
  audit?: { traceId: string; requestId: string };
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scopes: string[];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const BROWSER_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'browser_list',
    description:
      'List connected browsers and their tabs (read-only discovery).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000 },
        cursor: { type: 'string' },
        browserId: { type: 'string' },
      },
      additionalProperties: false,
    },
    scopes: [readScope],
    annotations: readOnly,
  },
  {
    name: 'browser_claim_tab',
    description:
      'Optional internal tab reservation; browser_run_script automatically locks its target without manual claiming or per-action approval.',
    inputSchema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        tabId: { type: 'string' },
        title: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['browserId', 'tabId'],
      additionalProperties: false,
    },
    scopes: [controlScope],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'browser_run_script',
    description:
      'Run a browser SDK script on any controllable connected tab, automatically acquire its execution lock and return immediately; poll browser_get_execution.',
    inputSchema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        tabId: { type: 'string' },
        script: { type: 'string', minLength: 1 },
        taskName: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 300000 },
        limits: {
          type: 'object',
          properties: {
            maxOutputBytes: { type: 'integer', minimum: 1 },
            maxSteps: { type: 'integer', minimum: 1 },
          },
          additionalProperties: false,
        },
      },
      required: ['browserId', 'tabId', 'script'],
      additionalProperties: false,
    },
    scopes: [controlScope],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'browser_get_execution',
    description: 'Read the state and result of one script execution.',
    inputSchema: {
      type: 'object',
      properties: { executionId: { type: 'string' } },
      required: ['executionId'],
      additionalProperties: false,
    },
    scopes: [readScope],
    annotations: readOnly,
  },
  {
    name: 'browser_cancel_execution',
    description: 'Cancel a queued or running script execution.',
    inputSchema: {
      type: 'object',
      properties: { executionId: { type: 'string' } },
      required: ['executionId'],
      additionalProperties: false,
    },
    scopes: [controlScope],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'browser_sdk_docs',
    description:
      'Read the browser SDK documentation: no topic returns the index, one or more topics return the documents.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
      additionalProperties: false,
    },
    scopes: [readScope],
    annotations: readOnly,
  },
];

/** Map a thrown error to the tool error text. Known codes pass through; anything else is INTERNAL_ERROR. */
export function toolErrorText(error: unknown): string {
  if (error instanceof Error) {
    if (/^[A-Z_]{3,64}$/.test(error.message)) return error.message;
    if (/^[A-Z_]{3,64}: .+$/.test(error.message)) return error.message;
  }
  return 'INTERNAL_ERROR';
}

function requireExecutions(ctx: ToolContext): Executions {
  if (!ctx.executions) throw new Error('DAEMON_UNAVAILABLE');
  return ctx.executions;
}
function requiredString(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new Error('INVALID_ARGUMENT');
  return value;
}
function optionalString(value: unknown, max = 256): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max)
    throw new Error('INVALID_ARGUMENT');
  return value;
}
/**
 * browserId + tabId. The contract tabId is a string; an integer is accepted
 * leniently (the pre-M1 draft declared it integer) and normalized to a number.
 */
function targetArgs(args: Record<string, unknown>): {
  browserId: string;
  tabId: number;
} {
  const browserId = requiredString(args.browserId);
  const tabId = args.tabId;
  if (typeof tabId === 'number') {
    if (!Number.isSafeInteger(tabId) || tabId < 0)
      throw new Error('INVALID_ARGUMENT');
    return { browserId, tabId };
  }
  if (typeof tabId === 'string' && /^\d+$/.test(tabId)) {
    const parsed = Number(tabId);
    if (Number.isSafeInteger(parsed) && parsed >= 0)
      return { browserId, tabId: parsed };
  }
  throw new Error('INVALID_ARGUMENT');
}
function cursorOffset(cursor: unknown): number {
  if (cursor === undefined) return 0;
  if (typeof cursor !== 'string') throw new Error('INVALID_ARGUMENT');
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null || !('o' in parsed))
      throw new Error('bad cursor');
    const offset: unknown = parsed.o;
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error('bad cursor');
    return offset;
  } catch {
    throw new Error('INVALID_ARGUMENT');
  }
}

function browserList(ctx: ToolContext, args: Record<string, unknown>): unknown {
  const executions = requireExecutions(ctx);
  const limit = args.limit === undefined ? 100 : args.limit;
  if (
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error('INVALID_ARGUMENT');
  const offset = cursorOffset(args.cursor);
  let browsers = executions.browsers().filter((item) => item.connected);
  if (args.browserId !== undefined) {
    if (typeof args.browserId !== 'string') throw new Error('INVALID_ARGUMENT');
    browsers = browsers.filter((item) => item.id === args.browserId);
  }
  const total = browsers.length;
  const page = browsers.slice(offset, offset + limit);
  return {
    browsers: page.map((browser) => ({
      browserId: browser.id,
      name: browser.name,
      type: 'extension',
      tabs: browser.tabs.map((tab) => ({
        tabId: String(tab.id),
        ...(tab.title ? { title: tab.title } : {}),
        ...(tab.url ? { url: tab.url } : {}),
        claimed: executions.isClaimed(browser.id, tab.id),
      })),
    })),
    ...(offset + limit < total
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({ o: offset + limit }),
            'utf8',
          ).toString('base64url'),
        }
      : {}),
    total,
  };
}

function claimTab(ctx: ToolContext, args: Record<string, unknown>): unknown {
  const executions = requireExecutions(ctx);
  const { browserId, tabId } = targetArgs(args);
  const title = optionalString(args.title, 256);
  const url = optionalString(args.url, 2048);
  const claim = executions.claimTab(ctx.owner, browserId, tabId, {
    ...(title !== undefined ? { title } : {}),
    ...(url !== undefined ? { url } : {}),
  });
  return {
    browserId: claim.browserId,
    tabId: String(claim.tabId),
    ...(claim.title ? { title: claim.title } : {}),
    ...(claim.url ? { url: claim.url } : {}),
    claimedAt: claim.claimedAt,
  };
}

function runScript(ctx: ToolContext, args: Record<string, unknown>): unknown {
  const executions = requireExecutions(ctx);
  const { browserId, tabId } = targetArgs(args);
  if (typeof args.script !== 'string' || !args.script.trim())
    throw new Error('INVALID_ARGUMENT');
  const taskName = optionalString(args.taskName, 128);
  const timeoutMs = optionalTimeoutMs(args.timeoutMs);
  const limits = runLimits(args.limits);
  return executions.run(
    ctx.owner,
    args.script,
    { browserId, tabId },
    {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(taskName !== undefined ? { taskName } : {}),
      ...(limits !== undefined ? { limits } : {}),
      ...(ctx.audit ? { audit: ctx.audit } : {}),
    },
  );
}

function optionalTimeoutMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 300_000
  )
    throw new Error('INVALID_ARGUMENT');
  return value;
}

function runLimits(
  value: unknown,
): { maxOutputBytes?: number; maxSteps?: number } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_ARGUMENT');
  const raw = value as Record<string, unknown>;
  const maxOutputBytes = optionalPositiveInt(raw.maxOutputBytes);
  const maxSteps = optionalPositiveInt(raw.maxSteps);
  return {
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('INVALID_ARGUMENT');
  return value;
}

function getExecution(
  ctx: ToolContext,
  args: Record<string, unknown>,
): unknown {
  const executions = requireExecutions(ctx);
  return executions.get(ctx.owner, requiredString(args.executionId));
}

async function cancelExecution(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<unknown> {
  const executions = requireExecutions(ctx);
  return executions.cancel(ctx.owner, requiredString(args.executionId));
}

function sdkDocsTool(
  _ctx: ToolContext,
  args: Record<string, unknown>,
): unknown {
  if (args.topic === undefined)
    return { version: SDK_DOCS_VERSION, index: sdkDocIndex() };
  const raw = Array.isArray(args.topic) ? args.topic : [args.topic];
  const topics: string[] = [];
  for (const topic of raw) {
    if (typeof topic !== 'string' || !topic)
      throw new Error('INVALID_ARGUMENT');
    topics.push(topic);
  }
  return {
    version: SDK_DOCS_VERSION,
    documents: sdkDocs(topics).map(({ topic, title, content }) => ({
      topic,
      title,
      content,
    })),
  };
}

export async function callBrowserTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = BROWSER_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error('INVALID_ARGUMENT');
  if (!tool.scopes.every((scope) => ctx.scopes.includes(scope)))
    throw new Error('PERMISSION_DENIED');
  // The schemas declare additionalProperties: false; the SDK does not
  // enforce it, so the dispatcher does.
  const properties = tool.inputSchema.properties;
  if (
    typeof properties === 'object' &&
    properties !== null &&
    !Array.isArray(properties)
  ) {
    for (const key of Object.keys(args))
      if (!(key in properties)) throw new Error('INVALID_ARGUMENT');
  }
  switch (name) {
    case 'browser_list':
      return browserList(ctx, args);
    case 'browser_claim_tab':
      return claimTab(ctx, args);
    case 'browser_run_script':
      return runScript(ctx, args);
    case 'browser_get_execution':
      return getExecution(ctx, args);
    case 'browser_cancel_execution':
      return cancelExecution(ctx, args);
    case 'browser_sdk_docs':
      return sdkDocsTool(ctx, args);
    default:
      throw new Error('INVALID_ARGUMENT');
  }
}
