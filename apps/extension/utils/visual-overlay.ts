/** Page-only presentation for browser automation. This never captures page data. */
type CursorMessage = {
  type: 'avru.cursor';
  x: number;
  y: number;
  visible?: boolean;
  action?: string;
};
type FaviconMessage = {
  type: 'avru.favicon.status';
  status: 'active' | 'done' | 'clear';
  taskId: string;
};
export type VisualMessage = CursorMessage | FaviconMessage;

export function isVisualMessage(value: unknown): value is VisualMessage {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if (data.type === 'avru.cursor')
    return (
      typeof data.x === 'number' &&
      Number.isFinite(data.x) &&
      typeof data.y === 'number' &&
      Number.isFinite(data.y) &&
      (data.visible === undefined || typeof data.visible === 'boolean')
    );
  return (
    data.type === 'avru.favicon.status' &&
    ['active', 'done', 'clear'].includes(String(data.status)) &&
    typeof data.taskId === 'string'
  );
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[char] ?? '';
  });
}

function badgeSvg(original: string, status: 'active' | 'done'): string {
  const base = original
    ? `<image href="${escapeXml(original)}" x="1" y="1" width="29" height="29" opacity="${status === 'active' ? '.5' : '1'}"/>`
    : '<rect x="1" y="1" width="29" height="29" rx="7" fill="#dbeafe"/>';
  const marker =
    status === 'active'
      ? '<path d="M19 16 30 23 25 25 23 30Z" fill="#2563eb" stroke="white" stroke-width="1.5"/>'
      : '<circle cx="26" cy="26" r="5" fill="#2563eb" stroke="white" stroke-width="2"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${base}${marker}</svg>`;
}

/** Returns a message handler; only trusted extension runtime messages reach it. */
export function createVisualOverlay(doc: Document, reducedMotion = false) {
  let pointer: HTMLElement | undefined;
  let position: { x: number; y: number } | undefined;
  let badge: HTMLLinkElement | undefined;

  function ensurePointer(): HTMLElement {
    if (pointer) return pointer;
    const host = doc.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:fixed!important;inset:0!important;pointer-events:none!important;' +
      'z-index:2147483647!important;overflow:hidden!important;contain:layout style!important;';
    pointer = doc.createElement('div');
    pointer.style.cssText =
      'position:absolute;left:0;top:0;width:24px;height:24px;pointer-events:none;' +
      'clip-path:polygon(0 0,100% 52%,57% 63%,42% 100%,28% 65%);' +
      'background:#2563eb;filter:drop-shadow(0 0 6px #60a5fa);opacity:0;';
    host.append(pointer);
    doc.documentElement.append(host);
    return pointer;
  }
  async function move(message: CursorMessage): Promise<void> {
    const marker = ensurePointer();
    if (message.visible === false) {
      marker.style.opacity = '0';
      return;
    }
    const next = { x: message.x, y: message.y };
    const end = `translate3d(${String(next.x)}px,${String(next.y)}px,0)`;
    marker.style.opacity = '1';
    if (position && !reducedMotion && typeof marker.animate === 'function') {
      const distance = Math.hypot(next.x - position.x, next.y - position.y);
      const duration = Math.min(420, Math.max(65, distance * 0.35));
      const mid = `translate3d(${String((next.x + position.x) / 2)}px,${String((next.y + position.y) / 2 - Math.min(distance / 8, 40))}px,0)`;
      const from = `translate3d(${String(position.x)}px,${String(position.y)}px,0)`;
      const animation = marker.animate(
        [{ transform: from }, { transform: mid }, { transform: end }],
        { duration, easing: 'ease-in-out', fill: 'forwards' },
      );
      try {
        await animation.finished;
      } finally {
        marker.style.transform = end;
        animation.cancel();
      }
    } else {
      marker.style.transform = end;
    }
    position = next;
  }
  function favicon(message: FaviconMessage): void {
    if (message.status === 'clear') {
      badge?.remove();
      badge = undefined;
      return;
    }
    const original = doc.querySelector<HTMLLinkElement>(
      'link[rel~="icon"]:not([data-avru-badge])',
    );
    if (!badge) {
      badge = doc.createElement('link');
      badge.rel = 'icon';
      badge.type = 'image/svg+xml';
      badge.setAttribute('data-avru-badge', '');
    }
    badge.href =
      'data:image/svg+xml,' +
      encodeURIComponent(badgeSvg(original?.href ?? '', message.status));
    doc.head.append(badge);
  }
  return async (message: VisualMessage): Promise<void> => {
    if (message.type === 'avru.cursor') await move(message);
    else favicon(message);
  };
}
