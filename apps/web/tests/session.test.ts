import { expect, it, vi } from 'vitest';
import {
  bootstrapManagement,
  managementSession,
  reloadManagementLink,
} from '../src/session.js';
it('imports valid capabilities, strips fragments and clears invalid incoming values', () => {
  const storage = new Map<string, string>();
  const host = {
    location: {
      hash: `#key=${'a'.repeat(64)}`,
      pathname: '/',
      search: '?view=1',
    },
    history: { replaceState: vi.fn() },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  };
  expect(managementSession(host).key).toHaveLength(64);
  expect(host.history.replaceState).toHaveBeenCalledWith(null, '', '/?view=1');
  host.location.hash = '';
  const restored = managementSession(host);
  expect(restored.key).toHaveLength(64);
  restored.clear();
  expect(managementSession(host).key).toBeNull();
  host.location.hash = '#key=bad';
  expect(managementSession(host).key).toBeNull();
  host.location.hash = '#other=value';
  expect(managementSession(host).key).toBeNull();
  host.sessionStorage.setItem('avru.management.key', 'invalid');
  host.location.hash = '';
  expect(managementSession(host).key).toBeNull();
});

it('reinitializes reopened private links without reacting to unrelated or malformed fragments', () => {
  const reload = vi.fn();
  for (const hash of [
    '',
    '#view=overview',
    '#key=bad',
    '#key=' + 'a'.repeat(64) + '&other=1',
  ])
    reloadManagementLink(hash, reload);
  expect(reload).not.toHaveBeenCalled();
  reloadManagementLink('#key=' + 'a'.repeat(64), reload);
  expect(reload).toHaveBeenCalledOnce();
});

it('does not mount the bridge until a fresh fragment-free document loads', () => {
  const values = new Map<string, string>();
  const host = {
    location: { hash: '#key=' + 'b'.repeat(64), pathname: '/', search: '' },
    history: {
      replaceState: vi.fn(() => {
        host.location.hash = '';
      }),
    },
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
  const reload = vi.fn();
  const mount = vi.fn();
  bootstrapManagement(host, reload, mount);
  expect(reload).toHaveBeenCalledOnce();
  expect(mount).not.toHaveBeenCalled();
  expect(host.location.hash).toBe('');
  bootstrapManagement(host, reload, mount);
  expect(reload).toHaveBeenCalledOnce();
  expect(mount).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'b'.repeat(64) }),
  );
});
