// A remote (SSH) host that runs Claude Code for a Claude Desktop session (issue #67).
//
// Desktop's Code tab can run a session on a Linux host over SSH. Claude Code then runs *there*,
// reads that host's `~/.claude/settings.json`, and has no route to this router: 127.0.0.1 on the
// remote is the remote. Desktop opens its SSH connection with the bundled ssh2 library, which only
// forwards local→remote and never reads `RemoteForward` from ~/.ssh/config, so the router holds its
// own reverse tunnel (remote-tunnel.ts) and this module puts on the remote what a session there
// needs: the CA certificate, the env that points Claude Code at the tunnel, and the worker agent
// files. See docs/ARCHITECTURE.md "Remote (SSH) sessions".
//
// Everything on the remote is done by POSIX `sh` scripts fed to `ssh <host> sh -s` on stdin. No
// node or python there, no quoting of a command line through whatever login shell the remote user
// has, and the host name only ever travels as its own argv element — never through a local shell.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The remote port the tunnel listens on (remote 127.0.0.1) unless `--port` says otherwise. */
export const DEFAULT_REMOTE_PORT = 18791;
/** Our directory under the remote home: the CA copy and the record of what we put there. */
export const REMOTE_DIR = ".clauderipple-remote";
/** The remote settings.json is copied here once, before the first time we change it. */
export const SETTINGS_BACKUP_SUFFIX = ".clauderipple-backup";

/**
 * Why `host` cannot be handed to ssh, or null when it can. An ssh alias or `user@host`, nothing
 * else: a leading `-` would be read as an option (`-oProxyCommand=…` runs a command), and anything
 * outside a hostname's characters has no business in one.
 */
export function hostProblem(host: unknown): string | null {
  if (typeof host !== "string" || host === "") return "an ssh host is required (an ssh alias or user@host)";
  if (host.length > 255) return "the ssh host is longer than 255 characters";
  if (host.startsWith("-")) return `"${host}" starts with "-", which ssh would read as an option`;
  if (!/^[A-Za-z0-9_.@:-]+$/.test(host)) return `"${host}" is not an ssh alias or user@host (letters, digits and . _ @ : - only)`;
  return null;
}

export function portProblem(port: unknown): string | null {
  return Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536 ? null : `port must be an integer from 1 to 65535`;
}

/** The OpenSSH client: Windows ships it as an optional feature in System32\OpenSSH. */
export function sshExecutable(): string {
  if (process.platform !== "win32") return "ssh";
  const builtIn = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
  return fs.existsSync(builtIn) ? builtIn : "ssh.exe";
}

/**
 * Extra ssh arguments from `CLAUDERIPPLE_SSH_OPTIONS` (a JSON array of strings), placed before the
 * host. Exists for the end-to-end test, which points ssh at a throwaway sshd with its own key and
 * known_hosts instead of the user's ssh setup; nothing in the product sets it.
 */
export function extraSshOptions(): string[] {
  const raw = process.env.CLAUDERIPPLE_SSH_OPTIONS;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== "string")) throw new Error("CLAUDERIPPLE_SSH_OPTIONS must be a JSON array of strings");
  return parsed as string[];
}

/** Never ask: a prompt nobody can answer would hang the router or the CLI. */
export const BATCH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];

export type SshResult = { code: number | null; stdout: string; stderr: string; error?: string };
/** Runs `ssh <args>` with `input` on stdin. Injected in tests. */
export type SshRunner = (args: string[], opts?: { input?: string; timeoutMs?: number }) => Promise<SshResult>;

export const SSH_MISSING = "ssh was not found. Install the OpenSSH client (on Windows: Settings → System → Optional features → OpenSSH Client).";

export const spawnSsh: SshRunner = (args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: SshResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(sshExecutable(), args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ code: null, stdout, stderr, error: `ssh timed out after ${Math.round((opts.timeoutMs ?? 60_000) / 1000)}s` });
    }, opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.stdin.on("error", () => {}); // ssh gone before reading its input: the exit says why
    child.on("error", (e: NodeJS.ErrnoException) => done({ code: null, stdout, stderr, error: e.code === "ENOENT" ? SSH_MISSING : e.message }));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  });

