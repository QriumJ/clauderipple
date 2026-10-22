// 리플이 (Ripple), the mod's mascot: a hollow ripple ring with a face, a wave crest on top and two
// ripple ears, alive wherever it is drawn. Every shape is the approved sheet "리플이 v2 (물마루)"
// (design-drafts/ripple-char-v2.html and brand/, 2026-10-11) on its 56-unit grid; the motion is ours.
//
// What the host allows, and so what this draws (see parts.tsx):
// - A plain Svg image (never isInteractive) keeps its CSS motion and does not blink when the desktop
//   redraws (seen in the owner's app, 2026-10-11). But each redraw is a new image, so the motion
//   starts over: every loop opens on a natural pose (the rest pose, or a part that is hidden at
//   rest, like a ripple about to spread), and the big moments (a look, a hop, a yawn) come seconds
//   in, so the first second after a redraw is quiet and reads as going on.
// - A face is one fixed string per state; only the gauge varies, in 5% steps, so a figure that
//   creeps does not make a new picture every redraw.
// - Idle life is several loops of unrelated lengths (blinks on 7, 11 and 13 s, a look on 13, a hop
//   on 17), so the sum never looks mechanical. One loop per element: blinks nest a group each.
// - Under prefers-reduced-motion nothing moves: the markup alone is the rest pose. No filters, no
//   external references, no script.
// - Two details: `full` (34 px up) is the colour sheet, the face in ink; `mini` (below, the band's
//   20 px) is the mono template the sheet gives for small sizes, every part in the tone, heavier
//   lines, no mouth or brows, its moves a little larger so they read.
// - Colours are the palette variables svgDoc sets (theme.ts), so light and dark differ by tokens.
//
// Pure: no imports at run time, so node tests can load it.

import type { Palette } from './theme'

export type Face =
  | 'calm' | 'thinking' | 'working' | 'drowsy' | 'sleepy' | 'uneasy' | 'strained' | 'alarmed'
  | 'dazed' | 'asking' | 'squeezing' | 'going' | 'pleased' | 'sorry'
export type FaceTone = 'accent' | 'ok' | 'warn' | 'bad'
export type Detail = 'full' | 'mini'

export const FACES: readonly Face[] = ['calm', 'thinking', 'working', 'drowsy', 'sleepy', 'uneasy', 'strained', 'alarmed', 'dazed', 'asking', 'squeezing', 'going', 'pleased', 'sorry']

/** The grid every face is drawn on: the SVG's viewBox is `0 0 56 56` at any size. */
export const GRID = 56

/** From this size up the full drawing (the sheet's 34 px badge floor); below it, the mini one. */
export const MIN_SIZE = 34

export function detailOf(size: number): Detail {
  return size < MIN_SIZE ? 'mini' : 'full'
}

export const FACE_TONE: Record<Face, FaceTone> = {
  calm: 'accent',
  thinking: 'accent',
  working: 'accent',
  drowsy: 'accent',
  sleepy: 'accent',
  uneasy: 'warn',
  strained: 'warn',
  alarmed: 'bad',
  dazed: 'bad',
  asking: 'accent',
  squeezing: 'accent',
  going: 'accent',
  pleased: 'ok',
  sorry: 'bad',
}

/** The faces whose ring is a gauge when given a value; their strain grows with it. */
export const GAUGE_FACES: readonly Face[] = ['uneasy', 'strained', 'alarmed']

/** A gauge value as drawn: whole multiples of 5 from 0 to 100. */
export function gaugeStep(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent / 5) * 5))
}

const v = (key: keyof Palette): string => 'var(--' + key + ')'
const n = (x: number): string => String(Math.round(x * 100) / 100)

// ---- Parts ---------------------------------------------------------------------------------------

/** The crest's variants: its base sits on the outer edge of the ring at −100°…−64°, buried in it. */
const CREST = {
  up: 'M24.7 12.29C24.2 6.2 29.2 2.4 35 2.6C39.6 2.8 42.6 6.2 41.6 9.8C40.6 8 38.6 7 36.8 7.6C35 8.2 35 11 36.33 13.92Z',
  tall: 'M24.7 12.29C24.4 5.6 28.6 0.8 34.2 0.6C37.6 0.5 40.2 2.2 40.8 4.6C39.2 3.8 37.2 4 36.2 5.4C35 7.2 35.2 10.6 36.33 13.92Z',
  short: 'M24.7 12.29C25 8.4 28.4 6.4 32 6.6C34.8 6.8 36.8 8.4 36.8 10.2C36 9.6 35.2 9.8 34.9 10.6C34.7 11.6 35.4 12.8 36.33 13.92Z',
  wind: 'M24.7 12.29C25.6 6.4 31.6 3.6 38 4C42 4.2 44.6 6 45.2 8.4C43.4 7.4 40.8 7.4 38.8 8.4C37.2 9.4 36 11.6 36.33 13.92Z',
  wilt: 'M24.7 12.29C25.4 6 31.4 3.8 36.6 4.6C41.6 5.4 44.4 9.6 43.6 14.6C42.4 12 40.2 10.6 38.2 11C37.2 11.4 36.6 12.6 36.33 13.92Z',
  left: 'M31.3 12.29C31.8 6.2 26.8 2.4 21 2.6C16.4 2.8 13.4 6.2 14.4 9.8C15.4 8 17.4 7 19.2 7.6C21 8.2 21 11 19.67 13.92Z',
} as const

