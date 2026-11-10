import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

function bridge() {
  const calls: { command: string; params: Record<string, unknown> }[] = [];
  const invoke = vi.fn((method: string, raw: string) => {
    expect(method).toBe('cdp.send');
    const [command, params] = JSON.parse(raw) as [
      string,
      Record<string, unknown>,
    ];
    calls.push({ command, params });
    return Promise.resolve(JSON.stringify({}));
  });
  return { calls, invoke };
}

describe('Avru-native CUA coordinate SDK', () => {
  it('dispatches a real mouse move, press and release for click', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.cua.click({x:120,y:56,button:3,keypress:["Shift"]}); return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    expect(h.calls.map((call) => call.params.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased',
    ]);
    expect(h.calls[1]).toEqual({
      command: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x: 120,
        y: 56,
        button: 'right',
        clickCount: 1,
        modifiers: 8,
      },
    });
  });

  it('double-clicks with CDP clickCount 1 followed by 2', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.cua.double_click({x:20,y:40});',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"ok":true,"pageVersion":0,"changed":true}',
    });
    expect(h.calls.map((call) => call.params.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased',
      'mousePressed',
      'mouseReleased',
    ]);
    expect(h.calls[3]?.params.clickCount).toBe(2);
  });

  it('moves, scrolls and types text through unfiltered CDP Input methods', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.cua.move({x:10,y:20,keys:["Control"]});' +
        'await browser.tab.cua.scroll({x:30,y:40,scrollX:0,scrollY:350});' +
        'return await browser.tab.cua.type({text:"你好 Avru"});',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"ok":true,"pageVersion":0,"changed":true}',
    });
    expect(h.calls.map((call) => call.command)).toEqual([
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.insertText',
    ]);
    expect(h.calls[0]?.params.modifiers).toBe(2);
    expect(h.calls[1]?.params).toMatchObject({
      type: 'mouseWheel',
      deltaX: 0,
      deltaY: 350,
      x: 30,
      y: 40,
    });
    expect(h.calls[2]?.params).toEqual({ text: '你好 Avru' });
  });

  it('holds combined keyboard modifiers until the key-up sequence', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.cua.keypress({keys:["Control","a"]}); return "done";',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"done"' });
    expect(h.calls.map((call) => call.params.type)).toEqual([
      'rawKeyDown',
      'rawKeyDown',
      'keyUp',
      'keyUp',
    ]);
    expect(h.calls.map((call) => call.params.key)).toEqual([
      'Control',
      'a',
      'a',
      'Control',
    ]);
    expect(h.calls[1]?.params.modifiers).toBe(2);
    expect(h.calls[1]?.params.code).toBe('KeyA');
    expect(h.calls[1]?.params.commands).toEqual(['SelectAll']);
    expect(h.calls[3]?.params.modifiers).toBe(0);
  });

  it('drags over multiple points and releases the mouse button', async () => {
    const h = bridge();
    const result = await execute(
      'await browser.tab.cua.drag({path:[{x:1,y:2},{x:5,y:6},{x:9,y:10}]}); return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    expect(h.calls.map((call) => call.params.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseMoved',
      'mouseMoved',
      'mouseReleased',
    ]);
    expect(h.calls[3]?.params.buttons).toBe(1);
    expect(h.calls[4]?.params).toMatchObject({ x: 9, y: 10 });
  });

  it('rejects malformed inputs before issuing browser actions', async () => {
    const h = bridge();
    const result = await execute(
      'const bad = [' +
        '() => browser.tab.cua.click({x:NaN,y:2}),' +
        '() => browser.tab.cua.click({x:1,y:2,button:8}),' +
        '() => browser.tab.cua.keypress({keys:[]}),' +
        '() => browser.tab.cua.keypress({keys:["Unrecognized"]}),' +
        '() => browser.tab.cua.scroll({x:3,y:4,scrollX:Infinity,scrollY:0}),' +
        '() => browser.tab.cua.drag({path:[{x:1,y:2}]}),' +
        '() => browser.tab.cua.type({text:42})];' +
        'for (const fn of bad) {' +
        'try { await fn(); return "BAD"; }' +
        'catch(e) { if(e.code !== "INVALID_ARGUMENT") return e.code; }}' +
        'return "VALIDATED";',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"VALIDATED"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('advertises CUA methods without conflating them with the CDP command set', () => {
    const advertised = SDK_CAPABILITIES.map((item) => item.name);
    expect(advertised).toEqual(
      expect.arrayContaining([
        'tab.cua.click',
        'tab.cua.double_click',
        'tab.cua.drag',
        'tab.cua.keypress',
        'tab.cua.move',
        'tab.cua.scroll',
        'tab.cua.type',
        'cdp.send',
      ]),
    );
  });
});
