import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FACES, FACE_TONE, GAUGE_FACES, detailOf, gaugeStep, rippleBody, rippleCss } from '../../packages/mod/hooks/ui/ripple.ts'

const DETAILS = ['full', 'mini'] as const

test('each face is one fixed drawing in its tone; the full face in ink, the mini all in the tone', () => {
  for (const detail of DETAILS) {
    for (const face of FACES) {
      const body = rippleBody(face, undefined, detail)
      assert.equal(rippleBody(face, undefined, detail), body, face)
      assert.ok(body.includes('var(--' + FACE_TONE[face] + ')'), face)
      if (detail === 'full') assert.ok(body.includes('var(--ink)'), face)
      else assert.doesNotMatch(body, /var\(--ink\)|var\(--muted\)/, face)
      // Faces that are no gauge do not change with a value.
      if (!GAUGE_FACES.includes(face)) assert.equal(rippleBody(face, 37, detail), body, face)
    }
    assert.equal(new Set(FACES.map(face => rippleBody(face, undefined, detail))).size, FACES.length, detail)
  }
  // The mini is the sheet's mono template: the heavier ring, no mouth.
  assert.match(rippleBody('calm', undefined, 'mini'), /stroke-width="6.4"/)
  assert.doesNotMatch(rippleBody('calm', undefined, 'mini'), /class="mouth"/)
  assert.deepEqual([16, 20, 33, 34, 44, 64].map(detailOf), ['mini', 'mini', 'mini', 'full', 'full', 'full'])
})

test('nothing the host would refuse or that reaches out: no script, handlers, links, filters, SMIL', () => {
  for (const detail of DETAILS) {
    for (const face of FACES) {
      for (const markup of [rippleBody(face, 50, detail), rippleCss(face, 50, detail)]) {
        assert.doesNotMatch(markup, /<script|\son\w+=|href|url\(|filter|<animate|<set\b|@import/i, face)
      }
    }
  }
})

test('the gauge moves in steps of 5%, so a creeping figure redraws the same picture', () => {
  assert.deepEqual([0, 2.4, 2.5, 61, 62.4, 62.5, 97.4, 97.5, 140, -3, NaN].map(gaugeStep), [0, 0, 5, 60, 60, 65, 95, 100, 100, 0, 0])
  for (const face of GAUGE_FACES) {
    for (const draw of [rippleBody, rippleCss]) {
      assert.equal(draw(face, 59), draw(face, 61), face)
      assert.notEqual(draw(face, 60), draw(face, 65), face)
    }
    const drawn = new Set(Array.from({ length: 1001 }, (_, i) => rippleBody(face, i / 10)))
    assert.equal(drawn.size, 21, face)
    // A track behind the value; empty, the track alone; full, the whole ring in the tone.
    assert.ok(rippleBody(face, 50).includes('stroke="var(--faint)"'), face)
    assert.doesNotMatch(rippleBody(face, 0), /M28 14\.5A/)
    assert.doesNotMatch(rippleBody(face, 100), /var\(--faint\)|M28 14\.5A/)
    // Past half the arc takes the long way round.
    assert.match(rippleBody(face, 40), /A16\.5 16\.5 0 0 1 /)
    assert.match(rippleBody(face, 70), /A16\.5 16\.5 0 1 1 /)
  }
})

type Keyframes = { name: string; stops: { at: number[]; decl: string }[] }

function keyframesOf(css: string): Keyframes[] {
  return [...css.matchAll(/@keyframes (\w+)\{(.*?\})\}/g)].map(([, name, body]) => ({
    name: name!,
    stops: [...body!.matchAll(/([\d.%,]+)\{([^}]*)\}/g)].map(([, at, decl]) => ({ at: at!.split(',').map(p => parseFloat(p)), decl: decl! })),
  }))
}

function animationsOf(css: string): { at: string; name: string; seconds: number; delay: number; once: boolean }[] {
  return [...css.matchAll(/([.\w,]+)\{animation:([^}]*)\}/g)].flatMap(([, at, list]) =>
    list!.split(',').map(one => {
      const [name, seconds, , delay, count] = one.split(' ')
      return { at: at!, name: name!, seconds: parseFloat(seconds!), delay: count === undefined ? 0 : parseFloat(delay!), once: (count ?? delay) === '1' }
    }),
  )
}

/** At rest: no transform, fully shown; or hidden, as a ripple about to spread is. */
const atRest = (decl: string) => /opacity:0\b/.test(decl) || decl.split(';').every(d => d === 'transform:none' || d === 'opacity:1')

/** Turns that draw the same at their end: a dash of the eight, an × a full round. */
const TURNS = ['spin', 'dizzy']