/** The question's tail: two points on the ring's outer edge meeting at (8.6, 53.4). */
const TAIL = 'M18.5 47.45Q15.4 51.2 8.6 53.4Q11.8 48.2 13.03 42.7Z'

const RING = '<circle cx="28" cy="31" r="16.5" fill="none"'
/** The ears: the sheet's colour arcs (r 23.5, 2.4) and the mono template's (r 24.5, 4). */
const EARS: Record<Detail, { r: string; l: string; width: number }> = {
  full: { r: 'M49.47 21.44A23.5 23.5 0 0 1 49.47 40.56', l: 'M6.53 40.56A23.5 23.5 0 0 1 6.53 21.44', width: 2.4 },
  mini: { r: 'M50.02 20.26A24.5 24.5 0 0 1 50.02 41.74', l: 'M5.98 41.74A24.5 24.5 0 0 1 5.98 20.26', width: 4 },
}
const OUTER_R = 'M53.86 23.59A26.9 26.9 0 0 1 53.86 38.41'
const OUTER_L = 'M2.14 38.41A26.9 26.9 0 0 1 2.14 23.59'

/** What one drawing paints with: the tone, and the face's ink (the tone too on the mini). */
type Pen = { mini: boolean; tone: string; ink: string; muted: string; ring: number }

function penOf(face: Face, detail: Detail): Pen {
  const tone = v(FACE_TONE[face])
  const mini = detail === 'mini'
  return { mini, tone, ink: mini ? tone : v('ink'), muted: mini ? tone : v('muted'), ring: mini ? 6.4 : 5 }
}

function stroke(d: string, paint: string, width: number, extra = ''): string {
  return '<path d="' + d + '" fill="none" stroke="' + paint + '" stroke-width="' + n(width) + '" stroke-linecap="round"' + extra + '/>'
}

/** A line of the face: ink, round caps and joins; heavier on the mini. */
function line(p: Pen, d: string, width = 2.2): string {
  return stroke(d, p.ink, p.mini ? Math.max(3.2, width * 1.45) : width, ' stroke-linejoin="round"')
}

/** The capsule eyes, the left one at `x, y`, `h` tall; the mini's are the template's 5 wide, half again as tall. */
function capsules(p: Pen, x: number, y: number, h: number): string {
  const w = p.mini ? 5 : 3.6
  const hh = p.mini ? h * 1.5 : h
  const top = y + h / 2 - hh / 2
  return [x, x + 11.2].map(left => '<rect x="' + n(left + 1.8 - w / 2) + '" y="' + n(top) + '" width="' + n(w) + '" height="' + n(hh) + '" rx="' + n(w / 2) + '" fill="' + p.ink + '"/>').join('')
}

/** A water drop (sweat, tear) at its top point, scaled; muted, larger on the mini. */
function drop(p: Pen, x: number, y: number, scale: number): string {
  const s = p.mini ? scale * 1.5 : scale
  const r = 2.3 * s
  return (
    '<path d="M' + n(x) + ' ' + n(y) + 'q' + n(-r) + ' ' + n(3.1 * s) + ' ' + n(-r) + ' ' + n(4.5 * s) + 'a' + n(r) + ' ' + n(r) + ' 0 0 0 ' + n(2 * r) +
    ' 0q0 ' + n(-1.4 * s) + ' ' + n(-r) + ' ' + n(-4.5 * s) + 'z" fill="' + p.muted + '"/>'
  )
}

type Ears = 'on' | 'dim' | 'double' | 'none' | 'left' | 'waving'

/** The ears, each in a group of its own so one can wave. */
function ears(p: Pen, kind: Ears): string {
  const e = EARS[p.mini ? 'mini' : 'full']
  const ear = (d: string, opacity?: number) => stroke(d, p.tone, e.width, opacity === undefined ? '' : ' stroke-opacity="' + opacity + '"')
  const L = (opacity?: number) => '<g class="earL">' + ear(e.l, opacity) + '</g>'
  const R = (opacity?: number) => '<g class="earR">' + ear(e.r, opacity) + '</g>'
  switch (kind) {
    case 'none':
      return ''
    case 'left':
      return L(0.55)
    case 'dim':
      return L(0.4) + R(0.4)
    case 'waving':
      return L(0.4) + R()
    case 'on':
      return L() + R()
    case 'double':
      // The mini has no room past the ears: its alarm is the pulse alone.
      return L() + R() + (p.mini ? '' : stroke(OUTER_R, p.tone, 2, ' stroke-opacity="0.55"') + stroke(OUTER_L, p.tone, 2, ' stroke-opacity="0.55"'))
  }
}

