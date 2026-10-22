import test from "node:test";
import assert from "node:assert/strict";
import { approval, bridgeFixture, bridgeId, tick } from "./bridge-fixture.ts";

test("a dead Remote Control stream clears permission attention with the expired approvals", async t => {
  let broken = false;
  const f = bridgeFixture(t, { streamBodyless: () => broken });
  f.sessions.log(bridgeId);
  await tick(); await tick();
  f.emit(approval("req-1"));
  await tick(); await tick();
  assert.equal(f.permissions.pending(bridgeId).length, 1);
  assert.equal(f.sessions.summaryOf(bridgeId)?.attention?.reason, "permission");

  // The server withdraws nothing and the stream dies terminally: the approvals expire.
  broken = true;
  f.closeStream();
  const deadline = Date.now() + 5000;
  while (f.permissions.pending(bridgeId).length > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  assert.equal(f.permissions.pending(bridgeId).length, 0);
  // Nothing is answerable anymore, so no permission attention may stick around.
  assert.equal(f.sessions.summaryOf(bridgeId)?.attention ?? null, null);
  assert.equal(f.sessions.list().find(s => s.id === bridgeId)?.attention ?? null, null);
});
