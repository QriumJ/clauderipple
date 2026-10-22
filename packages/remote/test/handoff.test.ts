import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopHandoff } from "../src/handoff.ts";

for (const mode of ["success", "failure", "timeout"] as const) {
  test(`PTY handoff ${mode} uses a fake CLI, never a user's session`, { skip: process.platform !== "darwin" }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-handoff-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const cli = path.join(dir, "fake-claude");
    fs.writeFileSync(cli, `#!/bin/sh\n${mode === "timeout" ? "exec /bin/sleep 60" : 'printf "%s\\n" "$@"; exit ' + (mode === "failure" ? "7" : "0")}\n`, { mode: 0o700 });
    const run = desktopHandoff(cli, mode === "timeout" ? 100 : 5000);
    const request = { sessionId: "fake-session", title: "Phone title", cwd: dir };
    if (mode === "success") {
      const output = await run(request);
      assert.match(output, /--desktop --resume fake-session/);
      assert.doesNotMatch(output, /--name/);
    } else await assert.rejects(run(request), mode === "timeout" ? /timed out/ : /exit 7/);
  });
}
