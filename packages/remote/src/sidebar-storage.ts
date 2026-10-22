// Read Chromium Local Storage without opening LevelDB (opening it takes a lock and writes).
// Only the requested key escapes this boundary. SST blocks use LevelDB's raw Snappy format.
import fs from "node:fs";
import path from "node:path";

function varint(b: Buffer, cursor: { at: number }): number {
  let n = 0, scale = 1;
  for (let i = 0; i < 8; i++) {
    if (cursor.at >= b.length) throw new Error("Truncated LevelDB varint");
    const v = b[cursor.at++]!;
    n += (v & 127) * scale;
    if (!(v & 128)) return n;
    scale *= 128;
  }
  throw new Error("Invalid LevelDB varint");
}
function slice(b: Buffer, c: { at: number }): Buffer {
  const size = varint(b, c), end = c.at + size;
  if (end > b.length) throw new Error("Truncated LevelDB value");
  const value = b.subarray(c.at, end); c.at = end; return value;
}
function snappy(b: Buffer): Buffer {
  const c = { at: 0 }, size = varint(b, c);
  if (size > 16 * 1024 * 1024) throw new Error("Oversized LevelDB block");
  const out = Buffer.alloc(size);
  let at = 0;
  while (c.at < b.length) {
    const tag = b[c.at++]!, kind = tag & 3;
    let length = (tag >>> 2) + 1, offset = 0;
    if (kind === 0) {
      if (length >= 61) {
        const bytes = length - 60;
        if (c.at + bytes > b.length) throw new Error("Truncated Snappy literal");
        length = b.readUIntLE(c.at, bytes) + 1; c.at += bytes;
      }
      if (c.at + length > b.length || at + length > size) throw new Error("Invalid Snappy literal");
      b.copy(out, at, c.at, c.at + length); c.at += length;
    } else {
      const bytes = kind === 1 ? 1 : kind === 2 ? 2 : 4;
      if (c.at + bytes > b.length) throw new Error("Truncated Snappy copy");
      offset = b.readUIntLE(c.at, bytes); c.at += bytes;
      if (kind === 1) { offset += (tag & 224) << 3; length = 4 + ((tag >>> 2) & 7); }
      if (!offset || offset > at || at + length > size) throw new Error("Invalid Snappy copy");
      for (let i = 0; i < length; i++) out[at + i] = out[at + i - offset]!;
    }
    at += length;
  }
  if (at !== size) throw new Error("Incomplete Snappy block");
  return out;
}
function entries(b: Buffer, visit: (key: Buffer, value: Buffer) => void): void {
  if (b.length < 4) throw new Error("Invalid LevelDB block");
  const end = b.length - 4 - b.readUInt32LE(b.length - 4) * 4;
  let key = Buffer.alloc(0);
  const c = { at: 0 };
  while (c.at < end) {
    const shared = varint(b, c), suffix = varint(b, c), size = varint(b, c);
    if (shared > key.length || c.at + suffix + size > end) throw new Error("Invalid LevelDB entry");
    key = Buffer.concat([key.subarray(0, shared), b.subarray(c.at, c.at + suffix)]); c.at += suffix;
    const value = b.subarray(c.at, c.at + size); c.at += size;
    visit(key, value);
  }
}
function table(b: Buffer, visit: (key: Buffer, value: Buffer, sequence: bigint) => void): void {
  if (b.length < 48 || b.readBigUInt64LE(b.length - 8) !== 0xdb4775248b80fb57n) throw new Error("Invalid LevelDB table");
  const block = (handle: Buffer): Buffer => {
    const c = { at: 0 }, offset = varint(handle, c), size = varint(handle, c);
    if (offset + size + 5 > b.length) throw new Error("Truncated LevelDB block");
    const data = b.subarray(offset, offset + size), compression = b[offset + size];
    if (compression === 0) return data;
    if (compression === 1) return snappy(data);
    throw new Error("Unsupported LevelDB compression");
  };
  const footer = { at: b.length - 48 };
  varint(b, footer); varint(b, footer); // metaindex handle
  entries(block(b.subarray(footer.at)), (_key, handle) => entries(block(handle), (key, value) => {
    if (key.length < 8) throw new Error("Invalid LevelDB internal key");
    const tag = key.readBigUInt64LE(key.length - 8);
    visit(key.subarray(0, -8), (tag & 255n) === 0n ? Buffer.alloc(0) : value, tag >> 8n);
  }));
}
function wal(b: Buffer, visit: (key: Buffer, value: Buffer, sequence: bigint) => void): void {
  let chunks: Buffer[] = [];
  const batch = (data: Buffer) => {
    if (data.length < 12) throw new Error("Invalid LevelDB batch");
    const sequence = data.readBigUInt64LE(), count = data.readUInt32LE(8), c = { at: 12 };
    for (let i = 0; i < count; i++) {
      const type = data[c.at++];
      if (type !== 0 && type !== 1) throw new Error("Invalid LevelDB batch type");
      const key = slice(data, c), value = type === 1 ? slice(data, c) : Buffer.alloc(0);
      visit(key, value, sequence + BigInt(i));
    }
  };
  for (let at = 0; at + 7 <= b.length;) {
    const remaining = 32768 - (at % 32768);
    if (remaining < 7) { at += remaining; continue; }
    const size = b.readUInt16LE(at + 4), type = b[at + 6];
    if (!size && !type) { at += remaining; continue; }
    if (size + 7 > remaining) throw new Error("Invalid LevelDB WAL record");
    if (at + 7 + size > b.length) break; // An in-flight append is retried on the next poll.
    const data = b.subarray(at + 7, at + 7 + size); at += 7 + size;
    if (type === 1) { batch(data); chunks = []; }
    else if (type === 2) chunks = [data];
    else if (type === 3 && chunks.length) chunks.push(data);
    else if (type === 4 && chunks.length) { chunks.push(data); batch(Buffer.concat(chunks)); chunks = []; }
    else throw new Error("Invalid LevelDB WAL fragment");
  }
}

export class SidebarStorage {
  private files = new Map<string, { stamp: string; sequence: bigint; value: Buffer }>();
  private dir: string;
  constructor(dir: string) { this.dir = dir; }
  read(keyName: string): unknown {
    const wanted = Buffer.from(`_https://claude.ai\0\x01${keyName}`);
    let names: string[];
    try { names = fs.readdirSync(this.dir).filter(n => /^\d+\.(ldb|log)$/.test(n)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    for (const name of this.files.keys()) if (!names.includes(name)) this.files.delete(name);
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const stat = fs.lstatSync(file), stamp = `${stat.mtimeMs}:${stat.size}`;
        if (!stat.isFile() || this.files.get(name)?.stamp === stamp) continue;
        let sequence = -1n;
        let value: Buffer = Buffer.alloc(0);
        const visit = (key: Buffer, data: Buffer, seq: bigint) => { if (key.equals(wanted) && seq > sequence) { sequence = seq; value = data; } };
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { const data = fs.readFileSync(fd); name.endsWith(".log") ? wal(data, visit) : table(data, visit); }
        finally { fs.closeSync(fd); }
        this.files.set(name, { stamp, sequence, value });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const latest = [...this.files.values()].sort((a, b) => a.sequence > b.sequence ? -1 : a.sequence < b.sequence ? 1 : 0)[0];
    if (!latest || latest.sequence < 0n || !latest.value.length) return null;
    const encoding = latest.value[0];
    if (encoding !== 0 && encoding !== 1) throw new Error("Unsupported Chromium storage encoding");
    return JSON.parse(latest.value.subarray(1).toString(encoding === 0 ? "utf16le" : "latin1")) as unknown;
  }
}
