import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { en } from '../locales/en';
import { zh } from '../locales/zh';
import { localeFor, pairingText, text } from '../utils/i18n';
import { statusText } from '../utils/connection-status';
import { localizePopup } from '../utils/popup-view';

it('selects Chinese for every zh variant and English for other preferred languages', () => {
  for (const value of ['zh', 'zh-CN', 'zh-TW', 'ZH-hant'])
    expect(localeFor(value)).toBe('zh');
  for (const value of ['en', 'fr-FR', 'ja-JP', ''])
    expect(localeFor(value)).toBe('en');
  expect(text('en', 'popup.title')).toBe('Avru browser connection');
  expect(text('zh', 'popup.title')).toBe('Avru 浏览器连接');
  expect(pairingText('en', '000123')).toContain('000123');
  expect(pairingText('zh', '000123')).toContain('000123');
});

it('keeps resources complete, nonempty and interpolation-compatible', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(zh[key].trim()).not.toBe('');
    expect(en[key].trim()).not.toBe('');
    expect(zh[key].match(/\{\w+\}/g) ?? []).toEqual(
      en[key].match(/\{\w+\}/g) ?? [],
    );
  }
});

it('translates only known status codes and validated pairing codes', () => {
  for (const code of [
    'unpaired',
    'connecting',
    'connected',
    'rejected',
    'reconnecting',
    'protocolError',
    'requestFailed',
  ]) {
    expect(statusText('zh', { code })).not.toBe(statusText('en', { code }));
  }
  expect(
    statusText('en', { code: 'pairing', pairingCode: '000123' }),
  ).toContain('000123');
  for (const value of [
    null,
    {},
    '已连接',
    { code: '<script>' },
    { code: 'pairing' },
    { code: 'pairing', pairingCode: '<script>' },
  ])
    expect(statusText('en', value)).toBe('Background service is not ready');
});

it('sets popup language, title, labels and placeholder without HTML insertion', () => {
  const elements = new Map<
    string,
    { textContent: string; placeholder: string }
  >();
  for (const selector of [
    '#status',
    '#description',
    '#endpoint-label',
    '#name-label',
    '#pairing-help',
    '#pair',
    '#disconnect',
    '#revoke-help',
    '[name=name]',
  ])
    elements.set(selector, { textContent: '', placeholder: '' });
  const root = {
    documentElement: { lang: '' },
    title: '',
    querySelector: (selector: string) => elements.get(selector),
  } as unknown as Document;
  for (const locale of ['en', 'zh'] as const) {
    localizePopup(root, locale);
    expect(root.documentElement.lang).toBe(locale);
    expect(root.title).toBe(text(locale, 'popup.title'));
    expect(elements.get('#pair')?.textContent).toBe(text(locale, 'popup.pair'));
    expect(elements.get('[name=name]')?.placeholder).toBe(
      text(locale, 'popup.namePlaceholder'),
    );
  }
  localizePopup(
    {
      documentElement: { lang: '' },
      querySelector: () => null,
    } as unknown as Document,
    'en',
  );
});

it('ships complete browser-managed manifest locales with distinct dev names', () => {
  for (const locale of ['en', 'zh_CN', 'zh_TW']) {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../public/_locales/${locale}/messages.json`, import.meta.url),
        'utf8',
      ),
    ) as Record<string, { message: string }>;
    expect(Object.keys(messages).sort()).toEqual([
      'description',
      'name',
      'nameDev',
    ]);
    expect(messages.name?.message).toBeTruthy();
    expect(messages.nameDev?.message).toContain('Dev');
    expect(messages.description?.message).toBeTruthy();
  }
});
