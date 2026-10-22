// Google's "no capacity for this model" 503 is about the model on Google's side, not the account
// (measured 2026-10-20, ARCHITECTURE §5): it is asked again a few times, slowly, on the same account,
// rests nothing, and ends the turn unwritten so the proxy can hand it to a route fallback. Any other
// 503 keeps the ordinary ten-ask ladder and the short rest.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { capacityRetry, GoogleAdapter, isModelCapacityExhausted, type GoogleOutcome } from "../src/providers/google/index.ts";
import { saveGoogleAccount } from "../src/providers/google/accounts.ts";
import { Logger } from "../src/log.ts";
import type { AnthropicRequest } from "../src/providers/chatgpt/translate.ts";

// The body Cloud Code Assist sent on 2026-10-20 (router.log), minus nothing but whitespace.
const CAPACITY_503 ={ error: {
  code: 503, message: "No capacity available for model gemini-3.8-flash-high on the server", status: "UNAVAILABLE",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "MODEL_CAPACITY_EXHAUSTED", domain: "cloudcode-pa.googleapis.com",
    metadata: { error_number: "2010", model: "gemini-3.8-flash-high", OVERLOADED_TOO_MANY_RETRIES_PER_REQUEST: "true" } }],
} };
const PLAIN_503 = { error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } };
const OK = { response: { candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] } };

capacityRetry.delaysMs = [40, 40];

const request: AnthropicRequest = { model: "gemini-3.8-flash", max_tokens: 64, stream: false, system: "sys", messages: [{ role: "user", content: "Reply OK." }] };

