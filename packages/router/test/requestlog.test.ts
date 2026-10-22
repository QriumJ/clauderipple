import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RequestLog, ResponseUsageTap, type RequestRecord } from "../src/requestlog.ts";

function record(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id,
    at: "2026-09-13T10:00:00.000Z",
    ms: 100,
    status: 200,
    ok: true,
    kind: "messages",
    source: "claude-opus",
    target: "gpt-test",
    provider: "chatgpt",
    stream: true,
    ...overrides,
  };
}

test("RequestLog keeps a bounded ring and reloads persisted JSONL", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-request-log-"));
  const file = path.join(dir, "requests.jsonl");
  try {
    const log = new RequestLog(file, 2);
    log.add(record("one"));
    log.add(record("two", { provider: "anthropic" }));
    log.add(record("three"));
    assert.deepEqual(log.list(10).map((r) => r.id), ["three", "two"]);
    assert.deepEqual(log.list(10, { provider: "chatgpt" }).map((r) => r.id), ["three"]);
    log.add(record("four", { session: "s-1" }));
    assert.deepEqual(log.list(10, { session: "s-1" }).map((r) => r.id), ["four"]);
    assert.deepEqual(log.list(10, { session: "s-2" }), []);
    const reloaded = new RequestLog(file, 2);
    assert.deepEqual(reloaded.list(10).map((r) => r.id), ["four", "three"]);
    assert.equal(reloaded.list(1)[0]!.session, "s-1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an image record persists, reloads and counts under the image target", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-request-image-"));
  try {
    const file = path.join(dir, "requests.jsonl");
    const log = new RequestLog(file);
    log.add(record("image-1", {
      at: "2026-10-21T10:00:00.000Z",
      kind: "image",
      source: "gpt-6-astra",
      target: "image",
      provider: "gpt",
      stream: false,
      usage: { input: 2249, cached: 0, output: 75 },
      note: "1536x1024 low png, 1 reference(s)",
    }));
    log.add(record("turn"));
    assert.deepEqual(log.list(10, { kind: "image" }).map((r) => r.id), ["image-1"]);
    // A filter may name several kinds; a record matches any of them.
    assert.deepEqual(log.list(10, { kind: ["messages", "image"] }).map((r) => r.id), ["turn", "image-1"]);
    assert.deepEqual(log.list(10, { kind: ["count_tokens"] }), []);

    const reloaded = new RequestLog(file);
    assert.equal(reloaded.list(1, { kind: "image" })[0]!.kind, "image");
    const usage = reloaded.usage(Date.parse("2026-10-21T10:00:00.000Z"), Date.parse("2026-10-21T11:00:00.000Z"));
    assert.equal(usage.providers.gpt?.count, 1);
    assert.deepEqual(usage.models.map((m) => [m.provider, m.model, m.input]), [["gpt", "image", 2249]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RequestLog computes success, usage, cache and latency summaries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-request-summary-"));
  try {
    const log = new RequestLog(path.join(dir, "requests.jsonl"));
    log.add(record("a", { at: "2026-09-13T10:00:00.000Z", ms: 100, usage: { input: 20, cached: 80, output: 9 } }));
    log.add(record("b", { at: "2026-09-13T10:01:00.000Z", ms: 300, ok: false, status: 502, provider: "moonshot", usage: { input: 50, cached: 0, output: 0 } }));
    // A cache write is input that missed: 98 read of 2 + 98 + 100 is a 49% hit, not 98%.
    log.add(record("c", { at: "2026-09-13T10:02:00.000Z", ms: 200, provider: "anthropic", usage: { input: 2, cached: 98, cacheWrite: 100, output: 1 } }));
    log.add(record("old", { at: "2026-09-13T09:00:00.000Z", usage: { input: 999, cached: 0, output: 999 } }));
    const summary = log.summary(Date.parse("2026-09-13T09:59:00.000Z"));
    assert.deepEqual(summary.total, { count: 3, ok: 2, failed: 1, input: 72, cached: 178, cacheWrite: 100, output: 10, cacheHitPercent: 50.9, avgMs: 200 });
    assert.deepEqual(summary.providers.chatgpt, { count: 1, ok: 1, failed: 0, input: 20, cached: 80, cacheWrite: 0, output: 9, cacheHitPercent: 80, avgMs: 100 });
    assert.deepEqual(summary.providers.moonshot, { count: 1, ok: 0, failed: 1, input: 50, cached: 0, cacheWrite: 0, output: 0, cacheHitPercent: 0, avgMs: 300 });
    assert.deepEqual(summary.providers.anthropic, { count: 1, ok: 1, failed: 0, input: 2, cached: 98, cacheWrite: 100, output: 1, cacheHitPercent: 49, avgMs: 200 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a resent request is counted, but neither as a success nor as a failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-request-resent-"));
  try {
    const log = new RequestLog(path.join(dir, "requests.jsonl"));
    log.add(record("a", { at: "2026-10-07T10:00:00.000Z", ms: 300, ok: false, status: 404, provider: "anthropic", resent: true }));
    log.add(record("b", { at: "2026-10-07T10:00:01.000Z", ms: 100, provider: "anthropic" }));
    const summary = log.summary(Date.parse("2026-10-07T09:59:00.000Z"));
    assert.equal(summary.total.count, 2);
    assert.equal(summary.total.ok, 1);
    assert.equal(summary.total.failed, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RequestLog rotates once at its configured size and keeps one previous file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-request-rotate-"));
  const file = path.join(dir, "requests.jsonl");
  try {
    const log = new RequestLog(file, 100, 300);
    log.add(record("one", { note: "x".repeat(180) }));
    log.add(record("two", { note: "y".repeat(180) }));
    assert.ok(fs.existsSync(file));
    assert.ok(fs.existsSync(`${file}.1`));
    assert.match(fs.readFileSync(`${file}.1`, "utf8"), /"id":"one"/);
    assert.match(fs.readFileSync(file, "utf8"), /"id":"two"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ResponseUsageTap extracts split Anthropic SSE fields without changing forwarded bytes", () => {
  const body = [
    "event: message_start\n",
    "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":40,\"cache_creation_input_tokens\":7,\"output_tokens\":0}}}\n\n",
    "event: message_delta\n",
    "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":40,\"cache_creation_input_tokens\":7,\"output_tokens\":25}}\n\n",
  ].join("");
  const pieces = [Buffer.from(body.slice(0, 31)), Buffer.from(body.slice(31, 119)), Buffer.from(body.slice(119, 231)), Buffer.from(body.slice(231))];
  const tap = new ResponseUsageTap("text/event-stream", "identity");
  const forwarded: Buffer[] = [];
  for (const piece of pieces) {
    forwarded.push(piece); // exactly what the proxy writes before observing it
    tap.feed(piece);
  }
  assert.deepEqual(Buffer.concat(forwarded), Buffer.from(body));
  assert.deepEqual(tap.finish(), { usage: { input: 100, cached: 40, cacheWrite: 7, output: 25 }, stopReason: "end_turn" });
});

test("ResponseUsageTap skips compressed responses and bounds unbroken input", () => {
  const compressed = new ResponseUsageTap("text/event-stream", "gzip");
  compressed.feed(Buffer.from("event: message_delta\ndata: {}\n\n"));
  assert.deepEqual(compressed.finish(), {});
  const plain = new ResponseUsageTap("text/event-stream", "identity");
  plain.feed(Buffer.from("x".repeat(70 * 1024)));
  assert.deepEqual(plain.finish(), {});
});

test("ResponseUsageTap inflates a gzip SSE stream side-band", async () => {
  const { ResponseUsageTap } = await import("../src/requestlog.ts");
  const zlib = await import("node:zlib");
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":900,"cache_creation_input_tokens":0,"output_tokens":1}}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n',
    "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
  ].join("");
  const gz = zlib.gzipSync(Buffer.from(sse));
  const tap = new ResponseUsageTap("text/event-stream", "gzip");
  for (let i = 0; i < gz.length; i += 7) tap.feed(gz.subarray(i, i + 7));
  const r = tap.finish();
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.usage?.input, 100);
  assert.equal(r.usage?.cached, 900);
  assert.equal(r.usage?.output, 42);
});

test("ResponseUsageTap keeps usage when a whole SSE body over 64KiB arrives at once (#55)", async () => {
  const zlib = await import("node:zlib");
  const delta = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"' + "a".repeat(200) + '"}}\n\n';
  const sse = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":900,"cache_creation_input_tokens":7,"output_tokens":1}}}\n\n',
    delta.repeat(400),
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n',
  ].join("");
  assert.ok(sse.length > 64 * 1024);
  const expected = { usage: { input: 100, cached: 900, cacheWrite: 7, output: 42 }, stopReason: "end_turn" };
  const gzip = new ResponseUsageTap("text/event-stream", "gzip");
  gzip.feed(zlib.gzipSync(Buffer.from(sse)));
  assert.deepEqual(gzip.finish(), expected);
  const plain = new ResponseUsageTap("text/event-stream", "identity");
  plain.feed(Buffer.from(sse));
  assert.deepEqual(plain.finish(), expected);
});

test("ResponseUsageTap distinguishes explicit cache writes from absent/non-number values", () => {
  for (const stream of [false, true]) {
    for (const value of [0, 7, undefined, null, "0"]) {
      const usage = { input_tokens: 5, output_tokens: 1, ...(value !== undefined ? { cache_creation_input_tokens: value } : {}) };
      const tap = new ResponseUsageTap(stream ? "text/event-stream" : "application/json", undefined);
      tap.feed(Buffer.from(stream
        ? `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage } })}\n\n`
        : JSON.stringify({ usage })));
      if (stream) tap.feed(Buffer.from('event: message_delta\ndata: {"usage":{"output_tokens":9}}\n\n'));
      assert.deepEqual(tap.finish().usage, { input: 5, cached: 0, ...(typeof value === "number" ? { cacheWrite: value } : {}), output: stream ? 9 : 1 });
    }
  }
});

test("ResponseUsageTap observes only the message id and reported tier, across split JSON/SSE", () => {
  const message = { content: [{ id: "tool-id", text: 'quoted "id":"prompt-id"' }], id: "msg_actual", usage: { input_tokens: 1, service_tier: "standard" } };
  for (const stream of [false, true]) {
    const text = stream ? `event: message_start\ndata: ${JSON.stringify({ message })}\n\n` : JSON.stringify(message);
    const tap = new ResponseUsageTap(stream ? "text/event-stream" : "application/json", undefined);
    for (const char of text) tap.feed(Buffer.from(char));
    assert.deepEqual(tap.finish(), { messageId: "msg_actual", servedTier: "standard", usage: { input: 1, cached: 0, output: 0 } });
  }
  const absent = new ResponseUsageTap("application/json", undefined);
  absent.feed(Buffer.from(JSON.stringify({ content: [{ id: "tool-id" }], usage: { input_tokens: 1, service_tier: null } })));
  assert.deepEqual(absent.finish(), { usage: { input: 1, cached: 0, output: 0 } });
});

test("ResponseUsageTap drops an over-long SSE line whole and reads the events after it", () => {
  const tap = new ResponseUsageTap("text/event-stream", "identity");
  tap.feed(Buffer.from('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\n'));
  tap.feed(Buffer.from("data: " + "x".repeat(70 * 1024)));
  tap.feed(Buffer.from('data: {"type":"message_delta"}\n\n'));
  tap.feed(Buffer.from('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n'));
  assert.deepEqual(tap.finish(), { usage: { input: 5, cached: 0, output: 9 }, stopReason: "end_turn" });
});
