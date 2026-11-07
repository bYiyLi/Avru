import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  catalogs,
  translate,
  number,
  timestamp,
  tabCount,
  localizeDocument,
} from '../src/i18n.js';
import { language } from '../src/presentation.js';
import type { MessageKey } from '../src/i18n-types.js';
function placeholders(value: string) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}
it('requires complete nonempty catalogs with identical interpolation contracts', () => {
  expect(Object.keys(catalogs.zh).sort()).toEqual(
    Object.keys(catalogs.en).sort(),
  );
  for (const key of Object.keys(catalogs.en) as MessageKey[]) {
    expect(catalogs.zh[key].trim()).not.toBe('');
    expect(catalogs.en[key].trim()).not.toBe('');
    expect(placeholders(catalogs.zh[key])).toEqual(
      placeholders(catalogs.en[key]),
    );
  }
});
it('uses semantic resource keys and prevents reintroducing bilingual calls into components', () => {
  const files = readdirSync('apps/web/src').filter((file) =>
    /\.(ts|tsx)$/.test(file),
  );
  for (const file of files) {
    const source = readFileSync(`apps/web/src/${file}`, 'utf8');
    expect(source).not.toMatch(/t\(\s*locale\s*,\s*['"][\u3400-\u9fff]/);
    expect(source).not.toMatch(/locale\s*===\s*['"]zh['"]\s*\?/);
  }
});
it('formats counts, plurals and UTC instants using the selected locale', () => {
  expect(tabCount('en', 0)).toBe('0 tabs');
  expect(tabCount('en', 1)).toBe('1 tab');
  expect(tabCount('en', 2)).toBe('2 tabs');
  expect(tabCount('zh', 1)).toBe('1 个标签页');
  expect(tabCount('zh', 1200)).toBe('1,200 个标签页');
  expect(translate('en', 'calls.retention', { count: 1200 })).toBe(
    'Retains up to 1,200 records',
  );
  expect(number('en', 12.125, 2)).toBe('12.13');
  expect(timestamp('en', 1001)).not.toBe(timestamp('en', 1002));
  expect(timestamp('zh', 1001)).not.toBe(timestamp('zh', 1002));
  expect(timestamp('en', 0)).toContain('1970');
  expect(timestamp('zh', 0)).toContain('1970');
  expect(timestamp('en', 0)).not.toBe(timestamp('zh', 0));
});
it('selects Chinese for zh variants and English otherwise without a persisted override', () => {
  for (const value of ['zh-CN', 'zh-TW', 'ZH-hant'])
    expect(language(value)).toBe('zh');
  for (const value of ['en-US', 'fr', 'ja', ''])
    expect(language(value)).toBe('en');
  const target = { title: '', documentElement: { lang: '' } };
  for (const locale of ['zh', 'en'] as const) {
    localizeDocument(target as Document, locale);
    expect(target.documentElement.lang).toBe(locale);
    expect(target.title).toBe(translate(locale, 'shell.title'));
  }
});
it('rejects missing interpolation and enforces keys and parameters at compile time', () => {
  expect(() => {
    // @ts-expect-error Missing interpolation must be rejected by the type checker.
    translate('en', 'calls.retention');
  }).toThrow('Missing message parameter');
  const typeOnly = () => {
    // @ts-expect-error Unknown message keys are never accepted.
    translate('en', 'not.a.message');
    // @ts-expect-error Typo in interpolation names must be caught.
    translate('en', 'calls.retention', { total: 1 });
  };
  expect(typeof typeOnly).toBe('function');
});
