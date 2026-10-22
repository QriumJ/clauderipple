// Whether this Mac is "away" — its screen locked, or no keyboard/mouse input for a while. It is
// the gate for pushes about Mac sessions the host is not tailing (Sessions' onAlert path): the
// person is at the desk while these are false, so a phone buzz would only be noise. Probe failures
// answer "here", never "away": a wrong push is worse than a missed one.
import { execFile } from "node:child_process";

/** No input for this long counts as away, matching the phone's own idle threshold (Paseo's PRESENCE_THRESHOLD_MS). */
export const IDLE_MS = 180_000;
const CACHE_MS = 10_000;
const TIMEOUT_MS = 2_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export type AwayRunner = (cmd: string, args: string[]) => Promise<string>;
const run: AwayRunner = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

/**
 * Whether the console session's dictionary carries `CGSSessionScreenIsLocked` true.
 * Measured on this Mac (Darwin 27, unlocked): the key is absent altogether, not `<false/>`, so only
 * a `<true/>` inside the console user's entry is a lock. Nothing parses as a lock means no lock.
 */
export function screenLocked(plist: string): boolean {
  const start = plist.indexOf("<key>IOConsoleUsers</key>");
  if (start < 0) return false;
  const end = plist.indexOf("</array>", start);
  const body = plist.slice(start, end < 0 ? plist.length : end);
  for (const entry of body.split("<dict>").slice(1)) {
    const close = entry.indexOf("</dict>");
    const session = close < 0 ? entry : entry.slice(0, close);
    if (!/<key>kCGSSessionOnConsoleKey<\/key>\s*<true\s*\/>/.test(session)) continue;
    return /<key>CGSSessionScreenIsLocked<\/key>\s*<true\s*\/>/.test(session);
  }
  return false;
}

/** `HIDIdleTime` from `ioreg -c IOHIDSystem`, in milliseconds, or null when the line is missing. */
export function hidIdleMs(ioreg: string): number | null {
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(ioreg);
  return match ? Number(match[1]) / 1_000_000 : null;
}

export interface AwayOptions {
  runner?: AwayRunner;
  platform?: NodeJS.Platform;
  now?: () => number;
  log?: (line: string) => void;
}

/** Both readings are `ioreg`; the answer is cached so a poll every few seconds probes once per CACHE_MS. */
export class MacAway {
  private runner: AwayRunner;
  private platform: NodeJS.Platform;
  private now: () => number;
  private log: ((line: string) => void) | undefined;
  private at = -Infinity;
  private value: boolean | null = null;
  private pending: Promise<boolean> | null = null;
  /** The last probe failed; cleared by a probe that answers. One log line per failing streak. */
  private failed = false;

  constructor(opts: AwayOptions = {}) {
    this.runner = opts.runner ?? run;
    this.platform = opts.platform ?? process.platform;
    this.now = opts.now ?? Date.now;
    this.log = opts.log;
  }

  async away(): Promise<boolean> {
    if (this.platform !== "darwin") return false;
    const now = this.now();
    if (this.value !== null && now - this.at < CACHE_MS) return this.value;
    // One probe at a time: a second caller rides the in-flight one instead of reading the old value.
    this.at = now;
    this.pending ??= this.probe().then(value => { this.value = value; return value; }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async probe(): Promise<boolean> {
    try {
      const [lock, hid] = await Promise.all([
        this.runner("/usr/sbin/ioreg", ["-n", "Root", "-d1", "-a"]),
        this.runner("/usr/sbin/ioreg", ["-c", "IOHIDSystem"]),
      ]);
      const idle = hidIdleMs(hid);
      this.failed = false;
      return screenLocked(lock) || (idle !== null && idle >= IDLE_MS);
    } catch (error) {
      if (!this.failed) { this.failed = true; this.log?.(`away: probe failed (${error instanceof Error ? error.message : String(error)}) — treated as here`); }
      return false;
    }
  }
}
