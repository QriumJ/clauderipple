// The Antigravity quota lookup: the `retrieveUserQuotaSummary` parse and its window mapping, and
// the per-account cache. The response shape is the measured one (2026-10-15); the values are fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GoogleUsage, googleWindowsFromGroups, parseQuotaSummary } from "../src/providers/google/usage.ts";

const measured = {
  groups: [
    { displayName: "Gemini Models", buckets: [
      { bucketId: "gemini-weekly", displayName: "Weekly", window: "weekly", resetTime: "2026-10-19T00:00:00Z", remainingFraction: 0.98 },
      { bucketId: "gemini-5h", displayName: "5h", window: "5h", resetTime: "2026-10-15T05:39:48Z", remainingFraction: 1 },
    ] },
    { displayName: "Claude and GPT models", buckets: [
      { bucketId: "3p-weekly", displayName: "Weekly", window: "weekly", resetTime: "2026-10-19T00:00:00Z", remainingFraction: 0.9 },
      { bucketId: "3p-5h", displayName: "5h", window: "5h", resetTime: "2026-10-15T05:39:48Z", remainingFraction: 1 },
    ] },
  ],
};

test("the quota summary parses into groups; a body of the wrong shape gives null", () => {
  const groups = parseQuotaSummary(measured);
  assert.equal(groups?.length, 2);
  assert.equal(groups?.[0]?.displayName, "Gemini Models");
  assert.equal(groups?.[0]?.buckets[0]?.remainingFraction, 0.98);
  // A bucket without a readable fraction is dropped; a group left empty goes too.
  assert.deepEqual(parseQuotaSummary({ groups: [{ displayName: "X", buckets: [{ window: "5h" }] }] }), []);
  assert.equal(parseQuotaSummary({}), null);
  assert.equal(parseQuotaSummary(null), null);
  assert.equal(parseQuotaSummary([1, 2]), null);
});

test("windows map Gemini's own to five-hour/weekly and every other group to a scoped 3P", () => {
  const groups = parseQuotaSummary(measured)!;
  const windows = googleWindowsFromGroups(groups);
  assert.deepEqual(windows, [
    { kind: "five_hour", used_percent: 0, window_minutes: 300, reset_at: Math.round(Date.parse("2026-10-15T05:39:48Z") / 1000) },
    { kind: "seven_day", used_percent: 2, window_minutes: 10080, reset_at: Math.round(Date.parse("2026-10-19T00:00:00Z") / 1000) },
    { kind: "scoped", label: "3P", used_percent: 10, window_minutes: 10080, reset_at: Math.round(Date.parse("2026-10-19T00:00:00Z") / 1000) },
    { kind: "scoped", label: "3P", used_percent: 0, window_minutes: 300, reset_at: Math.round(Date.parse("2026-10-15T05:39:48Z") / 1000) },
  ]);
});

test("usage is cached per account and a failed lookup keeps the last good groups", async () => {
  const seen: string[] = [];
  let fail = false;
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    if (fail) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(measured), { status: 200 });
  }) as unknown as typeof fetch;
  let now = 1_000_000;
  const source = { credentials: async () => [{ ownerId: "acct-1", accessToken: "tok", projectId: "proj" }] } as never;
  const instance = new GoogleUsage(source, { fetch: fetchImpl, now: () => now, ttlMs: 300_000, warn: () => {} });
  const first = await instance.snapshot();
  assert.equal(first["acct-1"]?.length, 2);
  assert.equal(seen.length, 1);
  // Within the TTL the answer is served from the cache, and no new request is made.
  await instance.snapshot();
  assert.equal(seen.length, 1);
  // Past the TTL a failed lookup keeps the last good groups.
  now += 300_001;
  fail = true;
  const third = await instance.snapshot();
  assert.equal(third["acct-1"]?.length, 2);
  assert.equal(seen.length, 2);
});

