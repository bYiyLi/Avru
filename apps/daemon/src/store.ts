import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface BrowserRecord {
  id: string;
  name: string;
  origin: string;
}
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export class BrowserStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, 'a', 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error('Unsupported database version');
    }
    if (version === 0)
      this.db.exec(`CREATE TABLE IF NOT EXISTS browsers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL,
      profile_id TEXT NOT NULL, token_hash TEXT NOT NULL
    ); PRAGMA user_version = 1;`);
  }
  list(): BrowserRecord[] {
    return this.db
      .prepare('SELECT id, name, origin FROM browsers ORDER BY rowid')
      .all()
      .map((row) => {
        if (
          typeof row.id !== 'string' ||
          typeof row.name !== 'string' ||
          typeof row.origin !== 'string'
        )
          throw new Error('Invalid browser database');
        return { id: row.id, name: row.name, origin: row.origin };
      });
  }
  add(
    identity: { name: string; origin: string; profileId: string },
    token: string,
  ): BrowserRecord {
    if (this.list().length >= 64) throw new Error('Browser limit reached');
    const item = {
      id: randomUUID(),
      name: identity.name,
      origin: identity.origin,
    };
    this.db
      .prepare('INSERT INTO browsers VALUES (?, ?, ?, ?, ?)')
      .run(item.id, item.name, item.origin, identity.profileId, digest(token));
    return item;
  }
  authenticate(
    id: string,
    origin: string,
    token: string,
  ): BrowserRecord | undefined {
    const row = this.db
      .prepare('SELECT name, origin, token_hash FROM browsers WHERE id = ?')
      .get(id);
    if (
      !row ||
      row.origin !== origin ||
      typeof row.name !== 'string' ||
      typeof row.token_hash !== 'string'
    )
      return undefined;
    const hash = Buffer.from(row.token_hash);
    const supplied = Buffer.from(digest(token));
    if (hash.length !== supplied.length || !timingSafeEqual(hash, supplied))
      return undefined;
    return { id, name: row.name, origin };
  }
  remove(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM browsers WHERE id = ?').run(id).changes > 0
    );
  }
  close(): void {
    this.db.close();
  }
}
