import { describe, expect, it } from 'vitest';
import { browserToolContent } from '../src/oauth/mcp';

describe('MCP browser tool content and screenshot serialization', () => {
  it('always emits valid text even for missing or non-object return values', () => {
    for (const [value, text] of [
      [undefined, 'null'],
      [null, 'null'],
      [false, 'false'],
      [0, '0'],
      ['hello', '"hello"'],
      [[], '[]'],
      [[1, 2], '[1,2]'],
    ] as const) {
      expect(browserToolContent(value)).toEqual([{ type: 'text', text }]);
    }
  });

  it('keeps a standard result in text form when no observations array exists', () => {
    const result = { executionId: 'task', state: 'completed' };
    expect(browserToolContent(result)).toEqual([
      { type: 'text', text: JSON.stringify(result) },
    ]);
    expect(browserToolContent({ observations: null })).toEqual([
      { type: 'text', text: '{"observations":null}' },
    ]);
  });

  it('exposes bounded JPEG images as MCP images while removing raw data from text', () => {
    const result = {
      executionId: 'task',
      observations: [
        { mode: 'state', state: 'Visible text' },
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', data: 'AQID' },
        },
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', data: 'A'.repeat(48 * 1024) },
        },
      ],
    };
    const content = browserToolContent(result);
    expect(content).toHaveLength(3);
    expect(content[1]).toEqual({
      type: 'image',
      mimeType: 'image/jpeg',
      data: 'AQID',
    });
    expect(content[2]).toEqual({
      type: 'image',
      mimeType: 'image/jpeg',
      data: 'A'.repeat(48 * 1024),
    });
    const text = content[0];
    expect(text?.type).toBe('text');
    if (!text || text.type !== 'text') throw new Error('Missing text content');
    expect(JSON.parse(text.text)).toMatchObject({
      executionId: 'task',
      observations: [
        { mode: 'state', state: 'Visible text' },
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', byteLength: 4 },
        },
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', byteLength: 48 * 1024 },
        },
      ],
    });
    expect(text.text).not.toContain('AQID');
  });

  it('does not promote invalid screenshots or observations to MCP images', () => {
    const observations = [
      null,
      false,
      4,
      'opaque',
      [],
      { mode: 'state', state: 'text' },
      { mode: 'screenshot', screenshot: null },
      { mode: 'screenshot', screenshot: [] },
      {
        mode: 'screenshot',
        screenshot: { mimeType: 'image/png', data: 'AQID' },
      },
      { mode: 'screenshot', screenshot: { mimeType: 'image/jpeg', data: 3 } },
      {
        mode: 'screenshot',
        screenshot: { mimeType: 'image/jpeg', data: 'A'.repeat(48 * 1024 + 1) },
      },
    ];
    const result = { observations };
    expect(browserToolContent(result)).toEqual([
      { type: 'text', text: JSON.stringify(result) },
    ]);
  });

  it('preserves the original observation ordering even with multiple image items', () => {
    const result = {
      observations: [
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', data: 'FIRST' },
        },
        { mode: 'state', state: 'middle' },
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', data: 'SECOND' },
        },
      ],
    };
    const content = browserToolContent(result);
    expect(content.slice(1)).toEqual([
      { type: 'image', mimeType: 'image/jpeg', data: 'FIRST' },
      { type: 'image', mimeType: 'image/jpeg', data: 'SECOND' },
    ]);
    expect(content[0]).toMatchObject({ type: 'text' });
  });
});
