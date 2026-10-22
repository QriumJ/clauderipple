// New-session isolation. A "local" session runs in the folder you picked; a "worktree" session
// instead branches off in `git worktree`, so the person's checkout is never touched. Everything
// here is host-side and validated: a folder that is not a git repository is refused rather than
// guessed at. No code is copied from any reference implementation (CLAUDE.md).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GitInfo } from "./protocol.ts";

const run = promisify(execFile);

/** git with a bounded buffer and a fixed cwd; the caller decides what a non-zero exit means. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.toString();
}

async function isDirectory(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

/** The repository root containing `dir`, or null if it is not inside one. */
async function repoRoot(dir: string): Promise<string | null> {
  try { return (await git(dir, ["rev-parse", "--show-toplevel"])).trim() || null; }
  catch { return null; }
}

/** A folder's git situation, for the new-session isolation choice. Never throws. */
export async function gitInfo(dir: string): Promise<GitInfo> {
  const target = path.resolve(dir);
  if (!(await isDirectory(target))) return { isRepo: false, root: null, branch: null, branches: [] };
  const root = await repoRoot(target);
  if (!root) return { isRepo: false, root: null, branch: null, branches: [] };
  let branch: string | null = null, branches: string[] = [];
  try {
    const head = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    branch = head && head !== "HEAD" ? head : null;
  } catch { /* detached or empty repo: no current branch */ }
  try {
    branches = (await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]))
      .split("\n").map((line) => line.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  } catch { /* no branches yet */ }
  return { isRepo: true, root, branch, branches };
}

/** A branch/directory name from the task text: lower-case, alphanumeric runs joined by dashes. */
export function worktreeSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

export interface WorktreeOptions { cwd: string; text: string; baseBranch?: string; now?: () => number }
export interface WorktreeResult { dir: string; branch: string; base: string }

/**
 * Create a worktree under `<repo parent>/<repo>-worktrees/<slug>`, on a new branch named from the
 * slug, based on `baseBranch` (default: the current branch). Refuses a folder that is not inside a
 * git repository, an unknown base branch, or a target that already exists — the person's folder is
 * never modified in place.
 */
export async function createWorktree(opts: WorktreeOptions): Promise<WorktreeResult> {
  const cwd = path.resolve(opts.cwd);
  if (!(await isDirectory(cwd))) throw new Error(`not a folder: ${cwd}`);
  const root = await repoRoot(cwd);
  if (!root) throw new Error("Not a git repository; a new worktree needs one.");
  let base = opts.baseBranch?.trim() ?? "";
  if (!base) {
    const head = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (!head || head === "HEAD") throw new Error("The repository has no current branch to branch from.");
    base = head;
  }
  // The base comes from the phone and goes on git's command line: a leading dash would be an option.
  if (base.startsWith("-")) throw new Error(`Unknown base branch: ${base}`);
  try { await git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]); }
  catch { throw new Error(`Unknown base branch: ${base}`); }
  const slug = worktreeSlug(opts.text) || `session-${(opts.now ?? Date.now)()}`;
  const dir = path.join(path.dirname(root), `${path.basename(root)}-worktrees`, slug);
  if (await isDirectory(dir)) throw new Error(`A worktree already exists at ${dir}`);
  await fs.mkdir(path.dirname(dir), { recursive: true });
  try { await git(root, ["worktree", "add", "-b", slug, dir, base]); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not create the worktree: ${message.split("\n").find((line) => line.trim()) ?? message}`);
  }
  return { dir, branch: slug, base };
}
