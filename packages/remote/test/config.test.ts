import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { loadConfig, routerAdminUrl } from "../src/config.ts";

function tempDir(t: import("node:test").TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The host must read the router's admin port, not assume this Mac's 8792. */
test("admin URL derives from the router config: default listen 8790 → 8791, custom 8791 → 8792", t => {
  const config = path.join(tempDir(t), "config.json");
  assert.equal(routerAdminUrl(config), "http://127.0.0.1:8791"); // no file yet: the router's defaults, listen 8790
  fs.writeFileSync(config, JSON.stringify({ listen: { port: 8790 } }) + "\n");
  assert.equal(routerAdminUrl(config), "http://127.0.0.1:8791");
  fs.writeFileSync(config, JSON.stringify({ listen: { port: 8791 } }) + "\n");
  assert.equal(routerAdminUrl(config), "http://127.0.0.1:8792");
  // An explicit admin.port still wins over listen + 1, as it does for the router itself.
  fs.writeFileSync(config, JSON.stringify({ listen: { port: 8791 }, admin: { port: 9001 } }) + "\n");
  assert.equal(routerAdminUrl(config), "http://127.0.0.1:9001");
});

/** host.json's own adminUrl, when set, must keep winning over the derived one. */
test("an explicit adminUrl in host.json wins over the router-derived default", t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "host.json"), JSON.stringify({ adminUrl: "http://127.0.0.1:9999" }) + "\n");
  assert.equal(loadConfig(dir, false).adminUrl, "http://127.0.0.1:9999");
});

/** With no host.json adminUrl, loadConfig falls back to the port the router config names. */
test("loadConfig falls back to the router-derived admin URL", t => {
  const home = tempDir(t);
  const prev = process.env.CLAUDERIPPLE_HOME;
  process.env.CLAUDERIPPLE_HOME = home;
  t.after(() => { if (prev === undefined) delete process.env.CLAUDERIPPLE_HOME; else process.env.CLAUDERIPPLE_HOME = prev; });
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ listen: { port: 8791 } }) + "\n");
  const dir = path.join(home, "remote");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "host.json"), "{}\n");
  assert.equal(loadConfig(dir, false).adminUrl, "http://127.0.0.1:8792");
});
