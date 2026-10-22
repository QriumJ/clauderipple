import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sessions } from "../src/sessions.ts";
import type { QueryFn } from "../src/sessions.ts";
import { PermissionQueue } from "../src/permissions.ts";

test("sessions.decide rejects decision strings outside allow / allow_always / deny", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "decide-validation-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const queryFn: QueryFn = () => { throw new Error("must not spawn SDK"); };
  const sessions = new Sessions({ dir,
    router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } },
    permissions: PermissionQueue.open(path.join(dir, "permissions.json")),
    queryFn: queryFn as never, onEvent: () => {}, onSessions: () => {} });
  t.after(() => sessions.shutdown());
  assert.throws(() => sessions.decide("s", "p", "expired" as never), /invalid decision/);
  assert.throws(() => sessions.decide("s", "p", "" as never), /invalid decision/);
  assert.equal(sessions.decide("s", "p", "deny"), false);
});
