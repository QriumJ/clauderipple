import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { DEFAULTS, validate, type Config } from "../src/config.ts";
import { Logger } from "../src/log.ts";
import { RequestLog } from "../src/requestlog.ts";
import { startAdmin } from "../src/admin.ts";
import { SSH_MISSING, hostProblem } from "../src/remote-host.ts";
import { RemoteTunnels, tunnelArgs, type TunnelChild, type TunnelStatus } from "../src/remote-tunnel.ts";

class FakeChild extends EventEmitter {
  readonly stderr = new PassThrough();
  killed: string[] = [];
  readonly pid: number;
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? "SIGTERM");
    return true;
  }
  say(line: string): void {
    this.stderr.write(line + "\n");
  }
  /** ssh leaving: `close` comes after its stderr has ended. */
  exit(code: number): void {
    this.stderr.end();
    setImmediate(() => this.emit("close", code, null));
  }
}

const tick = () => new Promise((r) => setImmediate(r));

function harness(extra: Partial<ConstructorParameters<typeof RemoteTunnels>[0]> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-tunnel-"));
  const children: FakeChild[] = [];
  const spawned: { command: string; args: string[] }[] = [];
  const logs: string[] = [];
  const synced: string[] = [];
  let nextPid = 1000;
  const tunnels = new RemoteTunnels({
    log: { info: (m) => logs.push(`info ${m}`), warn: (m) => logs.push(`warn ${m}`) },
    proxyTarget: () => ({ host: "127.0.0.1", port: 8791 }),
    pidFile: path.join(dir, "remote-tunnels.json"),
    spawn: (command, args) => {
      spawned.push({ command, args });
      const c = new FakeChild(nextPid++);
      children.push(c);
      return c as unknown as TunnelChild;
    },
    sync: async (host) => {
      synced.push(host);
    },
    backoff: { baseMs: 100, maxMs: 400, stableMs: 10_000 },
    settleMs: 60_000,
    ...extra,
  });
  return { dir, tunnels, children, spawned, logs, synced, pidFile: path.join(dir, "remote-tunnels.json") };
}

const one = (s: TunnelStatus[]): TunnelStatus => s[0]!;

test("tunnel argv: the host is its own argument, after the forward and the batch options", () => {
  const prev = process.env.CLAUDERIPPLE_SSH_OPTIONS;
  delete process.env.CLAUDERIPPLE_SSH_OPTIONS;
  try {
    assert.deepEqual(tunnelArgs("me@box", 18791, { host: "127.0.0.1", port: 8791 }), [
      "-N", "-v",
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
      "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
      "-R", "127.0.0.1:18791:127.0.0.1:8791",
      "me@box",
    ]);
    process.env.CLAUDERIPPLE_SSH_OPTIONS = JSON.stringify(["-p", "2222"]);
    assert.deepEqual(tunnelArgs("box", 1, { host: "127.0.0.1", port: 2 }).slice(-3), ["-p", "2222", "box"]);
  } finally {
    if (prev === undefined) delete process.env.CLAUDERIPPLE_SSH_OPTIONS;
    else process.env.CLAUDERIPPLE_SSH_OPTIONS = prev;
  }
});

test("a tunnel is up when ssh reports the remote forward, and syncs then; debug noise stays out of the log", async () => {
  const h = harness();
  h.tunnels.reconcile([{ host: "box", port: 18791 }]);
  assert.equal(h.spawned.length, 1);
  assert.equal(one(h.tunnels.status()).state, "starting");
  assert.deepEqual(JSON.parse(fs.readFileSync(h.pidFile, "utf8")), { tunnels: [{ pid: 1000, host: "box", port: 18791 }] });
  h.children[0]!.say("debug1: Connecting to box port 22.");
  h.children[0]!.say("debug1: remote forward success for: listen 127.0.0.1:18791, connect 127.0.0.1:8791");
  await tick();
  const s = one(h.tunnels.status());
  assert.equal(s.state, "up");
  assert.equal(s.pid, 1000);
  assert.deepEqual(h.synced, ["box"]);
  assert.ok(!h.logs.some((l) => l.includes("Connecting to")), "debug lines are not logged");
  assert.ok(h.logs.some((l) => l.includes("tunnel up")));
  h.tunnels.stopAll();
});

