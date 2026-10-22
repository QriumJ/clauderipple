import test from "node:test";
import assert from "node:assert/strict";
import { approval, bridgeFixture, bridgeId, tick } from "./bridge-fixture.ts";

function stored(requestId: string): unknown {
  return { source: "worker", payload: approval(requestId) };
}

function permissionEvents(f: ReturnType<typeof bridgeFixture>): number {
  return f.sessions.log(bridgeId).tail().events.filter(e => e.kind === "permission").length;
}

test("a replay that still lists an answered request does not revive its card", async t => {
  const f = bridgeFixture(t);
  f.sessions.log(bridgeId);
  await tick(); await tick();
  // The server lags: its stored events still show req-1 open after we answered it.
  f.history.push(stored("req-1"));
  f.emit(approval("req-1"));
  await tick(); await tick();
  const permId = f.permissions.pending(bridgeId)[0]?.id;
  assert.ok(permId);
  assert.equal(await f.sessions.decide(bridgeId, permId, "allow"), true);
  assert.ok(f.posts.some(p => JSON.stringify(p).includes('"request_id":"req-1"')));
  assert.equal(f.permissions.pending(bridgeId).length, 0);

  await f.sessions.syncBridge(bridgeId);
  assert.equal(f.permissions.pending(bridgeId).length, 0);
  assert.equal(permissionEvents(f), 1);
});

test("a request answered from another client is not carded on replay", async t => {
  const f = bridgeFixture(t);
  f.sessions.log(bridgeId);
  await tick(); await tick();
  // The answer arrived live before we ever opened the request (e.g. after a host restart
  // dropped the local mapping): the replay must not card it either.
  f.emit({ type: "control_response", response: { request_id: "req-2" } });
  await tick();
  f.history.push(stored("req-2"));
  await f.sessions.syncBridge(bridgeId);
  assert.equal(f.permissions.pending(bridgeId).length, 0);
  assert.equal(permissionEvents(f), 0);
});