test("the detector reads the measured ErrorInfo reason, on a 503 only, and tolerates junk", () => {
  const body = JSON.stringify(CAPACITY_503);
  assert.equal(isModelCapacityExhausted(503, body), true);
  assert.equal(isModelCapacityExhausted(503, JSON.stringify({ error: { details: [{ reason: "MODEL_CAPACITY_EXHAUSTED" }] } })), true);
  for (const status of [200, 429, 500, 502, 504]) assert.equal(isModelCapacityExhausted(status, body), false, String(status));
  for (const text of ["", "not JSON", "null", "[]", "{}", '{"error":null}', JSON.stringify(PLAIN_503),
    JSON.stringify({ error: { details: {} } }), JSON.stringify({ error: { details: [null, 1, "MODEL_CAPACITY_EXHAUSTED"] } }),
    JSON.stringify({ error: { message: "MODEL_CAPACITY_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } })]) {
    assert.equal(isModelCapacityExhausted(503, text), false, text);
  }
});

type Reply = { status: number; body: unknown };

async function rig(t: TestContext, reply: (n: number, body: string) => Reply, accounts = 2) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cr-capacity-"));
  const seen: { token: string | undefined; body: string }[] = [];
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ token: req.headers.authorization, body });
    const r = reply(seen.length, body);
    res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.body));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  for (let n = 1; n <= accounts; n++) saveGoogleAccount(home, {
    accessToken: `token-${n}`, projectId: `project-${n}`, email: `user-${n}@example.test`, expiresAt: Date.now() + 3_600_000,
  });
  const adapter = new GoogleAdapter("google", { type: "google", auth: "antigravity", url }, home, new Logger(null, 1e6, 1, false));
  const outcomes: GoogleOutcome[] = [];
  const front = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const outcome = await adapter.handle(req, res, "/v1/messages", JSON.parse(body) as AnthropicRequest, "gemini-3.8-flash", "high");
    outcomes.push(outcome);
    if (outcome.kind === "model-capacity") {
      assert.equal(res.headersSent, false, "only the proxy may commit a capacity failure");
      assert.equal(outcome.bytes, 0);
      res.writeHead(outcome.status, { "content-type": "application/json" }).end(outcome.errorBody);
    }
  });
  await new Promise<void>(resolve => front.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const server of [front, upstream]) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const call = async (body: AnthropicRequest) => {
    const r = await fetch(`http://127.0.0.1:${(front.address() as { port: number }).port}/v1/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    return { status: r.status, text: await r.text() };
  };
  return { adapter, seen, outcomes, call };
}

test("no capacity: three slow asks on the same account, nothing rested, the turn handed back unwritten", async t => {
  let capacity = true;
  const r = await rig(t, () => capacity ? { status: 503, body: CAPACITY_503 } : { status: 200, body: OK });
  const res = await r.call(request);
  assert.equal(res.status, 529);
  const error = JSON.parse(res.text).error;
  assert.equal(error.type, "overloaded_error", "the type Claude Code retries on its own");
  assert.match(error.message, /No capacity available for model gemini-3\.8-flash-high/);
  assert.match(error.message, /MODEL_CAPACITY_EXHAUSTED/);
  assert.equal(r.seen.length, 3, "one ask and two retries, not the ten-ask ladder");
  assert.deepEqual(r.seen.map(s => s.token), ["Bearer token-1", "Bearer token-1", "Bearer token-1"], "the other account meets the same model; it is not walked");
  const outcome = r.outcomes[0]!;
  assert.equal(outcome.kind, "model-capacity");
  assert.equal(outcome.exhaustion, undefined);
  assert.match(outcome.note!, /MODEL_CAPACITY_EXHAUSTED after 3 asks/);
  assert.deepEqual(r.adapter.accountStatus().map(a => a.state), ["ready", "ready"]);
  assert.equal(r.adapter.hasUsable(), true, "a route choosing between this provider and its fallback still sees it usable");

  // The next turn is not refused "all accounts resting": it goes to Google on the same account.
  capacity = false;
  const next = await r.call(request);
  assert.equal(next.status, 200);
  assert.match(next.text, /"text":"OK"/);
  assert.equal(r.seen.at(-1)!.token, "Bearer token-1");
});

test("capacity that returns on the second ask answers the turn", async t => {
  const r = await rig(t, (n) => n === 1 ? { status: 503, body: CAPACITY_503 } : { status: 200, body: OK });
  const res = await r.call(request);
  assert.equal(res.status, 200);
  assert.equal(r.seen.length, 2);
  assert.deepEqual(r.adapter.accountStatus().map(a => a.state), ["ready", "ready"]);
});

test("a concurrent turn is sent upstream while another waits out the model's capacity", async t => {
  // Only the turn mentioning "busy" meets no capacity; the other is answered.
  const r = await rig(t, (_n, body) => body.includes("busy") ? { status: 503, body: CAPACITY_503 } : { status: 200, body: OK });
  capacityRetry.delaysMs = [300, 300];
  t.after(() => { capacityRetry.delaysMs = [40, 40]; });
  const busy = r.call({ ...request, messages: [{ role: "user", content: "busy" }] });
  // Let the busy turn reach its first wait before the other one starts.
  for (let i = 0; i < 100 && r.seen.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const other = await r.call(request);
  assert.equal(other.status, 200, "not refused with 429 'every signed-in account is at its limit'");
  assert.equal((await busy).status, 529);
  assert.deepEqual(r.adapter.accountStatus().map(a => a.state), ["ready", "ready"]);
});

test("an ordinary 503 keeps the ten-ask ladder and the short rest", async t => {
  const r = await rig(t, () => ({ status: 503, body: PLAIN_503 }), 1);
  const res = await r.call(request);
  assert.equal(res.status, 529);
  assert.equal(JSON.parse(res.text).error.type, "api_error", "mapped as before");
  assert.equal(r.seen.length, 10);
  assert.equal(r.outcomes[0]!.kind, undefined);
  assert.deepEqual(r.adapter.accountStatus().map(a => a.state), ["cooling"]);
  const next = await r.call(request);
  assert.equal(next.status, 429, "the rested account refuses the next turn, as before");
  assert.match(JSON.parse(next.text).error.message, /every signed-in account is at its limit/);
  assert.equal(r.seen.length, 10, "nothing sent while resting");
});
