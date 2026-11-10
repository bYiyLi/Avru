import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

function withTaskRef(expression: string) {
  const nonce = /"nonce":"([^"]+)"/u.exec(expression)?.[1] ?? '';
  return {
    url: 'https://example.test/',
    title: 'Example',
    pageVersion: 101,
    text: 'Search',
    root: {
      ref: 'document',
      role: 'document',
      children: [
        {
          ref: `e:${nonce}:101:0`,
          role: 'textbox',
          name: 'Search',
        },
      ],
    },
    truncated: false,
  };
}

function mockEvaluation(expression: string): unknown {
  if (expression.includes('const KEY =')) return withTaskRef(expression);
  if (expression.includes('e.currentSrc||e.src||e.href||e.poster'))
    return 'https://cdn.example/video.mp4';
  if (expression.includes('const x = box.left'))
    return { x: 30, y: 44, pageVersion: 101 };
  if (expression.includes('const before'))
    return { changed: true, pageVersion: 101 };
  return { x: 30, y: 44 };
}

function bridge() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const invoke = vi.fn((method: string, json: string) => {
    if (method === 'tab.downloadMedia')
      return Promise.resolve(
        JSON.stringify({ path: '/Downloads/video.mp4', downloadId: '42' }),
      );
    expect(method).toBe('cdp.send');
    const [command, params] = JSON.parse(json) as [
      string,
      Record<string, unknown>,
    ];
    calls.push({ method: command, params });
    if (command === 'Runtime.evaluate') {
      const expression = String(params.expression);
      const value = mockEvaluation(expression);
      return Promise.resolve(JSON.stringify({ result: { value } }));
    }
    return Promise.resolve(JSON.stringify({}));
  });
  return { calls, invoke };
}

describe('DomCUA browser SDK', () => {
  it('produces a bounded visible DOM with numeric IDs and opaque references', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.dom.getVisibleTree();',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    const tree = JSON.parse(
      result.status === 'completed' ? result.json : '{}',
    ) as {
      nodes: { nodeId: number; node_id: string; role: string; name: string }[];
      truncated: boolean;
    };
    expect(tree.nodes).toEqual([
      expect.objectContaining({
        nodeId: 0,
        role: 'textbox',
        name: 'Search',
      }),
    ]);
    expect(tree.nodes[0]?.node_id).toMatch(/^e:.*:101:0$/u);
    expect(tree.truncated).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  it('clicks a DOM node using an existing task-scoped ref', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.dom.getVisibleTree(); return await browser.tab.dom.click({node_id:0});',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(h.calls.map((call) => call.method)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.calls[3]?.params).toMatchObject({
      type: 'mousePressed',
      x: 30,
      y: 44,
    });
  });

  it('fills a DOM node and emits a changed action', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.dom.getVisibleTree(); return await browser.tab.dom.fill(0,"headphones");',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(
      JSON.parse(result.status === 'completed' ? result.json : '{}'),
    ).toMatchObject({ ok: true, changed: true, pageVersion: 101 });
    expect(String(h.calls[1]?.params.expression)).toContain('headphones');
  });

  it('rejects unobserved numeric nodes without touching the page', async () => {
    const h = bridge();
    const result = await execute(
      'try { await browser.tab.dom.click({node_id:3}); return "unexpected"; } catch(e) { return e.code; }',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"STALE_REF"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('routes DOM keypress, typing and scrolling through the same CUA transport', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.dom.keypress({keys:["Enter"]});' +
        'await browser.tab.dom.type({text:"typed"});' +
        'return await browser.tab.dom.scroll({x:0,y:200});',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"ok":true,"pageVersion":0,"changed":true}',
    });
    expect(h.calls.map((call) => call.method)).toEqual([
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
      'Input.insertText',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.calls[3]?.params).toMatchObject({
      type: 'mouseWheel',
      deltaX: 0,
      deltaY: 200,
    });
  });

  it('downloads media from a task-scoped visible DOM element', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.dom.getVisibleTree();' +
        'return await browser.tab.dom.downloadMedia({node_id:0});',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"path":"/Downloads/video.mp4","downloadId":"42"}',
    });
    expect(h.calls.map((call) => call.method)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
    ]);
    expect(
      SDK_CAPABILITIES.find((item) => item.name === 'tab.dom.downloadMedia')
        ?.supported,
    ).toBe(true);
    expect(
      SDK_CAPABILITIES.find((item) => item.name === 'tab.cua.downloadMedia')
        ?.supported,
    ).toBe(true);
  });
});