/** The last non-empty line ssh printed, which is where it says what went wrong. */
function lastLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
}

/** Run a POSIX sh script on `host` and return its stdout. Throws with ssh's own words on failure. */
export async function runRemoteScript(run: SshRunner, host: string, script: string, timeoutMs = 60_000): Promise<string> {
  const problem = hostProblem(host);
  if (problem) throw new Error(problem);
  const r = await run([...BATCH_OPTIONS, ...extraSshOptions(), host, "sh", "-s"], { input: script, timeoutMs });
  if (r.error) throw new Error(r.error);
  if (r.code === 255) throw new SshConnectError(host, lastLine(r.stderr) || "ssh exited with 255");
  if (r.code !== 0) throw new Error(`script on ${host} failed (exit ${r.code}): ${lastLine(r.stderr) || "no message"}`);
  return r.stdout;
}

/** ssh itself could not connect or authenticate (exit 255), as opposed to our script failing. */
export class SshConnectError extends Error {
  readonly host: string;
  readonly detail: string;
  constructor(host: string, detail: string) {
    super(`cannot reach ${host} over ssh: ${detail}`);
    this.host = host;
    this.detail = detail;
  }
}

// ---- What is on the remote ----------------------------------------------------------------

/** What we left on the remote last time, in `<home>/.clauderipple-remote/agents.json`. */
export type RemoteRecord = { agents: string[]; proxyUrl?: string; caPath?: string };

export type RemoteState = {
  /** The remote `$HOME`, absolute. */
  home: string;
  /** `~/.claude/settings.json` as it is now, or null when there is none. */
  settings: string | null;
  /** `cksum` of the same file, so a write can refuse when it changed after this was read. */
  settingsSum: string | null;
  backup: boolean;
  record: RemoteRecord | null;
  /** Basenames (without `.md`) of every file in `~/.claude/agents`. */
  agentFiles: string[];
};

const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function remoteCaPath(home: string): string {
  return `${home}/${REMOTE_DIR}/ca.pem`;
}

export function remoteProxyUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function inspectRemote(run: SshRunner, host: string): Promise<RemoteState> {
  const m = `@@cr-${crypto.randomBytes(6).toString("hex")}`;
  const script = [
    `m='${m}'`,
    `f="$HOME/.claude/settings.json"`,
    `printf '%s home\\n' "$m"; printf '%s\\n' "$HOME"`,
    `printf '%s settings\\n' "$m"`,
    `if [ -e "$f" ]; then printf 'present\\n'; cat "$f" || exit 1; printf '\\n'; else printf 'missing\\n'; fi`,
    `printf '%s sum\\n' "$m"`,
    `if [ -e "$f" ]; then cksum < "$f" || exit 1; fi`,
    `printf '%s backup\\n' "$m"`,
    `if [ -e "$f${SETTINGS_BACKUP_SUFFIX}" ]; then printf 'yes\\n'; else printf 'no\\n'; fi`,
    `printf '%s record\\n' "$m"`,
    `if [ -e "$HOME/${REMOTE_DIR}/agents.json" ]; then cat "$HOME/${REMOTE_DIR}/agents.json"; printf '\\n'; fi`,
    `printf '%s agents\\n' "$m"`,
    `for x in "$HOME/.claude/agents"/*.md; do if [ -e "$x" ]; then basename "$x" .md; fi; done`,
    `printf '%s end\\n' "$m"`,
    `exit 0`,
    "",
  ].join("\n");
  const out = await runRemoteScript(run, host, script);
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith(`${m} `)) {
      current = [];
      sections.set(line.slice(m.length + 1).trim(), current);
    } else current?.push(line);
  }
  if (!sections.has("end")) throw new Error(`unexpected answer from ${host} (is its shell POSIX sh?)`);
  const text = (name: string): string => (sections.get(name) ?? []).join("\n");
  const home = text("home").trim();
  if (!home.startsWith("/")) throw new Error(`${host} reported HOME="${home}"; a remote host must be Linux or another POSIX system`);
  const settingsLines = sections.get("settings") ?? [];
  const present = settingsLines[0] === "present";
  let record: RemoteRecord | null = null;
  const recordText = text("record").trim();
  if (recordText) {
    try {
      const parsed = JSON.parse(recordText) as Partial<RemoteRecord>;
      record = {
        agents: Array.isArray(parsed.agents) ? parsed.agents.filter((a): a is string => typeof a === "string" && AGENT_NAME.test(a)) : [],
        ...(typeof parsed.proxyUrl === "string" ? { proxyUrl: parsed.proxyUrl } : {}),
        ...(typeof parsed.caPath === "string" ? { caPath: parsed.caPath } : {}),
      };
    } catch {
      record = { agents: [] }; // ours but unreadable: nothing in it can be trusted as a delete list
    }
  }
  return {
    home,
    settings: present ? settingsLines.slice(1).join("\n") : null,
    settingsSum: present ? text("sum").trim() || null : null,
    backup: text("backup").trim() === "yes",
    record,
    agentFiles: text("agents").split("\n").map((l) => l.trim()).filter(Boolean),
  };
}

