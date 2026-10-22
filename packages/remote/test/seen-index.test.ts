import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay, setImmediate as nextTick } from "node:timers/promises";
import { Sessions } from "../src/sessions.ts";
import type { QueryFn } from "../src/sessions.ts";
import { PermissionQueue } from "../src/permissions.ts";

const router = {
  status: async () => ({ ok: true, proxyEnv: {} }),
  figures: async () => { throw new Error("unused"); },
};

function host(t: import("node:test").TestContext, dir: string, counter: { queries: number }) {
  const cwd = path.join(dir, "project");
  fs.mkdirSync(cwd, { recursive: true });
  const queryFn: QueryFn = params => {
    counter.queries++;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const user of params.prompt) {
          void user;
          yield { type: "system", subtype: "init", session_id: "sdk-1" };
          yield { type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1 };
        }
      },
      interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {}, close: () => {},
    };
  };
  const permissions = PermissionQueue.open(path.join(dir, "permissions.json"));
  const sessions = new Sessions({ dir, router, permissions, queryFn: queryFn as never, coalesceMs: 5,
    onEvent: () => {}, onSessions: () => {} });
  return { sessions, cwd };
}

async function waitIdle(sessions: Sessions, id: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (sessions.summaryOf(id)?.state !== "idle") {
    assert.ok(Date.now() < deadline, "never went idle");
    await delay(10);
  }
  await nextTick();
}

test("resend checks use a bounded in-memory index, scanning only when cold", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seen-index-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const counter = { queries: 0 };
  const { sessions, cwd } = host(t, dir, counter);
  t.after(() => sessions.shutdown());

  const id = await sessions.create({ clientMsgId: "c1", cwd, model: "m", effort: null, text: "do stuff" });
  await waitIdle(sessions, id);
  assert.equal(counter.queries, 1);

  // Warm index: both hit and miss answer from memory, without touching the log.
  const log = sessions.log(id);
  let scans = 0;
  const scan = log.before.bind(log);
  log.before = ((...args: Parameters<typeof scan>) => { scans++; return scan(...args); }) as typeof log.before;
  assert.equal((sessions as unknown as { seen(id: string, clientMsgId: string): boolean }).seen(id, "c1"), true);
  assert.equal((sessions as unknown as { seen(id: string, clientMsgId: string): boolean }).seen(id, "c-never"), false);
  assert.equal(scans, 0);

  // A resend of the original still deduplicates without running again.
  await sessions.send(id, "c1", "do stuff");
  assert.equal(counter.queries, 1);

  // Cold index after a restart: the scan runs once, then the index is warm again.
  const cold = host(t, dir, counter);
  t.after(() => cold.sessions.shutdown());
  const log2 = cold.sessions.log(id);
  let scans2 = 0;
  const scan2 = log2.before.bind(log2);
  log2.before = ((...args: Parameters<typeof scan2>) => { scans2++; return scan2(...args); }) as typeof log2.before;
  assert.equal((cold.sessions as unknown as { seen(id: string, clientMsgId: string): boolean }).seen(id, "c1"), true);
  assert.ok(scans2 > 0);
  assert.equal((cold.sessions as unknown as { seen(id: string, clientMsgId: string): boolean }).seen(id, "c-other"), false);
});

test("the duplicate index is bounded per session", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seen-index-cap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { sessions, cwd } = host(t, dir, { queries: 0 });
  t.after(() => sessions.shutdown());
  const id = await sessions.create({ clientMsgId: "c1", cwd, model: "m", effort: null, text: "do stuff" });
  await waitIdle(sessions, id);
  const inner = sessions as unknown as { seenIds: Map<string, Set<string>>; rememberClientMsgId(id: string, clientMsgId: string): void };
  inner.seenIds.get(id)!.clear();
  for (let i = 0; i < 200; i++) inner.seenIds.get(id)!.add(`old-${i}`);
  inner.rememberClientMsgId(id, "fresh");
  assert.ok(inner.seenIds.get(id)!.size <= 200);
  assert.ok(!inner.seenIds.get(id)!.has("old-0"), "oldest id evicted");
  assert.ok(inner.seenIds.get(id)!.has("fresh"));
});
