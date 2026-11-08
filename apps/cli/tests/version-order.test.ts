import { expect, it } from 'vitest';
import { compareVersions } from '../src/version-order.js';

it('compares supported versions numerically within the same environment', () => {
  expect(compareVersions('0.1.0-dev.1', '0.1.0-dev.1')).toBe(0);
  expect(compareVersions('0.01.0-dev.01', '0.1.0-dev.1')).toBe(0);
  expect(compareVersions('0.1.0-dev.10', '0.1.0-dev.2')).toBe(1);
  expect(compareVersions('0.1.0-dev.1', '0.1.0-dev.2')).toBe(-1);
  expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
  expect(compareVersions('1.2.3', '1.2.2')).toBe(1);
  expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  expect(
    compareVersions('90071992547409930.0.0', '90071992547409929.0.0'),
  ).toBe(1);
  expect(compareVersions('0.1.0', '0.1.0-dev.1')).toBeUndefined();
  expect(compareVersions('unknown', '0.1.0-dev.1')).toBeUndefined();
  expect(compareVersions('0.1.0-dev.1', 'unknown')).toBeUndefined();
});