// ---- Writing to the remote ----------------------------------------------------------------

/** `"$HOME/<rel>"` for a path we built ourselves; refuses anything a shell could read differently. */
function homePath(rel: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.split("/").includes("..")) throw new Error(`refusing remote path "${rel}"`);
  return `"$HOME/${rel}"`;
}

/**
 * Lines that replace `$HOME/<rel>` with `content`: a quoted heredoc into a temp file, then `mv`, so
 * a reader sees the old file or the new one. A quoted delimiter means the shell expands nothing in
 * the body. A heredoc always ends in a newline, so content without one gains one.
 */
export function writeFileLines(rel: string, content: string): string[] {
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  let delim = "";
  do delim = `CLAUDERIPPLE_EOF_${crypto.randomBytes(8).toString("hex")}`;
  while (body.split("\n").includes(delim));
  const target = homePath(rel);
  const tmp = homePath(`${rel}.clauderipple-tmp`);
  return [`cat > ${tmp} <<'${delim}' || exit 1`, body, delim, `mv -f ${tmp} ${target} || exit 1`];
}

/**
 * Stops the script (exit 3) when the remote settings.json is no longer the file `state` read. Put
 * first in a script that will write it, so a refusal leaves nothing half done.
 */
export function settingsGuardLine(state: Pick<RemoteState, "settingsSum">): string {
  const f = `"$HOME/.claude/settings.json"`;
  return state.settingsSum === null
    ? `if [ -e ${f} ]; then echo "~/.claude/settings.json appeared while it was being edited; run the command again" >&2; exit 3; fi`
    : `if [ "$(cksum < ${f})" != '${state.settingsSum.replace(/'/g, "")}' ]; then echo "~/.claude/settings.json changed while it was being edited; run the command again" >&2; exit 3; fi`;
}

/**
 * Lines that write the remote settings.json, but only if it is still the file `state` read: a
 * session or the user may have changed it in between, and that change must not be overwritten.
 * The first time we change it, the original is copied to `settings.json.clauderipple-backup`.
 */
export function settingsWriteLines(state: RemoteState, content: string): string[] {
  const f = `"$HOME/.claude/settings.json"`;
  return [
    `mkdir -p "$HOME/.claude" || exit 1`,
    settingsGuardLine(state),
    `if [ -e ${f} ] && [ ! -e "$HOME/.claude/settings.json${SETTINGS_BACKUP_SUFFIX}" ]; then cp -p ${f} "$HOME/.claude/settings.json${SETTINGS_BACKUP_SUFFIX}" || exit 1; fi`,
    ...writeFileLines(".claude/settings.json", content),
  ];
}

// ---- What we copy ------------------------------------------------------------------------

export type LocalAssets = { caPem: string; agents: { name: string; content: string }[] };

/**
 * The router's CA certificate — the file the local install points NODE_EXTRA_CA_CERTS at,
 * `<home>/ca.pem` (cli/src/settings.ts via certPaths) — and the agent files this router generated,
 * as `<home>/generated-agents.json` lists them (agents.ts). Only the public certificate: the file
 * is checked to be one, so a key can never travel by mistake.
 */
