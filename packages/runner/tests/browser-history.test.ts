import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES } from '../src/sdk';

describe('QuickJS browser history SDK', () => {
  it('bridges a bounded search with exact arguments', async () => {
    const invoke = vi.fn((method: string, json: string) => {
      expect(method).toBe('history.search');
      expect(JSON.parse(json)).toEqual([
        {
          queries: ['headphones'],
          limit: 2,
          from: '2026-11-01',
        },
      ]);
      return Promise.resolve(
        '[{"url":"https://example.test","dateVisited":"2026-11-02T00:00:00.000Z"}]',
      );
    });
    const result = await execute(
      'return await browser.history({queries:["headphones"],limit:2,from:"2026-11-01"});',
      invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '[{"url":"https://example.test","dateVisited":"2026-11-02T00:00:00.000Z"}]',
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(SDK_CAPABILITIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'browser.history', supported: true }),
      ]),
    );
  });

  it('checks invalid history arguments before calling the host', async () => {
    const invoke = vi.fn(() => Promise.resolve('[]'));
    const result = await execute(
      'const bad=[null,{limit:0},{limit:21},{from:5},' +
        '{from:"bad"},{from:"2026-12-01",to:"2026-11-01"},' +
        '{queries:[]},{queries:["x","y","z","w","q"]},' +
        '{queries:[99]}];' +
        'for(const options of bad){try{await browser.history(options);return "unexpected";}' +
        'catch(error){if(error.code!=="INVALID_ARGUMENT")return "unexpected";}}' +
        'return "validated";',
      invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"validated"' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
