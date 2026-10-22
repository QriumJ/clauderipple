// Hold new model calls for a moment, without refusing them.
//
// The way back from the iPhone hotspot to Wi-Fi (tether.ts) drops the link for a few seconds, so it
// waits for a quiet moment. With Claude and subagents working back-to-back there is none, and on
// 2026-10-20 the return was postponed from 19:22:54 until the hotspot itself went away. So after a
// grace period the tether controller makes the gap instead: it engages this gate, waits for the
// calls already running to finish, switches, and releases the gate.
//
// While the gate is engaged, a NEW model call (the proxy's /v1/messages, the OpenAI ingress's
// Responses/Chat calls) waits before its body is read: nothing is written to it, it is not refused
// and not answered 503 — zero vanished requests is an acceptance metric. It goes ahead when the gate
// is released or after HOLD_MAX_MS, whichever comes first. Non-model traffic is never held.
//
// Release is guaranteed three ways: the owner releases in a `finally`, a failsafe timer set at
// engage() releases on its own, and close() (the router's drain) releases and refuses to engage again.

/**
 * The longest any one call waits at the gate; then it proceeds as if there were none. Longer than the
 * tether's drain wait plus its switch (tether.ts RETURN_DRAIN_WAIT_MS), shorter than the ~180s after
 * which Claude Code gave up on a call with no answer yet (2026-10-20).
 */
export const HOLD_MAX_MS = 120_000;

export type HoldResult = { ms: number; timedOut: boolean };

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };

const realTimers: Timers = {
  set: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clear: (t) => clearTimeout(t as NodeJS.Timeout),
};

export class HoldGate {
  private reasonText: string | null = null;
  private failsafe: unknown = null;
  private isClosed = false;
  private readonly waiters = new Set<() => void>();
  private readonly maxHoldMs: number;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(opts: { maxHoldMs?: number; timers?: Timers; now?: () => number } = {}) {
    this.maxHoldMs = opts.maxHoldMs ?? HOLD_MAX_MS;
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now ?? Date.now;
  }

  get engaged(): boolean {
    return this.reasonText !== null;
  }

  get reason(): string | null {
    return this.reasonText;
  }

  /** Calls waiting at the gate right now. */
  get waiting(): number {
    return this.waiters.size;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /**
   * Start holding new calls. `failsafeMs` releases the gate by itself if its owner never does.
   * False after close(): a draining router holds nothing.
   */
  engage(reason: string, failsafeMs: number): boolean {
    if (this.isClosed) return false;
    this.reasonText = reason;
    if (this.failsafe !== null) this.timers.clear(this.failsafe);
    this.failsafe = this.timers.set(() => {
      this.failsafe = null;
      this.release();
    }, failsafeMs);
    return true;
  }

  /** Let every held call go ahead. Idempotent. Returns how many were waiting. */
  release(): number {
    if (this.failsafe !== null) this.timers.clear(this.failsafe);
    this.failsafe = null;
    this.reasonText = null;
    const all = [...this.waiters];
    for (const wake of all) wake();
    return all.length;
  }

  /** Release, and never engage again (the router is draining or exiting). */
  close(): number {
    this.isClosed = true;
    return this.release();
  }

  /** Resolves at once when the gate is open; else when it is released or after HOLD_MAX_MS. */
  wait(): Promise<HoldResult> {
    if (this.reasonText === null) return Promise.resolve({ ms: 0, timedOut: false });
    const t0 = this.now();
    return new Promise((resolve) => {
      let timer: unknown = null;
      const done = (timedOut: boolean): void => {
        if (!this.waiters.delete(wake)) return;
        if (timer !== null) this.timers.clear(timer);
        resolve({ ms: this.now() - t0, timedOut });
      };
      const wake = (): void => done(false);
      this.waiters.add(wake);
      timer = this.timers.set(() => done(true), this.maxHoldMs);
    });
  }
}