// hasRemainingQuota: cached, positive-only evidence from the last successful lookup.
const NOW = Date.parse("2026-10-15T00:00:00Z");
const FUTURE = "2026-10-15T03:00:00Z";
const bucket = (window: string, remainingFraction: unknown, resetTime: unknown = FUTURE) => ({ displayName: window, window, resetTime, remainingFraction });
// A bucket without its own bucketId gets the measured one for its group ("gemini-5h", "3p-weekly").
const group = (displayName: string, prefix: string, buckets: unknown[]) => ({
  displayName,
  buckets: buckets.map((b) => ({ bucketId: `${prefix}-${(b as { window: string }).window}`, ...(b as object) })),
});
const summary = (gemini: unknown[], thirdParty: unknown[]) => ({ groups: [group("Gemini Models", "gemini", gemini), group("Claude and GPT models", "3p", thirdParty)] });
const healthy = () => summary([bucket("weekly", 0.5), bucket("5h", 1)], [bucket("weekly", 0.2), bucket("5h", 0.01)]);

type Account = { ownerId: string; accessToken: string; projectId: string };
function harness(initial: unknown = healthy()) {
  const state = { body: initial as unknown, status: 200, now: NOW, accounts: [{ ownerId: "acct-1", accessToken: "tok", projectId: "proj-1" }] as Account[], calls: 0 };
  const fetchImpl = (async () => {
    state.calls++;
    return state.status === 200 ? new Response(JSON.stringify(state.body), { status: 200 }) : new Response("nope", { status: state.status });
  }) as unknown as typeof fetch;
  const usage = new GoogleUsage({ credentials: async () => state.accounts } as never, { fetch: fetchImpl, now: () => state.now, ttlMs: 300_000, warn: () => {} });
  return { state, usage, acct: (): Account => state.accounts[0]! };
}
const GEMINI = "gemini-3.8-flash";

test("quota is read from the host the requests go to, the daily host unless configured", async () => {
  // Each host counts its own: prod answered 1.0 for a day of use on daily (2026-10-20).
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(measured), { status: 200 });
  }) as unknown as typeof fetch;
  const source = { credentials: async () => [{ ownerId: "acct-1", accessToken: "tok", projectId: "proj" }] } as never;
  await new GoogleUsage(source, { fetch: fetchImpl, warn: () => {} }).snapshot();
  await new GoogleUsage(source, { baseUrl: "https://example.test", fetch: fetchImpl, warn: () => {} }).snapshot();
  assert.deepEqual(seen, [
    "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    "https://example.test/v1internal:retrieveUserQuotaSummary",
  ]);
});

test("every configured host is read, one failing host keeps the other's numbers and evidence", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    if (url.startsWith("https://prod.test/")) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(measured), { status: 200 });
  }) as unknown as typeof fetch;
  const source = { credentials: async () => [{ ownerId: "acct-1", accessToken: "tok", projectId: "proj" }] } as never;
  const usage = new GoogleUsage(source, {
    baseUrl: "https://daily.test",
    hosts: () => ["https://daily.test", "https://prod.test"],
    fetch: fetchImpl,
    now: () => Date.parse("2026-10-15T00:00:00Z"),
    warn: () => {},
  });
  const shown = await usage.snapshot();
  assert.deepEqual(seen.sort(), [
    "https://daily.test/v1internal:retrieveUserQuotaSummary",
    "https://prod.test/v1internal:retrieveUserQuotaSummary",
  ]);
  assert.equal(shown["acct-1"]?.length, 2, "the reachable host's groups are shown");
  assert.equal(usage.hasRemainingQuota({ ownerId: "acct-1", projectId: "proj" }, GEMINI, "https://daily.test"), true);
  assert.equal(usage.hasRemainingQuota({ ownerId: "acct-1", projectId: "proj" }, GEMINI, "https://prod.test"), false, "a failed host proves nothing");
});

