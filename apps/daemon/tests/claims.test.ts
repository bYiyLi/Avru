import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaimRegistry } from '../src/claims';

afterEach(() => {
  vi.useRealTimers();
});

describe('ClaimRegistry (T6)', () => {
  it('claims a tab, is idempotent for the same owner, and blocks another owner', () => {
    const registry = new ClaimRegistry();
    const claim = registry.claim('owner-a', {
      browserId: 'b',
      tabId: 12,
      generation: 1,
      title: 'B',
    });
    expect(claim).toMatchObject({
      owner: 'owner-a',
      browserId: 'b',
      tabId: 12,
      generation: 1,
    });
    expect(registry.isClaimed('b', 12)).toBe(true);
    expect(
      registry.claim('owner-a', { browserId: 'b', tabId: 12, generation: 1 }),
    ).toEqual(claim);
    expect(() =>
      registry.claim('owner-b', { browserId: 'b', tabId: 12, generation: 1 }),
    ).toThrow('TAB_ALREADY_CLAIMED');
    expect(registry.size()).toBe(1);
  });
  it('binds a claim to an execution and releases it by execution', () => {
    const registry = new ClaimRegistry();
    registry.claim('owner-a', { browserId: 'b', tabId: 12, generation: 1 });
    expect(() => {
      registry.bind('exec-1', 'owner-b', 'b', 12);
    }).toThrow('TAB_NOT_CLAIMED');
    expect(() => {
      registry.bind('exec-1', 'owner-a', 'b', 99);
    }).toThrow('TAB_NOT_CLAIMED');
    registry.bind('exec-1', 'owner-a', 'b', 12);
    expect(registry.get('b', 12)).toMatchObject({ executionId: 'exec-1' });
    expect(() =>
      registry.claim('owner-a', { browserId: 'b', tabId: 12, generation: 1 }),
    ).toThrow('TAB_ALREADY_CLAIMED');
    registry.releaseByExecution('exec-1');
    expect(registry.isClaimed('b', 12)).toBe(false);
    expect(
      registry.claim('owner-b', { browserId: 'b', tabId: 12, generation: 2 }),
    ).toMatchObject({ owner: 'owner-b', generation: 2 });
  });
  it('releases a claim and all of one owner claims', () => {
    const registry = new ClaimRegistry();
    registry.claim('owner-a', { browserId: 'b', tabId: 12, generation: 1 });
    registry.claim('owner-a', { browserId: 'b', tabId: 13, generation: 1 });
    registry.claim('owner-b', { browserId: 'a', tabId: 12, generation: 1 });
    registry.release('b', 12);
    expect(registry.isClaimed('b', 12)).toBe(false);
    expect(registry.isClaimed('b', 13)).toBe(true);
    registry.releaseForOwner('owner-a');
    expect(registry.isClaimed('b', 13)).toBe(false);
    expect(registry.isClaimed('a', 12)).toBe(true);
    expect(registry.size()).toBe(1);
  });
  it('expires an unbound claim after the 600 s token lifetime', () => {
    vi.useFakeTimers();
    const registry = new ClaimRegistry();
    registry.claim('owner-a', { browserId: 'b', tabId: 12, generation: 1 });
    vi.advanceTimersByTime(599_000);
    expect(registry.isClaimed('b', 12)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(registry.get('b', 12)).toBeUndefined();
    expect(registry.isClaimed('b', 12)).toBe(false);
    expect(
      registry.claim('owner-b', { browserId: 'b', tabId: 12, generation: 1 }),
    ).toMatchObject({ owner: 'owner-b' });
  });
  it('does not expire a bound claim', () => {
    vi.useFakeTimers();
    const registry = new ClaimRegistry();
    registry.claim('owner-a', { browserId: 'b', tabId: 12, generation: 1 });
    registry.bind('exec-1', 'owner-a', 'b', 12);
    vi.advanceTimersByTime(601_000);
    expect(registry.get('b', 12)).toMatchObject({ executionId: 'exec-1' });
  });
});
