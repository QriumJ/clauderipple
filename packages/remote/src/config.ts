// Host settings and the pairing token, under ~/.clauderipple/remote (0600). The token is the
// only secret: whoever holds it can run Claude Code on this machine, so it is never logged,
// never put in a URL the server sees (the pairing link carries it in the #fragment), and
// compared in constant time.
import { randomBytes, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ConfigStore, adminPort, configPath as routerConfigPath } from "../../router/src/config.ts";
import { readJson, writeFileAtomic } from "./fsutil.ts";

export const DEFAULT_PORT = 8797;
/** ClaudeRipple's own relay: what phone access turns back on with after it was switched off. */
export const DEFAULT_RELAY = "https://ripple-relay.clauderipple.workers.dev";

export interface HostConfig {
  token: string;
  /** an address, or "tailscale" / "lan" to pick this machine's address on that network at start */
  bind: string;
  port: number;
  adminUrl: string;
  claudePath?: string;
  /** the relay's origin, once `--relay <url>` was given */
  relay?: string;
  /** this host's name on the relay: random, not secret (the phone needs it in the pairing link) */
  serverId: string;
  /** proves to the relay that a host connection is this host (first one in registers it) */
  relaySecret: string;
}

export function remoteHome(): string {
  return process.env.RIPPLE_REMOTE_HOME ?? path.join(os.homedir(), ".clauderipple", "remote");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Where the router's admin API is listening, read from the router's own config. The admin API sits
 * beside the proxy listener: the router derives its port as `admin.port ?? listen.port + 1`, so a
 * default install is 8791 while this Mac (listen 8791) is 8792. Hardcoding 8792 only worked on this
 * machine; on a default Windows install the host hit a dead port (`/api/status: HTTP 404`).
 */
export function routerAdminUrl(configFile = routerConfigPath()): string {
  return `http://127.0.0.1:${adminPort(new ConfigStore(configFile).get())}`;
}

/** `persist: false` reads without writing the generated secrets (for commands that only print). */
export function loadConfig(dir = remoteHome(), persist = true): HostConfig {
  const file = path.join(dir, "host.json");
  const stored = readJson<Partial<HostConfig>>(file) ?? {};
  const cfg: HostConfig = {
    token: typeof stored.token === "string" && stored.token.length >= 32 ? stored.token : newToken(),
    bind: typeof stored.bind === "string" ? stored.bind : "127.0.0.1",
    port: typeof stored.port === "number" ? stored.port : DEFAULT_PORT,
    adminUrl: typeof stored.adminUrl === "string" ? stored.adminUrl : routerAdminUrl(),
    ...(typeof stored.claudePath === "string" ? { claudePath: stored.claudePath } : {}),
    ...(typeof stored.relay === "string" ? { relay: stored.relay } : {}),
    serverId: typeof stored.serverId === "string" && /^[\w-]{16,64}$/.test(stored.serverId) ? stored.serverId : randomBytes(16).toString("base64url"),
    relaySecret: typeof stored.relaySecret === "string" && stored.relaySecret.length >= 32 ? stored.relaySecret : newToken(),
  };
  if (persist && (cfg.token !== stored.token || cfg.serverId !== stored.serverId || cfg.relaySecret !== stored.relaySecret)) saveConfig(cfg, dir);
  return cfg;
}

export function saveConfig(cfg: HostConfig, dir = remoteHome()): void {
  writeFileAtomic(path.join(dir, "host.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Ifaces = ReturnType<typeof os.networkInterfaces>;

const isTailnet = (ip: string): boolean => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b !== undefined && b >= 64 && b <= 127; // 100.64.0.0/10, Tailscale's CGNAT range
};
const isLan = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

function firstV4(ifaces: Ifaces, pick: (ip: string) => boolean): string | null {
  for (const list of Object.values(ifaces)) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && pick(a.address)) return a.address;
  return null;
}

/** The address to listen on, and the one to put in the pairing link. */
export function resolveBind(bind: string, ifaces: Ifaces = os.networkInterfaces()): { listen: string; advertise: string; reachableFromPhone: boolean } {
  if (bind === "tailscale" || bind === "lan") {
    const ip = firstV4(ifaces, bind === "tailscale" ? isTailnet : isLan);
    if (!ip) throw new Error(`no ${bind === "tailscale" ? "Tailscale (100.64.0.0/10)" : "LAN"} address on this machine`);
    return { listen: ip, advertise: ip, reachableFromPhone: true };
  }
  if (bind === "0.0.0.0" || bind === "::") {
    const ip = firstV4(ifaces, isTailnet) ?? firstV4(ifaces, isLan) ?? "127.0.0.1";
    return { listen: bind, advertise: ip, reachableFromPhone: ip !== "127.0.0.1" };
  }
  const loopback = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
  return { listen: bind, advertise: bind, reachableFromPhone: !loopback };
}

export function pairingUrl(advertise: string, port: number, token: string): string {
  const host = advertise.includes(":") ? `[${advertise}]` : advertise;
  return `http://${host}:${port}/#pair=${token}`;
}

/**
 * The pairing link through the relay. Everything after `#` stays on the phone: browsers never send a
 * fragment, so the relay sees neither the token nor the host's public key, only the page request.
 */
export function relayPairingUrl(relay: string, serverId: string, hostPublicKey: string, token: string): string {
  const origin = new URL(relay).origin;
  return `${origin}/#pair=${token}&server=${serverId}&hpk=${hostPublicKey}`;
}

/** The relay's address, validated: https (or http only for a local `wrangler dev`). */
export function normalizeRelay(url: string): string {
  const u = new URL(url);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error(`relay must be https:// (http:// only for localhost): ${url}`);
  return u.origin;
}
