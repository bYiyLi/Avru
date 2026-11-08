import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  ConnectionEvent,
  ConnectionEventCode,
} from '../../../../packages/protocol/connection.d.ts';
export class ConnectionEvents {
  private readonly db: DatabaseSync;
  private readonly persistent: boolean;
  constructor(path = ':memory:') {
    this.persistent = path !== ':memory:';
    this.db = new DatabaseSync(path);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS connection_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, code TEXT NOT NULL)',
    );
  }
  record(code: ConnectionEventCode): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO connection_events VALUES (?, ?, ?)')
        .run(randomUUID(), Date.now(), code);
      this.db.exec(
        'DELETE FROM connection_events WHERE rowid NOT IN (SELECT rowid FROM connection_events ORDER BY rowid DESC LIMIT 200)',
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  snapshot(): {
    events: ConnectionEvent[];
    retention: { limit: number; persistent: boolean };
  } {
    const rows = this.db
      .prepare('SELECT id, at, code FROM connection_events ORDER BY rowid DESC')
      .all();
    return {
      events: rows.map((row) => ({
        id: String(row.id),
        at: Number(row.at),
        code: String(row.code) as ConnectionEventCode,
      })),
      retention: { limit: 200, persistent: this.persistent },
    };
  }
  close(): void {
    this.db.close();
  }
}