/** Copies of the ears that spread outward like water, unseen at rest. */
function waves(p: Pen, sides: 'both' | 'right'): string {
  const e = EARS[p.mini ? 'mini' : 'full']
  const wave = (cls: string, d: string) => stroke(d, p.tone, e.width * 0.8, ' class="' + cls + '" opacity="0"')
  return (sides === 'both' ? wave('wL', e.l) : '') + wave('wR', e.r)
}

/** The ring as a gauge: a faint track and the value from twelve o'clock, clockwise. */
function gauge(p: Pen, percent: number): string {
  const step = gaugeStep(percent)
  const track = RING + ' stroke="' + v('faint') + '" stroke-width="' + p.ring + '"/>'
  if (step === 0) return track
  if (step === 100) return RING + ' stroke="' + p.tone + '" stroke-width="' + p.ring + '"/>'
  const a = ((-90 + 3.6 * step) * Math.PI) / 180
  const x = 28 + 16.5 * Math.cos(a)
  const y = 31 + 16.5 * Math.sin(a)
  return track + stroke('M28 14.5A16.5 16.5 0 ' + (step > 50 ? 1 : 0) + ' 1 ' + n(x) + ' ' + n(y), p.tone, p.ring)
}

/** The ring in progress: eight dashes, the first under the crest. It turns by whole dashes. */
function dashed(p: Pen): string {
  return '<g class="spin">' + RING + ' stroke="' + p.tone + '" stroke-width="' + p.ring + '" stroke-dasharray="9.2 3.76" transform="rotate(-99 28 31)"/></g>'
}

/** Ripples that spread from the ring while it thinks, unseen at rest. */
function rings(p: Pen): string {
  return ['r1', 'r2'].map(cls => '<circle class="' + cls + '" cx="28" cy="31" r="19" fill="none" stroke="' + p.tone + '" stroke-width="' + (p.mini ? 2.6 : 1.6) + '" opacity="0"/>').join('')
}

/** A thought's bubbles rising to the upper right, small to large. */
function bubbles(p: Pen): string {
  const w = p.mini ? 2.4 : 1.5
  return [[43.6, 14.2, 1.3], [47.6, 9.2, 1.9], [51.6, 3.9, 2.6]]
    .map(([x, y, r], i) => '<circle class="bub bub' + (i + 1) + '" cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="' + p.tone + '" stroke-width="' + w + '"/>')
    .join('')
}

function zs(p: Pen): string {
  if (p.mini) return '<path class="z1" d="M42.6 2.6h6.4l-6.4 6.8h6.4" fill="none" stroke="' + p.muted + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
  return (
    '<path class="z1" d="M44.4 4.6h4l-4 4.4h4" fill="none" stroke="' + p.muted + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path class="z2" d="M50 10.6h2.8l-2.8 3h2.8" fill="none" stroke="' + p.muted + '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>'
  )
}

// ---- Faces ---------------------------------------------------------------------------------------

type Spec = {
  crest: keyof typeof CREST
  ring: 'solid' | 'gauge' | 'dashed' | 'broken'
  ears: Ears
  /** The eyes, in nested groups of their own so they can blink on several loops. */
  eyes: (p: Pen) => string
  /** Where the eyes' middle is, for their blink. */
  eyesY: number
  /** Brows: the full drawing only. */
  brows?: string
  /** The mouth, in a group of its own: the full drawing only. */
  mouth?: string
  /** The mouth that opens in a yawn, unseen at rest. */
  yawn?: boolean
  /** Muted props (z, sweat, tear), drawn last. */
  prop?: (p: Pen) => string
  /** Crest and ring at this opacity, in one group so their overlap does not darken. */
  faded?: number
  tail?: boolean
  /** Ripples spreading from the ears. */
  waves?: 'both' | 'right'
  /** Under the body: ripples from the ring, the done halo. */
  behind?: (p: Pen) => string
  /** Outside the figure, so a tilt does not carry it: the asking bubbles. */
  outside?: (p: Pen) => string
}

const ink = (d: string, width = 2.2) => stroke(d, v('ink'), width, ' stroke-linejoin="round"')

