import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { BrowserStore } from '../src/store.js';
const identity = {
  name: 'Chrome',
  origin: 'chrome-extension://' + 'a'.repeat(32),
  profileId: 'profile',
};
describe('credential persistence', () => {
  it('persists only hashes, binds origin, reopens offline identity and revokes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'avru-store-'));
    const path = join(directory, 'private', 'browsers.sqlite');
    let store = new BrowserStore(path);
    const secret = 'b'.repeat(64);
    const item = store.add(identity, secret);
    expect(store.list()).toEqual([item]);
    expect(store.authenticate(item.id, identity.origin, secret)).toEqual(item);
    expect(store.authenticate(item.id, 'wrong-origin', secret)).toBeUndefined();
    expect(
      store.authenticate(item.id, identity.origin, 'wrong-secret'),
    ).toBeUndefined();
    expect(
      store.authenticate('missing', identity.origin, secret),
    ).toBeUndefined();
    store.close();
    expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    if (process.platform !== 'win32')
      expect(statSync(path).mode & 0o777).toBe(0o600);
    store = new BrowserStore(path);
    expect(store.authenticate(item.id, identity.origin, secret)).toEqual(item);
    expect(store.remove(item.id)).toBe(true);
    expect(store.remove(item.id)).toBe(false);
    store.close();
    rmSync(directory, { recursive: true });
  });
  it('bounds retained profiles and rejects corrupt records', () => {
    const store = new BrowserStore(':memory:');
    for (let i = 0; i < 64; i++) store.add(identity, String(i));
    expect(() => store.add(identity, 'overflow')).toThrow('limit');
    store.close();
    const directory = mkdtempSync(join(tmpdir(), 'avru-corrupt-'));
    const path = join(directory, 'db');
    const corrupt = new BrowserStore(path);
    const row = corrupt.add(identity, 'secret');
    const db = new DatabaseSync(path);
    db.prepare('UPDATE browsers SET name=?, token_hash=? WHERE id=?').run(
      new Uint8Array([1]),
      'short',
      row.id,
    );
    expect(() => corrupt.list()).toThrow('Invalid browser');
    expect(
      corrupt.authenticate(row.id, identity.origin, 'secret'),
    ).toBeUndefined();
    db.prepare('UPDATE browsers SET name=? WHERE id=?').run('name', row.id);
    expect(
      corrupt.authenticate(row.id, identity.origin, 'secret'),
    ).toBeUndefined();
    db.close();
    corrupt.close();
    const future = new DatabaseSync(path);
    future.exec('PRAGMA user_version = 2');
    future.close();
    expect(() => new BrowserStore(path)).toThrow(
      'Unsupported database version',
    );
    rmSync(directory, { recursive: true });
  });
});