test('every loop opens on the rest pose or a hidden part and ends where it began, all inside a no-preference query', () => {
  const QUERY = '@media (prefers-reduced-motion:no-preference){'
  for (const detail of DETAILS) {
    for (const face of FACES) {
      const css = rippleCss(face, undefined, detail)
      const at = css.indexOf(QUERY)
      assert.ok(at > 0, face)
      assert.doesNotMatch(css.slice(0, at), /animation|@keyframes/, face)
      assert.ok(css.endsWith('}}'), face)
      const frames = keyframesOf(css)
      assert.ok(frames.length > 0, face)
      const animations = animationsOf(css)
      for (const k of frames) {
        const first = k.stops.find(s => s.at.includes(0))
        assert.ok(first && atRest(first.decl), face + ' ' + k.name + ' opens at rest')
        const last = k.stops.find(s => s.at.includes(100))!
        const once = animations.filter(a => a.name === k.name).every(a => a.once)
        if (TURNS.includes(k.name)) assert.match(last.decl, /rotate\((45|360)deg\)/, k.name)
        else assert.ok(last === first || (once && atRest(last.decl)), face + ' ' + k.name + ' ends where it began')
        // Every animation names keyframes the sheet has, and every keyframes is used.
        assert.ok(animations.some(a => a.name === k.name), k.name)
      }
      for (const a of animations) assert.ok(frames.some(k => k.name === a.name), a.name)
      // One rule per element: a second rule on it would drop the first's animations.
      const selectors = animations.map(a => a.at)
      const rules = [...css.matchAll(/([.\w,]+)\{animation:/g)].map(([, s]) => s)
      assert.equal(new Set(rules).size, rules.length, face)
      assert.ok(selectors.length >= rules.length)
      // Loops last 0.8 to 17 s; only done plays once (its bounce), then lives on.
      for (const a of animations) {
        assert.ok(a.seconds >= 0.8 && a.seconds <= 17, face + ' ' + a.name + ' ' + a.seconds)
        if (a.once) assert.equal(face, 'pleased', a.name)
      }
    }
  }
})

test('idle life is uneven: three blinks of different lengths, and the big moments seconds in', () => {
  const css = rippleCss('calm')
  const animations = animationsOf(css)
  const blinks = animations.filter(a => /^blink/.test(a.name))
  assert.equal(blinks.length, 3)
  assert.equal(new Set(blinks.map(a => a.seconds)).size, 3)
  assert.equal(new Set(blinks.map(a => a.at)).size, 3)
  // A redraw starts the motion over: nothing but breath and sway in the first two seconds.
  const frames = keyframesOf(css)
  for (const name of ['blinkA', 'blinkB', 'blinkC', 'look', 'hop']) {
    const k = frames.find(f => f.name === name)!
    const a = animations.find(x => x.name === name)!
    const moves = k.stops.filter(s => !atRest(s.decl)).flatMap(s => s.at)
    assert.ok(Math.min(...moves) / 100 * a.seconds + a.delay >= 2, name)
  }
  for (const want of ['breathe', 'sway', 'look', 'hop', 'wave']) assert.ok(animations.some(a => a.name === want), want)
})

test('each state acts: the strain grows with the gauge, the done bounce plays once, reduced motion is still', () => {
  const swing = (face: (typeof GAUGE_FACES)[number], p: number) => {
    const css = rippleCss(face, p)
    const deg = Number(/@keyframes wob\{[^@]*?rotate\(([\d.]+)deg\)/.exec(css)![1])
    const beat = animationsOf(css).find(a => a.name === 'wob')!.seconds
    return { deg, beat }
  }
  for (const face of GAUGE_FACES) {
    const low = swing(face, 50)
    const high = swing(face, 100)
    assert.ok(high.deg > low.deg && high.beat < low.beat, face)
  }
  const acts: Record<string, string[]> = {
    thinking: ['twirl', 'ripple'],
    working: ['spin', 'busy'],
    drowsy: ['nod', 'heavy', 'yawn'],
    sleepy: ['snore', 'zrise', 'yawn'],
    dazed: ['dizzy', 'shard'],
    asking: ['tilt', 'pop'],
    squeezing: ['squash'],
    going: ['wag', 'leave'],
    pleased: ['bounce', 'halo'],
    sorry: ['sink', 'tear'],
  }
  for (const [face, names] of Object.entries(acts)) {
    const css = rippleCss(face as (typeof FACES)[number])
    for (const name of names) assert.ok(css.includes('@keyframes ' + name + '{'), face + ' ' + name)
  }
  assert.ok(animationsOf(rippleCss('pleased')).filter(a => a.name === 'bounce').every(a => a.once))
})
