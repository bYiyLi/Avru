import { expect } from '@playwright/test';
import type { openProfile } from './browser-fixture.js';
import { createServer } from 'node:http';

type BrowserProfile = Awaited<ReturnType<typeof openProfile>>;
type RemoteToolCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function startContentPage() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<html><head><title>Background read</title></head>' +
        '<body><main>Avru content in a background tab</main></body></html>',
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('test HTTP server did not bind a TCP port');
  }
  const url = `http://127.0.0.1:${String(address.port)}/content`;
  const close = async () => {
    // Background browser connections may retain HTTP keep-alive sockets.
    // The fixture owns this server; close its sockets before awaiting teardown.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };
  return { url, close };
}

/** Verify M5 reads an actual page through a temporary background tab. */
export async function verifyTabsContent(
  call: RemoteToolCall,
  profile: BrowserProfile,
  browserId: string,
  tabId: number,
): Promise<void> {
  const initialPages = profile.context.pages().length;
  const current = profile.context
    .pages()
    .find((tab) => tab.url().endsWith('/sdk'));
  const site = await startContentPage();
  try {
    const submitted = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script: `return await browser.tabs.content({contentType:"text",urls:[${JSON.stringify(site.url)}],timeoutMs:5000});`,
    });
    await expect
      .poll(
        async () => {
          const result = await call('browser_get_execution', {
            executionId: submitted.executionId,
          });
          if (result.state === 'failed') {
            throw new Error(
              'background content execution failed: ' + JSON.stringify(result),
            );
          }
          if (result.state !== 'succeeded') return result.state;
          expect(result.result).toEqual([
            {
              url: site.url,
              title: 'Background read',
              content: 'Avru content in a background tab',
            },
          ]);
          return 'succeeded';
        },
        { timeout: 15_000 },
      )
      .toBe('succeeded');
    await expect
      .poll(() => profile.context.pages().length, { timeout: 5_000 })
      .toBe(initialPages);
    expect(current?.url()).toBe('https://avru.example/sdk');
  } finally {
    await site.close();
  }
}