const SPECS: Record<Face, Spec> = {
  calm: { crest: 'up', ring: 'solid', ears: 'on', waves: 'both', eyes: p => capsules(p, 20.6, 26.2, 5.6), eyesY: 29, mouth: ink('M24.8 36.2q3.2 2.6 6.4 0') },
  // Eyes up and to the right, a lopsided "hmm"; ripples spread while it weighs.
  thinking: {
    crest: 'up',
    ring: 'solid',
    ears: 'dim',
    eyes: p => capsules(p, 21.4, 24.4, 5.2),
    eyesY: 27,
    mouth: ink('M26.2 37.6q2.2 .7 4.4 -.5'),
    behind: rings,
  },
  // Focused: eyes a little low, the mouth set, the ring turning.
  working: { crest: 'up', ring: 'dashed', ears: 'dim', waves: 'both', eyes: p => capsules(p, 20.6, 27, 5), eyesY: 29.5, mouth: ink('M26 37.2h4') },
  // Heavy lids over half eyes; nods off and catches itself, now and then a yawn.
  drowsy: {
    crest: 'up',
    ring: 'solid',
    ears: 'dim',
    faded: 0.75,
    eyes: p => (p.mini ? capsules(p, 20.6, 29, 3) : capsules(p, 20.6, 29, 2.8) + line(p, 'M19.9 28.4h5', 1.8) + line(p, 'M31.1 28.4h5', 1.8)),
    eyesY: 30.2,
    mouth: ink('M26.6 37.2q1.4 1 2.8 0'),
    yawn: true,
  },
  sleepy: {
    crest: 'short',
    ring: 'solid',
    ears: 'none',
    faded: 0.45,
    eyes: p => line(p, 'M20 29q2.4 2.2 4.8 0') + line(p, 'M31.2 29q2.4 2.2 4.8 0'),
    eyesY: 30.1,
    mouth: ink('M26.6 37.2q1.4 1 2.8 0'),
    yawn: true,
    prop: zs,
  },
  uneasy: {
    crest: 'up',
    ring: 'gauge',
    ears: 'dim',
    eyes: p => capsules(p, 20.6, 26.9, 5),
    eyesY: 29.4,
    brows: ink('M19.4 24.4L25 22.4', 2) + ink('M36.6 24.4L31 22.4', 2),
    mouth: ink('M22.9 37.2q1.275 -1.7 2.55 0t2.55 0t2.55 0t2.55 0'),
    prop: p => '<g class="sweat">' + drop(p, 46.6, 13.8, 1) + '</g>',
  },
  strained: {
    crest: 'tall',
    ring: 'gauge',
    ears: 'on',
    eyes: p => capsules(p, 20.6, 27.6, 4.4),
    eyesY: 29.8,
    brows: ink('M19.6 23.6h5.4', 2) + ink('M31 23.6h5.4', 2),
    mouth: ink('M24.9 37.4h6.2'),
    prop: p => '<g class="sweat">' + drop(p, 46.6, 13.8, 1) + '</g>',
  },
  alarmed: {
    crest: 'tall',
    ring: 'gauge',
    ears: 'double',
    eyes: p => (p.mini ? capsules(p, 20.6, 25.2, 7.6) : '<circle cx="22.4" cy="29" r="3.3" fill="' + p.ink + '"/><circle cx="33.6" cy="29" r="3.3" fill="' + p.ink + '"/>'),
    eyesY: 29,
    brows: ink('M18.8 22.4q3.2 -2.2 6.6 -0.8', 2) + ink('M37.2 22.4q-3.2 -2.2 -6.6 -0.8', 2),
    mouth: '<ellipse cx="28" cy="37.8" rx="2.6" ry="3.1" fill="' + v('ink') + '"/>',
    prop: p => '<g class="sweat">' + drop(p, 46.6, 13.8, 1) + '</g><g class="sweat2">' + drop(p, 10.4, 15.2, 0.8) + '</g>',
  },
  dazed: {
    crest: 'short',
    ring: 'broken',
    ears: 'left',
    eyes: p => '<g class="e1">' + line(p, 'M20.2 26.8l4.4 4.4m0 -4.4l-4.4 4.4') + '</g><g class="e2">' + line(p, 'M31.4 26.8l4.4 4.4m0 -4.4l-4.4 4.4') + '</g>',
    eyesY: 29,
    mouth: ink('M23.6 37.8l2.2 -1.8l2.2 1.8l2.2 -1.8l2.2 1.8'),
  },
  asking: {
    crest: 'left',
    ring: 'solid',
    ears: 'dim',
    tail: true,
    eyes: p => capsules(p, 21.4, 25, 5.6),
    eyesY: 27.8,
    brows: ink('M30.4 22.2q2.6 -1.8 5.4 -0.6', 2),
    mouth: '<ellipse cx="28" cy="37.2" rx="1.7" ry="2" fill="' + v('ink') + '"/>',
    outside: bubbles,
  },
  squeezing: {
    crest: 'up',
    ring: 'dashed',
    ears: 'dim',
    eyes: p => line(p, 'M20.4 26.6l3.4 2.4l-3.4 2.4') + line(p, 'M35.6 26.6l-3.4 2.4l3.4 2.4'),
    eyesY: 29,
    mouth: ink('M25.6 37.4h4.8'),
  },
  // Off it goes: the right ear waves, a ripple leaves from it.
  going: { crest: 'wind', ring: 'dashed', ears: 'waving', waves: 'right', eyes: p => capsules(p, 22.2, 26.2, 5.6), eyesY: 29, mouth: ink('M26.6 37.2q1.4 1 2.8 0') },
  pleased: {
    crest: 'up',
    ring: 'solid',
    ears: 'on',
    waves: 'both',
    eyes: p => line(p, 'M20 30q2.4 -3.4 4.8 0') + line(p, 'M31.2 30q2.4 -3.4 4.8 0'),
    eyesY: 28.3,
    mouth: '<path d="M23.8 35.4h8.4a4.2 4.2 0 0 1 -8.4 0z" fill="' + v('ink') + '"/>',
    // The done ripple: unseen at rest, spreads once from the ring.
    behind: p => '<circle class="halo" cx="28" cy="31" r="19" fill="none" stroke="' + p.tone + '" stroke-width="' + (p.mini ? 2.6 : 1.6) + '" opacity="0"/>',
  },
  sorry: {
    crest: 'wilt',
    ring: 'solid',
    ears: 'none',
    eyes: p => capsules(p, 20.6, 27.6, 4.4),
    eyesY: 29.8,
    brows: ink('M19.2 24.8L24.6 22.2', 2) + ink('M36.8 24.8L31.4 22.2', 2),
    mouth: ink('M24.8 38.4q3.2 -2.6 6.4 0'),
    prop: p => '<g class="tear">' + drop(p, 36.4, 33.2, 0.8) + '</g>',
  },
}

