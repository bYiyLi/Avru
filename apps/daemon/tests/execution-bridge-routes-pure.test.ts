import { describe, expect, it } from 'vitest';
import { ClaimRegistry } from '../src/claims';
import { createExecutionEntry } from '../src/execution-types';
import {
  actionAborted,
  deriveStepContext,
  dispatchMetadata,
  noArgs,
  oneStringArg,
  openUserTabs,
  parseBridgeArgs,
  parseIdentity,
  recordObservation,
  validateMoveOptions,
  validateTabAction,
} from '../src/execution-bridge-routes';

const target = { browserId: 'browser-a', tabId: 7, generation: 3 };
const entry = () =>
  createExecutionEntry({
    owner: 'owner-a',
    source: 'return 1;',
    target,
    timeoutMs: 30_000,
    limits: { maxOutputBytes: 65_536, maxBridgeCalls: 32 },
  });

describe('bridge identity and argument boundaries', () => {
  it('parses only canonical connected identities without trusting page-owned metadata', () => {
    expect(
      parseIdentity({ browserId: 'a', tabId: '7', generation: 2 }),
    ).toEqual({
      browserId: 'a',
      tabId: 7,
      generation: 2,
    });
    expect(parseIdentity({ browserId: 'a', tabId: 0, generation: 1 })).toEqual({
      browserId: 'a',
      tabId: 0,
      generation: 1,
    });
    for (const value of [
      null,
      undefined,
      2,
      [],
      {},
      { browserId: '', tabId: 1, generation: 1 },
      { browserId: 1, tabId: 1, generation: 1 },
      { browserId: 'a', tabId: -1, generation: 1 },
      { browserId: 'a', tabId: 1.1, generation: 1 },
      { browserId: 'a', tabId: 'unsafe', generation: 1 },
      { browserId: 'a', tabId: Number.MAX_SAFE_INTEGER + 1, generation: 1 },
      { browserId: 'a', tabId: 1, generation: 0 },
      { browserId: 'a', tabId: 1, generation: '1' },
    ])
      expect(() => parseIdentity(value)).toThrow(
        'invalid browser tab identity',
      );
  });

  it('requires JSON array arguments instead of arbitrary objects', () => {
    expect(parseBridgeArgs('[]')).toEqual([]);
    expect(parseBridgeArgs('["7",{"active":true}]')).toEqual([
      '7',
      { active: true },
    ]);
    for (const value of ['{', '{}', 'null', '42', '"a"'])
      expect(() => parseBridgeArgs(value)).toThrow(
        'bridge arguments must be a JSON array',
      );
  });

  it('checks no-argument and single-string helpers', () => {
    expect(() => {
      noArgs([], 'tabs.list');
    }).not.toThrow();
    expect(() => {
      noArgs(['extra'], 'tabs.list');
    }).toThrow('tabs.list takes no arguments');
    expect(oneStringArg(['hello'], 'method', 'label')).toBe('hello');
    for (const args of [[], [null], [3], [''], ['a', 'b']])
      expect(() => oneStringArg(args, 'method', 'label')).toThrow(
        'method requires label',
      );
  });

  it('detects aborted and active runtime tasks', () => {
    const controller = new AbortController();
    expect(actionAborted(controller.signal)).toBe(false);
    controller.abort();
    expect(actionAborted(controller.signal)).toBe(true);
  });
});

