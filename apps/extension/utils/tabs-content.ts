/** Read URLs in temporary background tabs without changing the selected tab. */
interface ContentPage {
  title: string;
  url: string;
  text: string;
}

export interface TabsContentPort {
  tabs: {
    get(id: number): Promise<{
      status?: 'loading' | 'complete' | 'unloaded' | undefined;
    }>;
    create?: (options: { url?: string; active?: boolean }) => Promise<{
      id?: number | undefined;
    }>;
    remove?: (id: number) => Promise<void>;
  };
  scripting: {
    executeScript(details: {
      target: { tabId: number };
      func: () => ContentPage;
    }): Promise<{ result?: ContentPage }[]>;
  };
}

interface ContentOptions {
  contentType: 'html' | 'text' | 'domSnapshot';
  urls: string[];
  timeoutMs?: number;
}

interface ContentResult {
  url: string;
  title: string | null;
  content: string | null;
}

function validate(value: unknown): ContentOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_ARGUMENT');
  const input = value as Partial<ContentOptions>;
  if (
    !['html', 'text', 'domSnapshot'].includes(input.contentType ?? '') ||
    !Array.isArray(input.urls) ||
    input.urls.length < 1 ||
    input.urls.length > 8 ||
    input.urls.some(
      (url) =>
        typeof url !== 'string' ||
        url.length > 2048 ||
        !/^https?:\/\/[^\s]+$/u.test(url),
    ) ||
    (input.timeoutMs !== undefined &&
      (!Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > 30_000))
  )
    throw new Error('INVALID_ARGUMENT');
  return input as ContentOptions;
}

function readText(): ContentPage {
  const body = document.body as HTMLElement | null;
  return {
    title: document.title,
    url: location.href,
    text: (body?.innerText ?? '').slice(0, 4096),
  };
}
function readHtml(): ContentPage {
  return {
    title: document.title,
    url: location.href,
    text: document.documentElement.outerHTML.slice(0, 4096),
  };
}
function readDomSnapshot(): ContentPage {
  const elements = document.querySelectorAll(
    'h1,h2,h3,a[href],button,input,textarea,select,[role]',
  );
  const lines = Array.from(elements)
    .slice(0, 80)
    .map((element) => {
      const name =
        element.getAttribute('aria-label') ??
        element.getAttribute('placeholder') ??
        element.textContent;
      return element.tagName.toLowerCase() + ': ' + name.trim().slice(0, 120);
    });
  return {
    title: document.title,
    url: location.href,
    text: lines.join('\n').slice(0, 4096),
  };
}

async function waitForReady(
  api: TabsContentPort,
  tabId: number,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    const tab = await api.tabs.get(tabId);
    if (tab.status === 'complete' || tab.status === undefined) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('TIMEOUT');
}

async function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            reject(new Error('TIMEOUT'));
          },
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function boundOutput(items: ContentResult[]): ContentResult[] {
  const encoder = new TextEncoder();
  for (let attempt = 0; attempt < 16; attempt++) {
    if (encoder.encode(JSON.stringify(items)).length <= 60_000) return items;
    for (const item of items)
      if (item.content)
        item.content = item.content.slice(
          0,
          Math.floor(item.content.length / 2),
        );
  }
  throw new Error('OUTPUT_TOO_LARGE');
}

async function contentOf(
  api: TabsContentPort,
  url: string,
  options: ContentOptions,
  deadline: number,
): Promise<ContentResult> {
  if (!api.tabs.create || !api.tabs.remove)
    throw new Error('CAPABILITY_NOT_ALLOWED');
  if (Date.now() >= deadline) throw new Error('TIMEOUT');
  const tab = await api.tabs.create({ url, active: false });
  if (tab.id === undefined || !Number.isSafeInteger(tab.id))
    throw new Error('TARGET_GONE');
  try {
    await waitForReady(api, tab.id, deadline);
    const func =
      options.contentType === 'html'
        ? readHtml
        : options.contentType === 'domSnapshot'
          ? readDomSnapshot
          : readText;
    const response = await withDeadline(
      api.scripting
        .executeScript({ target: { tabId: tab.id }, func })
        .catch(() => {
          throw new Error('PAGE_NOT_ACCESSIBLE');
        }),
      deadline,
    );
    const result = response[0]?.result;
    if (
      !result ||
      typeof result.text !== 'string' ||
      typeof result.url !== 'string' ||
      result.url.length > 2048 ||
      typeof result.title !== 'string'
    )
      throw new Error('PAGE_NOT_ACCESSIBLE');
    return {
      url: result.url,
      title: result.title.slice(0, 200),
      content: result.text.slice(0, 4096),
    };
  } finally {
    await api.tabs.remove(tab.id);
  }
}

export async function readTabsContent(
  api: TabsContentPort,
  args: unknown[],
): Promise<ContentResult[]> {
  if (args.length !== 1) throw new Error('INVALID_ARGUMENT');
  const options = validate(args[0]);
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  const output = [];
  for (const url of options.urls)
    output.push(await contentOf(api, url, options, deadline));
  return boundOutput(output);
}
