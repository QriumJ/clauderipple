import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogEntry, loadModelCatalog } from "../src/catalog.ts";

// Shapes as models.dev served them 2026-10-02.
const catalog = {
  "opencode-go": {
    npm: "@ai-sdk/openai-compatible",
    models: {
      "glm-5.3-flash": { reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }] },
      "muse-spark-1.3-contributor": { provider: { npm: "@ai-sdk/openai" }, reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high", "xhigh"] }], limit: { context: 1048576, output: 131072 } },
      "minimax-m3": { provider: { npm: "@ai-sdk/anthropic" }, reasoning_options: [{ type: "toggle" }] },
      "mimo-v2.6-pro": { reasoning_options: [] },
      "qwen3.8-max": { provider: { npm: "@ai-sdk/anthropic" }, reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "medium", "xhigh"] }, { type: "budget_tokens", max: 262144 }] },
      "zero-window": { reasoning: true, limit: { context: 0 } },
      "fractional-window": { reasoning: true, limit: { context: 200000.5 } },
      "listed-string-window": { reasoning: true, limit: { context: "1000000" } },
    },
  },
  opencode: {
    npm: "@ai-sdk/openai-compatible",
    models: {
      "gemini-x": { provider: { npm: "@ai-sdk/google" }, reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "high"] }] },
      "kimi-k2": { reasoning: false },
      "no-options": { reasoning: true },
    },
  },
};

test("catalogEntry reads the wire from the model's SDK, else the provider's", () => {
  assert.equal(catalogEntry(catalog, "opencode-go", "glm-5.3-flash")?.wire, "chat");
  assert.equal(catalogEntry(catalog, "opencode-go", "muse-spark-1.3-contributor")?.wire, "responses");
  assert.equal(catalogEntry(catalog, "opencode-go", "minimax-m3")?.wire, "anthropic");
  assert.equal(catalogEntry(catalog, "opencode-zen", "gemini-x")?.wire, undefined, "an SDK we do not speak names no wire");
});

test("catalogEntry takes the effort values as listed, and a toggle or budget is no effort", () => {
  assert.deepEqual(catalogEntry(catalog, "opencode-go", "glm-5.3-flash")?.effortLevels, ["low", "high", "max"]);
  assert.deepEqual(catalogEntry(catalog, "opencode-go", "qwen3.8-max")?.effortLevels, ["low", "medium", "xhigh"]);
  assert.deepEqual(catalogEntry(catalog, "opencode-go", "minimax-m3")?.effortLevels, []);
  assert.deepEqual(catalogEntry(catalog, "opencode-go", "mimo-v2.6-pro")?.effortLevels, []);
  assert.deepEqual(catalogEntry(catalog, "opencode-zen", "kimi-k2")?.effortLevels, [], "a model that does not reason takes no effort");
  assert.equal(catalogEntry(catalog, "opencode-zen", "no-options")?.effortLevels, undefined, "a reasoning model with no options leaves the ladder to measurement");
});

test("catalogEntry reads the context window from limit.context, and only when it is a positive integer", () => {
  assert.equal(catalogEntry(catalog, "opencode-go", "muse-spark-1.3-contributor")?.contextWindow, 1048576);
  assert.equal(catalogEntry(catalog, "opencode-go", "glm-5.3-flash")?.contextWindow, undefined, "an entry with no limit states no window");
  assert.equal(catalogEntry(catalog, "opencode-go", "zero-window")?.contextWindow, undefined);
  assert.equal(catalogEntry(catalog, "opencode-go", "fractional-window")?.contextWindow, undefined);
  assert.equal(catalogEntry(catalog, "opencode-go", "listed-string-window")?.contextWindow, undefined, "a window is a number, not a string");
});

test("catalogEntry says nothing for a preset without a catalogue or a model it does not list", () => {
  assert.equal(catalogEntry(catalog, "deepseek", "glm-5.3-flash"), undefined);
  assert.equal(catalogEntry(catalog, undefined, "glm-5.3-flash"), undefined);
  assert.equal(catalogEntry(catalog, "opencode-go", "brand-new"), undefined);
  assert.equal(catalogEntry(undefined, "opencode-go", "glm-5.3-flash"), undefined);
});

test("loadModelCatalog answers undefined rather than throwing when the catalogue cannot be had", async () => {
  const failing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal(await loadModelCatalog(failing), undefined);
});
