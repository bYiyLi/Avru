import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

const tree = {
  nodes: [
    {
      nodeId: '1',
      ignored: false,
      role: { value: 'RootWebArea' },
      name: { value: 'Test page' },
    },
    {
      nodeId: '2',
      ignored: false,
      backendDOMNodeId: 21,
      role: { value: 'textbox' },
      name: { value: 'Search' },
      value: { value: 'before' },
    },
    {
      nodeId: '3',
      ignored: true,
      backendDOMNodeId: 25,
      role: { value: 'generic' },
    },
  ],
};

function responseFor(
  command: string,
  params: Record<string, unknown>,
  platformModifier: string,
): unknown {
  switch (command) {
    case 'Accessibility.getFullAXTree':
      return tree;
    case 'DOM.getBoxModel':
      return { model: { border: [10, 10, 110, 10, 110, 50, 10, 50] } };
    case 'Page.getLayoutMetrics':
      return {
        cssVisualViewport: {
          clientWidth: 800,
          clientHeight: 600,
          pageX: 0,
          pageY: 0,
        },
        cssContentSize: { width: 800, height: 1200 },
      };
    case 'Page.captureScreenshot':
      return { data: '/9j/AA==' };
    case 'DOM.resolveNode':
      return { object: { objectId: 'ax-node-21' } };
    case 'Runtime.callFunctionOn':
      return { result: { value: { selected: true } } };
    case 'Runtime.evaluate':
      return {
        result: {
          value:
            typeof params.expression === 'string' &&
            params.expression.includes('navigator.platform')
              ? platformModifier
              : {
                  url: 'https://example.test/',
                  title: 'Example',
                  pageVersion: 7,
                  root: { ref: 'document', role: 'document', children: [] },
                  text: 'Example',
                  truncated: false,
                },
        },
      };
    default:
      return {};
  }
}

function fixture(platformModifier = 'Meta') {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const hostCalls: { method: string; args: unknown[] }[] = [];
  const invoke = vi.fn((method: string, raw: string) => {
    if (method === 'tab.observe.write') {
      hostCalls.push({ method, args: JSON.parse(raw) as unknown[] });
      return Promise.resolve('null');
    }
    expect(method).toBe('cdp.send');
    const [command, params] = JSON.parse(raw) as [
      string,
      Record<string, unknown>,
    ];
    calls.push({ method: command, params });
    const value = responseFor(command, params, platformModifier);
    return Promise.resolve(JSON.stringify(value));
  });
  return { calls, hostCalls, invoke };
}

