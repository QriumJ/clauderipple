import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULTS, type Config } from "../src/config.ts";
import { isJudgeOnlyModel } from "../src/model-policy.ts";
import { agentAliases, generatedAgents, syncAgentFiles } from "../src/agents.ts";
import { injectBootstrap } from "../src/bootstrap.ts";
import { chatPickerModels, injectPickerModels } from "../src/picker.ts";
import { buildModelScores } from "../src/model-scores.ts";
import { ingressModels } from "../src/ingress/models.ts";
import { writeCodexCatalog } from "../../cli/src/codex.ts";

const config = (): Config => ({
  ...DEFAULTS, providers: { zen: { type: "anthropic-compatible", preset: "opencode-zen", url: "http://127.0.0.1:9", models: [{ id: "jev-1.13" }, { id: "chat-model" }] } },
  direct: [], aliases: { judge: "jev-1.13" }, routes: { "judge-slot": { provider: "zen", model: "jev-1.13" } },
  cli: { ...DEFAULTS.cli, extraModels: [{ model: "jev-1.13", name: "Jev" }, { model: "chat-model", name: "Chat" }, { model: "judge", name: "Judge alias" }, { model: "judge-slot", name: "Judge route" }] },
});

test("judge-only predicate recognizes jev ids with effort suffixes, not chat models", () => {
  for (const id of ["jev", "jev-1.13", "jev-1.13@high", "JEV-2"]) assert.equal(isJudgeOnlyModel(id), true);
  for (const id of ["gpt-6.1-sol", "deepseek-v4.1-flash", "claude-sonnet-5-5", "my-jev"]) assert.equal(isJudgeOnlyModel(id), false);
});

test("sync excludes judges and removes a previously generated jev file while preserving hand files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-judge-agents-"));
  const manifest = path.join(dir, "generated-agents.json");
  try {
    fs.writeFileSync(manifest, JSON.stringify({ agents: ["jev-1-13"] }));
    fs.writeFileSync(path.join(dir, "jev-1-13.md"), "---\nname: jev-1-13\nmodel: jev-1.13\n---\n");
    const hand = "---\nname: hand-judge\nmodel: jev-2\n---\nUser owned\n";
    fs.writeFileSync(path.join(dir, "hand-judge.md"), hand);
    syncAgentFiles(config(), dir, undefined, { manifestPath: manifest });
    assert.equal(fs.existsSync(path.join(dir, "jev-1-13.md")), false);
    assert.equal(fs.readFileSync(path.join(dir, "hand-judge.md"), "utf8"), hand);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, "utf8")), { agents: ["chat-model"] });
    assert.deepEqual(agentAliases(dir), { "chat-model": "chat-model" });
    assert.deepEqual(generatedAgents(config(), dir, manifest), [{ name: "chat-model", model: "chat-model", provider: "zen" }]);
    assert.equal(config().providers.zen?.models?.length, 2, "provider configuration keeps the judge");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Desktop picker and Claude Code bootstrap do not offer judge-only models", () => {
  const cfg = config();
  const json = { model_selector_config: [{ id: "code", models: [{ id: "claude-sonnet-5-5", name: "Sonnet" }] }] };
  assert.deepEqual(chatPickerModels(cfg).map(m => m.model), ["chat-model"], "judge aliases/routes are not chat choices either");
  const result = injectPickerModels(json, chatPickerModels(cfg));
  assert.equal(result.injected, 1);
  assert.deepEqual(json.model_selector_config[0]?.models.map(m => m.id), ["claude-sonnet-5-5", "chat-model"]);
  const bootstrap = JSON.parse(injectBootstrap(Buffer.from("{}"), cfg, []).toString()) as { additional_model_options: { model: string }[] };
  assert.deepEqual(bootstrap.additional_model_options.map(m => m.model), ["chat-model"]);
});

test("OpenAI ingress and Codex catalog omit judge ids and routes pointing at judges", () => {
  const cfg = config();
  assert.deepEqual(ingressModels(cfg).map(m => m.id), ["chat-model"]);
  assert.deepEqual(buildModelScores(cfg, null).models.map(m => m.model), ["chat-model"], "AA metadata used for auto workers excludes judges");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-judge-codex-"));
  try {
    fs.writeFileSync(path.join(dir, "models_cache.json"), JSON.stringify({ models: [
      { slug: "gpt-5.5", model_messages: { instructions_template: "T" } }, { slug: "jev-cached" },
    ] }));
    const file = writeCodexCatalog([{ id: "jev-1.13", provider: "zen", effortLevels: [] }, { id: "chat-model", provider: "zen", effortLevels: [] }], dir);
    assert.ok(file);
    const catalog = JSON.parse(fs.readFileSync(file, "utf8")) as { models: { slug: string }[] };
    assert.deepEqual(catalog.models.map(m => m.slug), ["gpt-5.5", "chat-model"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
