/**
 * MCP server (M1, T7, B3). The handwritten stateless JSON-RPC processor is
 * replaced by the official TypeScript SDK: a low-level Server (no zod in the
 * daemon's dependencies; tool arguments are validated by hand in tools.ts)
 * over a stateless Streamable HTTP transport. One fresh server + transport
 * per POST, matching the existing architecture (each POST independent, no
 * server-initiated notifications, GET /mcp stays 405 in http.ts). The
 * transport negotiates protocol 2025-11-25 and answers initialize/ping
 * itself; tools/list and tools/call are the only handlers registered here.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RELEASE_VERSION } from '../../../../packages/protocol/environment.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BROWSER_TOOLS, callBrowserTool, toolErrorText } from './tools.js';
import type { ToolContext } from './tools.js';

export interface McpOutcome {
  isError: boolean;
}

type BrowserToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: 'image/jpeg' };

export function browserToolContent(result: unknown): BrowserToolContent[] {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return [
      {
        type: 'text',
        text: JSON.stringify(result === undefined ? null : result),
      },
    ];
  const value = result as Record<string, unknown>;
  if (!Array.isArray(value.observations))
    return [{ type: 'text', text: JSON.stringify(result) }];
  const images: BrowserToolContent[] = [];
  const observations = (value.observations as unknown[]).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const observation = item as Record<string, unknown>;
    const screenshot = observation.screenshot;
    if (
      screenshot &&
      typeof screenshot === 'object' &&
      !Array.isArray(screenshot)
    ) {
      const image = screenshot as Record<string, unknown>;
      if (
        image.mimeType === 'image/jpeg' &&
        typeof image.data === 'string' &&
        image.data.length <= 48 * 1024
      ) {
        images.push({
          type: 'image',
          data: image.data,
          mimeType: 'image/jpeg',
        });
        return {
          ...observation,
          screenshot: { mimeType: 'image/jpeg', byteLength: image.data.length },
        };
      }
    }
    return observation;
  });
  return [
    { type: 'text', text: JSON.stringify({ ...value, observations }) },
    ...images,
  ];
}

// The low-level Server is used deliberately: McpServer's registerTool
// requires Zod schemas and this package has no zod dependency (see the
// file header). The deprecation is acknowledged, not accidental.
/* eslint-disable @typescript-eslint/no-deprecated */
export function createMcpServer(
  ctx: ToolContext & { outcome?: McpOutcome },
): Server {
  const server = new Server(
    { name: 'avru', version: RELEASE_VERSION },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: BROWSER_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    // CallToolRequestSchema already validates arguments as a record.
    const args = request.params.arguments ?? {};
    try {
      const result = await callBrowserTool(ctx, name, args);
      return { content: browserToolContent(result) };
    } catch (error) {
      if (ctx.outcome) ctx.outcome.isError = true;
      return {
        isError: true,
        content: [{ type: 'text', text: toolErrorText(error) }],
      };
    }
  });
  return server;
}
/* eslint-enable @typescript-eslint/no-deprecated */

/** Handle one POST /mcp with a fresh stateless server. Returns the tool outcome for call tracing. */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  ctx: ToolContext,
): Promise<McpOutcome> {
  const outcome: McpOutcome = { isError: false };
  const server = createMcpServer({ ...ctx, outcome });
  // Stateless: each request uses a fresh server + transport, so session ids
  // are disabled. The cast keeps exactOptionalPropertyTypes happy: an
  // explicit `undefined` is not assignable to the optional property.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // No server-initiated notifications: answer POSTs with a single JSON
    // object instead of an SSE stream (the transport default).
    enableJsonResponse: true,
  } as unknown as StreamableHTTPServerTransportOptions);
  await server.connect(transport);
  try {
    await transport.handleRequest(req, res, body);
  } finally {
    await server.close();
    await transport.close();
  }
  return outcome;
}
