import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

interface CdpEvent {
  sequence: number;
  method: string;
  params: Record<string, unknown>;
}

const logEvents: CdpEvent[] = [
  {
    sequence: 1,
    method: 'Runtime.consoleAPICalled',
    params: {
      type: 'log',
      args: [{ type: 'string', value: 'page ready' }],
      timestamp: 1_760_000_000_000,
    },
  },
  {
    sequence: 2,
    method: 'Runtime.consoleAPICalled',
    params: {
      type: 'warning',
      args: [{ type: 'string', value: 'retry' }],
      timestamp: 1_760_000_000_100,
    },
  },
  {
    sequence: 3,
    method: 'Log.entryAdded',
    params: {
      entry: {
        level: 'error',
        text: 'network failure',
        timestamp: 1_760_000_000_200,
        url: 'https://example.test/',
      },
    },
  },
];

function bridge(events: CdpEvent[] = logEvents) {
  const calls: { method: string; args: unknown[] }[] = [];
  const invoke = vi.fn((method: string, json: string) => {
    const args = JSON.parse(json) as unknown[];
    calls.push({ method, args });
    return Promise.resolve(
      JSON.stringify(
        method === 'cdp.events'
          ? { events, nextCursor: String(events.length) }
          : {},
      ),
    );
  });
  return { invoke, calls };
}

describe('CDP console and JavaScript dialog observation', () => {
  it('enables console domains and reads bounded, structured log entries', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.devLogs();',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    const data = JSON.parse(
      result.status === 'completed' ? result.json : '[]',
    ) as { level: string; message: string; timestamp: string; url?: string }[];
    expect(data).toHaveLength(3);
    expect(data.map((entry) => entry.level)).toEqual(['log', 'warn', 'error']);
    expect(data[0]?.message).toBe('page ready');
    expect(data[2]?.url).toBe('https://example.test/');
    expect(Date.parse(data[0]?.timestamp ?? '')).not.toBeNaN();
    expect(h.calls).toEqual([
      { method: 'cdp.send', args: ['Runtime.enable', {}] },
      { method: 'cdp.send', args: ['Log.enable', {}] },
      { method: 'cdp.events', args: [] },
    ]);
  });

  it('applies level, substring, time and count filters after observation', async () => {
    const h = bridge();
    const result = await execute(
      'return await browser.tab.devLogs({levels:["warning","error"],limit:1,filter:"failure",since:1760000000100});',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(
      JSON.parse(result.status === 'completed' ? result.json : '[]'),
    ).toMatchObject([{ level: 'error', message: 'network failure' }]);
  });

  it('rejects invalid log filters and excessive output before host calls', async () => {
    const h = bridge();
    const result = await execute(
      'for(const option of [null,{limit:0},{limit:26},' +
        '{levels:["unknown"]},{filter:123},{since:-1}]){' +
        'try{await browser.tab.devLogs(option);return "unexpected";}' +
        'catch(error){if(error.code!=="INVALID_ARGUMENT")return error.code;}}' +
        'return "validated";',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"validated"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('returns the latest still-open JavaScript dialog', async () => {
    const h = bridge([
      {
        sequence: 1,
        method: 'Page.javascriptDialogOpening',
        params: { type: 'confirm', message: 'Continue?' },
      },
    ]);
    const result = await execute(
      'return await browser.tab.getJsDialog();',
      h.invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"type":"confirm","message":"Continue?"}',
    });
    expect(h.calls).toEqual([{ method: 'cdp.events', args: [] }]);
  });

  it('returns null when the JavaScript dialog was closed', async () => {
    const h = bridge([
      {
        sequence: 1,
        method: 'Page.javascriptDialogOpening',
        params: { type: 'prompt', message: 'Your name?' },
      },
      { sequence: 2, method: 'Page.javascriptDialogClosed', params: {} },
    ]);
    expect(
      await execute('return await browser.tab.getJsDialog();', h.invoke),
    ).toEqual({ status: 'completed', json: 'null' });
  });

  it('accepts or dismisses a JavaScript dialog through CDP without manual approval', async () => {
    const h = bridge([]);
    const result = await execute(
      'await browser.tab.dialogAccept("Avru");' +
        'await browser.tab.dialogDismiss();return true;',
      h.invoke,
    );
    expect(result).toEqual({ status: 'completed', json: 'true' });
    expect(h.calls).toEqual([
      {
        method: 'cdp.send',
        args: [
          'Page.handleJavaScriptDialog',
          {
            accept: true,
            promptText: 'Avru',
          },
        ],
      },
      {
        method: 'cdp.send',
        args: ['Page.handleJavaScriptDialog', { accept: false }],
      },
    ]);
  });

  it('advertises the four implemented observation capabilities', () => {
    const names = SDK_CAPABILITIES.map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'tab.devLogs',
        'tab.getJsDialog',
        'tab.dialogAccept',
        'tab.dialogDismiss',
      ]),
    );
  });
});
