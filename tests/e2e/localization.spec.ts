import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProfile } from './browser-fixture.js';
test('extension has a management action without a popup in every supported browser locale', async () => {
  for (const locale of ['en-US', 'zh-TW', 'fr-FR']) {
    const directory = await mkdtemp(join(tmpdir(), 'avru-action-locale-'));
    const { context, worker } = await openProfile(directory, locale);
    try {
      const manifest = await worker.evaluate<{
        name: string;
        action: { default_popup?: string };
      }>('chrome.runtime.getManifest()');
      expect(manifest.name).toContain('Avru');
      expect(manifest.action.default_popup).toBeUndefined();
      expect(await worker.evaluate<string>('chrome.action.getPopup({})')).toBe(
        '',
      );
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
