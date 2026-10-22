// The self-exit for a stuck process (§5 "Router stuck with DNS resolution failure for 10h") must not
// fire when the machine itself is offline: on 2026-10-20 a MacBook that lost Wi-Fi restarted the
// router 27 times in 18 minutes, and each restart threw away the hotspot failover's probe history.
// A child process (curl) is asked first. Every command here goes to a fake runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunOptions, RunResult } from "../src/awake.ts";
import { checkConnectivity, curlPath, UpstreamHealth, type Connectivity } from "../src/health.ts";

const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND api.anthropic.com"), { code: "ENOTFOUND" });
const tick = () => new Promise((r) => setImmediate(r));

type Answer = RunResult | ((url: string) => RunResult);
function fakeCurl(apple: Answer, google: Answer) {
  const calls: { file: string; args: string[]; opts?: RunOptions }[] = [];
  const run = async (file: string, args: string[], opts?: RunOptions): Promise<RunResult> => {
    calls.push({ file, args, ...(opts ? { opts } : {}) });
    const url = args[args.length - 1]!;
    const a = url.includes("apple") ? apple : google;
    return typeof a === "function" ? a(url) : a;
  };
  return { run, calls };
}
const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const exit = (code: number, stderr = ""): RunResult => ({ code, stdout: "", stderr });

test("connectivity: either endpoint's exact answer is online; curl runs bounded, without a proxy or a curlrc", async () => {
  const f = fakeCurl(ok("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>\n200"), exit(6));
  const c = await checkConnectivity(f.run, "darwin");
  assert.equal(c.result, "online");
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.file, "/usr/bin/curl");
    assert.deepEqual(call.args.slice(0, 7), ["-q", "-s", "--noproxy", "*", "-m", "5", "-w"]);
    assert.ok((call.opts?.timeoutMs ?? 0) > 5_000, "the runner outlives curl's own -m");
  }
  assert.deepEqual(f.calls.map((c) => c.args.at(-1)).sort(), ["http://captive.apple.com/hotspot-detect.html", "http://connectivitycheck.gstatic.com/generate_204"]);
  assert.equal((await checkConnectivity(fakeCurl(exit(28), ok("\n204")).run, "darwin")).result, "online");
});

test("connectivity: both unreachable, or only a captive portal's answers, is offline", async () => {
  // 6 = could not resolve host, 7 = could not connect, 28 = timed out (man curl).
  for (const [a, g] of [[exit(6), exit(6)], [exit(7), exit(28)], [ok("<html>Log in</html>\n200"), ok("\n302")]] as const) {
    const c = await checkConnectivity(fakeCurl(a, g).run, "darwin");
    assert.equal(c.result, "offline", c.detail);
  }
});

test("connectivity: curl missing or failing for its own reasons is unknown", async () => {
  // execRunner reports a spawn failure (ENOENT) or its own timeout as code -1.
  assert.equal((await checkConnectivity(fakeCurl(exit(-1, "spawn /usr/bin/curl ENOENT"), exit(-1, "spawn /usr/bin/curl ENOENT")).run, "darwin")).result, "unknown");
  assert.equal((await checkConnectivity(fakeCurl(exit(6), exit(2, "failed to init")).run, "darwin")).result, "unknown");
});

test("connectivity: Windows uses the curl.exe the OS ships", () => {
  assert.equal(curlPath("win32", { SystemRoot: "D:\\WINDOWS" }), "D:\\WINDOWS\\System32\\curl.exe");
  assert.equal(curlPath("win32", {}), "C:\\Windows\\System32\\curl.exe");
  assert.equal(curlPath("darwin"), "/usr/bin/curl");
});

function healthRig(verdicts: Connectivity["result"][]) {
  const trips: { n: number; c?: Connectivity }[] = [];
  const offline: number[] = [];
  let checks = 0;
  const h = new UpstreamHealth(() => 3, (n, c) => trips.push({ n, ...(c ? { c } : {}) }), {
    connectivity: async () => {
      const result = verdicts[Math.min(checks++, verdicts.length - 1)]!;
      return { result, detail: result };
    },
    onOffline: (n) => offline.push(n),
  });
  return { h, trips, offline, checks: () => checks };
}

test("the machine reaches the internet but this process cannot: exit as before", async () => {
  const r = healthRig(["online"]);
  for (let i = 0; i < 3; i++) r.h.failure(enotfound);
  await tick();
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0]!.n, 3);
  assert.equal(r.trips[0]!.c?.result, "online");
  assert.deepEqual(r.offline, []);
  // Tripped once: more failures do not ask again or trip again.
  for (let i = 0; i < 5; i++) r.h.failure(enotfound);
  await tick();
  assert.equal(r.checks(), 1);
  assert.equal(r.trips.length, 1);
});

test("the machine is offline too: no exit, logged once per outage, and the counter re-arms", async () => {
  const r = healthRig(["offline"]);
  for (let i = 0; i < 3; i++) r.h.failure(enotfound);
  await tick();
  assert.deepEqual(r.trips, []);
  assert.deepEqual(r.offline, [3]);
  assert.equal(r.h.consecutiveFailures, 0, "re-armed");
  // Still offline: it trips and asks again, but says nothing new.
  for (let i = 0; i < 3; i++) r.h.failure(enotfound);
  await tick();
  assert.equal(r.checks(), 2);
  assert.deepEqual(r.offline, [3]);
  assert.deepEqual(r.trips, []);
  // An upstream success ends the outage; the next one is logged again.
  r.h.success();
  for (let i = 0; i < 3; i++) r.h.failure(enotfound);
  await tick();
  assert.deepEqual(r.offline, [3, 3]);
});

test("offline, then back online while this process still cannot connect: the next trip exits", async () => {
  const r = healthRig(["offline", "online"]);
  for (let i = 0; i < 6; i++) {
    r.h.failure(enotfound);
    await tick();
  }
  assert.equal(r.checks(), 2);
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0]!.c?.result, "online");
});

test("the check cannot run (no curl): exit as before — the documented fix stays the default", async () => {
  const r = healthRig(["unknown"]);
  for (let i = 0; i < 3; i++) r.h.failure(enotfound);
  await tick();
  assert.equal(r.trips.length, 1);
  assert.equal(r.trips[0]!.c?.result, "unknown");
  // A check that throws is the same as one that cannot run.
  const trips: number[] = [];
  const h = new UpstreamHealth(() => 1, (n) => trips.push(n), { connectivity: async () => { throw new Error("spawn failed"); } });
  h.failure(enotfound);
  await tick();
  assert.deepEqual(trips, [1]);
});

test("an upstream success while the check runs means this process works: no exit", async () => {
  let answer: (c: Connectivity) => void = () => {};
  const trips: number[] = [];
  const h = new UpstreamHealth(() => 2, (n) => trips.push(n), { connectivity: () => new Promise((r) => { answer = r; }) });
  h.failure(enotfound);
  h.failure(enotfound);
  h.success();
  answer({ result: "online", detail: "" });
  await tick();
  assert.deepEqual(trips, []);
  // Re-armed: the counter can trip again.
  h.failure(enotfound);
  h.failure(enotfound);
  answer({ result: "online", detail: "" });
  await tick();
  assert.deepEqual(trips, [2]);
});

test("without a connectivity check the original rule holds, and only connect errors count", () => {
  const trips: number[] = [];
  const h = new UpstreamHealth(() => 2, (n) => trips.push(n));
  h.failure(new Error("HTTP 500"));
  h.failure(enotfound);
  assert.deepEqual(trips, []);
  h.failure(enotfound);
  assert.deepEqual(trips, [2]);
});
