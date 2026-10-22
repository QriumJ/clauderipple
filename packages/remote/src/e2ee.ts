// End-to-end encryption between the phone and the host, so the relay forwards bytes it cannot read
// or forge. No imports: the host also serves this file to the browser (as /src/e2ee.ts), and
// both ends pass in tweetnacl (`nacl`) themselves, so the same lines run on both sides.
//
// Handshake (one per connection):
//   phone → host   text  {"e2ee":"hello","v":1,"pk":<phone ephemeral X25519 public key>}
//   host  → phone  text  {"e2ee":"ready","v":1,"n":<nonce>,"box":box(<host ephemeral public key>, n, phone eph pk, host static sk)}
// The phone knows the host's static public key from the pairing QR (URL fragment, never sent to
// the relay), so only the real host can make a `box` that opens: the relay cannot stand in for the
// host. Both sides then use crypto_box_beforenm(peer ephemeral pk, own ephemeral sk) as the key for
// this connection — ephemeral on both sides, so a host key stolen later does not open old traffic.
// The phone proves nothing here; it proves itself with the pairing token, inside the channel.
//
// Frames after the handshake are binary: XSalsa20-Poly1305 (crypto_box_afternm) with a nonce that
// is not sent but counted — byte 0 the direction (1 host→phone, 2 phone→host), bytes 16–23 the
// frame number. A dropped, repeated, reordered or altered frame fails to open, and the link closes.

export interface KeyPair { publicKey: Uint8Array; secretKey: Uint8Array }
/** The slice of tweetnacl used here. */
export interface Nacl {
  box: {
    (msg: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
    keyPair(): KeyPair;
    before(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
    after(msg: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
    open: { after(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null } & ((box: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array) => Uint8Array | null);
  };
  randomBytes(n: number): Uint8Array;
}

export const E2EE_VERSION = 1;
/** Bytes crypto_box adds to a frame (the Poly1305 tag). */
export const BOX_OVERHEAD = 16;
const HOST_TO_PHONE = 1;
const PHONE_TO_HOST = 2;

export function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("bad base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function key32(text: unknown): Uint8Array {
  if (typeof text !== "string") throw new Error("handshake: missing key");
  let k: Uint8Array;
  try { k = fromB64u(text); } catch { throw new Error("handshake: bad key"); }
  if (k.length !== 32) throw new Error("handshake: bad key length");
  return k;
}

function nonceFor(direction: number, n: number): Uint8Array {
  const nonce = new Uint8Array(24);
  nonce[0] = direction;
  const view = new DataView(nonce.buffer);
  view.setUint32(16, Math.floor(n / 0x1_0000_0000));
  view.setUint32(20, n >>> 0);
  return nonce;
}

/** One direction-aware encrypted link. Throws on anything that does not open. */
export class Channel {
  private nacl: Nacl;
  private key: Uint8Array;
  private sendDir: number;
  private recvDir: number;
  private sent = 0;
  private received = 0;
  private enc = new TextEncoder();
  private dec = new TextDecoder("utf-8", { fatal: true });

  constructor(nacl: Nacl, key: Uint8Array, side: "host" | "phone") {
    this.nacl = nacl;
    this.key = key;
    this.sendDir = side === "host" ? HOST_TO_PHONE : PHONE_TO_HOST;
    this.recvDir = side === "host" ? PHONE_TO_HOST : HOST_TO_PHONE;
  }

  seal(text: string): Uint8Array {
    return this.nacl.box.after(this.enc.encode(text), nonceFor(this.sendDir, this.sent++), this.key);
  }

  open(frame: Uint8Array): string {
    const plain = this.nacl.box.open.after(frame, nonceFor(this.recvDir, this.received), this.key);
    if (!plain) throw new Error("e2ee: frame did not open (altered, replayed or out of order)");
    this.received++;
    return this.dec.decode(plain);
  }
}

export function phoneHello(nacl: Nacl): { text: string; eph: KeyPair } {
  const eph = nacl.box.keyPair();
  return { text: JSON.stringify({ e2ee: "hello", v: E2EE_VERSION, pk: toB64u(eph.publicKey) }), eph };
}

/** Host side: answer a phone's hello. Throws on a malformed hello. */
export function hostAccept(nacl: Nacl, hostStatic: KeyPair, helloText: string): { text: string; channel: Channel } {
  let hello: { e2ee?: unknown; v?: unknown; pk?: unknown };
  try { hello = JSON.parse(helloText) as typeof hello; } catch { throw new Error("handshake: not JSON"); }
  if (hello.e2ee !== "hello" || hello.v !== E2EE_VERSION) throw new Error("handshake: not a hello");
  const phonePk = key32(hello.pk);
  const eph = nacl.box.keyPair();
  const n = nacl.randomBytes(24);
  const sealed = nacl.box(eph.publicKey, n, phonePk, hostStatic.secretKey);
  const channel = new Channel(nacl, nacl.box.before(phonePk, eph.secretKey), "host");
  return { text: JSON.stringify({ e2ee: "ready", v: E2EE_VERSION, n: toB64u(n), box: toB64u(sealed) }), channel };
}

/** Phone side: check the host's answer against the host key from pairing. Throws if it is not that host. */
export function phoneFinish(nacl: Nacl, eph: KeyPair, hostPublicKey: Uint8Array, readyText: string): Channel {
  let ready: { e2ee?: unknown; v?: unknown; n?: unknown; box?: unknown };
  try { ready = JSON.parse(readyText) as typeof ready; } catch { throw new Error("handshake: not JSON"); }
  if (ready.e2ee !== "ready" || ready.v !== E2EE_VERSION || typeof ready.n !== "string" || typeof ready.box !== "string") throw new Error("handshake: not a ready");
  const n = fromB64u(ready.n);
  if (n.length !== 24) throw new Error("handshake: bad nonce");
  const hostEph = nacl.box.open(fromB64u(ready.box), n, hostPublicKey, eph.secretKey);
  if (!hostEph || hostEph.length !== 32) throw new Error("handshake: the answer is not from the paired host");
  return new Channel(nacl, nacl.box.before(hostEph, eph.secretKey), "phone");
}
