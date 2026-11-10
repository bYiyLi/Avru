/**
 * QuickJS → daemon → extension browser SDK bridge (M1–M3).
 * Validates active task state, route generation, operation arguments and
 * execution locks; never requests per-operation user approval. CDP commands
 * and events pass through without a command/domain allowlist. Executions
 * owns task queues and lifecycle, this module owns dispatch and step logs.
 */
import {
  TAB_ACTION_METHODS,
  parseIdentity,
  parseBridgeArgs,
  noArgs,
  oneStringArg,
  actionAborted,
  validateTabAction,
  TITLE_FAILURES,
  recordObservation,
  performTabAction,
  deriveStepContext,
  dispatchMetadata,
  DIRECT_TAB_ACTIONS,
  openUserTabs,
} from './execution-bridge-routes.js';
import { executeCdpAction } from './cdp-bridge.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { TabActionRequest } from './execution-bridge-routes.js';
import type { Connections } from './connections.js';
import type { ClaimRegistry } from './claims.js';
import type { BrowserTab, Entry, ExecutionStep } from './execution-types.js';
import type { ExecutionAudit } from './execution-audit.js';
import {
  codedError,
  errorCode,
  normalizeTabId,
  unknownAfterDispatch,
} from './execution-types.js';

export class ExecutionBridge {
  constructor(
    private readonly connections: Connections,
    private readonly claims: ClaimRegistry,
    private readonly audit?: ExecutionAudit,
  ) {}

  /** A connected browser's live tab (title/url/generation) or undefined. */
  liveTab(
    browserId: string,
    tabId: number,
  ): { title: string; url: string; generation: number } | undefined {
    const browser = this.connections
      .browsers()
      .find((item) => item.id === browserId);
    if (!browser || !browser.connected) return undefined;
    const tab = browser.tabs.find((item) => item.id === tabId);
    if (!tab) return undefined;
    const generation = this.connections.generation(browserId);
    if (generation === undefined) return undefined;
    return { title: tab.title, url: tab.url, generation };
  }

  /**
   * Resolve an AI-selected target and acquire an internal execution lock.
   * The AI no longer has to call browser_claim_tab before running a script.
   * Existing claims still provide concurrency isolation, not user approval.
   */
  resolveTarget(
    owner: string,
    target:
      { browserId: string; tabId: number; generation?: number } | undefined,
  ): { browserId: string; tabId: number; generation: number } | undefined {
    if (target === undefined) return undefined;
    if (typeof target.browserId !== 'string' || !target.browserId)
      throw new Error('INVALID_ARGUMENT');
    const tabId = normalizeTabId(target.tabId);
    if (tabId === undefined) throw new Error('INVALID_ARGUMENT');
    const live = this.liveTab(target.browserId, tabId);
    if (!live) throw new Error('INVALID_TARGET');
    if (
      target.generation !== undefined &&
      target.generation !== live.generation
    )
      throw new Error('INVALID_TARGET');
    const claim = this.claims.get(target.browserId, tabId);
    if (claim) {
      if (claim.owner !== owner || claim.executionId !== undefined)
        throw new Error('TAB_ALREADY_CLAIMED');
      if (claim.generation !== live.generation)
        throw new Error('INVALID_TARGET');
    } else {
      this.claims.claim(owner, {
        browserId: target.browserId,
        tabId,
        generation: live.generation,
        title: live.title,
        url: live.url,
      });
    }
    return {
      browserId: target.browserId,
      tabId,
      generation: live.generation,
    };
  }

