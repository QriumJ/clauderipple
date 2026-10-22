import { spawn } from "node:child_process";

export interface HandoffRequest { sessionId: string; title: string; cwd: string }
export type HandoffRunner = (request: HandoffRequest) => Promise<string>;

/** macOS script supplies the TTY required by --desktop. CLI 2.1.296 rejects --name
 * with --desktop; the SDK's persisted title is read by the desktop registry instead. */
export function desktopHandoff(claudePath: string, timeoutMs = 30_000): HandoffRunner {
  return ({ sessionId, cwd }) => new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn("/usr/bin/script", ["-q", "/dev/null", claudePath, "--desktop", "--resume", sessionId], {
      cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", timedOut = false;
    const collect = (chunk: Buffer): void => { output = (output + chunk.toString()).slice(-4000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the PTY wrapper and its CLI, not just the wrapper.
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error); }
      }
    }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const detail = output.replace(/\s+/g, " ").trim();
      if (timedOut || code !== 0) reject(new Error(`${timedOut ? "timed out" : `exit ${code ?? signal}`} ${detail}`));
      else resolve(detail || "opened");
    });
  });
}