export function readLocalAssets(opts: { home: string; agentDir: string }): LocalAssets {
  const caFile = path.join(opts.home, "ca.pem");
  let caPem: string;
  try {
    caPem = fs.readFileSync(caFile, "utf8");
  } catch {
    throw new Error(`no CA certificate at ${caFile}; run \`clauderipple install\` first`);
  }
  if (!caPem.includes("-----BEGIN CERTIFICATE-----") || /PRIVATE KEY/.test(caPem)) throw new Error(`${caFile} is not a certificate; refusing to copy it`);
  let names: string[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(opts.home, "generated-agents.json"), "utf8")) as { agents?: unknown };
    if (Array.isArray(parsed.agents)) names = parsed.agents.filter((a): a is string => typeof a === "string" && AGENT_NAME.test(a));
  } catch {
    /* no generated agents yet */
  }
  const agents: LocalAssets["agents"] = [];
  for (const name of [...names].sort()) {
    try {
      agents.push({ name, content: fs.readFileSync(path.join(opts.agentDir, `${name}.md`), "utf8") });
    } catch {
      /* listed but gone: the router removes it from the manifest on its next sync */
    }
  }
  return { caPem, agents };
}

/** Changes whenever what a remote should hold changes; a tunnel re-syncs only on a new value. */
export function assetsFingerprint(a: LocalAssets): string {
  const h = crypto.createHash("sha256").update(a.caPem);
  for (const agent of a.agents) h.update(`\0${agent.name}\0${agent.content}`);
  return h.digest("hex");
}

export type AgentPlan = { write: string[]; skipped: string[]; remove: string[] };

/**
 * Which agent files to write and remove on the remote. A remote file of the same name that we did
 * not put there is someone's own agent and is left alone; a file we put there whose worker is no
 * longer generated here goes.
 */
export function planAgents(local: string[], state: Pick<RemoteState, "record" | "agentFiles">): AgentPlan {
  const ours = new Set(state.record?.agents ?? []);
  const present = new Set(state.agentFiles);
  const write = local.filter((n) => !present.has(n) || ours.has(n));
  const skipped = local.filter((n) => present.has(n) && !ours.has(n));
  const remove = [...ours].filter((n) => !local.includes(n));
  return { write, skipped, remove };
}

/** Lines that put the CA and the planned agent files on the remote and record what we own. */
export function assetLines(assets: LocalAssets, plan: AgentPlan, record: Omit<RemoteRecord, "agents">): string[] {
  const lines = [`mkdir -p "$HOME/${REMOTE_DIR}" "$HOME/.claude/agents" || exit 1`, ...writeFileLines(`${REMOTE_DIR}/ca.pem`, assets.caPem)];
  for (const name of plan.write) {
    const agent = assets.agents.find((a) => a.name === name);
    if (agent && AGENT_NAME.test(name)) lines.push(...writeFileLines(`.claude/agents/${name}.md`, agent.content));
  }
  for (const name of plan.remove) if (AGENT_NAME.test(name)) lines.push(`rm -f ${homePath(`.claude/agents/${name}.md`)}`);
  const next: RemoteRecord = { agents: [...plan.write].sort(), ...record };
  lines.push(...writeFileLines(`${REMOTE_DIR}/agents.json`, JSON.stringify(next, null, 2) + "\n"));
  return lines;
}

export function script(lines: string[]): string {
  return ["umask 077", ...lines, "exit 0", ""].join("\n");
}

export type SyncResult = { home: string; plan: AgentPlan };

/**
 * Bring the CA and agent files on `host` in step with this machine. What the tunnel runs each time
 * it comes up and whenever the router regenerates the agent files; settings.json is not touched
 * (that is `remote add`'s job, once).
 */
export async function syncRemoteAssets(run: SshRunner, host: string, assets: LocalAssets): Promise<SyncResult> {
  const state = await inspectRemote(run, host);
  const plan = planAgents(assets.agents.map((a) => a.name), state);
  const { agents: _agents, ...kept } = state.record ?? { agents: [] };
  await runRemoteScript(run, host, script(assetLines(assets, plan, kept)));
  return { home: state.home, plan };
}