test("hasRemainingQuota evidence belongs to one host: the same model on another host is unknown", async () => {
  const fetchImpl = (async (url: string) => {
    const fraction = url.startsWith("https://daily.test/") ? 0.9 : 0;
    const body = summary([bucket("weekly", fraction), bucket("5h", fraction, FUTURE)], []);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const source = { credentials: async () => [{ ownerId: "acct-1", accessToken: "tok", projectId: "proj" }] } as never;
  const usage = new GoogleUsage(source, {
    baseUrl: "https://daily.test",
    hosts: () => ["https://daily.test", "https://prod.test"],
    fetch: fetchImpl,
    now: () => NOW,
    warn: () => {},
  });
  const shown = await usage.snapshot();
  const a = { ownerId: "acct-1", projectId: "proj" };
  // Both hosts answered; the row takes the higher used percent, so the exhausted prod windows win.
  const fiveHour = shown["acct-1"]?.find((g) => /gemini/i.test(g.displayName))?.buckets.find((b) => b.window === "5h");
  assert.equal(fiveHour?.remainingFraction, 0, "both hosts in use: the row shows the closer-to-spent window");
  assert.equal(usage.hasRemainingQuota(a, GEMINI, "https://daily.test"), true, "the daily host has room");
  assert.equal(usage.hasRemainingQuota(a, GEMINI, "https://prod.test"), false, "prod's windows are spent");
  // The default host is the provider's, so an unspecified host means daily here.
  assert.equal(usage.hasRemainingQuota(a, GEMINI), true);
  assert.equal(usage.hasRemainingQuota(a, GEMINI, "https://unread.test"), false, "an unread host is not evidence");
});

test("hasRemainingQuota is false until a lookup has succeeded, never fetches, then is true on the ordinary positive path", async () => {
  const h = harness();
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false);
  assert.equal(h.state.calls, 0);
  await h.usage.snapshot();
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), true);
  // Both windows only need to be positive: 1 (untouched) and 0.01 (almost spent) both count.
  assert.equal(h.usage.hasRemainingQuota(h.acct(), "claude-opus-4-6-thinking"), true);
  assert.equal(h.state.calls, 1);
});

test("hasRemainingQuota reads the model's own group and treats unrecognized models as false", async () => {
  const h = harness(summary([bucket("weekly", 0.5), bucket("5h", 0.5)], [bucket("weekly", 0.5), bucket("5h", 0)]));
  await h.usage.snapshot();
  const a = h.acct();
  for (const model of ["gemini-3.1-pro", "gemini-pro-agent", "gemini-3.7-flash-tiered"]) assert.equal(h.usage.hasRemainingQuota(a, model), true, model);
  // The third-party group has a spent 5h window.
  for (const model of ["claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"]) assert.equal(h.usage.hasRemainingQuota(a, model), false, model);
  // With room in that group, claude-/gpt-oss are true, but names outside the known families never are.
  h.state.body = healthy();
  h.state.now += 300_001;
  await h.usage.snapshot();
  for (const model of ["claude-sonnet-4-6", "gpt-oss-120b-medium"]) assert.equal(h.usage.hasRemainingQuota(a, model), true, model);
  for (const model of ["gpt-6-sol", "gemini", "geminix-1", "gpt-oss2", "llama-4", ""]) assert.equal(h.usage.hasRemainingQuota(a, model), false, model);
});

test("hasRemainingQuota expires with the cache TTL, and a clock that moved backwards is not evidence", async () => {
  const h = harness();
  await h.usage.snapshot();
  h.state.now = NOW + 299_999;
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), true);
  h.state.now = NOW + 300_000;
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false);
  h.state.now = NOW - 1;
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false);
});

test("hasRemainingQuota is false once a reset time has passed, even inside the snapshot TTL", async () => {
  const reset = NOW + 60_000;
  const h = harness(summary([bucket("weekly", 0.5), bucket("5h", 0.5, new Date(reset).toISOString())], []));
  await h.usage.snapshot();
  h.state.now = reset - 1;
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), true);
  h.state.now = reset;
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false);
});

