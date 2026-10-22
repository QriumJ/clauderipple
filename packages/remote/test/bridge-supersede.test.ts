import test from "node:test";
import assert from "node:assert/strict";
import { approval, bridgeFixture, bridgeId, tick } from "./bridge-fixture.ts";

test("a new phone message denies waiting Mac approvals like host sessions do", async t => {
  const f = bridgeFixture(t);
  f.sessions.log(bridgeId);
  await tick(); await tick();
  f.emit(approval("req-1"));
  await tick(); await tick();
  const permId = f.permissions.pending(bridgeId)[0]?.id;
  assert.ok(permId);
  assert.equal(f.sessions.summaryOf(bridgeId)?.attention?.reason, "permission");

  await f.sessions.send(bridgeId, "phone-1", "second thought");
  await tick(); await tick();

  // The Remote Control side got the deny it accepts; the local record resolved denied.
  const deny = f.posts.find(p => JSON.stringify(p).includes('"request_id":"req-1"'));
  assert.ok(deny, "expected a control_response for req-1");
  assert.match(JSON.stringify(deny), /"behavior":"deny"/);
  assert.equal(f.permissions.get(permId)?.state, "deny");
  assert.equal(f.permissions.pending(bridgeId).length, 0);
  assert.equal(f.sessions.summaryOf(bridgeId)?.attention?.reason ?? null, null);
  // The user event itself still went out over the bridge.
  assert.ok(f.posts.some(p => JSON.stringify(p).includes("second thought")));

  // And a lagging replay does not bring the superseded card back.
  f.history.push({ source: "worker", payload: approval("req-1") });
  await f.sessions.syncBridge(bridgeId);
  assert.equal(f.permissions.pending(bridgeId).length, 0);
});