test("an exit restarts with doubling backoff capped at max, reports why, and re-syncs on each comeback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.tunnels.reconcile([{ host: "box", port: 18791 }]);
  h.children[0]!.say("Error: remote port forwarding failed for listen port 18791");
  h.children[0]!.exit(255);
  await tick(); await tick();
  let s = one(h.tunnels.status());
  assert.equal(s.state, "backoff");
  assert.equal(s.lastError, "Error: remote port forwarding failed for listen port 18791");
  assert.equal(s.pid, null);

  const waits: number[] = [];
  for (let round = 0; round < 4; round++) {
    const before = h.spawned.length;
    let waited = 0;
    while (h.spawned.length === before && waited < 1000) {
      t.mock.timers.tick(50);
      waited += 50;
    }
    waits.push(waited);
    const child = h.children.at(-1)!;
    child.exit(255);
    await tick(); await tick();
  }
  assert.deepEqual(waits, [100, 200, 400, 400]);
  s = one(h.tunnels.status());
  assert.equal(s.restarts, 4);
  assert.equal(s.lastError, "ssh exited (code 255)", "a silent exit does not repeat an earlier child's error");

  // Comes back up: synced again.
  t.mock.timers.tick(400);
  h.children.at(-1)!.say("debug1: remote forward success for: listen 127.0.0.1:18791, connect 127.0.0.1:8791");
  await tick();
  assert.equal(one(h.tunnels.status()).state, "up");
  assert.deepEqual(h.synced, ["box"]);
  // Drops and comes back: copied again, though nothing changed here (the host may have).
  h.children.at(-1)!.exit(255);
  await tick(); await tick();
  t.mock.timers.tick(400);
  h.children.at(-1)!.say("debug1: remote forward success for: listen 127.0.0.1:18791, connect 127.0.0.1:8791");
  await tick();
  assert.deepEqual(h.synced, ["box", "box"]);
  h.tunnels.stopAll();
});

test("a tunnel that stayed up past stableMs starts its backoff over", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  const h = harness({ now: () => now });
  h.tunnels.reconcile([{ host: "box", port: 18791 }]);
  for (const _ of [1, 2]) {
    h.children.at(-1)!.exit(255);
    await tick(); await tick();
    t.mock.timers.tick(400);
  }
  assert.equal(h.spawned.length, 3);
  h.children.at(-1)!.say("debug1: remote forward success for: listen 127.0.0.1:18791, connect 127.0.0.1:8791");
  await tick();
  now += 20_000;
  h.children.at(-1)!.exit(255);
  await tick(); await tick();
  t.mock.timers.tick(99);
  assert.equal(h.spawned.length, 3);
  t.mock.timers.tick(1);
  assert.equal(h.spawned.length, 4, "back to the base delay");
  h.tunnels.stopAll();
});

test("ssh missing: the state says so", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  h.tunnels.reconcile([{ host: "box", port: 18791 }]);
  const err = Object.assign(new Error("spawn ssh ENOENT"), { code: "ENOENT" });
  h.children[0]!.emit("error", err);
  h.children[0]!.emit("close", -2, null);
  const s = one(h.tunnels.status());
  assert.equal(s.state, "down");
  assert.equal(s.lastError, SSH_MISSING);
  h.tunnels.stopAll();
});

test("reconcile stops removed hosts, restarts a changed port, and stopAll kills everything", async () => {
  const h = harness();
  h.tunnels.reconcile([{ host: "a", port: 1 }, { host: "b", port: 2 }]);
  assert.equal(h.spawned.length, 2);
  h.tunnels.reconcile([{ host: "a", port: 1 }, { host: "b", port: 2 }]);
  assert.equal(h.spawned.length, 2, "idempotent");
  h.tunnels.reconcile([{ host: "a", port: 3 }]);
  assert.deepEqual(h.children[0]!.killed, ["SIGTERM"]);
  assert.deepEqual(h.children[1]!.killed, ["SIGTERM"]);
  assert.equal(h.spawned.length, 3);
  assert.ok(h.spawned[2]!.args.includes("127.0.0.1:3:127.0.0.1:8791"));
  // A killed child's late close does not restart it.
  h.children[0]!.exit(143);
  await tick(); await tick();
  assert.equal(h.spawned.length, 3);
  h.tunnels.stopAll();
  assert.deepEqual(h.children[2]!.killed, ["SIGTERM"]);
  assert.deepEqual(h.tunnels.status(), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.pidFile, "utf8")), { tunnels: [] });
});

test("stale tunnels a previous router left are killed — only ours, by command line", () => {
  const h = harness();
  fs.writeFileSync(h.pidFile, JSON.stringify({ tunnels: [
    { pid: 11, host: "box", port: 18791 },
    { pid: 12, host: "box", port: 18791 },
    { pid: 13, host: "other", port: 18792 },
  ] }));
  const killed: number[] = [];
  const t2 = new RemoteTunnels({
    log: { info: () => {}, warn: () => {} },
    proxyTarget: () => ({ host: "127.0.0.1", port: 8791 }),
    pidFile: h.pidFile,
    processCommand: (pid) => ({
      11: "ssh -N -v -o BatchMode=yes -R 127.0.0.1:18791:127.0.0.1:8791 box",
      12: "/usr/bin/python3 server.py", // the pid was reused by something else
    } as Record<number, string>)[pid] ?? null, // 13 is gone
    kill: (pid) => killed.push(pid),
  });
  assert.equal(t2.cleanupStale(), 1);
  assert.deepEqual(killed, [11]);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.pidFile, "utf8")), { tunnels: [] });
});

