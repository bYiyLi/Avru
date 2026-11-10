import { describe, expect, it, vi } from 'vitest';
import { createVisualOverlay, isVisualMessage } from '../utils/visual-overlay';

class ElementFixture {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: ElementFixture[] = [];
  parent: ElementFixture | undefined;
  href = '';
  rel = '';
  type = '';
  animate?: (
    frames: unknown[],
    options: unknown,
  ) => {
    finished: Promise<void>;
    cancel(): void;
  };
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  append(child: ElementFixture) {
    child.remove();
    child.parent = this;
    this.children.push(child);
  }
  remove() {
    if (this.parent) {
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
    }
    this.parent = undefined;
  }
}

function fixture(original?: string) {
  const created: ElementFixture[] = [];
  const documentElement = new ElementFixture('html');
  const head = new ElementFixture('head');
  const originalLink =
    original === undefined ? null : new ElementFixture('link');
  if (originalLink) originalLink.href = original ?? '';
  const doc = {
    documentElement,
    head,
    createElement(tag: string) {
      const node = new ElementFixture(tag);
      created.push(node);
      return node;
    },
    querySelector() {
      return originalLink;
    },
  } as unknown as Document;
  return { doc, created, documentElement, head };
}

describe('trusted extension visual messages', () => {
  it('accepts the supported cursor and badge messages', () => {
    expect(isVisualMessage({ type: 'avru.cursor', x: 0, y: 7 })).toBe(true);
    expect(
      isVisualMessage({ type: 'avru.cursor', x: 1, y: -2, visible: false }),
    ).toBe(true);
    for (const status of ['active', 'done', 'clear'])
      expect(
        isVisualMessage({ type: 'avru.favicon.status', status, taskId: 'a' }),
      ).toBe(true);
  });
  it('rejects malformed or unrelated messages', () => {
    for (const value of [
      null,
      undefined,
      'cursor',
      42,
      [],
      { type: 'other', taskId: 'a' },
      { type: 'avru.cursor', x: '1', y: 2 },
      { type: 'avru.cursor', x: 1, y: NaN },
      { type: 'avru.cursor', x: Infinity, y: 2 },
      { type: 'avru.cursor', x: 1, y: Infinity },
      { type: 'avru.cursor', x: 1, y: 2, visible: 'false' },
      { type: 'avru.favicon.status', status: 'bad', taskId: 'a' },
      { type: 'avru.favicon.status', status: 'done', taskId: 1 },
    ])
      expect(isVisualMessage(value)).toBe(false);
  });
});

describe('Avru page overlay', () => {
  it('renders a non-interactive pointer before CDP mouse input', async () => {
    const h = fixture();
    const render = createVisualOverlay(h.doc);
    await render({ type: 'avru.cursor', x: 10, y: 20 });
    expect(h.created).toHaveLength(2);
    expect(h.documentElement.children).toHaveLength(1);
    const host = h.created[0];
    const marker = h.created[1];
    expect(host?.attributes.get('aria-hidden')).toBe('true');
    expect(host?.style.cssText).toContain('pointer-events:none');
    expect(marker?.style.opacity).toBe('1');
    expect(marker?.style.transform).toBe('translate3d(10px,20px,0)');
    await render({ type: 'avru.cursor', x: 10, y: 20, visible: false });
    expect(marker?.style.opacity).toBe('0');
    expect(h.created).toHaveLength(2);
  });
  it('animates a long move and acknowledges only after animation arrival', async () => {
    const h = fixture();
    const render = createVisualOverlay(h.doc);
    await render({ type: 'avru.cursor', x: 10, y: 20 });
    const marker = h.created[1];
    let arrive: (() => void) | undefined;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({
      finished: new Promise<void>((resolve) => {
        arrive = resolve;
      }),
      cancel,
    }));
    if (marker) marker.animate = animate;
    const waiting = render({ type: 'avru.cursor', x: 210, y: 120 });
    expect(animate).toHaveBeenCalledWith(
      expect.arrayContaining([{ transform: 'translate3d(10px,20px,0)' }]),
      expect.objectContaining({ easing: 'ease-in-out', fill: 'forwards' }),
    );
    expect(cancel).not.toHaveBeenCalled();
    arrive?.();
    await waiting;
    expect(marker?.style.transform).toBe('translate3d(210px,120px,0)');
    expect(cancel).toHaveBeenCalledOnce();
    expect(h.created).toHaveLength(2);
  });
  it('always clears an interrupted animation and respects reduced motion', async () => {
    const h = fixture();
    const render = createVisualOverlay(h.doc);
    await render({ type: 'avru.cursor', x: 0, y: 0 });
    const cancel = vi.fn();
    const marker = h.created[1];
    if (marker)
      marker.animate = () => ({
        finished: Promise.reject(new Error('navigation')),
        cancel,
      });
    await expect(render({ type: 'avru.cursor', x: 3, y: 3 })).rejects.toThrow(
      'navigation',
    );
    expect(cancel).toHaveBeenCalledOnce();
    const noMotion = createVisualOverlay(fixture().doc, true);
    await noMotion({ type: 'avru.cursor', x: 0, y: 0 });
    await noMotion({ type: 'avru.cursor', x: 3, y: 4 });
  });
  it('preserves the original favicon and displays active/done SVG badges', async () => {
    const h = fixture('https://example.test/icon?value="&<>\'');
    const render = createVisualOverlay(h.doc);
    await render({
      type: 'avru.favicon.status',
      status: 'active',
      taskId: 'one',
    });
    const badge = h.created[0];
    expect(badge?.rel).toBe('icon');
    expect(badge?.attributes.has('data-avru-badge')).toBe(true);
    const first = decodeURIComponent(badge?.href.split(',')[1] ?? '');
    expect(first).toContain('&quot;&amp;&lt;&gt;&apos;');
    expect(first).toContain('opacity=".5"');
    await render({
      type: 'avru.favicon.status',
      status: 'done',
      taskId: 'one',
    });
    expect(h.created).toHaveLength(1);
    expect(h.head.children).toHaveLength(1);
    expect(decodeURIComponent(badge?.href.split(',')[1] ?? '')).toContain(
      '<circle',
    );
    await render({
      type: 'avru.favicon.status',
      status: 'clear',
      taskId: 'one',
    });
    expect(h.head.children).toHaveLength(0);
    await render({
      type: 'avru.favicon.status',
      status: 'clear',
      taskId: 'one',
    });
    expect(h.created).toHaveLength(1);
  });
  it('uses a fallback icon when the page has no favicon', async () => {
    const h = fixture();
    const render = createVisualOverlay(h.doc);
    await render({ type: 'avru.favicon.status', status: 'done', taskId: 'a' });
    expect(h.head.children).toHaveLength(1);
    expect(
      decodeURIComponent(h.created[0]?.href.split(',')[1] ?? ''),
    ).toContain('<rect');
  });
});
