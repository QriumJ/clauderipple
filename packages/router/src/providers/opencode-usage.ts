// How much of an OpenCode Go subscription is used, for the status bar's limits row.
//
// One request per provider: GET {provider.url}/usage (measured 2026-10-15: https://opencode.ai/zen/go/v1/usage)
// with the provider's own config headers (the bearer key) and the same default User-Agent Node's
// fetch sends elsewhere — Cloudflare answers 403 `error 1010` to a request carrying no User-Agent
// and no browser fingerprint, but accepts Node's fetch as it is. Source of the route (behavioral
// only, no code copied): anomalyco/opencode packages/console/app/src/routes/zen/go/v1/usage.ts and
// lib/inference-proxy.ts (the `GET /zen/go/v1/usage` → `/go/v1/usage` mapping).
//
// Measured answer:
//   {"usage":{"rolling":{"status":"ok","percent":3,"resetsAt":"2026-10-15T05:39:48Z"},
//             "weekly":{"status":"ok","percent":52,"resetsAt":"2026-10-19T00:00:00Z"},
//             "monthly":{"status":"ok","percent":92,"resetsAt":"2026-10-18T05:43:30Z"}}}
// `rolling` is the five-hour window, `weekly` the week, `monthly` roughly 30 days.

import type { FetchLike } from "./google/antigravity.ts";

/** The five-hour, weekly and ~monthly window lengths in minutes. */
const FIVE_HOURS = 5 * 60;
const WEEK = 7 * 24 * 60;
const MONTH = 30 * 24 * 60;

/** One window the `/api/limits` endpoint reads. */
export type OpenCodeWindow = { kind: "five_hour" | "seven_day" | "window"; used_percent: number; window_minutes?: number; reset_at?: number };

/** The window lengths and read order of the endpoint's three keys. */
const KEYS: { key: string; kind: OpenCodeWindow["kind"]; window_minutes: number }[] = [
  { key: "rolling", kind: "five_hour", window_minutes: FIVE_HOURS },
  { key: "weekly", kind: "seven_day", window_minutes: WEEK },
  { key: "monthly", kind: "window", window_minutes: MONTH },
];

/**
 * Parse the `/usage` body into windows. A window missing a finite percent is dropped; null when the
 * body carries no `usage` object at all (so the caller keeps its last good answer instead of
 * blanking).
 */
export function opencodeWindowsFromBody(body: unknown): OpenCodeWindow[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const source = usage as Record<string, unknown>;
  const out: OpenCodeWindow[] = [];
  for (const { key, kind, window_minutes } of KEYS) {
    const w = source[key];
    if (!w || typeof w !== "object" || Array.isArray(w)) continue;
    const win = w as { percent?: unknown; resetsAt?: unknown };
    if (typeof win.percent !== "number" || !Number.isFinite(win.percent)) continue;
    const at = typeof win.resetsAt === "string" ? Date.parse(win.resetsAt) : NaN;
    out.push({ kind, used_percent: win.percent, window_minutes, ...(Number.isFinite(at) ? { reset_at: Math.round(at / 1000) } : {}) });
  }
  return out.length ? out : null;
}

/** Whether a provider is an OpenCode Go subscription: its preset, or an OpenCode Go endpoint. */
export function isOpenCodeGo(p: { type: string; url?: string; preset?: string }): boolean {
  if (p.type === "openai-compatible" && p.preset === "opencode-go") return true;
  if (typeof p.url !== "string") return false;
  try {
    const url = new URL(p.url);
    return url.hostname === "opencode.ai" && /^\/zen\/go\/v1(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

type UsageOptions = { fetch?: FetchLike; now?: () => number; ttlMs?: number; timeoutMs?: number; warn?: (message: string) => void };

/**
 * Per-provider usage windows, fetched at most once per `ttlMs` per provider. A failed lookup keeps
 * the last good windows rather than blanking them, and only the status code is logged.
 */
export class OpenCodeUsage {
  private readonly last = new Map<string, OpenCodeWindow[]>();
  private readonly at = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<OpenCodeWindow[]>>();
  private readonly opts: UsageOptions;

  constructor(opts: UsageOptions) {
    this.opts = opts;
  }

  /** The provider's windows, cached for `ttlMs`; the last good ones survive a failed lookup. */
  windows(name: string, url: string, headers: Record<string, string>): Promise<OpenCodeWindow[]> {
    const now = (this.opts.now ?? Date.now)();
    const ttl = this.opts.ttlMs ?? 5 * 60_000;
    if (now - (this.at.get(name) ?? Number.NEGATIVE_INFINITY) < ttl) return Promise.resolve(this.last.get(name) ?? []);
    const running = this.inFlight.get(name);
    if (running) return running;
    const task = this.fetchOne(name, url, headers).finally(() => {
      this.at.set(name, (this.opts.now ?? Date.now)());
      this.inFlight.delete(name);
    });
    this.inFlight.set(name, task);
    return task;
  }

  private async fetchOne(name: string, url: string, headers: Record<string, string>): Promise<OpenCodeWindow[]> {
    const keep = () => this.last.get(name) ?? [];
    try {
      const res = await (this.opts.fetch ?? fetch)(`${url.replace(/\/+$/, "")}/usage`, {
        method: "GET",
        headers: { accept: "application/json", ...headers },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (!res.ok) {
        // The status alone: the body of an auth failure is not worth the risk of echoing.
        this.opts.warn?.(`opencode usage ${name}: HTTP ${res.status}`);
        return keep();
      }
      const windows = opencodeWindowsFromBody(await res.json());
      if (!windows) return keep();
      this.last.set(name, windows);
      return windows;
    } catch (e) {
      this.opts.warn?.(`opencode usage ${name}: ${(e as Error).message}`);
      return keep();
    }
  }
}
