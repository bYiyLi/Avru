import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { ConnectionEvents } from '../src/transports/connection-events.js';
// Capacity acceptance performs 205 durable transactions on the actual platform filesystem.
it('persists only bounded fixed events and rolls back a failed write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avru-events-'));
  const path = join(root, 'data.sqlite');
  const events = new ConnectionEvents(path);
  const db = new DatabaseSync(path);
  expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
  try {
    for (let i = 0; i < 205; i++) events.record('process_started');
    expect(events.snapshot().events).toHaveLength(200);
    db.exec(
      "CREATE TRIGGER reject_event BEFORE INSERT ON connection_events BEGIN SELECT RAISE(ABORT, 'failure'); END",
    );
    expect(() => {
      events.record('process_started');
    }).toThrow();
    expect(events.snapshot().events).toHaveLength(200);
    db.exec('DROP TRIGGER reject_event');
    events.record('configuration_removed');
    expect(events.snapshot().events[0]?.code).toBe('configuration_removed');
    events.close();
    const restored = new ConnectionEvents(path);
    expect(restored.snapshot().retention).toEqual({
      limit: 200,
      persistent: true,
    });
    expect(restored.snapshot().events).toHaveLength(200);
    restored.close();
    const memory = new ConnectionEvents();
    expect(memory.snapshot().retention.persistent).toBe(false);
    memory.close();
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
