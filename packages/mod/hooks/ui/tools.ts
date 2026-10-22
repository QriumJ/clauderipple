// A subagent's tool calls as the Agents pane words them: one short line of each call's input, and a
// run of calls headed in one line the way the Claude app heads it ("명령어 7개 실행함, 파일 1개를
// 편집함"). Pure, so the tests can call it.
//
// The phone app's host words a run the same way (packages/remote/src/tool-details.ts
// `activitySummary`). The mod cannot import it: Claude Code loads the mod as its own folder
// (dist/mod in an npm install, scripts/build-npm.mjs), with no packages/remote beside it. So the
// rules are kept here too: kinds in the order they first appear, a file read or edited counted once,
// five or more kinds cut to the first three and the rest counted.

import { t } from '../i18n.ts'
import type { Lang } from '../i18n.ts'

/** Where the session runs and the user's home, to say paths short: relative to the one, `~` for the other. */
export type Place = { cwd?: string; home?: string }

/** One tool call as the pane holds it (view.ts AgentEntry's tool kind). */
export type ToolCall = { id: string; tool: string; detail: string; state: 'running' | 'ok' | 'error' }

type Activity = 'command' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'other'

export function activityOf(tool: string): Activity {
  if (['Bash', 'BashOutput', 'KillShell'].includes(tool)) return 'command'
  if (tool === 'Read') return 'read'
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) return 'edit'
  if (['Grep', 'Glob', 'LS'].includes(tool)) return 'search'
  if (['WebSearch', 'WebFetch'].includes(tool)) return 'web'
  if (['Task', 'Agent'].includes(tool)) return 'agent'
  return 'other'
}

/** A directory without its trailing slash; nothing for one that cannot shorten a path (`/`, `~`). */
function dir(path: string | undefined): string | undefined {
  const bare = path?.replace(/\/+$/, '')
  return bare && bare.startsWith('/') ? bare : undefined
}

/** A path relative to the session's folder, else under `~`, else as given. */
export function shortPath(path: string, place: Place): string {
  const cwd = dir(place.cwd)
  const home = dir(place.home)
  if (cwd) {
    if (path === cwd) return '.'
    if (path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  }
  if (home) {
    if (path === home) return '~'
    if (path.startsWith(home + '/')) return '~' + path.slice(home.length)
  }
  return path
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every absolute path in a command said short, as shortPath says one. */
function shortPaths(text: string, place: Place): string {
  let out = text
  const cwd = dir(place.cwd)
  const home = dir(place.home)
  if (cwd) out = out.replace(new RegExp(escape(cwd) + '(/|(?![\\w.-]))', 'g'), (_m, slash: string) => slash ? '' : '.')
  if (home) out = out.replace(new RegExp(escape(home) + '(?=/|(?![\\w.-]))', 'g'), '~')
  return out
}

/** A `cd <dir> &&` (or `;`, or a line of its own) at the head of a command: it says nothing about what it does. */
const CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;|\n)\s*/

/** A command as a line: without the `cd` it opens with, its first line only, its paths short. */
export function commandLine(command: string, place: Place = {}): string {
  let rest = command
  for (let i = 0; i < 3 && CD.test(rest); i++) rest = rest.replace(CD, '')
  const first = rest.split('\n').find(line => line.trim()) ?? ''
  return shortPaths(first.trim(), place)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)
}

function firstLine(value: string): string {
  return (value.split('\n').find(line => line.trim()) ?? '').trim()
}

/**
 * A tool call's input in one line: a command's own description when it gave one, else the command;
 * a file's path; a search's pattern (and where). Paths short, multi-line input its first line.
 */
export function toolDetail(tool: string, input: Readonly<Record<string, unknown>>, place: Place = {}): string {
  if (tool === 'Bash') {
    const description = firstLine(text(input.description))
    if (description) return description
    return commandLine(text(input.command), place)
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const where = text(input.path)
    return [firstLine(text(input.pattern)), where ? shortPath(where, place) : ''].filter(Boolean).join(' · ')
  }
  const path = text(input.file_path ?? input.notebook_path ?? input.path)
  if (path) return shortPath(firstLine(path), place)
  const detail = input.command ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt ?? ''
  return shortPaths(firstLine(text(detail)), place)
}

/** A run's head in one line, and how many of its calls failed. */
export function runSummary(run: readonly ToolCall[], lang: Lang): { text: string; failed: number } {
  const counts = new Map<Activity, number>()
  const files = new Set<string>()
  for (const call of run) {
    const kind = activityOf(call.tool)
    const file = (kind === 'read' || kind === 'edit') && call.detail ? kind + ':' + call.detail : ''
    if (!file || !files.has(file)) counts.set(kind, (counts.get(kind) ?? 0) + 1)
    if (file) files.add(file)
  }
  const word = (key: string, count: number) => t(lang, 'agents.act.' + key + (count === 1 ? 'One' : ''), { count })
  const parts = [...counts]
  const shown = parts.length >= 5 ? parts.slice(0, 3) : parts
  const rest = parts.slice(shown.length).reduce((sum, [, n]) => sum + n, 0)
  return {
    text: [...shown.map(([kind, n]) => word(kind, n)), ...(rest ? [word('more', rest)] : [])].join(', '),
    failed: run.filter(call => call.state === 'error').length,
  }
}