function ringOf(p: Pen, s: Spec, percent?: number): string {
  if (s.ring === 'broken') {
    // Broken at 22°…54°; the shard (28°…46°) knocked 6.2 out along 38° and turned 18°.
    return (
      stroke('M37.7 44.35A16.5 16.5 0 1 1 43.3 37.18', p.tone, p.ring) +
      '<g class="shard">' + stroke('M42.57 38.75A16.5 16.5 0 0 1 39.46 42.87', p.tone, p.ring, ' transform="translate(4.89 3.82) rotate(18 41.18 40.93)"') + '</g>'
    )
  }
  if (s.ring === 'dashed') return dashed(p)
  if (s.ring === 'gauge' && percent !== undefined) return gauge(p, percent)
  return RING + ' stroke="' + p.tone + '" stroke-width="' + p.ring + '"/>'
}

/**
 * The face's markup on the 56 grid, in the drawing order of the sheet: crest, tail, ring, ears,
 * eyes, face, props. `percent` draws the ring of uneasy, strained and alarmed as a gauge. The
 * groups are what the motion moves: `.fig` the whole figure (hops, tilts), `.pose` its shape
 * (breath, squash, wobble), `.face` the look, `.b1`…`.b3` the blinks.
 */
export function rippleBody(face: Face, percent?: number, detail: Detail = 'full'): string {
  const s = SPECS[face]
  const p = penOf(face, detail)
  const crest = '<g class="crest"><g class="crest2"><path d="' + CREST[s.crest] + '" fill="' + p.tone + '"/></g></g>' + (s.tail ? '<path d="' + TAIL + '" fill="' + p.tone + '"/>' : '')
  const ring = ringOf(p, s, percent)
  const body = s.faded ? '<g opacity="' + s.faded + '">' + crest + ring + '</g>' : crest + ring
  const eyes = '<g class="eyes"><g class="b1"><g class="b2"><g class="b3">' + s.eyes(p) + '</g></g></g></g>'
  const mouth = p.mini
    ? ''
    : (s.brows ?? '') + (s.mouth ? '<g class="mouth">' + s.mouth + '</g>' : '') +
      (s.yawn ? '<ellipse class="yawn" cx="28" cy="37.8" rx="2.4" ry="3" fill="' + v('ink') + '" opacity="0"/>' : '')
  return (
    '<g class="fig"><g class="pose">' + (s.behind ? s.behind(p) : '') + body +
    '<g class="ears">' + ears(p, s.ears) + '</g>' + (s.waves ? waves(p, s.waves) : '') +
    '<g class="face">' + eyes + mouth + '</g>' +
    (s.prop ? '<g class="prop">' + s.prop(p) + '</g>' : '') + '</g></g>' +
    (s.outside ? s.outside(p) : '')
  )
}

// ---- Motion --------------------------------------------------------------------------------------

/** One animation: what it moves, its keyframes, how long, and whether it waits or plays once. */
type Loop = { at: string; name: string; frames: string; seconds: number; timing?: 'linear' | 'ease-out'; delay?: number; once?: boolean }

const loop = (at: string, name: string, frames: string, seconds: number, more: Omit<Loop, 'at' | 'name' | 'frames' | 'seconds'> = {}): Loop => ({ at, name, frames, seconds, ...more })

/**
 * The keyframes, `k` the scale of their travel (larger on the mini, where a unit is a third of a
 * pixel). Each opens on `0%` at the rest pose or with its part hidden, and each but the turns
 * (`spin`, `dizzy`: a dash, or an × a quarter round, draws the same) ends where it began.
 */
