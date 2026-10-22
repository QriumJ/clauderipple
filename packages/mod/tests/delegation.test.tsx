// Base's delegation (docs/specs/2026-10-12-worker-tiers.md "Screens"): while no mode is on, the
// eager note is Base's; a mode that is on uses its own delegation instead.
import { expect, test } from 'claude-code/testing'
import { DEFAULTS, normalizeSettings } from '../hooks/settings'
import { eagerNote, modeNote } from '../hooks/modes'
import type { Mode, Settings } from '../types'

const BASE_NOTE = 'ClaudeRipple: delegate everything except judgment and final review to ripple:auto.'

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...normalizeSettings(null), ...patch }
}

const MODES: Mode[] = [
  { id: 'calm', name: 'Calm', rungs: {}, delegation: 'normal', until: 'none' },
  { id: 'burn', name: 'Burn', rungs: {}, delegation: 'eager', until: 'none' },
]

test('Base eager notes the main chat once, then not again until a compaction clears it', () => {
  const s = settings({ delegation: 'eager' })
  expect(eagerNote(s, null)).toEqual({ note: BASE_NOTE, noted: 'base' })
  expect(eagerNote(s, 'base')).toEqual({ noted: 'base' })
  // The compaction clears `noted` (register.tsx), so the first prompt after it carries the note again.
  expect(eagerNote(s, null).note).toBe(BASE_NOTE)
})

test('Base normal says nothing and clears what was noted, so eager again sends it afresh', () => {
  const s = settings({ delegation: 'normal' })
  expect(eagerNote(s, null)).toEqual({ noted: null })
  expect(eagerNote(s, 'base')).toEqual({ noted: null })
})

test("a mode's delegation wins over Base, either way", () => {
  // A normal mode on an eager Base: no note, and the earlier Base note is cleared.
  const calmOnEagerBase = normalizeSettings({ delegation: 'eager', modes: MODES, activeMode: 'calm', activeSince: 5 })
  expect(eagerNote(calmOnEagerBase, 'base')).toEqual({ noted: null })
  // An eager mode on a normal Base: the mode's note, once per turning-on.
  const burnOnNormalBase = normalizeSettings({ delegation: 'normal', modes: MODES, activeMode: 'burn', activeSince: 5 })
  const first = eagerNote(burnOnNormalBase, null)
  expect(first).toEqual({ note: modeNote('Burn'), noted: 'burn@5' })
  expect(eagerNote(burnOnNormalBase, first.noted)).toEqual({ noted: 'burn@5' })
})

test('normalizeSettings keeps a stored delegation and defaults anything else to normal', () => {
  expect(DEFAULTS.delegation).toBe('normal')
  expect(normalizeSettings(null).delegation).toBe('normal')
  expect(normalizeSettings({ delegation: 'loud' }).delegation).toBe('normal')
  expect(normalizeSettings({ delegation: 'eager' }).delegation).toBe('eager')
  expect(normalizeSettings(normalizeSettings({ delegation: 'eager' })).delegation).toBe('eager')
})
