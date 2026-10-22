// Ripple relay: a Cloudflare Worker with one Durable Object per host (server id). It does two
// things and keeps nothing: forwards encrypted frames between a phone and its host (room.ts), and
// serves the PWA's static files, so the phone has an https origin — the secure context that
// service workers and web push need. Self-hostable: `wrangler deploy` on anyone's account.
//
//   GET /ws/host?server=<id>               host control socket   (header x-ripple-host-secret)
//   GET /ws/host-data?server=<id>&conn=<c> host data socket       (same header)
//   GET /ws/client?server=<id>             phone socket
//   anything else                          the PWA: static assets (./dist, by build-web.ts), not this worker
import { Room } from "./room.ts";
import type { RoomCtx } from "./room.ts";

// ---- the slice of the Workers runtime used here (no @cloudflare/workers-types dependency) ----

interface CfSocket { send(data: string | ArrayBuffer | Uint8Array): void; close(code?: number, reason?: string): void }
interface DoState {
  acceptWebSocket(ws: CfSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfSocket[];
  getTags(ws: CfSocket): string[];
  setWebSocketAutoResponse(pair: unknown): void;
  getWebSocketAutoResponseTimestamp(ws: CfSocket): Date | null;
  storage: { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> };
}
interface DoStub { fetch(req: Request): Promise<Response> }
interface DoNamespace { idFromName(name: string): unknown; get(id: unknown): DoStub }
interface Env { ROOM: DoNamespace; ASSETS: { fetch(req: Request): Promise<Response> } }
declare const WebSocketPair: { new (): { 0: CfSocket; 1: CfSocket } };
declare const WebSocketRequestResponsePair: { new (request: string, response: string): unknown };

const SERVER_RE = /^[\w-]{16,64}$/;

function upgrade(ctxAccept: (ws: CfSocket) => void): Response {
  const pair = new WebSocketPair();
  ctxAccept(pair[1]);
  return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
}

export class RelayRoom {
  private state: DoState;
  private room: Room<CfSocket>;

  constructor(state: DoState) {
    this.state = state;
    // Host pings are answered by the runtime without waking the object: idle rooms cost no duration.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    const ctx: RoomCtx<CfSocket> = {
      accept: (ws, tags) => state.acceptWebSocket(ws, tags),
      sockets: (tag) => state.getWebSockets(tag),
      tags: (ws) => state.getTags(ws),
      lastPing: (ws) => state.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null,
      now: () => Date.now(),
      get: (k) => state.storage.get<string>(k),
      put: (k, v) => state.storage.put(k, v),
      newId: () => crypto.randomUUID(),
      sha256: async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join(""),
    };
    this.room = new Room(ctx);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const secret = req.headers.get("x-ripple-host-secret");
    switch (url.pathname) {
      case "/ws/host":
        if (!(await this.room.hostAllowed(secret))) return new Response("forbidden", { status: 403 });
        return upgrade((ws) => this.room.hostControl(ws));
      case "/ws/host-data": {
        const conn = url.searchParams.get("conn") ?? "";
        if (!(await this.room.hostAllowed(secret))) return new Response("forbidden", { status: 403 });
        if (!this.room.hasClient(conn)) return new Response("no such connection", { status: 404 });
        return upgrade((ws) => this.room.hostData(ws, conn));
      }
      case "/ws/client":
        return upgrade((ws) => this.room.client(ws));
      default:
        return new Response("not found", { status: 404 });
    }
  }

  webSocketMessage(ws: CfSocket, data: string | ArrayBuffer): void { this.room.message(ws, data); }
  webSocketClose(ws: CfSocket, code: number): void {
    this.room.closed(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "closed"); } catch { /* already closed */ }
  }
  webSocketError(ws: CfSocket): void { this.room.closed(ws); }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/ws/")) {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
      const server = url.searchParams.get("server") ?? "";
      if (!SERVER_RE.test(server)) return new Response("bad server id", { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(server)).fetch(req);
    }
    // Only /ws/* is routed here (wrangler.toml run_worker_first); the PWA is served as static assets
    // with the headers in dist/_headers. Anything else that reaches the worker is handed to them.
    return env.ASSETS.fetch(req);
  },
};
