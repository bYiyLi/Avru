import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

function fixture() {
  const commands: { method: string; params: Record<string, unknown> }[] = [];
  const invoke = vi.fn((method: string, raw: string) => {
    expect(method).toBe('cdp.send');
    const [command, params] = JSON.parse(raw) as [
      string,
      Record<string, unknown>,
    ];
    commands.push({ method: command, params });
    const expression =
      typeof params.expression === 'string' ? params.expression : '';
    let value: unknown = {};
    if (expression.includes('const KEY =')) {
      const nonce = /"nonce":"([^"]+)"/u.exec(expression)?.[1] ?? '';
      value = {
        title: 'Example',
        url: 'https://example.test/',
        pageVersion: 123,
        root: {
          ref: 'document',
          role: 'document',
          children: [
            { ref: 'e:' + nonce + ':123:0', role: 'combobox', name: 'Size' },
          ],
        },
        text: 'Size',
        truncated: false,
      };
    } else if (
      expression.includes(
        'const state=globalThis.__avru_sdk_refs_v1;const version',
      )
    ) {
      value = { x: 35, y: 45, pageVersion: 123 };
    } else if (expression.includes('const opts=Array.from(el.options)')) {
      value = { changed: true, pageVersion: 123 };
    }
    return Promise.resolve(
      JSON.stringify(
        command === 'Runtime.evaluate' ? { result: { value } } : {},
      ),
    );
  });
  return { commands, invoke };
}

describe('Additional semantic page actions', () => {
  it('moves the browser pointer to a fresh task-scoped element', async () => {
    const h = fixture();
    const result = await execute(
      'const page=await browser.tab.snapshot();' +
        'return await browser.tab.hover(page.root.children[0].ref);',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"ok":true,"pageVersion":123,"changed":false}',
    });
    expect(h.commands.map((call) => call.method)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.commands[2]?.params).toMatchObject({
      type: 'mouseMoved',
      x: 35,
      y: 45,
    });
  });

  it('selects HTML options by value without bypassing fresh element refs', async () => {
    const h = fixture();
    const result = await execute(
      'const page=await browser.tab.snapshot();' +
        'return await browser.tab.selectOption(page.root.children[0].ref, ' +
        '[{value:"medium"}]);',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"ok":true,"pageVersion":123,"changed":true}',
    });
    expect(h.commands.map((call) => call.method)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
    ]);
    expect(String(h.commands[1]?.params.expression)).toContain('medium');
  });

  it('changes viewport using CDP metrics rather than a DOM approximation', async () => {
    const h = fixture();
    const result = await execute(
      'return await browser.tab.setViewport({width:640,height:480});',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"ok":true,"pageVersion":0,"changed":true}',
    });
    expect(h.commands).toEqual([
      {
        method: 'Emulation.setDeviceMetricsOverride',
        params: {
          width: 640,
          height: 480,
          deviceScaleFactor: 1,
          mobile: false,
        },
      },
    ]);
  });

  it('rejects invalid element refs, options and viewport sizes before host calls', async () => {
    const h = fixture();
    const result = await execute(
      'const tests=[' +
        '() => browser.tab.hover("e:another-task:1:0"),' +
        '() => browser.tab.selectOption("e:another-task:1:0","a"),' +
        '() => browser.tab.setViewport({width:0,height:480}),' +
        '() => browser.tab.setViewport({width:5000,height:480})];' +
        'for(const test of tests){try{await test();return "unexpected";}' +
        'catch(e){if(e.code!=="INVALID_ARGUMENT")return e.code;}}return "validated";',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"validated"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('reports the new methods in capability discovery', () => {
    expect(SDK_CAPABILITIES.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'tab.hover',
        'tab.selectOption',
        'tab.setViewport',
      ]),
    );
  });
});
