import { record } from '../messages.js';
import { RELEASE_VERSION } from '../../../../packages/protocol/environment.js';
const version = '2025-11-25';
export function mcpResponse(
  raw: unknown,
  snapshot: () => unknown,
): { status: number; body?: unknown } {
  if (
    !record(raw) ||
    raw.jsonrpc !== '2.0' ||
    typeof raw.method !== 'string' ||
    (raw.id !== undefined &&
      typeof raw.id !== 'string' &&
      typeof raw.id !== 'number')
  )
    return {
      status: 400,
      body: {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      },
    };
  if (raw.id === undefined) return { status: 202 };
  let result: unknown;
  switch (raw.method) {
    case 'initialize':
      result = {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: 'avru', version: RELEASE_VERSION },
      };
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = {
        tools: [
          {
            name: 'browsers_list',
            description:
              'Read connected browser metadata and sanitized tab snapshots.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: [{ type: 'oauth2', scopes: ['browser:read'] }],
            _meta: {
              securitySchemes: [{ type: 'oauth2', scopes: ['browser:read'] }],
            },
          },
        ],
      };
      break;
    case 'tools/call':
      if (
        !record(raw.params) ||
        raw.params.name !== 'browsers_list' ||
        (raw.params.arguments !== undefined &&
          (!record(raw.params.arguments) ||
            Object.keys(raw.params.arguments).length > 0))
      )
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: raw.id,
            error: { code: -32602, message: 'Invalid params' },
          },
        };
      result = {
        content: [{ type: 'text', text: JSON.stringify(snapshot()) }],
      };
      break;
    default:
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: raw.id,
          error: { code: -32601, message: 'Method not found' },
        },
      };
  }
  return { status: 200, body: { jsonrpc: '2.0', id: raw.id, result } };
}
