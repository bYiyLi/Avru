import { afterEach, expect, it, vi } from 'vitest';
import { AutoChallenge } from '../utils/auto-challenge';
afterEach(() => {
  vi.useRealTimers();
});
it('accepts exactly one challenge and safely ignores unsolicited responses', async () => {
  const h = new AutoChallenge();
  h.accept('a'.repeat(64));
  const pending = h.wait();
  h.accept('a'.repeat(64));
  await expect(pending).resolves.toBe('a'.repeat(64));
  h.cancel();
});
it('rejects timeout, replacement, cancellation and malformed challenges', async () => {
  vi.useFakeTimers();
  const h = new AutoChallenge();
  for (const value of [undefined, 'invalid']) {
    const pending = h.wait();
    const rejected = expect(pending).rejects.toThrow();
    h.accept(value);
    await rejected;
  }
  const first = h.wait();
  const rejected = expect(first).rejects.toThrow();
  const second = h.wait();
  await rejected;
  const timed = expect(second).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(8000);
  await timed;
});
