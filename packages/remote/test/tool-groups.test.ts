import test from "node:test";
import assert from "node:assert/strict";
import { timelineItems, type Item } from "../web/timeline.ts";
import { setLang, t } from "../web/i18n.ts";

const assistant = (key: string, text = "", names = ["Read"]): Item => ({ type: "assistant", key, ver: key, text, streaming: false, tools: names.map((name, i) => ({ id: `${key}-${i}`, name, summary: `${name} summary`, input: "input", result: { ok: true, text: "output" } })), model: "test", at: 1 });
const worker: Item = { type: "subagent", key: "worker", ver: "1", toolUseId: "agent-0", sub: "sub-agent", description: "Review files", model: null, status: "done", steps: 3 };

test("consecutive tools and workers collapse without counting Agent twice; text and permissions split runs", () => {
  const permission: Item = { type: "permission", key: "p", ver: "1", id: "p", tool: "Bash", title: "Approve", summary: "pwd", input: "pwd", canAlways: false, decision: null, at: 1 };
  const rows = timelineItems({ state: "idle", items: [assistant("a", "", ["Read", "Bash"]), worker, assistant("agent", "", ["Agent"]), assistant("b"), assistant("c", "Here is what I found"), permission, assistant("d")] });
  assert.deepEqual(rows.map(r => r.type), ["toolGroup", "assistant", "toolGroup", "permission", "toolGroup"]);
  const first = rows[0];
  assert.ok(first?.type === "toolGroup");
  assert.equal(first.tools, 3);
  assert.equal(first.workers, 1);
  assert.equal(first.rows.length, 4);
  assert.equal(first.running, false);
});

test("thinking, withheld or not, neither shows nor splits a run; only live thinking at the end shows", () => {
  const thinking = (key: string, text: string, streaming = false): Item => ({ type: "thinking", key, ver: key, text, streaming, msg: key, at: 1 });
  const rows = timelineItems({ state: "idle", items: [assistant("a"), thinking("h1", ""), assistant("b"), thinking("h2", "Checking the log"), assistant("c")] });
  assert.deepEqual(rows.map(r => r.type), ["toolGroup"]);
  assert.ok(rows[0]?.type === "toolGroup" && rows[0].tools === 3);
  const live = timelineItems({ state: "running", items: [assistant("a"), thinking("h1", "Checking", true), assistant("b"), thinking("h2", "", true)] });
  assert.deepEqual(live.map(r => r.type), ["toolGroup", "thinking"]);
  assert.equal(live[1]?.key, "h2");
});

test("worker event emitted before assistant text appears at its Agent call position", () => {
  const rows = timelineItems({ state: "idle", items: [worker, assistant("agent", "Delegating review", ["Agent"])] });
  assert.deepEqual(rows.map(r => r.type), ["assistant", "toolGroup"]);
  assert.ok(rows[1]?.type === "toolGroup");
  assert.equal(rows[1].workers, 1);
  assert.equal(rows[1].tools, 0);
  const desktop = timelineItems({ state: "idle", items: [assistant("desktop", "", ["Read", "Task"])] });
  assert.ok(desktop[0]?.type === "toolGroup");
  assert.equal(desktop[0].tools, 1);
  assert.equal(desktop[0].workers, 1);
});

test("active run shows latest summary and spinner, previous turns stay completed", () => {
  const result: Item = { type: "result", key: "r", ver: "1", ok: true, ms: 1, model: "test", effort: null };
  const rows = timelineItems({ state: "running", items: [assistant("a"), result, assistant("b", "", ["Read", "Bash"])] });
  assert.ok(rows[0]?.type === "toolGroup" && !rows[0].running);
  assert.ok(rows[2]?.type === "toolGroup" && rows[2].running);
  assert.equal(rows[2].latest, "Bash summary");
});

test("group keeps individual input/output and localizes counts", () => {
  const group = timelineItems({ state: "idle", items: [assistant("a", "", ["Read", "Bash"])] })[0]!;
  assert.ok(group.type === "toolGroup");
  assert.equal(group.rows.length, 2);
  assert.ok(group.rows[0]?.type === "tool");
  assert.equal(group.rows[0].tool.input, "input");
  assert.equal(group.rows[0].tool.result?.text, "output");
  setLang("en");
  assert.equal(t("tool.group", { n: group.tools }), "Used 2 tools");
  assert.equal(t("tool.group", { n: 1 }), "Used 1 tool");
  assert.equal(t("tasks.running", { n: 1 }), "1 task running");
  assert.equal(t("tool.groupWorkers", { n: 1, w: 2 }), "1 tool · 2 workers");
  setLang("ko");
  assert.equal(t("tool.group", { n: group.tools }), "도구 2개 사용");
});
