import { createElement, isValidElement } from 'react';
import type * as React from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Connection, connectionFile } from '../src/Connection.js';
import type { ConnectionStatus } from '../../../packages/protocol/connection.d.ts';
const update = vi.fn();
let message = '';
vi.mock('react', async (original) => ({
  ...(await original<typeof React>()),
  useState: () => [message, update],
}));
const status: ConnectionStatus = {
  state: 'connecting',
  configured: true,
  issuer: 'https://avru.example',
  mcpUrl: 'https://avru.example/mcp',
  programVersion: '0.72.0',
  programAvailable: true,
  verification: { publicEntry: 'notVerified', chatgpt: 'notVerified' },
  events: [{ id: '1', code: 'process_started', at: 1000 }],
  retention: { limit: 200, persistent: true },
};
interface NodeProps {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { currentTarget: HTMLInputElement }) => void;
}
function nodes(node: ReactNode): NodeProps[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node)) return [];
  if (typeof node.type === 'function')
    return nodes((node.type as (props: unknown) => ReactNode)(node.props));
  return [node.props, ...nodes(node.props.children)];
}
it('shows configured, unknown and disconnected states honestly in both languages', () => {
  for (const locale of ['zh', 'en'] as const) {
    for (const state of [
      'unconfigured',
      'applying',
      'connecting',
      'registered',
      'unavailable',
      'unknown',
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(Connection, {
          status: { ...status, state },
          locale,
          busy: false,
        }),
      );
      expect(html).toContain('ChatGPT');
      expect(html).toContain('https://avru.example/mcp');
      expect(html).not.toContain('FRPC');
    }
    expect(
      renderToStaticMarkup(
        createElement(Connection, { status: null, locale, busy: false }),
      ),
    ).toContain(locale === 'zh' ? '状态不可用' : 'status unavailable');
    const html = renderToStaticMarkup(
      createElement(Connection, {
        status: {
          ...status,
          configured: false,
          mcpUrl: null,
          programAvailable: false,
          events: [],
        },
        locale,
        busy: true,
      }),
    );
    expect(html).toContain('disabled');
    expect(html).not.toContain('https://avru.example/mcp');
  }
});
it('imports a local file without rendering its contents and handles invalid files and failed removal', async () => {
  const actions = {
    importConnection: vi.fn<() => Promise<void>>().mockResolvedValue(),
    clearConnection: vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('private')),
  };
  const view = Connection({ status, locale: 'zh', busy: false, actions });
  const handlers = nodes(view);
  const input = {
    files: [{ size: 10, text: () => Promise.resolve('{"secret":"hidden"}') }],
    value: 'file',
  } as unknown as HTMLInputElement;
  handlers.find((item) => item.onChange)?.onChange?.({ currentTarget: input });
  await vi.waitFor(() => {
    expect(actions.importConnection).toHaveBeenCalledWith({ secret: 'hidden' });
  });
  await vi.waitFor(() => {
    expect(input.value).toBe('');
  });
  expect(update).toHaveBeenCalledWith('connection.saved');
  actions.importConnection.mockRejectedValue(new Error('sensitive details'));
  handlers.find((item) => item.onChange)?.onChange?.({ currentTarget: input });
  handlers.find((item) => item.onClick)?.onClick?.();
  await vi.waitFor(() => {
    expect(update).toHaveBeenCalledWith('connection.fileInvalid');
  });
  handlers
    .find((item) => item.onChange)
    ?.onChange?.({
      currentTarget: { files: [] } as unknown as HTMLInputElement,
    });
  const disabled = nodes(Connection({ status, locale: 'en', busy: false }));
  disabled.find((item) => item.onChange)?.onChange?.({ currentTarget: input });
  disabled.find((item) => item.onClick)?.onClick?.();
  await expect(
    connectionFile({ size: 262145, text: () => Promise.resolve('{}') }),
  ).rejects.toThrow();
  await expect(
    connectionFile({ size: 1, text: () => Promise.resolve('{') }),
  ).rejects.toThrow();
});
it('announces configuration failures as alerts and successful saves as status messages', () => {
  for (const [value, role] of [
    ['connection.fileInvalid', 'alert'],
    ['connection.saved', 'status'],
  ] as const) {
    message = value;
    expect(
      renderToStaticMarkup(
        createElement(Connection, { status, locale: 'zh', busy: false }),
      ),
    ).toContain(`role="${role}"`);
  }
  message = '';
});