test("agent files regenerated: hosts whose tunnel is up are synced once per change", async () => {
  let print = "v1";
  const h = harness({ fingerprint: () => print });
  h.tunnels.reconcile([{ host: "box", port: 18791 }]);
  h.tunnels.assetsChanged(); // not up yet: nothing
  assert.deepEqual(h.synced, []);
  h.children[0]!.say("debug1: remote forward success for: listen 127.0.0.1:18791, connect 127.0.0.1:8791");
  await tick();
  assert.deepEqual(h.synced, ["box"]);
  h.tunnels.assetsChanged();
  await tick();
  assert.deepEqual(h.synced, ["box"], "unchanged: no sync");
  print = "v2";
  h.tunnels.assetsChanged();
  await tick();
  assert.deepEqual(h.synced, ["box", "box"]);
  h.tunnels.stopAll();
});

test("config: remote.hosts is validated like the CLI validates a host", () => {
  const cfg = (hosts: unknown): Config => ({ ...DEFAULTS, remote: { hosts } as Config["remote"] & object });
  assert.deepEqual(validate(cfg([{ host: "me@box.example", port: 18791 }])), []);
  assert.match(validate(cfg([{ host: "-oProxyCommand=touch /tmp/x", port: 1 }])).join(), /starts with "-"/);
  assert.match(validate(cfg([{ host: "a b", port: 1 }])).join(), /not an ssh alias/);
  assert.match(validate(cfg([{ host: "a", port: 1 }, { host: "a", port: 2 }])).join(), /listed twice/);
  assert.match(validate(cfg([{ host: "a", port: 70000 }])).join(), /port/);
  assert.match(validate(cfg("nope")).join(), /must be a list/);
});

test("host validation rejects options, whitespace and shell metacharacters", () => {
  for (const bad of ["-oProxyCommand=sh", "-p", "a b", "a;b", "a|b", "$(id)", "`id`", "a&b", "a>b", "a'b", "a\"b", "a\nb", "", "a/b", "a\\b"]) {
    assert.ok(hostProblem(bad), `rejects ${JSON.stringify(bad)}`);
  }
  for (const good of ["box", "me@box", "me@box.example.com", "dev-1", "10.0.0.2", "u_ser@10.0.0.2", "::1"]) {
    assert.equal(hostProblem(good), null, `accepts ${good}`);
  }
});

test("admin: GET /api/remote and POST /api/remote/reload", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cr-remote-admin-"));
  const prevHome = process.env.CLAUDERIPPLE_HOME;
  const prevSettings = process.env.CLAUDE_SETTINGS_PATH;
  process.env.CLAUDERIPPLE_HOME = home;
  process.env.CLAUDE_SETTINGS_PATH = path.join(home, "claude-settings.json");
  const status: TunnelStatus = { host: "box", port: 18791, state: "up", since: "2026-10-20T00:00:00.000Z", lastError: null, pid: 42, restarts: 0, synced: null };
  let reloads = 0;
  const base = {
    config: () => ({ ...DEFAULTS, admin: { port: 0 } }),
    configFile: path.join(home, "config.json"),
    log: new Logger(null, 1_000_000, 1, false),
    stats: () => ({ inFlight: 0, messagesInFlight: 0, started: 0, completed: 0, failed: 0 }),
    health: () => 0,
    version: "0.0.0-test",
    requests: new RequestLog(path.join(home, "logs", "requests.jsonl")),
  };
  const withRemote = await startAdmin({ ...base, remote: { status: () => [status], reload: () => { reloads++; return [status]; } } });
  const without = await startAdmin(base);
  try {
    const url = `http://127.0.0.1:${withRemote.port}`;
    assert.deepEqual(await (await fetch(`${url}/api/remote`)).json(), { hosts: [status] });
    const r = await fetch(`${url}/api/remote/reload`, { method: "POST" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { hosts: [status] });
    assert.equal(reloads, 1);
    const cross = await fetch(`${url}/api/remote/reload`, { method: "POST", headers: { origin: "https://evil.example" } });
    assert.equal(cross.status, 403);
    assert.equal(reloads, 1);
    assert.equal((await fetch(`http://127.0.0.1:${without.port}/api/remote`)).status, 501);
  } finally {
    withRemote.close();
    without.close();
    if (prevHome === undefined) delete process.env.CLAUDERIPPLE_HOME;
    else process.env.CLAUDERIPPLE_HOME = prevHome;
    if (prevSettings === undefined) delete process.env.CLAUDE_SETTINGS_PATH;
    else process.env.CLAUDE_SETTINGS_PATH = prevSettings;
  }
});