function frames(k: number) {
  const px = (x: number) => n(x * k) + 'px'
  const tx = (x: number) => 'translateX(' + px(x) + ')'
  const ty = (y: number) => 'translateY(' + px(y) + ')'
  return {
    breathe: '0%,100%{transform:none}50%{transform:scale(1.012,1.028)}',
    // Three blinks on loops of 7, 11 and 13 s: they fall at 2.2, 5.9, 7.6, 9.2, 16.2, 18.7…
    blinkA: '0%,100%{transform:none}29%,33%{transform:none}31%{transform:scaleY(.1)}',
    blinkB: '0%,100%{transform:none}68%,70.6%{transform:none}69.3%{transform:scaleY(.1)}',
    blinkC: '0%,100%{transform:none}44%,46.2%{transform:none}45.1%{transform:scaleY(.1)}',
    sway: '0%,100%{transform:none}30%{transform:rotate(-5deg)}70%{transform:rotate(3deg)}',
    look: '0%,100%{transform:none}38%{transform:none}43%,53%{transform:' + tx(-1.6) + '}58%,72%{transform:none}77%,86%{transform:' + tx(1.6) + '}91%{transform:none}',
    // A crouch, a small hop (kept under the top edge), a squash on landing.
    hop: '0%,100%{transform:none}60%{transform:none}62%{transform:scale(1.03,.96)}64.5%{transform:translateY(-2px)}67%{transform:scale(1.03,.97)}69%{transform:none}',
    wave: '0%,100%{opacity:0;transform:none}8%{opacity:.6}60%{opacity:0;transform:scale(1.14)}',
    ripple: '0%,100%{opacity:0;transform:none}10%{opacity:.5}75%{opacity:0;transform:scale(1.34)}',
    twirl: '0%,100%{transform:none}20%{transform:rotate(-14deg)}45%{transform:rotate(6deg)}70%{transform:rotate(-8deg)}',
    ponder: '0%,100%{transform:none}40%,60%{transform:translate(' + px(1) + ',' + px(-0.6) + ')}',
    spin: '0%{transform:none}100%{transform:rotate(45deg)}',
    busy: '0%,100%{transform:none}50%{transform:' + ty(-0.8) + '}',
    nod: '0%,100%{transform:none}45%{transform:none}62%{transform:' + ty(1.2) + ' rotate(3deg)}70%{transform:' + ty(1.5) + ' rotate(3.5deg)}74%{transform:' + ty(-0.3) + '}78%{transform:none}',
    scan: '0%,100%{transform:none}20%,40%{transform:' + tx(-1.2) + '}60%,80%{transform:' + tx(1.2) + '}',
    bob: '0%,100%{transform:none}50%{transform:rotate(-6deg)}',
    heavy: '0%,100%{transform:none}18%{transform:none}26%,38%{transform:scaleY(.12)}44%{transform:none}',
    yawn: '0%,100%{opacity:0;transform:scale(.3)}66%{opacity:0;transform:scale(.3)}74%,84%{opacity:1;transform:none}90%{opacity:0;transform:scale(.3)}',
    gape: '0%,100%{opacity:1}66%{opacity:1}70%,86%{opacity:0}90%{opacity:1}',
    stretch: '0%,100%{transform:none}66%{transform:none}76%,84%{transform:scale(.98,1.04)}90%{transform:none}',
    snore: '0%,100%{transform:none}50%{transform:scale(1.02,1.04)}',
    zrise: '0%,100%{opacity:1;transform:none}70%{opacity:0;transform:translate(' + px(2) + ',' + px(-3) + ')}71%{opacity:0;transform:none}',
    fret: '0%,100%{transform:none}30%{transform:' + tx(-0.8) + '}70%{transform:' + tx(0.8) + '}',
    drip: '0%,100%{opacity:1;transform:none}55%{opacity:0;transform:' + ty(3) + '}56%{opacity:0;transform:none}',
    quiver: '0%,100%{transform:none}15%{transform:rotate(3deg)}30%{transform:rotate(-3deg)}45%{transform:none}',
    pulse: '0%,100%{opacity:1}50%{opacity:.3}',
    jolt: '0%,100%{transform:none}10%{transform:' + ty(-1) + '}22%{transform:none}',
    dizzy: '0%{transform:none}100%{transform:rotate(360deg)}',
    orbit: '0%,100%{transform:none}25%{transform:translate(' + px(0.8) + ',' + px(-0.4) + ') rotate(2deg)}50%{transform:' + ty(-0.7) + '}75%{transform:translate(' + px(-0.8) + ',' + px(-0.4) + ') rotate(-2deg)}',
    shard: '0%,100%{transform:none}50%{transform:translate(' + px(1.2) + ',' + px(1.6) + ') rotate(10deg)}',
    tilt: '0%,100%{transform:none}14%,70%{transform:rotate(-7deg)}86%{transform:none}',
    pop: '0%,100%{opacity:0;transform:scale(.2)}20%{opacity:1;transform:scale(1.15)}26%,72%{opacity:1;transform:none}84%{opacity:0;transform:none}',
    squash: '0%,100%{transform:none}30%{transform:scale(1.08,.9)}62%{transform:scale(.95,1.06)}82%{transform:none}',
    squeeze: '0%,100%{transform:none}30%{transform:scale(.93)}62%{transform:scale(1.04)}',
    wag: '0%,100%{transform:none}12%{transform:rotate(-28deg)}26%{transform:rotate(10deg)}40%{transform:rotate(-24deg)}54%{transform:none}',
    leave: '0%,100%{opacity:0;transform:none}10%{opacity:.7}55%{opacity:0;transform:' + tx(6) + '}',
    flutter: '0%,100%{transform:none}50%{transform:rotate(-4deg)}',
    lean: '0%,100%{transform:none}50%{transform:' + tx(0.8) + '}',
    // Done: a crouch, a jump (under the top edge), a squash, a little rebound, still.
    bounce: '0%{transform:none}16%{transform:scale(1.05,.93)}40%{transform:translateY(-2.2px)}62%{transform:scale(1.04,.96)}80%{transform:translateY(-.8px)}100%{transform:none}',
    halo: '0%,100%{opacity:0;transform:none}12%{opacity:.55}90%{opacity:0;transform:scale(1.42)}',
    sink: '0%,100%{transform:none}50%{transform:' + ty(1) + '}',
    droop: '0%,100%{transform:none}50%{transform:rotate(5deg)}',
    tear: '0%,100%{opacity:1;transform:none}55%{opacity:0;transform:' + ty(2.6) + '}56%{opacity:0;transform:none}',
  }
}

