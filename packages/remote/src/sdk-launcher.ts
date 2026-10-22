// npm's Windows batch launcher needs cmd.exe; native .exe and SDK's bundled CLI stay direct.
import { spawn } from "node:child_process";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
export function batchCommand(command: string, args: string[]): string {
  // cmd expands these even inside quotes. Refuse rather than execute a different command.
  const words = [command, ...args];
  if (words.some(word => /[\r\n"%!^&|<>]/.test(word))) throw new Error("unsafe character in Windows Claude batch launcher arguments; use claude.exe instead");
  return words.map(word => `"${word}"`).join(" ");
}
export function launcherOptions(binary: string | undefined, platform = process.platform): Pick<Options, "spawnClaudeCodeProcess"> {
  if (platform !== "win32" || !binary || !/\.(cmd|bat)$/i.test(binary)) return {};
  return { spawnClaudeCodeProcess: options => spawn(batchCommand(options.command, options.args), {
    cwd: options.cwd, env: options.env, signal: options.signal, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  }) };
}
export const sdkQuery: typeof query = input => query({ ...input, options: { ...input.options, ...launcherOptions(input.options?.pathToClaudeCodeExecutable) } });
