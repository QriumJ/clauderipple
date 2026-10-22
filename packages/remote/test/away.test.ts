import test from "node:test";
import assert from "node:assert/strict";
import { MacAway, hidIdleMs, screenLocked } from "../src/away.ts";

/** The shape `ioreg -n Root -d1 -a` prints, with one console user whose extra keys the test varies. */
const rootPlist = (extra: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>IOConsoleLocked</key>
\t<false/>
\t<key>IOConsoleUsers</key>
\t<array>
\t\t<dict>
\t\t\t<key>kCGSSessionOnConsoleKey</key>
\t\t\t<true/>
${extra}
\t\t</dict>
\t</array>
</dict>
</plist>
`;
const lockKey = (value: "true" | "false"): string => `\t\t\t<key>CGSSessionScreenIsLocked</key>\n\t\t\t<${value}/>`;

test("screenLocked reads the console session's CGSSessionScreenIsLocked, absent meaning unlocked", () => {
  // Measured on this Mac 2026-10-16, unlocked: the key is absent, not false.
  assert.equal(screenLocked(rootPlist("")), false, "unlocked leaves the key out");
  assert.equal(screenLocked(rootPlist(lockKey("false"))), false);
  assert.equal(screenLocked(rootPlist(lockKey("true"))), true);
  assert.equal(screenLocked("<plist/>"), false, "a plist with no console users is not locked");
  // A locked non-console session's key is not the console's: the console's own entry decides.
  const other = "<key>IOConsoleUsers</key><array><dict><key>kCGSSessionOnConsoleKey</key><false/><key>CGSSessionScreenIsLocked</key><true/></dict></array>";
  assert.equal(screenLocked(other), false);
});

test("hidIdleMs converts HIDIdleTime nanoseconds to milliseconds", () => {
  // Measured lines on this Mac 2026-10-16 (the padding is ioreg's own).
  assert.equal(hidIdleMs('    | | |   "HIDIdleTime" = 9452000'), 9.452);
  assert.equal(hidIdleMs('"HIDIdleTime" = 364467562291'), 364467562291 / 1_000_000);
  assert.equal(hidIdleMs('"HIDIdleTime" = 180000000000'), 180_000, "exactly IDLE_MS");
  assert.equal(hidIdleMs("nothing here"), null);
});

test("MacAway: the lock or 180 s of no input is away, and the answer is cached", async () => {
  let now = 1_000_000;
  let locked = false;
  let idle = 0;
  let probes = 0;
  const away = new MacAway({
    platform: "darwin", now: () => now, log: () => {},
    runner: async (_cmd, args) => {
      if (args.includes("-a")) return rootPlist(locked ? lockKey("true") : "");
      probes++;
      return `"HIDIdleTime" = ${idle}`;
    },
  });
  assert.equal(await away.away(), false, "unlocked and active is here");
  idle = 179_000_000_000;
  now += 11_000;
  assert.equal(await away.away(), false, "just under 180 s is still here");
  idle = 180_000_000_000;
  now += 11_000;
  assert.equal(await away.away(), true, "180 s without input is away");
  const cached = probes;
  now += 2_000;
  assert.equal(await away.away(), true, "within the cache window");
  assert.equal(probes, cached, "a cached answer probes nothing");
  locked = true;
  idle = 0;
  now += 11_000;
  assert.equal(await away.away(), true, "a locked screen is away even while active");
  locked = false;
  now += 11_000;
  assert.equal(await away.away(), false);
});

test("MacAway: a failing probe is here, logs once per failure streak, and never runs off darwin", async () => {
  const logs: string[] = [];
  let now = 1_000_000;
  const away = new MacAway({ platform: "darwin", now: () => now, log: l => logs.push(l), runner: async () => { throw new Error("ioreg is missing"); } });
  assert.equal(await away.away(), false);
  now += 11_000;
  assert.equal(await away.away(), false);
  assert.deepEqual(logs, ["away: probe failed (ioreg is missing) — treated as here"]);
  const linux = new MacAway({ platform: "linux", runner: async () => { throw new Error("must not run"); } });
  assert.equal(await linux.away(), false);
});