type Frames = ReturnType<typeof frames>

/** The idle life: breath, three blinks, the crest's sway, a look either way, a hop, the ears' ripples. */
function idle(f: Frames, delay = 0, blink = true): Loop[] {
  const d = delay ? { delay } : {}
  return [
    loop('.pose', 'breathe', f.breathe, 4.2, d),
    loop('.crest', 'sway', f.sway, 5.4, d),
    loop('.face', 'look', f.look, 13, d),
    loop('.fig', 'hop', f.hop, 17, d),
    loop('.wL,.wR', 'wave', f.wave, 3.6, { delay: delay + 0.6 }),
    ...(blink ? [loop('.b1', 'blinkA', f.blinkA, 7, d), loop('.b2', 'blinkB', f.blinkB, 11, d), loop('.b3', 'blinkC', f.blinkC, 13, d)] : []),
  ]
}

/** How hard a gauge face strains at `percent`: its wobble's swing (deg) and beat (s). */
function strain(face: Face, percent: number): { swing: number; beat: number } {
  const x = gaugeStep(percent) / 100
  if (face === 'alarmed') return { swing: 3 + 2 * x, beat: 1.4 - 0.4 * x }
  if (face === 'strained') return { swing: 2 + 3 * x, beat: 2.6 - 1.2 * x }
  return { swing: 1.5 + 3 * x, beat: 3.2 - 1.4 * x }
}

/** The value a gauge face strains at when it is drawn without one. */
const DEFAULT_PERCENT: Partial<Record<Face, number>> = { uneasy: 60, strained: 85, alarmed: 97 }

function motionOf(face: Face, percent: number | undefined, detail: Detail): Loop[] {
  const f = frames(detail === 'mini' ? 1.5 : 1)
  const full = detail === 'full'
  switch (face) {
    case 'calm':
      return idle(f)
    case 'thinking':
      return [
        loop('.pose', 'breathe', f.breathe, 4.2),
        loop('.crest', 'twirl', f.twirl, 2.6),
        loop('.face', 'ponder', f.ponder, 5.2),
        loop('.r1', 'ripple', f.ripple, 2.6),
        loop('.r2', 'ripple', f.ripple, 2.6, { delay: 1.3 }),
        loop('.b1', 'blinkA', f.blinkA, 7),
        loop('.b2', 'blinkB', f.blinkB, 11),
      ]
    case 'working':
      return [
        loop('.spin', 'spin', f.spin, 1.2, { timing: 'linear' }),
        loop('.fig', 'busy', f.busy, 0.8),
        loop('.crest', 'bob', f.bob, 0.8),
        loop('.face', 'scan', f.scan, 2.4),
        loop('.wL,.wR', 'wave', f.wave, 1.6),
        loop('.b1', 'blinkA', f.blinkA, 7),
      ]
    case 'drowsy':
      return [
        loop('.fig', 'nod', f.nod, 6),
        loop('.b1', 'heavy', f.heavy, 7),
        loop('.crest', 'sway', f.sway, 6.4),
        ...(full ? [loop('.pose', 'stretch', f.stretch, 9), loop('.yawn', 'yawn', f.yawn, 9), loop('.mouth', 'gape', f.gape, 9)] : []),
      ]
    case 'sleepy':
      return [
        loop('.pose', 'snore', f.snore, 4.6),
        loop('.z1', 'zrise', f.zrise, 3.6),
        ...(full ? [loop('.z2', 'zrise', f.zrise, 3.6, { delay: 1.2 }), loop('.fig', 'stretch', f.stretch, 11), loop('.yawn', 'yawn', f.yawn, 11), loop('.mouth', 'gape', f.gape, 11)] : []),
      ]
    case 'uneasy':
    case 'strained':
    case 'alarmed': {
      // The wobble swings wider and beats faster as the gauge fills; so does the sweat.
      const { swing, beat } = strain(face, percent ?? DEFAULT_PERCENT[face]!)
      const wob = '0%,100%{transform:none}25%{transform:rotate(' + n(swing) + 'deg)}75%{transform:rotate(' + n(-swing) + 'deg)}'
      const b = Number(n(beat))
      const sweat = Number(n(beat * 1.3))
      if (face === 'uneasy') {
        return [loop('.pose', 'wob', wob, b), loop('.face', 'fret', f.fret, 3.2), loop('.sweat', 'drip', f.drip, sweat), loop('.crest', 'sway', f.sway, 2.8), loop('.b1', 'blinkA', f.blinkA, 7), loop('.b2', 'blinkB', f.blinkB, 11)]
      }
      if (face === 'strained') {
        return [loop('.pose', 'wob', wob, b), loop('.crest', 'quiver', f.quiver, b), loop('.ears', 'pulse', f.pulse, b), loop('.sweat', 'drip', f.drip, sweat), loop('.b1', 'blinkA', f.blinkA, 7)]
      }
      return [
        loop('.pose', 'wob', wob, b),
        loop('.crest', 'quiver', f.quiver, b),
        loop('.ears', 'pulse', f.pulse, b),
        loop('.face', 'jolt', f.jolt, b),
        loop('.sweat', 'drip', f.drip, sweat),
        loop('.sweat2', 'drip', f.drip, sweat, { delay: Number(n(sweat / 2)) }),
      ]
    }
    case 'dazed':
      return [
        loop('.e1', 'dizzy', f.dizzy, 1.8, { timing: 'linear' }),
        loop('.e2', 'dizzy', f.dizzy, 1.8, { timing: 'linear' }),
        loop('.fig', 'orbit', f.orbit, 2.4),
        loop('.shard', 'shard', f.shard, 2.6),
        loop('.crest', 'sway', f.sway, 3),
      ]
    case 'asking':
      return [
        loop('.fig', 'tilt', f.tilt, 4.4),
        loop('.bub1', 'pop', f.pop, 4.4),
        loop('.bub2', 'pop', f.pop, 4.4, { delay: 0.25 }),
        loop('.bub3', 'pop', f.pop, 4.4, { delay: 0.5 }),
        loop('.b1', 'blinkA', f.blinkA, 7),
        loop('.b2', 'blinkB', f.blinkB, 11),
      ]
    case 'squeezing':
      return [loop('.pose', 'squash', f.squash, 1.4), loop('.spin', 'spin', f.spin, 1.4, { timing: 'linear' }), loop('.ears', 'squeeze', f.squeeze, 1.4)]
    case 'going':
      return [
        loop('.earR', 'wag', f.wag, 2.4),
        loop('.wR', 'leave', f.leave, 2.4, { delay: 0.3 }),
        loop('.spin', 'spin', f.spin, 1.6, { timing: 'linear' }),
        loop('.crest', 'flutter', f.flutter, 0.8),
        loop('.fig', 'lean', f.lean, 2.4),
      ]
    case 'pleased':
      // A happy bounce and its ripple, once; then the idle life, its eyes too glad to blink.
      return [loop('.fig', 'bounce', f.bounce, 1.2, { timing: 'ease-out', once: true }), loop('.halo', 'halo', f.halo, 1.4, { timing: 'ease-out', once: true }), ...idle(f, 1.2, false)]
    case 'sorry':
      return [loop('.fig', 'sink', f.sink, 4.2), loop('.crest', 'droop', f.droop, 4.2), loop('.tear', 'tear', f.tear, 3.6), loop('.b2', 'blinkB', f.blinkB, 11)]
  }
}

