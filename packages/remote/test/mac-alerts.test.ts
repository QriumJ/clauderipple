import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sessions } from "../src/sessions.ts";
import { PermissionQueue } from "../src/permissions.ts";
import { BridgeClient } from "../src/bridge-client.ts";
import type { DesktopProcess } from "../src/desktop.ts";
import type { AlertBody } from "../src/protocol.ts";

const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const line = (value: unknown): string => JSON.stringify(value) + "\n";
const user = { type: "user", uuid: "u1", cwd: "/synthetic/project", timestamp: "2026-10-12T01:00:00Z", message: { content: "First prompt" } };
const assistant = { type: "assistant", uuid: "a1", message: { id: "m1", model: "test-model", stop_reason: "end_turn", content: [{ type: "text", text: "Answer" }] } };
const failedResult = { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" };

/** A Remote Control transport that answers the cursor reads and holds its stream open until aborted. */
const idleBridge = (): BridgeClient => new BridgeClient({
  auth: () => ({ accessToken: "test", organizationUuid: "org", expiresAt: Date.now() + 60_000 }),
  fetch: async (url, options) => {
    if (String(url).includes("sort_order=")) return Response.json({ data: [] });
    if (!String(url).includes("/events/stream")) return Response.json({ worker_status: "idle" });
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      options?.signal?.addEventListener("abort", () => { try { controller.close(); } catch { /* already closed */ } }, { once: true });
    } }));
  },
});

/** A Mac session the host only reads: a transcript in a synthetic projects dir, plus a registry entry.
 * Everything a transition needs (the clock, the away answer, the registry) is injected. */
function fixture(t: TestContext, opts: { status?: DesktopProcess["status"]; tail?: unknown[]; away?: boolean; bridgeId?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mac-alerts-"));
  const project = path.join(root, "projects", "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, `${id}.jsonl`), [line(user), line(assistant), ...(opts.tail ?? []).map(line)].join(""));
  const registry = new Map<string, DesktopProcess>([[id, { sessionId: id, pid: 42, status: opts.status ?? "busy", ...(opts.bridgeId ? { bridgeSessionId: opts.bridgeId } : {}) }]]);
  const alerts: { session: string; body: AlertBody }[] = [];
  let now = Date.now();
  let awayNow = opts.away ?? true;
  let probes = 0;
  const sessions = new Sessions({
    dir: path.join(root, "host"), now: () => now,
    desktopProjects: path.join(root, "projects"), desktopRegistry: () => registry, desktopProcesses: () => "",
    permissions: PermissionQueue.open(path.join(root, "permissions.json")), bridgeClient: idleBridge(),
    router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } },
    queryFn: () => { throw new Error("no SDK is spawned for a Mac session"); },
    log: () => {}, onEvent: () => {}, onSessions: () => {},
    onAlert: (session, body) => alerts.push({ session, body }),
    away: async () => { probes++; return awayNow; },
  });
  t.after(async () => {
    sessions.shutdown();
    await new Promise(resolve => setImmediate(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    registry, sessions, alerts,
    probes: () => probes,
    setStatus: (status: DesktopProcess["status"]) => { registry.get(id)!.status = status; },
    setAway: (value: boolean) => { awayNow = value; },
    advance: () => { now += 4000; },
    poll: async () => { await sessions.pollDesktop(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("a Mac session alerts once when its turn finishes and once when it newly waits for approval", async t => {
  const f = fixture(t);
  await f.poll();
  assert.equal(f.alerts.length, 0, "the host's first sight of a session only seeds it");
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.deepEqual(f.alerts, [{ session: id, body: { kind: "result", ok: true } }]);
  f.advance();
  await f.poll();
  assert.equal(f.alerts.length, 1, "an idle session does not alert again");
  f.advance(); f.setStatus("waiting");
  await f.poll();
  assert.deepEqual(f.alerts.map(a => a.body), [{ kind: "result", ok: true }, { kind: "permission" }]);
  assert.equal(f.alerts[1]!.session, id);
  f.advance();
  await f.poll();
  assert.equal(f.alerts.length, 2, "still waiting is not a new approval");
  f.advance(); f.setStatus("busy");
  await f.poll();
  assert.equal(f.alerts.length, 2, "work starting is not a push");
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.equal(f.alerts.length, 3, "the next finished turn alerts");
});

test("a turn whose transcript result failed alerts ok:false", async t => {
  const f = fixture(t, { tail: [failedResult] });
  await f.poll();
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.deepEqual(f.alerts, [{ session: id, body: { kind: "result", ok: false } }]);
});

test("nothing is sent while the Mac is not away, and the transition is spent, not postponed", async t => {
  const f = fixture(t, { away: false });
  await f.poll();
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.equal(f.alerts.length, 0, "at the desk: no push");
  assert.ok(f.probes() >= 1, "the away probe was asked");
  f.setAway(true);
  f.advance(); f.setStatus("busy");
  await f.poll();
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.deepEqual(f.alerts, [{ session: id, body: { kind: "result", ok: true } }], "only the turn that ended while away");
});

test("a host that starts while sessions are idle pushes nothing for their old turns", async t => {
  const f = fixture(t, { status: "idle" });
  await f.poll();
  f.advance();
  await f.poll();
  assert.equal(f.alerts.length, 0, "seeded idle: old turns are not re-announced");
  f.advance(); f.setStatus("busy");
  await f.poll();
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.equal(f.alerts.length, 1, "only the turn that ran and ended after the start");
});

test("a bridged session's turns never come through this path", async t => {
  const f = fixture(t, { bridgeId: "bridge-session" });
  f.sessions.log(id); // the phone opened it: the host now tails it as a bridged record
  f.advance();
  await f.poll();
  assert.equal(f.alerts.length, 0);
  f.advance(); f.setStatus("idle");
  await f.poll();
  assert.equal(f.alerts.length, 0, "its appended result event pushes instead");
});