describe('automatic tab assignment and movement validation', () => {
  const context = () => ({
    browserId: 'browser-a',
    executionId: 'execution-a',
    claims: new ClaimRegistry(),
  });

  it('accepts read-only list and bounded history query shapes', () => {
    const c = context();
    for (const method of ['tabs.content', 'history.search'])
      expect(() => {
        validateTabAction(method, [{ urls: ['https://example.test/'] }], c);
      }).not.toThrow();
    for (const method of ['windows.list', 'tabs.selected'])
      expect(() => {
        validateTabAction(method, [], c);
      }).not.toThrow();
    for (const method of ['tabs.content', 'history.search'])
      for (const args of [[], [null], [[]], [1], [{}, {}]])
        expect(() => {
          validateTabAction(method, args, c);
        }).toThrow('invalid');
    for (const method of ['windows.list', 'tabs.selected'])
      expect(() => {
        validateTabAction(method, [1], c);
      }).toThrow('takes no arguments');
  });

  it('validates tab creation, move destinations and canonical IDs', () => {
    const c = context();
    expect(() => {
      validateTabAction('tabs.new', [null, { active: true }], c);
    }).not.toThrow();
    expect(() => {
      validateTabAction('tabs.new', ['https://example.test', {}], c);
    }).not.toThrow();
    for (const args of [[], [1, {}], [null, null], [null, []], ['', {}, {}]])
      expect(() => {
        validateTabAction('tabs.new', args, c);
      }).toThrow('invalid new tab arguments');
    expect(() => {
      validateTabAction('tabs.move', ['7', { index: -1, windowId: 0 }], c);
    }).not.toThrow();
    expect(() => {
      validateMoveOptions(['7', { index: 0 }]);
    }).not.toThrow();
    for (const args of [
      ['7'],
      ['7', null],
      ['7', []],
      ['7', { index: -2 }],
      ['7', { index: 1.5 }],
      ['7', { index: 0, windowId: -1 }],
      ['7', { index: 0, windowId: '1' }],
    ])
      expect(() => {
        validateMoveOptions(args);
      }).toThrow('invalid tabs.move');
    for (const args of [[''], ['01'], ['7.0'], [7], ['a'], [], ['7', '8']])
      expect(() => {
        validateTabAction('tabs.get', args, c);
      }).toThrow('invalid tab ID');
  });

  it('does not let another active task reuse an already claimed tab', () => {
    const c = context();
    c.claims.claim('owner-a', target);
    c.claims.bind('other-execution', 'owner-a', target.browserId, target.tabId);
    expect(() => {
      validateTabAction('tabs.close', ['7'], c);
    }).toThrow('tab is in use');
    c.executionId = 'other-execution';
    expect(() => {
      validateTabAction('tabs.close', ['7'], c);
    }).not.toThrow();
  });
});

describe('bounded and redacted task observations', () => {
  it('records a valid state, JPEG screenshot and combined observation', () => {
    const e = entry();
    expect(
      recordObservation(e, [{ mode: 'state', state: 'Page title' }]),
    ).toBeNull();
    const screenshot = { data: 'aGVsbG8=', mimeType: 'image/jpeg' };
    expect(
      recordObservation(e, [{ mode: 'screenshot', screenshot }]),
    ).toBeNull();
    expect(
      recordObservation(e, [{ mode: 'both', state: 'Page', screenshot }]),
    ).toBeNull();
    expect(e.observations).toHaveLength(3);
    expect(e.observations[2]).toEqual({
      mode: 'both',
      state: 'Page',
      screenshot,
    });
  });

  it('rejects invalid object shapes and unrecognized modes', () => {
    const e = entry();
    for (const args of [
      [],
      [null],
      [1],
      [[]],
      [{}, {}],
      [{ mode: 'bad', state: 'a' }],
    ])
      expect(() => recordObservation(e, args)).toThrow('invalid');
    expect(e.observations).toHaveLength(0);
  });

  it('rejects overlarge observations and missing mode fields', () => {
    const e = entry();
    for (const args of [
      [{ mode: 'state', state: 'x'.repeat(12_001) }],
      [{ mode: 'state', state: 9 }],
      [
        {
          mode: 'both',
          state: '',
          screenshot: { mimeType: 'image/png', data: 'x' },
        },
      ],
      [
        {
          mode: 'screenshot',
          screenshot: { mimeType: 'image/jpeg', data: 'x'.repeat(50_000) },
        },
      ],
      [{ mode: 'screenshot', screenshot: 'image' }],
    ])
      expect(() => recordObservation(e, args)).toThrow('exceeds');
    for (const args of [
      [{ mode: 'state' }],
      [{ mode: 'both', state: 'present' }],
      [{ mode: 'screenshot' }],
    ])
      expect(() => recordObservation(e, args)).toThrow(
        'missing required content',
      );
    expect(e.observations).toHaveLength(0);
  });

  it('refuses a fifth observation rather than overwriting the preceding evidence', () => {
    const e = entry();
    for (let i = 0; i < 4; i++)
      recordObservation(e, [{ mode: 'state', state: String(i) }]);
    expect(() =>
      recordObservation(e, [{ mode: 'state', state: 'fifth' }]),
    ).toThrow('too many');
    expect(e.observations).toHaveLength(4);
  });
});