describe('Chrome CDP Accessibility SDK', () => {
  it('reads a bounded AX tree and filters ignored nodes', async () => {
    const h = fixture();
    const result = await execute(
      'return await browser.tab.ax.snapshot();',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: JSON.stringify({
        nodes: [
          { index: 0, role: 'RootWebArea', name: 'Test page' },
          { index: 1, role: 'textbox', name: 'Search', value: 'before' },
        ],
        truncated: false,
      }),
    });
    expect(h.calls.map((call) => call.method)).toEqual([
      'Accessibility.enable',
      'Accessibility.getFullAXTree',
    ]);
  });

  it('returns readable accessibility state and a paired screenshot', async () => {
    const h = fixture();
    const result = await execute(
      'return await browser.tab.ax.get("both");',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    const response = JSON.parse(
      result.status === 'completed' ? result.json : '{}',
    ) as { state: string; screenshot: { data: string; mimeType: string } };
    expect(response.state).toContain('[1] textbox Search value=before');
    expect(response.screenshot).toEqual({
      data: '/9j/AA==',
      mimeType: 'image/jpeg',
    });
  });

  it('resolves an observed AX node to its current box before clicking', async () => {
    const h = fixture();
    const result = await execute(
      'await browser.tab.ax.snapshot();' +
        'await browser.tab.ax.click(1); return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    expect(h.calls.map((call) => call.method)).toEqual([
      'Accessibility.enable',
      'Accessibility.getFullAXTree',
      'DOM.enable',
      'DOM.getBoxModel',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.calls[3]?.params).toEqual({ backendNodeId: 21 });
    expect(h.calls[5]?.params).toMatchObject({
      type: 'mousePressed',
      x: 60,
      y: 30,
    });
  });

  it('accepts viewport coordinates without an accessibility observation', async () => {
    const h = fixture();
    const result = await execute(
      'await browser.tab.ax.click([30,40]); return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    expect(h.calls.map((call) => call.method)).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.calls[1]?.params).toMatchObject({ x: 30, y: 40 });
  });

  it('focuses a real AX element before replacing its value', async () => {
    const h = fixture();
    const result = await execute(
      'await browser.tab.ax.snapshot();' +
        'await browser.tab.ax.setValue(1,"camera"); return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    expect(h.calls).toEqual(
      expect.arrayContaining([
        { method: 'DOM.focus', params: { backendNodeId: 21 } },
        { method: 'Input.insertText', params: { text: 'camera' } },
      ]),
    );
    const selectAll = h.calls.find(
      (call) =>
        call.method === 'Input.dispatchKeyEvent' &&
        Array.isArray(call.params.commands),
    );
    expect(selectAll?.params.commands).toEqual(['SelectAll']);
  });

  it('uses Control for Select All on non-Mac Chromium profiles', async () => {
    const h = fixture('Control');
    const result = await execute(
      'await browser.tab.ax.snapshot();' +
        'await browser.tab.ax.setValue(1,"laptops"); return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    const control = h.calls.find(
      (call) =>
        call.method === 'Input.dispatchKeyEvent' &&
        call.params.key === 'Control',
    );
    expect(control?.params.type).toBe('rawKeyDown');
    const selectAll = h.calls.find(
      (call) =>
        call.method === 'Input.dispatchKeyEvent' &&
        Array.isArray(call.params.commands),
    );
    expect(selectAll?.params.modifiers).toBe(2);
    expect(selectAll?.params.commands).toEqual(['SelectAll']);
  });

  it('forwards supported click modifiers and rejects unsupported key combos', async () => {
    const h = fixture();
    const result = await execute(
      'await browser.tab.ax.click([30,40],{key:"shift"});' +
        'try {await browser.tab.ax.click([30,40],{key:"shift+NotAKey"});return "bad";}' +
        'catch(error){return error.code;}',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '"CAPABILITY_NOT_ALLOWED"',
    });
    const press = h.calls.find(
      (call) =>
        call.method === 'Input.dispatchMouseEvent' &&
        call.params.type === 'mousePressed',
    );
    expect(press?.params.modifiers).toBe(8);
  });

  it('rejects unobserved or invalid AX indexes before changing the page', async () => {
    const h = fixture();
    const result = await execute(
      'try {await browser.tab.ax.click(7); return "wrong";}' +
        'catch(error){return error.code;}',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"STALE_REF"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('returns screenshots, writes model observations, and selects exact text ranges', async () => {
    const h = fixture();
    const result = await execute(
      'await browser.tab.ax.snapshot();' +
        'const screenshot = await browser.tab.ax.get("screenshot");' +
        'await browser.tab.ax.write("both");' +
        'const selected = await browser.tab.ax.selectText(1,"before",{selectionType:"text"});' +
        'return {screenshot,selected};',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(h.calls.map((call) => call.method)).toContain(
      'Runtime.callFunctionOn',
    );
    expect(h.calls.map((call) => call.method)).toContain(
      'Runtime.releaseObject',
    );
    expect(h.hostCalls).toHaveLength(1);
    expect(h.hostCalls[0]).toMatchObject({
      method: 'tab.observe.write',
      args: [
        {
          mode: 'both',
          state: '[0] RootWebArea Test page\n[1] textbox Search value=before',
          screenshot: { data: '/9j/AA==', mimeType: 'image/jpeg' },
        },
      ],
    });
    const names = SDK_CAPABILITIES.filter((item) =>
      item.name.startsWith('tab.ax.'),
    );
    expect(names).toHaveLength(12);
    expect(names.find((item) => item.name === 'tab.ax.write')?.supported).toBe(
      true,
    );
    expect(
      names.find((item) => item.name === 'tab.ax.selectText')?.supported,
    ).toBe(true);
  });
});