  /** One bridge call, with a step record (T9) on the entry. */
  async invoke(
    entry: Entry,
    method: string,
    json: string,
    signal: AbortSignal,
  ): Promise<string> {
    const stepId = randomUUID();
    const started = performance.now();
    const { stepAction, stepTarget } = deriveStepContext(entry, method, json);
    entry.inFlight += 1;
    try {
      const value = await this.dispatch(entry, method, json, signal);
      this.recordStep(entry, {
        stepId,
        action: stepAction,
        ...(stepTarget ? { target: stepTarget } : {}),
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        result: 'ok',
      });
      return JSON.stringify(value);
    } catch (error) {
      if (entry.uncertainStep === stepId) throw error;
      const code = errorCode(error);
      entry.lastFailedStep = stepId;
      if (code === 'UNKNOWN_RESULT') entry.uncertainStep = stepId;
      this.recordStep(entry, {
        stepId,
        action: stepAction,
        ...(stepTarget ? { target: stepTarget } : {}),
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        result: `error:${code}`,
      });
      throw error;
    } finally {
      entry.inFlight -= 1;
    }
  }

  private recordStep(entry: Entry, step: ExecutionStep): void {
    entry.steps.push(step);
    try {
      this.audit?.append(entry.id, step);
    } catch {
      entry.uncertainStep = step.stepId;
      throw codedError('UNKNOWN_RESULT', 'execution audit write failed');
    }
  }

  private async dispatch(
    entry: Entry,
    method: string,
    json: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    // T5 check 1: the task must still be running (a late bridge call after cancel).
    if (entry.state !== 'running')
      throw codedError('CANCELLED', 'task is no longer running');
    if (signal.aborted) throw codedError('CANCELLED', 'task cancelled');
    const args = parseBridgeArgs(json);
    if (DIRECT_TAB_ACTIONS.has(method)) {
      if (!entry.target)
        throw codedError('INVALID_TARGET', 'task has no browser target');
      return this.sendTabAction(entry, {
        target: entry.target,
        method,
        args,
        signal,
        acquireLock: true,
      });
    }
    // Dispatch only SDK bridge method names; CDP method names themselves
    // are unrestricted and never subject to user-confirmation gates.
    switch (method) {
      case 'tabs.list': {
        noArgs(args, 'tabs.list');
        return this.listTabs();
      }
      case 'tabs.get':
        return this.getTab(
          entry,
          oneStringArg(args, 'tabs.get', 'a tabId string'),
        );
      case 'tab.action':
        return this.tabAction(entry, args, signal);
      case 'tab.observe.write':
        return recordObservation(entry, args);
      case 'management.audit':
        noArgs(args, method);
        return entry.steps
          .filter((step) => step.action.startsWith('management.'))
          .map((step) => ({ ...step }));
      case 'browser.user.openTabs':
        noArgs(args, method);
        return openUserTabs(this.listTabs());
      case 'browser.user.getTabContext':
        return this.userTabContext(entry, args, signal);
      case 'browser.user.claimTab':
        return this.claimUserTab(entry, args);
      case 'browser.nameSession':
        return this.nameSession(entry, args, signal);
      case 'documentation.get':
        return dispatchMetadata(method, args);
      case 'tabs.new':
      case 'tabs.content':
      case 'history.search':
      case 'windows.list':
      case 'tabs.move':
      case 'tabs.close':
      case 'tabs.select':
      case 'tabs.selected':
        return this.manageTabs(entry, method, args, signal);
      case 'tab.title': {
        noArgs(args, 'tab.title');
        return this.tabTitle(entry, signal);
      }
      case 'cdp.send':
      case 'cdp.events':
      case 'cdp.cursor':
        return executeCdpAction(this.connections, {
          target: entry.target,
          method,
          args,
          signal,
        });
      case 'capabilities.list':
      case 'capabilities.get':
        return dispatchMetadata(method, args);
      default:
        throw codedError(
          'CAPABILITY_NOT_ALLOWED',
          `unknown bridge method: ${method}`,
        );
    }
  }

