import { describe, expect, it, vi } from 'vitest';
import { Script } from 'node:vm';
import { execute } from '../src/engine';

function bridge(
  response: (command: string, args: Record<string, unknown>) => unknown,
) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const invoke = vi.fn((method: string, json: string) => {
    expect(method).toBe('cdp.send');
    const input = JSON.parse(json) as [string, Record<string, unknown>];
    calls.push({ command: input[0], args: input[1] });
    return Promise.resolve(JSON.stringify(response(input[0], input[1])));
  });
  return { invoke, calls };
}

const observed = {
  url: 'https://example.test/',
  title: 'Example',
  text: 'Search',
  pageVersion: 123,
  root: {
    ref: 'document',
    role: 'document',
    children: [{ ref: 'e:123:0', role: 'button', name: 'Search' }],
  },
  truncated: false,
};

function withTaskRef(expression: string) {
  const nonce = /"nonce":"([^"]+)"/u.exec(expression)?.[1] ?? '';
  return {
    ...observed,
    root: {
      ...observed.root,
      children: [
        { ...observed.root.children[0], ref: 'e:' + nonce + ':123:0' },
      ],
    },
  };
}

describe('page API in isolated QuickJS', () => {
  it('queries CSS locators and exposes a DOM snapshot through the semantic facade', async () => {
    const h = bridge((_command, args) => {
      const expression = String(args.expression);
      if (expression.includes('root.querySelectorAll(rootSelector(q))'))
        return { result: { value: 2 } };
      if (
        expression.includes('Array.from(document.querySelectorAll("iframe"))')
      )
        return { result: { value: [] } };
      return { result: { value: observed } };
    });
    const outcome = await execute(
      'return {count: await browser.tab.locator("button").count(), tree: await browser.tab.playwright.domSnapshot()};',
      h.invoke,
    );
    expect(outcome).toEqual({
      status: 'completed',
      json: JSON.stringify({ count: 2, tree: 'button: Search' }),
    });
  });

  it('clicks the selected locator after generating a fresh element ref', async () => {
    const h = bridge((command, args) => {
      if (command !== 'Runtime.evaluate') return {};
      const expr = String(args.expression);
      if (expr.includes('const KEY ='))
        return { result: { value: withTaskRef(expr) } };
      if (expr.includes('const n=args.index')) {
        const nonce = /"nonce":"([^"]+)"/u.exec(expr)?.[1] ?? '';
        return { result: { value: 'e:' + nonce + ':123:locator:0' } };
      }
      return { result: { value: { x: 15, y: 20, pageVersion: 123 } } };
    });
    const outcome = await execute(
      'return await browser.tab.playwright.getByRole("button", {name:"Search"}).click();',
      h.invoke,
    );
    expect(outcome.status).toBe('completed');
    expect(h.calls.map((item) => item.command)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.calls[5]?.args).toMatchObject({
      type: 'mousePressed',
      x: 15,
      y: 20,
    });
  });

  it('moves through CDP navigation history without silently fabricating entries', async () => {
    const h = bridge((command) =>
      command === 'Page.getNavigationHistory'
        ? { currentIndex: 1, entries: [{ id: 5 }, { id: 7 }] }
        : {},
    );
    const result = await execute(
      'return await browser.tab.goBack();',
      h.invoke,
    );
    expect(result.status).toBe('completed');
    expect(h.calls[1]).toEqual({
      command: 'Page.navigateToHistoryEntry',
      args: { entryId: 5 },
    });
    const forward = await execute(
      'try { await browser.tab.forward(); return "unexpected"; } catch(e) { return e.code; }',
      h.invoke,
    );
    expect(forward).toEqual({ status: 'completed', json: '"NO_HISTORY"' });
  });
  it('returns structured, scoped snapshots with element references', async () => {
    const h = bridge(() => ({ result: { value: observed } }));
    const outcome = await execute(
      'return await browser.tab.snapshot();',
      h.invoke,
      5000,
      {
        target: { browserId: 'a', tabId: '7', generation: 3 },
      },
    );
    expect(outcome.status).toBe('completed');
    expect(
      JSON.parse(outcome.status === 'completed' ? outcome.json : '{}'),
    ).toMatchObject({
      ...observed,
      tabId: '7',
      generation: 3,
    });
    expect(h.calls[0]?.args.expression).toContain('querySelectorAll');
  });

  it('uses the actual CDP mouse sequence for a snapshot element click', async () => {
    const h = bridge((command, args) => {
      if (command === 'Runtime.evaluate') {
        const expr = String(args.expression);
        // CDP test doubles must also reject invalid page JavaScript, as Chrome
        // does. This caught an accidentally non-async IIFE containing await.
        if (
          expr.includes(
            'const state=globalThis.__avru_sdk_refs_v1;const version',
          )
        )
          expect(() => new Script(expr)).not.toThrow();
        if (expr.includes('const KEY ='))
          return { result: { value: withTaskRef(expr) } };
        return { result: { value: { x: 27, y: 36, pageVersion: 123 } } };
      }
      return {};
    });
    const outcome = await execute(
      'const page = await browser.tab.snapshot(); return await browser.tab.click(page.root.children[0].ref);',
      h.invoke,
    );
    expect(outcome).toEqual({
      status: 'completed',
      json: JSON.stringify({ ok: true, pageVersion: 123, changed: false }),
    });
    expect(h.calls.map((call) => call.command)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
      'Input.dispatchMouseEvent',
    ]);
    expect(h.calls[3]?.args).toMatchObject({
      type: 'mousePressed',
      x: 27,
      y: 36,
      button: 'left',
    });
  });
});

