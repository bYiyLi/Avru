/**
 * Claim registry (M1, T6). A claim reserves one tab for one OAuth grant owner
 * until a task consumes it; the claim is bound to that execution at submit
 * time and released when the execution reaches a terminal state (or is
 * cancelled). Same-owner re-claim of an unbound claim is idempotent; a claim
 * held by another owner, or already bound to a running/queued execution, is
 * TAB_ALREADY_CLAIMED. An unbound claim expires after 600 s (the OAuth token
 * lifetime) so a grant that never runs cannot block other owners forever.
 * The registry is pure state: target existence and title/url snapshot
 * validation live in Executions, which owns the connections.
 */
export interface ClaimTarget {
  browserId: string;
  tabId: number;
}
export interface Claim extends ClaimTarget {
  owner: string;
  generation: number;
  title?: string;
  url?: string;
  claimedAt: number;
  executionId?: string;
}
const UNCONSUMED_TTL_MS = 600_000;
function key(browserId: string, tabId: number): string {
  return browserId + ':' + String(tabId);
}
/** Error carrying a design error code (the MCP layer maps it to a tool error). */
export function claimError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
export class ClaimRegistry {
  private readonly claims = new Map<string, Claim>();
  claim(
    owner: string,
    target: ClaimTarget & {
      generation: number;
      title?: string;
      url?: string;
    },
  ): Claim {
    const existing = this.get(target.browserId, target.tabId);
    if (existing) {
      if (existing.executionId !== undefined || existing.owner !== owner)
        throw claimError('TAB_ALREADY_CLAIMED');
      return existing;
    }
    const claim: Claim = {
      owner,
      browserId: target.browserId,
      tabId: target.tabId,
      generation: target.generation,
      ...(target.title !== undefined ? { title: target.title } : {}),
      ...(target.url !== undefined ? { url: target.url } : {}),
      claimedAt: Date.now(),
    };
    this.claims.set(key(target.browserId, target.tabId), claim);
    return { ...claim };
  }
  /** Bind an unbound claim owned by `owner` to an execution (run_script submit). */
  bind(
    executionId: string,
    owner: string,
    browserId: string,
    tabId: number,
  ): void {
    const existing = this.claims.get(key(browserId, tabId));
    if (
      !existing ||
      existing.owner !== owner ||
      existing.executionId !== undefined
    )
      throw claimError('TAB_NOT_CLAIMED');
    existing.executionId = executionId;
  }
  release(browserId: string, tabId: number): void {
    this.claims.delete(key(browserId, tabId));
  }
  releaseByExecution(executionId: string): void {
    for (const [itemKey, claim] of this.claims)
      if (claim.executionId === executionId) this.claims.delete(itemKey);
  }
  releaseForOwner(owner: string): void {
    for (const [itemKey, claim] of this.claims)
      if (claim.owner === owner) this.claims.delete(itemKey);
  }
  get(browserId: string, tabId: number): Claim | undefined {
    const itemKey = key(browserId, tabId);
    const claim = this.claims.get(itemKey);
    if (!claim) return undefined;
    if (
      claim.executionId === undefined &&
      claim.claimedAt + UNCONSUMED_TTL_MS <= Date.now()
    ) {
      this.claims.delete(itemKey);
      return undefined;
    }
    return { ...claim };
  }
  isClaimed(browserId: string, tabId: number): boolean {
    return this.get(browserId, tabId) !== undefined;
  }
  size(): number {
    return this.claims.size;
  }
}
