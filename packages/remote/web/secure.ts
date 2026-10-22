// The phone's socket through the relay: a SocketLike (conn.ts) that looks to the Link exactly like
// the direct WebSocket, but opens only after the relay connected it to the host AND the host proved
// it holds the key from the pairing QR (src/e2ee.ts). Every frame after that is sealed here; the
// relay forwards bytes it cannot read. Anything that does not open closes the socket, and the
// Link's never-give-up reconnect takes over.
import { RELAY_FRAME_CAP } from "../src/protocol.ts";
import type { RelayMsg } from "../src/protocol.ts";
import { fromB64u, phoneFinish, phoneHello } from "../src/e2ee.ts";
import type { Channel, KeyPair, Nacl } from "../src/e2ee.ts";
import type { SocketLike } from "./conn.ts";

/** What this needs of a browser WebSocket (tests pass a fake). */
export interface RawSocket {
  binaryType: string;
  readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RelayPairing { url: string; server: string; hpk: string }

export function relayClientUrl(p: RelayPairing): string {
  const u = new URL(p.url);
  return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}/ws/client?server=${encodeURIComponent(p.server)}`;
}

/** tweetnacl, loaded by index.html as a classic script (vendor/nacl-fast.min.js sets self.nacl). */
export function browserNacl(): Nacl {
  const n = (globalThis as unknown as { nacl?: Nacl }).nacl;
  if (!n) throw new Error("tweetnacl did not load");
  return n;
}

export class RelaySocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  private raw: RawSocket;
  private nacl: Nacl;
  private hostKey: Uint8Array;
  private stage: "relay" | "handshake" | "open" | "closed" = "relay";
  private eph: KeyPair | null = null;
  private channel: Channel | null = null;

  constructor(raw: RawSocket, pairing: RelayPairing, nacl: Nacl) {
    this.raw = raw;
    this.nacl = nacl;
    this.hostKey = fromB64u(pairing.hpk);
    raw.binaryType = "arraybuffer";
    raw.onmessage = (ev) => this.onRaw(ev.data);
    raw.onclose = (ev) => this.end(ev);
    raw.onerror = (ev) => this.onerror?.(ev);
  }

  send(data: string): void {
    if (this.stage !== "open" || !this.channel) throw new Error("not open");
    this.raw.send(this.channel.seal(data));
  }

  close(code?: number, reason?: string): void {
    try { this.raw.close(code, reason); } catch { /* gone */ }
    this.end({ code });
  }

  private onRaw(data: unknown): void {
    try {
      if (this.stage === "relay") {
        // The relay's one word to us: the host has a data socket for this connection. Then the handshake.
        if (typeof data !== "string" || (JSON.parse(data) as RelayMsg).relay !== "open") throw new Error("expected relay open");
        const hello = phoneHello(this.nacl);
        this.eph = hello.eph;
        this.stage = "handshake";
        this.raw.send(hello.text);
        return;
      }
      if (this.stage === "handshake") {
        if (typeof data !== "string") throw new Error("expected handshake");
        this.channel = phoneFinish(this.nacl, this.eph!, this.hostKey, data);
        this.eph = null;
        this.stage = "open";
        this.readyState = 1;
        this.onopen?.({});
        return;
      }
      if (this.stage === "open") {
        if (!(data instanceof ArrayBuffer) || data.byteLength > RELAY_FRAME_CAP) throw new Error("bad frame");
        this.onmessage?.({ data: this.channel!.open(new Uint8Array(data)) });
      }
    } catch {
      // Not the paired host, or an altered frame: drop the socket, never the check.
      this.close(4400, "e2ee");
    }
  }

  private end(ev: unknown): void {
    if (this.stage === "closed") return;
    this.stage = "closed";
    this.readyState = 3;
    this.channel = null;
    this.onclose?.(ev);
  }
}