describe('page API errors, keyboard and waits', () => {
  it('does not send a mouse event when the element reference is stale', async () => {
    const h = bridge((_command, args) => {
      const expr = String(args.expression);
      return expr.includes('const KEY =')
        ? { result: { value: withTaskRef(expr) } }
        : { result: { value: { error: 'STALE_REF' } } };
    });
    const outcome = await execute(
      'const page = await browser.tab.snapshot(); try { await browser.tab.click(page.root.children[0].ref); return "unexpected"; } catch (error) { return error.code; }',
      h.invoke,
    );
    expect(outcome).toEqual({ status: 'completed', json: '"STALE_REF"' });
    expect(h.calls.map((call) => call.command)).toEqual([
      'Runtime.evaluate',
      'Runtime.evaluate',
    ]);
  });

  it('does not reuse an element ref from an earlier execution', async () => {
    const first = bridge((_command, args) => ({
      result: { value: withTaskRef(String(args.expression)) },
    }));
    const snapshot = await execute(
      'return (await browser.tab.snapshot()).root.children[0].ref;',
      first.invoke,
    );
    expect(snapshot.status).toBe('completed');
    const ref = JSON.parse(
      snapshot.status === 'completed' ? snapshot.json : '""',
    ) as string;
    const next = bridge(() => ({}));
    const used = await execute(
      'try { await browser.tab.click(' +
        JSON.stringify(ref) +
        '); return "unexpected"; } catch (error) { return error.code; }',
      next.invoke,
    );
    expect(used).toEqual({ status: 'completed', json: '"INVALID_ARGUMENT"' });
    expect(next.invoke).not.toHaveBeenCalled();
  });

  it('fills editable fields and exposes a conservative changed flag', async () => {
    const h = bridge((_command, args) => {
      const expr = String(args.expression);
      return expr.includes('const KEY =')
        ? { result: { value: withTaskRef(expr) } }
        : { result: { value: { changed: true, pageVersion: 123 } } };
    });
    const outcome = await execute(
      'const page = await browser.tab.snapshot(); return await browser.tab.fill(page.root.children[0].ref, "headphones");',
      h.invoke,
    );
    expect(outcome).toEqual({
      status: 'completed',
      json: JSON.stringify({ ok: true, pageVersion: 123, changed: true }),
    });
    const expr = h.calls[1]?.args.expression;
    expect(expr).toContain('headphones');
    expect(expr).toContain('InputEvent');
  });

  it('navigates, dispatches keyboard events and scrolls without command filters', async () => {
    const h = bridge((command) =>
      command === 'Page.navigate'
        ? { frameId: '1' }
        : command === 'Runtime.evaluate'
          ? { result: { value: { pageVersion: 123 } } }
          : {},
    );
    const outcome = await execute(
      'await browser.tab.navigate("https://example.test/next"); await browser.tab.press("Enter"); return await browser.tab.scroll({y: 300});',
      h.invoke,
    );
    expect(outcome.status).toBe('completed');
    expect(h.calls.map((call) => call.command)).toEqual([
      'Page.enable',
      'Page.navigate',
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
      'Runtime.evaluate',
    ]);
    expect(h.calls[1]?.args).toEqual({ url: 'https://example.test/next' });
    expect(String(h.calls[4]?.args.expression)).toContain('window.scrollBy');
  });

  it('waits for a page condition then captures a fresh snapshot', async () => {
    const h = bridge((_command, args) =>
      String(args.expression).includes('deadline = Date.now()')
        ? { result: { value: true } }
        : { result: { value: observed } },
    );
    const outcome = await execute(
      'return await browser.tab.waitFor({kind: "text", value: "Search", timeoutMs: 1000});',
      h.invoke,
    );
    expect(outcome.status).toBe('completed');
    const data = JSON.parse(
      outcome.status === 'completed' ? outcome.json : '{}',
    ) as { matched: boolean; snapshot: { root: unknown } };
    expect(data.matched).toBe(true);
    expect(data.snapshot.root).toEqual(observed.root);
    expect(h.calls).toHaveLength(2);
  });

  it('rejects malformed inputs before calling the host', async () => {
    const h = bridge(() => ({}));
    const outcome = await execute(
      'for (const f of [() => browser.tab.click("oops"), () => browser.tab.fill("e:1:0", 42), () => browser.tab.navigate("file:///secret"), () => browser.tab.waitFor({kind:"broken",value:"x"})]) { try { await f(); } catch (error) { if (error.code !== "INVALID_ARGUMENT") return error.code; } } return "ok";',
      h.invoke,
    );
    expect(outcome).toEqual({ status: 'completed', json: '"ok"' });
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
