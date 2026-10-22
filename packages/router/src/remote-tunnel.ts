// Reverse SSH tunnels to remote hosts that run Claude Code for Claude Desktop (issue #67).
//
// Each configured host gets one long-lived `ssh -N -R 127.0.0.1:<remote port>:127.0.0.1:<proxy
// port> <host>`, owned by the router because the router is what launchd / the Windows supervisor /
// systemd already keeps alive. A tunnel that exits is started again with capped backoff; each time
// one comes up the CA and agent files on that host are brought up to date (remote-host.ts), and
// again when the router regenerates the agent files.
//
// Children are killed when the router exits, and their pids are recorded: a router that died
// without killing them (SIGKILL) would otherwise leave an orphan holding the remote port, and every
// new tunnel would then fail `ExitOnForwardFailure` for as long as the orphan lives.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BATCH_OPTIONS, SSH_MISSING, extraSshOptions, sshExecutable } from "./remote-host.ts";

export type RemoteHostConfig = { host: string; port: number };
export type TunnelState = "starting" | "up" | "backoff" | "down";

export type TunnelStatus = {
  host: string;
  port: number;
  state: TunnelState;
  /** ISO time the tunnel entered `state`. */
  since: string;
  lastError: string | null;
  pid: number | null;
  /** Times the tunnel was started again after it had exited. */
  restarts: number;
  /** ISO time the CA and agent files were last copied to the host, or null. */
  synced: string | null;
};

/** The subset of a ChildProcess the manager uses, so tests can hand it a fake. */
export type TunnelChild = {
  readonly pid?: number | undefined;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
};

export type TunnelDeps = {
  log: { info(msg: string): void; warn(msg: string): void };
  /** Where the tunnel's local end connects: the router's proxy listener. */
  proxyTarget: () => { host: string; port: number };
  /** `<home>/remote-tunnels.json`: the pids of the ssh children this router started. */
  pidFile: string;
  /** Copy the CA and agent files to `host`. Absent: nothing is copied. */
  sync?: (host: string) => Promise<unknown>;
  /** Changes when what `sync` would copy changes. */
  fingerprint?: () => string;
  spawn?: (command: string, args: string[]) => TunnelChild;
  /** The command line of a running process, or null when none runs with that pid. */
  processCommand?: (pid: number) => string | null;
  kill?: (pid: number) => void;
  now?: () => number;
  /** Backoff after an exit: base doubling to max; a tunnel up for `stableMs` starts again at base. */
  backoff?: { baseMs: number; maxMs: number; stableMs: number };
  /** No success line from ssh after this long, yet still running: take it as up. */
  settleMs?: number;
};

/**
 * The tunnel's argv. `-v` is there for one line: `remote forward success for: listen …` is how
 * ssh says the remote port is actually bound (measured, OpenSSH 10.3). Every other debug line is
 * dropped before the log; `ExitOnForwardFailure` makes a forward that cannot bind an exit.
 */
export function tunnelArgs(host: string, port: number, target: { host: string; port: number }): string[] {
  return [
    "-N",
    "-v",
    ...BATCH_OPTIONS,
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-R", `127.0.0.1:${port}:${target.host}:${target.port}`,
    ...extraSshOptions(),
    host,
  ];
}

type Entry = {
  host: string;
  port: number;
  target: { host: string; port: number };
  child: TunnelChild | null;
  state: TunnelState;
  since: number;
  upAt: number | null;
  lastError: string | null;
  attempt: number;
  restarts: number;
  timer: NodeJS.Timeout | null;
  settle: NodeJS.Timeout | null;
  stopped: boolean;
  synced: number | null;
  syncedPrint: string | null;
  syncing: boolean;
};

type PidRecord = { pid: number; host: string; port: number };

/** The connection target a router listening on `host` is reached at: a wildcard bind means loopback. */
export function proxyConnectHost(listenHost: string): string {
  return listenHost === "0.0.0.0" || listenHost === "::" || listenHost === "" ? "127.0.0.1" : listenHost;
}

function defaultProcessCommand(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
      return out.trim() || null;
    }
    const out = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
    return out.trim() || null;
  } catch {
    return null; // ps exits 1 when no such process
  }
}

export class RemoteTunnels {
  private readonly entries = new Map<string, Entry>();
  private readonly deps: TunnelDeps;
  private readonly backoff: { baseMs: number; maxMs: number; stableMs: number };
  private closed = false;

