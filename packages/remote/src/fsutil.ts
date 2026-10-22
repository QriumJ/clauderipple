import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeFileAtomic(file: string, data: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, data, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
  } finally {
    // A failed write must not leave a partial replacement beside the real state.
    rmSync(tmp, { force: true });
  }
}

export function readJson<T>(file: string): T | null {
  let data: string;
  try {
    data = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value: T | null = JSON.parse(data) as T | null;
  // null is reserved for a missing file, not a persisted empty state.
  if (value === null) throw new SyntaxError(`Null JSON state in ${file}`);
  return value;
}