test("a failed refresh drops the evidence even though the dashboard keeps the last good groups", async () => {
  const h = harness();
  await h.usage.snapshot();
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), true);
  h.state.now += 300_001;
  h.state.status = 500;
  const shown = await h.usage.snapshot();
  assert.equal(shown["acct-1"]?.length, 2);
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false);
  // A response of the wrong shape is a failed lookup too, and a later success restores the evidence.
  h.state.now += 300_001;
  h.state.status = 200;
  h.state.body = { nope: true };
  await h.usage.snapshot();
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false);
  h.state.now += 300_001;
  h.state.body = healthy();
  await h.usage.snapshot();
  assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), true);
});

test("hasRemainingQuota belongs to one account and project, and a removed account loses its evidence", async () => {
  const h = harness();
  h.state.accounts.push({ ownerId: "acct-2", accessToken: "tok2", projectId: "proj-2" });
  await h.usage.snapshot();
  const [one, two] = h.state.accounts as [Account, Account];
  assert.equal(h.usage.hasRemainingQuota(one, GEMINI), true);
  assert.equal(h.usage.hasRemainingQuota(two, GEMINI), true);
  assert.equal(h.usage.hasRemainingQuota({ ownerId: "acct-3", projectId: "proj-1" }, GEMINI), false);
  // The same owner under another project is a different quota.
  assert.equal(h.usage.hasRemainingQuota({ ownerId: "acct-1", projectId: "proj-other" }, GEMINI), false);
  // acct-1 is removed and later signs in again with a new project: the old answer cannot be reused.
  h.state.accounts.shift();
  h.state.now += 300_001;
  await h.usage.snapshot();
  assert.equal(h.usage.hasRemainingQuota(one, GEMINI), false);
  assert.equal(h.usage.hasRemainingQuota(two, GEMINI), true);
  h.state.accounts.push({ ownerId: "acct-1", accessToken: "tok", projectId: "proj-new" });
  assert.equal(h.usage.hasRemainingQuota({ ownerId: "acct-1", projectId: "proj-new" }, GEMINI), false);
  assert.equal(h.usage.hasRemainingQuota(one, GEMINI), false);
});