  private claimUserTab(entry: Entry, args: unknown[]): BrowserTab {
    if (args.length !== 1)
      throw codedError(
        'INVALID_ARGUMENT',
        'claimTab requires one tab identity',
      );
    const target = parseIdentity(args[0]);
    const live = this.liveTab(target.browserId, target.tabId);
    if (!live || live.generation !== target.generation)
      throw codedError('INVALID_TARGET', 'browser tab is no longer available');
    const existing = this.claims.get(target.browserId, target.tabId);
    if (existing?.executionId !== entry.id || existing.owner !== entry.owner) {
      this.claims.claim(entry.owner, {
        browserId: target.browserId,
        tabId: target.tabId,
        generation: live.generation,
        title: live.title,
        url: live.url,
      });
    }
    return (
      this.listTabs().find(
        (tab) =>
          tab.browserId === target.browserId &&
          tab.tabId === String(target.tabId),
      ) ??
      this.toBrowserTab(
        target.browserId,
        {
          id: target.tabId,
          title: live.title,
          url: live.url,
          active: false,
        },
        live.generation,
      )
    );
  }

  private async userTabContext(
    entry: Entry,
    args: unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    if (args.length !== 1)
      throw codedError(
        'INVALID_ARGUMENT',
        'getTabContext requires one tab identity',
      );
    const target = parseIdentity(args[0]);
    const value = await this.sendTabAction(entry, {
      target,
      method: 'tab.snapshot',
      args: [],
      signal,
      acquireLock: false,
    });
    if (!value || typeof value !== 'object')
      throw codedError('PAGE_NOT_ACCESSIBLE', 'tab context is unavailable');
    const page = value as Record<string, unknown>;
    if (
      typeof page.url !== 'string' ||
      typeof page.title !== 'string' ||
      typeof page.text !== 'string' ||
      typeof page.truncated !== 'boolean'
    )
      throw codedError(
        'PAGE_NOT_ACCESSIBLE',
        'tab context response is invalid',
      );
    return {
      kind: 'text',
      url: page.url,
      title: page.title,
      text: page.text,
      truncated: page.truncated,
    };
  }

  private async nameSession(
    entry: Entry,
    args: unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    if (
      args.length !== 1 ||
      typeof args[0] !== 'string' ||
      !args[0].trim() ||
      args[0].length > 128
    )
      throw codedError('INVALID_ARGUMENT', 'invalid browser session name');
    if (!entry.target)
      throw codedError('INVALID_TARGET', 'task has no browser target');
    return this.sendTabAction(entry, {
      target: entry.target,
      method: 'browser.nameSession',
      args: [args[0].trim(), entry.id],
      signal,
      acquireLock: true,
    });
  }

  private async tabAction(
    entry: Entry,
    args: unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    if (
      args.length !== 5 ||
      !Array.isArray(args[4]) ||
      typeof args[3] !== 'string' ||
      !TAB_ACTION_METHODS.has(args[3])
    )
      throw codedError('INVALID_ARGUMENT', 'invalid tab action');
    const target = parseIdentity({
      browserId: args[0],
      tabId: args[1],
      generation: args[2],
    });
    if (args[3] === 'tab.observe.write') {
      const live = this.liveTab(target.browserId, target.tabId);
      if (!live || live.generation !== target.generation)
        throw codedError(
          'INVALID_TARGET',
          'browser tab is unavailable or stale',
        );
      return recordObservation(entry, args[4]);
    }
    return this.sendTabAction(entry, {
      target,
      method: args[3],
      args: args[4],
      signal,
      acquireLock: true,
    });
  }

  private sendTabAction(
    entry: Entry,
    request: TabActionRequest,
  ): Promise<unknown> {
    return performTabAction(
      {
        connections: this.connections,
        claims: this.claims,
        liveTab: (browserId, tabId) => this.liveTab(browserId, tabId),
      },
      { entry, ...request },
    );
  }

  /** Route tab management only through the precise authenticated browser connection. */
  private async manageTabs(
    entry: Entry,
    method: string,
    args: unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    const target = entry.target;
    if (!target)
      throw codedError('INVALID_TARGET', 'task has no browser target');
    if (actionAborted(signal)) throw codedError('CANCELLED', 'task cancelled');
    if (this.connections.generation(target.browserId) !== target.generation)
      throw codedError('INVALID_TARGET', 'stale browser connection');
    validateTabAction(method, args, {
      browserId: target.browserId,
      executionId: entry.id,
      claims: this.claims,
    });
    const outcome = await this.connections.sendAction({
      browserId: target.browserId,
      tabId: target.tabId,
      generation: target.generation,
      method,
      args,
    });
    if (actionAborted(signal))
      throw codedError('UNKNOWN_RESULT', 'action may have completed');
    if (!outcome.ok)
      throw codedError(
        unknownAfterDispatch(outcome.error.code)
          ? 'UNKNOWN_RESULT'
          : outcome.error.code,
        outcome.error.message,
      );
    return outcome.value;
  }