describe('step accounting, metadata and provider IDs', () => {
  it('preserves targeted action names in audit steps, falling back on invalid inputs', () => {
    const e = entry();
    expect(
      deriveStepContext(
        e,
        'tab.action',
        JSON.stringify(['secondary', '9', 4, 'cdp.send', []]),
      ),
    ).toEqual({
      stepAction: 'cdp.send',
      stepTarget: { browserId: 'secondary', tabId: 9 },
    });
    expect(
      deriveStepContext(
        e,
        'browser.user.getTabContext',
        JSON.stringify([
          {
            browserId: 'a',
            tabId: '11',
            generation: 2,
          },
        ]),
      ),
    ).toEqual({
      stepAction: 'browser.user.getTabContext',
      stepTarget: { browserId: 'a', tabId: 11 },
    });
    expect(deriveStepContext(e, 'tab.action', '{')).toEqual({
      stepAction: 'tab.action',
      stepTarget: { browserId: 'browser-a', tabId: 7 },
    });
    e.target = undefined;
    expect(deriveStepContext(e, 'tabs.list', '[]')).toEqual({
      stepAction: 'tabs.list',
      stepTarget: undefined,
    });
  });

  it('lists known capabilities without allowing caller mutation to change the canonical table', () => {
    const capabilities = dispatchMetadata('capabilities.list', []) as {
      name: string;
    }[];
    expect(capabilities.find((c) => c.name === 'cdp.send')).toMatchObject({
      supported: true,
    });
    if (!capabilities[0]) throw new Error('Missing capability');
    capabilities[0].name = 'modified';
    const again = dispatchMetadata('capabilities.list', []) as {
      name: string;
    }[];
    expect(again[0]?.name).not.toBe('modified');
    expect(dispatchMetadata('capabilities.get', ['cdp.send'])).toMatchObject({
      name: 'cdp.send',
      supported: true,
    });
    expect(() => dispatchMetadata('capabilities.get', ['missing'])).toThrow(
      'unknown capability',
    );
    expect(() => dispatchMetadata('capabilities.list', [2])).toThrow(
      'takes no arguments',
    );
    expect(() => dispatchMetadata('unknown', [])).toThrow(
      'unknown SDK metadata',
    );
  });

  it('returns known documentation and rejects unknown requested topics', () => {
    const doc = dispatchMetadata('documentation.get', ['overview']) as string;
    expect(doc).toContain('browser_run_script');
    expect(() =>
      dispatchMetadata('documentation.get', ['unknown-topic']),
    ).toThrow('SDK documentation topic not found');
    expect(() => dispatchMetadata('documentation.get', [])).toThrow('requires');
  });

  it('creates provider tab identifiers without guessing titles or URLs', () => {
    expect(
      openUserTabs([
        {
          browserId: 'a',
          tabId: '7',
          generation: 2,
          title: 'Product',
          url: 'https://example.test',
          claimed: false,
          active: true,
        },
        {
          browserId: 'b',
          tabId: '9',
          generation: 5,
          claimed: true,
          active: false,
        },
      ]),
    ).toEqual([
      {
        id: 'a:7:2',
        providerTabId: 'a:7:2',
        title: 'Product',
        url: 'https://example.test',
      },
      { id: 'b:9:5', providerTabId: 'b:9:5' },
    ]);
  });
});