test("hasRemainingQuota rejects invalid fractions, bad resets and missing or ambiguous windows", async () => {
  const cases: Record<string, unknown[]> = {
    "zero 5h": [bucket("weekly", 0.5), bucket("5h", 0)],
    "zero weekly": [bucket("weekly", 0), bucket("5h", 0.5)],
    "negative": [bucket("weekly", -0.1), bucket("5h", 0.5)],
    "above one": [bucket("weekly", 0.5), bucket("5h", 1.0001)],
    "null fraction": [bucket("weekly", 0.5), bucket("5h", null)],
    "nonfinite fraction": [bucket("weekly", Number.POSITIVE_INFINITY), bucket("5h", 0.5)],
    "unreadable fraction (dropped by the parse)": [bucket("weekly", 0.5), bucket("5h", "0.5")],
    "missing 5h": [bucket("weekly", 0.5)],
    "missing weekly": [bucket("5h", 0.5)],
    "unknown window only": [bucket("monthly", 0.5), bucket("5h", 0.5)],
    "duplicate 5h": [bucket("weekly", 0.5), bucket("5h", 0.5), bucket("5h", 0.5)],
    "missing reset": [bucket("weekly", 0.5), { window: "5h", remainingFraction: 0.5 }],
    "invalid reset": [bucket("weekly", 0.5), bucket("5h", 0.5, "not a date")],
    "reset in the past": [bucket("weekly", 0.5), bucket("5h", 0.5, "2026-10-14T23:59:59Z")],
    "reset exactly now": [bucket("weekly", 0.5), bucket("5h", 0.5, "2026-10-15T00:00:00Z")],
    "no buckets": [],
    "extra exhausted window": [bucket("weekly", 0.5), bucket("5h", 0.5), bucket("monthly", 0)],
    "extra bucket of a known window": [bucket("weekly", 0.5), bucket("5h", 0.5), { ...bucket("5h", 0), bucketId: "other-5h" }],
    "wrong bucket id": [bucket("weekly", 0.5), { ...bucket("5h", 0.5), bucketId: "something-else" }],
    "malformed extra bucket (dropped by the display parse)": [bucket("weekly", 0.5), bucket("5h", 0.5), { window: "5h", bucketId: "gemini-5h" }],
    "malformed duplicate bucket": [bucket("weekly", 0.5), bucket("5h", 0.5), { ...bucket("5h", 0.5), remainingFraction: "0" }],
  };
  for (const [name, buckets] of Object.entries(cases)) {
    const h = harness(summary(buckets, buckets));
    await h.usage.snapshot();
    assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false, name);
    assert.equal(h.usage.hasRemainingQuota(h.acct(), "claude-sonnet-4-6"), false, name);
  }
  // An absent or duplicated group is unknown too.
  const noThirdParty = harness({ groups: [group("Gemini Models", "gemini", [bucket("weekly", 0.5), bucket("5h", 0.5)])] });
  await noThirdParty.usage.snapshot();
  assert.equal(noThirdParty.usage.hasRemainingQuota(noThirdParty.acct(), GEMINI), true);
  assert.equal(noThirdParty.usage.hasRemainingQuota(noThirdParty.acct(), "claude-sonnet-4-6"), false);
  const twoGemini = harness({ groups: [...healthy().groups, group("gemini models", "gemini", [bucket("weekly", 0.5), bucket("5h", 0.5)])] });
  await twoGemini.usage.snapshot();
  assert.equal(twoGemini.usage.hasRemainingQuota(twoGemini.acct(), GEMINI), false);
});

test("hasRemainingQuota accepts only the exact known group names and a structurally valid body", async () => {
  // Case and surrounding space in the name are tolerated; a renamed or lookalike group is not a known group.
  const ok = harness({ groups: [group(" gemini MODELS ", "gemini", [bucket("weekly", 0.5), bucket("5h", 0.5)]), group("claude and gpt MODELS", "3p", [bucket("weekly", 0.5), bucket("5h", 0.5)])] });
  await ok.usage.snapshot();
  assert.equal(ok.usage.hasRemainingQuota(ok.acct(), GEMINI), true);
  assert.equal(ok.usage.hasRemainingQuota(ok.acct(), "claude-sonnet-4-6"), true);
  const renamed = harness({ groups: [group("Gemini Models", "gemini", [bucket("weekly", 0.5), bucket("5h", 0.5)]), group("GPT premium", "3p", [bucket("weekly", 0.5), bucket("5h", 0.5)])] });
  await renamed.usage.snapshot();
  assert.equal(renamed.usage.hasRemainingQuota(renamed.acct(), GEMINI), true);
  assert.equal(renamed.usage.hasRemainingQuota(renamed.acct(), "claude-sonnet-4-6"), false);
  assert.equal(renamed.usage.hasRemainingQuota(renamed.acct(), "gpt-oss-120b-medium"), false);
  // A malformed group anywhere (even an unrelated one the display parse silently drops) voids the whole snapshot,
  // while the display still shows what parsed.
  for (const bad of [{ displayName: "Other", buckets: "nope" }, { buckets: [] }, 42, { displayName: "Other", buckets: [{ window: "5h", bucketId: "x", remainingFraction: 0 }, null] }]) {
    const h = harness({ groups: [...summary([bucket("weekly", 0.5), bucket("5h", 0.5)], [bucket("weekly", 0.5), bucket("5h", 0.5)]).groups, bad] });
    const shown = await h.usage.snapshot();
    assert.equal((shown["acct-1"]?.length ?? 0) >= 2, true);
    assert.equal(h.usage.hasRemainingQuota(h.acct(), GEMINI), false, JSON.stringify(bad));
  }
});