  private toBrowserTab(
    browserId: string,
    tab: { id: number; title: string; url: string; active: boolean },
    generation: number,
  ): BrowserTab {
    return {
      browserId,
      tabId: String(tab.id),
      generation,
      ...(tab.title ? { title: tab.title } : {}),
      ...(tab.url ? { url: tab.url } : {}),
      active: tab.active,
      claimed: this.claims.isClaimed(browserId, tab.id),
    };
  }

  private listTabs(): BrowserTab[] {
    const tabs: BrowserTab[] = [];
    for (const browser of this.connections.browsers()) {
      if (!browser.connected) continue;
      const generation = this.connections.generation(browser.id) ?? 0;
      for (const tab of browser.tabs)
        tabs.push(this.toBrowserTab(browser.id, tab, generation));
    }
    return tabs;
  }

  /**
   * One tab's metadata. Scoped to the task's target browser when the task
   * has one: a bare tabId cannot disambiguate across browsers.
   */
  private getTab(entry: Entry, tabId: string): BrowserTab {
    const id = normalizeTabId(tabId);
    if (id === undefined) throw codedError('INVALID_TARGET', 'unknown tab');
    const browsers = this.connections.browsers();
    const scope = entry.target
      ? browsers.filter((item) => item.id === entry.target?.browserId)
      : browsers;
    for (const browser of scope) {
      if (!browser.connected) continue;
      const tab = browser.tabs.find((item) => item.id === id);
      if (tab)
        return this.toBrowserTab(
          browser.id,
          tab,
          this.connections.generation(browser.id) ?? 0,
        );
    }
    throw codedError('INVALID_TARGET', 'unknown tab');
  }

  private async tabTitle(entry: Entry, signal: AbortSignal): Promise<string> {
    const target = entry.target;
    if (!target) throw codedError('INVALID_TARGET', 'task has no target tab');
    const claim = this.claims.get(target.browserId, target.tabId);
    if (!claim || claim.executionId !== entry.id)
      throw codedError(
        'TAB_NOT_CLAIMED',
        'target tab is not claimed by this task',
      );
    const generation = this.connections.generation(target.browserId);
    if (generation === undefined || generation !== target.generation)
      throw codedError('INVALID_TARGET', 'stale connection generation');
    let value: unknown;
    try {
      value = await this.connections.action(
        target.browserId,
        target.tabId,
        'tab.title',
        signal,
      );
    } catch (error) {
      throw this.titleError(entry, target, error);
    }
    if (typeof value !== 'string')
      throw codedError(
        'UNKNOWN_RESULT',
        'tab.title returned a non-string value',
      );
    return value;
  }

  /**
   * Map an extension-side tab.title failure. A vanished target escalates to
   * TAB_CLOSED (the task is cancelled); other codes map to design codes.
   */
  private titleError(
    entry: Entry,
    target: { browserId: string; tabId: number },
    error: unknown,
  ): Error {
    const code = error instanceof Error ? error.message : '';
    if (code === 'INVALID_TARGET' || code === 'TARGET_GONE') {
      if (!this.liveTab(target.browserId, target.tabId)) {
        entry.cancelReason = 'TAB_CLOSED';
        entry.runner?.cancel();
      }
      return codedError('INVALID_TARGET', 'target tab is gone');
    }
    const message = TITLE_FAILURES[code];
    if (message !== undefined) return codedError(code, message);
    return codedError('UNKNOWN_RESULT', 'tab.title failed');
  }
}
