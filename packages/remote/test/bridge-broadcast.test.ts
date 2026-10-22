import test from "node:test";
import assert from "node:assert/strict";
import { bridgeFixture, bridgeId, tick } from "./bridge-fixture.ts";

test("desktop polls broadcast only when the bridge state actually changed", async t => {
  const f = bridgeFixture(t);
  f.sessions.log(bridgeId);
  await tick(); await tick();
  const baseline = f.onSessions();

  await f.sessions.pollDesktop();
  await f.sessions.pollDesktop();
  assert.equal(f.stateReads(), 1);
  const afterFirst = f.onSessions();
  assert.ok(afterFirst > baseline, "first read (unknown -> idle) broadcasts");

  f.advance();
  await f.sessions.pollDesktop();
  assert.equal(f.stateReads(), 2);
  assert.equal(f.onSessions(), afterFirst, "unchanged re-read broadcasts nothing");

  f.advance();
  f.status("running");
  await f.sessions.pollDesktop();
  assert.equal(f.sessions.list().find(s => s.id === bridgeId)?.state, "running");
  assert.ok(f.onSessions() > afterFirst, "a real change broadcasts");
});
