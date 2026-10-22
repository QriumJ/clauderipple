// Keeps the Mac awake while a turn runs, and only then (spec: "a power assertion only while a
// turn runs"). One `caffeinate -i -w <host pid>` child is held while any session is starting,
// running or waiting on a permission — a turn that waits for the phone must not let the Mac
// sleep under it, or the answer has nowhere to go. `-i` blocks idle sleep only (lid close and
// the user's own sleep stay theirs); `-w` ends the assertion by itself if the host dies.
import { spawn } from "node:child_process";

export interface Held {
  kill(): void;
  onExit(fn: () => void): void;
}
export type Spawner = (cmd: string, args: string[]) => Held;

export const nodeSpawner: Spawner = (cmd, args) => {
  const child = spawn(cmd, args, { stdio: "ignore", windowsHide: true });
  // A missing binary must not crash the host; the hold just does not happen.
  child.on("error", () => undefined);
  return {
    kill: () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); },
    onExit: (fn) => { child.once("exit", fn); child.once("error", fn); },
  };
};

export function keepAwakeCommand(platform: NodeJS.Platform, pid: number): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "/usr/bin/caffeinate", args: ["-i", "-w", String(pid)] };
  if (platform === "win32") return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command",
    `Add-Type -Namespace Ripple -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'; $hostProcess = Get-Process -Id ${pid} -ErrorAction Stop; try { [Ripple.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null; while (-not $hostProcess.HasExited) { Start-Sleep -Seconds 2 } } finally { [Ripple.Power]::SetThreadExecutionState([uint32]2147483648) | Out-Null }`] };
  return { cmd: "systemd-inhibit", args: ["--what=idle", "--mode=block", "--who=Ripple Remote", "--why=Remote session active", process.execPath, "-e", `const t=setInterval(()=>{try{process.kill(${pid},0)}catch{clearInterval(t)}},2000)`] };
}

export class PowerHold {
  private spawner: Spawner;
  private pid: number;
  private child: Held | null = null;
  private wanted = false;
  private respawn: ReturnType<typeof setTimeout> | null = null;
  private retryMs: number;
  private platform: NodeJS.Platform;

  constructor(opts: { spawner?: Spawner; pid?: number; retryMs?: number; platform?: NodeJS.Platform } = {}) {
    this.platform = opts.platform ?? process.platform;
    this.spawner = opts.spawner ?? nodeSpawner;
    this.pid = opts.pid ?? process.pid;
    this.retryMs = opts.retryMs ?? 5_000;
  }

  get holding(): boolean { return this.child !== null; }

  /** Call whenever session states change; spawns once on the first busy session, kills when none is. */
  update(busy: boolean): void {
    this.wanted = busy;
    if (busy && !this.child) this.hold();
    if (!busy) this.release();
  }

  release(): void {
    this.wanted = false;
    if (this.respawn) { clearTimeout(this.respawn); this.respawn = null; }
    const c = this.child;
    this.child = null;
    c?.kill();
  }

  private hold(): void {
    if (this.respawn) { clearTimeout(this.respawn); this.respawn = null; }
    const command = keepAwakeCommand(this.platform, this.pid);
    const c = this.spawner(command.cmd, command.args);
    this.child = c;
    c.onExit(() => {
      if (this.child !== c) return;
      // Killed by someone else while a turn still runs: take it again, but not in a tight loop.
      this.child = null;
      if (this.wanted && !this.respawn) this.respawn = setTimeout(() => { this.respawn = null; if (this.wanted && !this.child) this.hold(); }, this.retryMs);
    });
  }
}