// Where each part turns: the ring's foot (the whole figure), its centre, the crest's base, the ears'
// roots, the middle of the eyes; the bubbles and the yawn about themselves.
const ORIGINS =
  'g,circle,path,rect,ellipse{transform-box:view-box}' +
  '.fig,.pose{transform-origin:28px 49.5px}' +
  '.spin,.halo,.face,.ears,.wL,.wR,.r1,.r2{transform-origin:28px 31px}' +
  '.crest,.crest2{transform-origin:30.5px 13px}' +
  '.earR{transform-origin:45px 31px}' +
  '.e1{transform-origin:22.4px 29px}.e2{transform-origin:33.6px 29px}' +
  '.shard{transform-origin:46px 44px}' +
  '.yawn,.mouth{transform-origin:28px 37.6px}' +
  '.bub{transform-box:fill-box;transform-origin:center}'

/**
 * The face's motion, for svgDoc's `css`; all of it inside a no-preference reduced-motion query, so
 * with less motion asked for the drawing is its rest pose. `percent` is the gauge's, which sets how
 * hard uneasy, strained and alarmed strain (in its 5% steps, like the ring).
 */
export function rippleCss(face: Face, percent?: number, detail: Detail = 'full'): string {
  const moves = motionOf(face, percent, detail)
  const keyframes = new Map<string, string>()
  for (const move of moves) keyframes.set(move.name, move.frames)
  // One rule per element, its animations in one list: two rules on one element would drop one.
  const by = new Map<string, string[]>()
  for (const move of moves) {
    const one = move.name + ' ' + n(move.seconds) + 's ' + (move.timing ?? 'ease-in-out') + (move.delay ? ' ' + n(move.delay) + 's' : '') + (move.once ? ' 1' : ' infinite')
    by.set(move.at, [...(by.get(move.at) ?? []), one])
  }
  const eyes = '.eyes,.b1,.b2,.b3{transform-origin:28px ' + SPECS[face].eyesY + 'px}'
  return (
    ORIGINS + eyes +
    '@media (prefers-reduced-motion:no-preference){' +
    [...keyframes].map(([name, body]) => '@keyframes ' + name + '{' + body + '}').join('') +
    [...by].map(([at, list]) => at + '{animation:' + list.join(',') + '}').join('') + '}'
  )
}
