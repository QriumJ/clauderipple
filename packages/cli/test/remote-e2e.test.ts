// End to end, with real ssh and a real sshd, without touching the user's ssh setup: a throwaway
// OpenSSH server runs as this user on a free port from a temp dir (its own host key, its own
// authorized_keys, HOME forced to a fake "remote home"), and the client uses its own key, its own
// known_hosts and no ssh config or agent. The tunnel's local end is a throwaway CONNECT proxy
// started here, not the live router. `remote add` runs against it through the real admin API and
// tunnel manager; a "remote" command then sends a CONNECT through the tunnel; `remote remove`
// undoes it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const SSHD = "/usr/sbin/sshd";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect({ host: "127.0.0.1", port });
    c.once("connect", () => { c.destroy(); resolve(true); });
    c.once("error", () => resolve(false));
  });
}

async function until(what: string, check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("remote add → CONNECT through the reverse tunnel → remote remove, against a throwaway sshd", { timeout: 90_000 }, async (t) => {
  if (process.platform === "win32") return t.skip("POSIX only");
  if (!fs.existsSync(SSHD)) return t.skip(`${SSHD} is not installed`);
  if (spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", "/dev/null/x"]).error) return t.skip("ssh-keygen is not installed");

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cr-remote-e2e-")));
  const home = path.join(tmp, "clauderipple");
  const agentDir = path.join(tmp, "agents");
  const remoteHome = path.join(tmp, "remotehome");
  for (const d of [home, agentDir, path.join(remoteHome, ".claude")]) fs.mkdirSync(d, { recursive: true });
  for (const k of ["hostkey", "client"]) assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(tmp, k)]).status, 0);
  fs.copyFileSync(path.join(tmp, "client.pub"), path.join(tmp, "authorized_keys"));

  const sshPort = await freePort();
  const remotePort = await freePort();
  fs.writeFileSync(path.join(tmp, "sshd_config"), [
    `Port ${sshPort}`,
    "ListenAddress 127.0.0.1",
    `HostKey ${path.join(tmp, "hostkey")}`,
    `AuthorizedKeysFile ${path.join(tmp, "authorized_keys")}`,
    `PidFile ${path.join(tmp, "sshd.pid")}`,
    "UsePAM no",
    "StrictModes no",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "AllowTcpForwarding yes",
    `ForceCommand env HOME=${remoteHome} /bin/sh -c "$SSH_ORIGINAL_COMMAND"`,
    "",
  ].join("\n"));

  // Nothing below may read or write the user's ~/.clauderipple, ~/.claude or ~/.ssh.
  const saved = { home: process.env.CLAUDERIPPLE_HOME, settings: process.env.CLAUDE_SETTINGS_PATH, ssh: process.env.CLAUDERIPPLE_SSH_OPTIONS };
  process.env.CLAUDERIPPLE_HOME = home;
  process.env.CLAUDE_SETTINGS_PATH = path.join(tmp, "local-claude-settings.json");
  process.env.CLAUDERIPPLE_SSH_OPTIONS = JSON.stringify([
    "-F", "/dev/null",
    "-p", String(sshPort),
    "-i", path.join(tmp, "client"),
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", `UserKnownHostsFile=${path.join(tmp, "known_hosts")}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "StrictHostKeyChecking=accept-new",
  ]);

  // Imported after the environment is set: homeDir() and friends read it.
  const { generateCerts } = await import("../src/certs.ts");
  const { remoteAdd, remoteRemove } = await import("../src/remote.ts");
  const { ConfigStore } = await import("../../router/src/config.ts");
  const { startAdmin } = await import("../../router/src/admin.ts");
  const { Logger } = await import("../../router/src/log.ts");
  const { RequestLog } = await import("../../router/src/requestlog.ts");
  const { RemoteTunnels } = await import("../../router/src/remote-tunnel.ts");
  const { readLocalAssets, spawnSsh, syncRemoteAssets, assetsFingerprint, BATCH_OPTIONS, extraSshOptions } = await import("../../router/src/remote-host.ts");

  let sshd: ChildProcess | null = null;
  let tunnels: InstanceType<typeof RemoteTunnels> | null = null;
  let admin: { port: number; close(): void } | null = null;
  const connects: string[] = [];
  const proxy = net.createServer((sock) => {
    let head = "";
    let tunnelled = false;
    sock.on("data", (d) => {
      if (tunnelled) {
        sock.end("HTTP/1.1 200 OK\r\ncontent-length: 9\r\nconnection: close\r\n\r\ntunnel-ok");
        return;
      }
      head += d.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      connects.push(head.split("\r\n")[0]!);
      tunnelled = true;
      sock.write("HTTP/1.1 200 Connection established\r\n\r\n");
    });
    sock.on("error", () => {});
  });
  try {
    sshd = spawn(SSHD, ["-D", "-e", "-f", path.join(tmp, "sshd_config")], { stdio: ["ignore", "ignore", "pipe"] });
    let sshdLog = "";
    sshd.stderr!.on("data", (d: Buffer) => (sshdLog += d.toString()));
    await until("sshd to listen", () => canConnect(sshPort)).catch((e: Error) => { throw new Error(`${e.message}\n${sshdLog}`); });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const proxyPort = (proxy.address() as net.AddressInfo).port;

    generateCerts(home);
    const configFile = path.join(home, "config.json");
    fs.writeFileSync(configFile, JSON.stringify({ listen: { host: "127.0.0.1", port: proxyPort }, admin: { port: 0 }, providers: {} }, null, 2));
    const agentBody = "---\nname: gpt-e2e\nmodel: gpt-e2e@high\n---\nworker\n";
    fs.writeFileSync(path.join(agentDir, "gpt-e2e.md"), agentBody);
    fs.writeFileSync(path.join(agentDir, "hand.md"), "---\nname: hand\n---\nnot generated\n");
    fs.writeFileSync(path.join(home, "generated-agents.json"), JSON.stringify({ agents: ["gpt-e2e"] }));
    fs.writeFileSync(path.join(remoteHome, ".claude", "settings.json"), JSON.stringify({ model: "opus", env: { FOO: "1" } }, null, 2));

    // The router's half, wired as index.ts wires it, pointed at the throwaway proxy.
    const store = new ConfigStore(configFile);
    const log = new Logger(null, 1_000_000, 1, false);
    const assets = () => readLocalAssets({ home, agentDir });
    tunnels = new RemoteTunnels({
      log,
      proxyTarget: () => ({ host: "127.0.0.1", port: store.get().listen.port }),
      pidFile: path.join(home, "remote-tunnels.json"),
      sync: (host) => syncRemoteAssets(spawnSsh, host, assets()),
      fingerprint: () => assetsFingerprint(assets()),
    });
    const tun = tunnels;
    admin = await startAdmin({
      config: () => store.get(),
      configFile,
      log,
      stats: () => ({ inFlight: 0, messagesInFlight: 0, started: 0, completed: 0, failed: 0 }),
      health: () => 0,
      version: "0.0.0-test",
      requests: new RequestLog(path.join(home, "logs", "requests.jsonl")),
      agentDir,
      remote: { status: () => tun.status(), reload: () => { tun.reconcile(store.get().remote?.hosts ?? []); return tun.status(); } },
    });
    const adminUrl = `http://127.0.0.1:${admin.port}`;

    const host = `${os.userInfo().username}@127.0.0.1`;
    const out: string[] = [];
    await remoteAdd(host, { port: remotePort, home, agentDir, configFile, adminUrl, print: (l) => out.push(l) });
    assert.ok(out.some((l) => l.startsWith("✓ tunnel up")), out.join("\n"));

    // What the remote session needs is there.
    const rs = JSON.parse(fs.readFileSync(path.join(remoteHome, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(rs.env, { FOO: "1", HTTPS_PROXY: `http://127.0.0.1:${remotePort}`, NODE_EXTRA_CA_CERTS: `${remoteHome}/.clauderipple-remote/ca.pem` });
    assert.equal(rs.model, "opus");
    assert.equal(fs.readFileSync(path.join(remoteHome, ".clauderipple-remote", "ca.pem"), "utf8"), fs.readFileSync(path.join(home, "ca.pem"), "utf8"));
    assert.equal(fs.readFileSync(path.join(remoteHome, ".claude", "agents", "gpt-e2e.md"), "utf8"), agentBody);
    assert.equal(fs.existsSync(path.join(remoteHome, ".claude", "agents", "hand.md")), false, "only generated agents travel");
    assert.ok(fs.existsSync(path.join(remoteHome, ".claude", "settings.json.clauderipple-backup")));
    const tunnelPid = tunnels.status()[0]!.pid!;
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "remote-tunnels.json"), "utf8")).tunnels, [{ pid: tunnelPid, host, port: remotePort }]);

    // On the "remote": a CONNECT to the remote port arrives at the proxy on this side.
    // (Asynchronously: the proxy answering it runs on this event loop.)
    const curl = await spawnSsh([...BATCH_OPTIONS, ...extraSshOptions(), host, "sh", "-s"], {
      input: `curl -sS -p --max-time 10 --proxy http://127.0.0.1:${remotePort} http://ripple.test/hello\n`,
    });
    assert.equal(curl.code, 0, curl.stderr);
    assert.equal(curl.stdout, "tunnel-ok");
    assert.deepEqual(connects, ["CONNECT ripple.test:80 HTTP/1.1"]);

    // The tunnel re-syncs the agent files when the router regenerates them.
    fs.writeFileSync(path.join(agentDir, "gpt-e2e.md"), agentBody.replace("worker", "worker v2"));
    tunnels.assetsChanged();
    await until("the regenerated agent file on the remote", async () => fs.readFileSync(path.join(remoteHome, ".claude", "agents", "gpt-e2e.md"), "utf8").includes("worker v2"));

    // remove: tunnel stopped, remote port closed, our keys and files gone, the rest kept.
    const outRemove: string[] = [];
    await remoteRemove(host, { home, agentDir, configFile, adminUrl, print: (l) => outRemove.push(l) });
    assert.ok(outRemove.includes("✓ tunnel stopped"), outRemove.join("\n"));
    assert.deepEqual(tunnels.status(), []);
    await until("the remote port to close", async () => !(await canConnect(remotePort)));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(remoteHome, ".claude", "settings.json"), "utf8")), { model: "opus", env: { FOO: "1" } });
    assert.equal(fs.existsSync(path.join(remoteHome, ".claude", "agents", "gpt-e2e.md")), false);
    assert.equal(fs.existsSync(path.join(remoteHome, ".clauderipple-remote")), false);
    assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).remote, undefined);
  } finally {
    tunnels?.stopAll();
    admin?.close();
    proxy.close();
    sshd?.kill("SIGTERM");
    for (const [k, v] of [["CLAUDERIPPLE_HOME", saved.home], ["CLAUDE_SETTINGS_PATH", saved.settings], ["CLAUDERIPPLE_SSH_OPTIONS", saved.ssh]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