  constructor(deps: TunnelDeps) {
    this.deps = deps;
    this.backoff = deps.backoff ?? { baseMs: 1_000, maxMs: 60_000, stableMs: 60_000 };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Kill ssh children a previous router left running. Only a pid whose command line is still our
   * tunnel for that host and port is killed: a pid the OS has since given to something else is not.
   */
  cleanupStale(): number {
    let records: PidRecord[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.deps.pidFile, "utf8")) as { tunnels?: unknown };
      if (Array.isArray(parsed.tunnels)) records = parsed.tunnels.filter((r): r is PidRecord => !!r && typeof (r as PidRecord).pid === "number" && typeof (r as PidRecord).host === "string" && typeof (r as PidRecord).port === "number");
    } catch {
      return 0;
    }
    const lookup = this.deps.processCommand ?? defaultProcessCommand;
    const kill = this.deps.kill ?? ((pid: number) => process.kill(pid, "SIGTERM"));
    let killed = 0;
    for (const r of records) {
      if (r.pid === process.pid) continue;
      const cmd = lookup(r.pid);
      if (!cmd || !/\bssh(\.exe)?\b/i.test(cmd) || !cmd.includes(`127.0.0.1:${r.port}:`) || !cmd.includes(r.host)) continue;
      try {
        kill(r.pid);
        killed++;
        this.deps.log.info(`remote ${r.host}: killed tunnel pid ${r.pid} left by a previous router`);
      } catch (e) {
        this.deps.log.warn(`remote ${r.host}: cannot kill stale tunnel pid ${r.pid}: ${(e as Error).message}`);
      }
    }
    this.writePids();
    return killed;
  }

  /** Start tunnels for new hosts, stop removed ones, restart one whose port or target changed. */
  reconcile(hosts: RemoteHostConfig[]): void {
    if (this.closed) return;
    const target = this.deps.proxyTarget();
    const wanted = new Map(hosts.map((h) => [h.host, h]));
    for (const [host, entry] of this.entries) {
      const want = wanted.get(host);
      if (!want || want.port !== entry.port || entry.target.host !== target.host || entry.target.port !== target.port) {
        this.stop(entry);
        this.entries.delete(host);
        this.deps.log.info(`remote ${host}: tunnel stopped${want ? " (port changed)" : " (host removed)"}`);
      }
    }
    for (const h of hosts) {
      if (this.entries.has(h.host)) continue;
      const entry: Entry = {
        host: h.host, port: h.port, target, child: null, state: "starting", since: this.now(), upAt: null, lastError: null,
        attempt: 0, restarts: 0, timer: null, settle: null, stopped: false, synced: null, syncedPrint: null, syncing: false,
      };
      this.entries.set(h.host, entry);
      this.start(entry);
    }
    this.writePids();
  }

  status(): TunnelStatus[] {
    return [...this.entries.values()].map((e) => ({
      host: e.host,
      port: e.port,
      state: e.state,
      since: new Date(e.since).toISOString(),
      lastError: e.lastError,
      pid: e.child?.pid ?? null,
      restarts: e.restarts,
      synced: e.synced === null ? null : new Date(e.synced).toISOString(),
    }));
  }

  /** The agent files or the CA changed here: copy them to every host whose tunnel is up. */
  assetsChanged(): void {
    if (!this.deps.fingerprint) return;
    const print = this.deps.fingerprint();
    for (const e of this.entries.values()) if (e.state === "up" && e.syncedPrint !== print) void this.sync(e);
  }

  /** Kill every tunnel. Synchronous, so it can run from an `exit` handler. */
  stopAll(): void {
    this.closed = true;
    for (const e of this.entries.values()) this.stop(e);
    this.entries.clear();
    this.writePids();
  }

  private setState(e: Entry, state: TunnelState): void {
    if (e.state !== state) e.since = this.now();
    e.state = state;
  }

  private start(e: Entry): void {
    if (e.stopped || this.closed) return;
    e.timer = null;
    this.setState(e, "starting");
    let child: TunnelChild;
    try {
      child = (this.deps.spawn ?? ((cmd, args) => spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true })))(sshExecutable(), tunnelArgs(e.host, e.port, e.target));
    } catch (err) {
      this.gone(e, null, (err as Error).message);
      return;
    }
    e.child = child;
    this.writePids();
    this.deps.log.info(`remote ${e.host}: starting tunnel 127.0.0.1:${e.port} on the host → ${e.target.host}:${e.target.port}${child.pid ? ` (pid ${child.pid})` : ""}`);
    let buffered = "";
    let said: string | null = null; // this child's own last word, not an earlier one's
    child.stderr?.on("data", (d: Buffer | string) => {
      buffered += d.toString();
      let i: number;
      while ((i = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, i).replace(/\r$/, "");
        buffered = buffered.slice(i + 1);
        if (e.child === child) said = this.stderrLine(e, line) ?? said;
      }
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (e.child !== child) return;
      this.gone(e, child, err.code === "ENOENT" ? SSH_MISSING : err.message, err.code === "ENOENT");
    });
    // `close`, not `exit`: it comes after stderr has been read to the end, so the reason ssh gave
    // for leaving is in `said` by then.
    child.on("close", (code, signal) => {
      if (e.child !== child) return;
      this.gone(e, child, said ?? `ssh exited (${signal ?? `code ${code}`})`);
    });
    const settleMs = this.deps.settleMs ?? 15_000;
    e.settle = setTimeout(() => {
      if (e.child === child && e.state === "starting") this.up(e);
    }, settleMs);
    e.settle.unref?.();
  }

  /** Returns the line when it is something ssh said to a person (an error, a warning). */
  private stderrLine(e: Entry, line: string): string | null {
    if (!line.trim()) return null;
    if (/^debug\d?: remote forward success for: listen/.test(line)) {
      this.up(e);
      return null;
    }
    if (/^debug\d?:/.test(line)) return null; // `-v` noise
    // `-v` also lets through ssh's verbose-level notices, which carry no prefix (measured: the
    // "Authenticated to … using "publickey"" line on every connect). They are not errors.
    if (/^(Authenticated to |Transferred: |Bytes per second|Warning: Permanently added )/.test(line)) {
      this.deps.log.info(`remote ${e.host}: ${line.trim()}`);
      return null;
    }
    e.lastError = line.trim();
    this.deps.log.warn(`remote ${e.host}: ${line.trim()}`);
    return line.trim();
  }

  private up(e: Entry): void {
    if (e.state === "up") return;
    if (e.settle) clearTimeout(e.settle);
    e.settle = null;
    this.setState(e, "up");
    e.upAt = this.now();
    e.lastError = null;
    this.deps.log.info(`remote ${e.host}: tunnel up (127.0.0.1:${e.port} on the host)`);
    // Each (re)start copies again: the host may have lost or changed the files while we were away.
    e.syncedPrint = null;
    void this.sync(e);
  }

  private async sync(e: Entry): Promise<void> {
    if (!this.deps.sync || e.syncing) return;
    e.syncing = true;
    const print = this.deps.fingerprint?.() ?? null;
    try {
      await this.deps.sync(e.host);
      e.synced = this.now();
      e.syncedPrint = print;
      this.deps.log.info(`remote ${e.host}: CA and agent files synced`);
    } catch (err) {
      this.deps.log.warn(`remote ${e.host}: sync failed: ${(err as Error).message}`);
    } finally {
      e.syncing = false;
    }
    // Something changed while this one ran: catch up once.
    if (this.deps.fingerprint && e.state === "up" && e.syncedPrint !== null && this.deps.fingerprint() !== e.syncedPrint) void this.sync(e);
  }

  private gone(e: Entry, child: TunnelChild | null, reason: string, sshMissing = false): void {
    if (child && e.child !== child) return;
    e.child = null;
    if (e.settle) clearTimeout(e.settle);
    e.settle = null;
    this.writePids();
    if (e.stopped || this.closed) {
      this.setState(e, "down");
      return;
    }
    if (e.upAt !== null && this.now() - e.upAt >= this.backoff.stableMs) e.attempt = 0;
    e.upAt = null;
    e.lastError = reason;
    const delay = sshMissing ? this.backoff.maxMs : Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** e.attempt);
    e.attempt++;
    this.setState(e, sshMissing ? "down" : "backoff");
    this.deps.log.warn(`remote ${e.host}: tunnel ${sshMissing ? "cannot start" : "down"}: ${reason}; retrying in ${Math.round(delay / 1000)}s`);
    e.timer = setTimeout(() => {
      e.restarts++;
      this.start(e);
    }, delay);
    e.timer.unref?.();
  }

  private stop(e: Entry): void {
    e.stopped = true;
    if (e.timer) clearTimeout(e.timer);
    if (e.settle) clearTimeout(e.settle);
    e.timer = e.settle = null;
    const child = e.child;
    e.child = null;
    this.setState(e, "down");
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }

  private writePids(): void {
    const tunnels: PidRecord[] = [];
    for (const e of this.entries.values()) if (e.child?.pid) tunnels.push({ pid: e.child.pid, host: e.host, port: e.port });
    if (tunnels.length === 0 && !fs.existsSync(this.deps.pidFile)) return; // a router with no remote hosts leaves no file
    try {
      fs.mkdirSync(path.dirname(this.deps.pidFile), { recursive: true });
      fs.writeFileSync(this.deps.pidFile, JSON.stringify({ tunnels }, null, 2) + "\n");
    } catch (err) {
      this.deps.log.warn(`remote: cannot record tunnel pids in ${this.deps.pidFile}: ${(err as Error).message}`);
    }
  }
}
