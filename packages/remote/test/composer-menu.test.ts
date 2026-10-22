import test from "node:test";
import assert from "node:assert/strict";
import { COMPOSER_MENU, composerCommand } from "../src/composer-menu.ts";

test("the + menu's compact sends /compact", () => {
  assert.equal(composerCommand("compact"), "/compact");
  assert.equal(COMPOSER_MENU.find(e => e.id === "compact")?.ko, "대화 압축");
});

test("start fresh reuses the /clear path and asks first", () => {
  assert.equal(composerCommand("restart"), "/clear");
  const restart = COMPOSER_MENU.find(e => e.id === "restart");
  assert.equal(restart?.ko, "새로 시작");
  assert.ok(restart?.confirm, "starting fresh must confirm");
  assert.equal(composerCommand("compact") === composerCommand("restart"), false);
});
