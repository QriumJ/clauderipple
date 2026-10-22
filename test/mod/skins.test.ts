import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatPictures } from '../../packages/mod/hooks/ui/flat.ts'
import * as deep from '../../packages/mod/hooks/ui/art.ts'
import type { Paint } from '../../packages/mod/hooks/ui/look.ts'
import type { Sea, TileArt } from '../../packages/mod/hooks/ui/art.ts'

const DEEP: Paint = {
  sea: deep.seaArt, plate: deep.plateArt, switch: deep.switchArt, word: deep.wordArt, extraHover: deep.extraHoverArt,
  pill: deep.pillArt, segmented: deep.segmentedArt, slider: deep.sliderArt, well: deep.wellArt, close: deep.closeArt,
  meter: deep.meterArt, ring: deep.ringArt, clock: deep.clockArt, gauge: deep.gaugeArt, icon: deep.iconArt,
  agents: deep.agentsArt, rule: deep.ruleArt, tile: deep.tileArt, beads: deep.beadsArt,
}

/** The two skins that share the deep's layout and change paint alone. */
const PAINTS: [string, Paint][] = [['deep', DEEP], ['flat', flatPictures('auto')], ['flat-dark', flatPictures('dark')]]

const SEAS: Sea[] = [
  { tone: 'violet', at: { x: 30, y: 20 }, ripples: 'calm', motes: true, wave: 40, visible: 60 },
  { tone: 'amber', at: { x: 30, y: 20 }, ripples: 'busy', sweep: true, current: true, strength: 0.5 },
  { tone: 'ice', at: { x: 30, y: 20 }, weather: 'snow' },
  { tone: 'red', at: { x: 30, y: 20 }, weather: 'static' },
  { tone: 'green', at: { x: 30, y: 20 }, tick: true, weather: 'sparkles' },
]
const TILES: TileArt[] = [
  { kind: 'effort', on: true }, { kind: 'effort', on: false }, { kind: 'judge', judge: 'haiku' }, { kind: 'judge', judge: 'jev' }, { kind: 'judge', judge: 'model' },
  { kind: 'mode', on: true }, { kind: 'mode', on: false }, { kind: 'warm', on: true }, { kind: 'warm', on: false }, { kind: 'skin', skin: 'flat' },
]

/** A drawing is one SVG document, its figures all numbers. */
function sound(name: string, source: string): void {
  assert.ok(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), name + ' starts an svg')
  assert.ok(source.endsWith('</svg>'), name + ' ends it')
  assert.ok(!/NaN|undefined|null|\[object/.test(source), name + ' has no stray value: ' + source.slice(0, 200))
  assert.equal((source.match(/<svg\b/g) ?? []).length, 1, name + ' is one document')
}

test('the deep and flat draw every picture, each one sound', () => {
  for (const [skin, art] of PAINTS) {
    for (const sea of SEAS) {
      const drawn = art.sea(600, 300, sea)
      if (drawn) sound(skin + ' sea ' + sea.tone, drawn)
    }
    sound(skin + ' plate', art.plate(300, 19))
    for (const on of [true, false]) for (const busy of [true, false]) sound(skin + ' switch', art.switch(on, busy))
    for (const on of [true, false]) for (const busy of [true, false]) sound(skin + ' word', art.word('Auto', on, busy).source)
    sound(skin + ' extraHover', art.extraHover(7.917))
    for (const look of ['primary', 'ghost'] as const) for (const glyph of [undefined, 'open', 'close', 'next'] as const) sound(skin + ' pill', art.pill('열기', look, 'amber', glyph).source)
    sound(skin + ' segmented', art.segmented(['Haiku', 'Jev', '라우터'], [6, 5, 7], 1, 'teal'))
    sound(skin + ' segmented none', art.segmented(['A', 'B'], [5, 5], -1))
    sound(skin + ' segmented colours', art.segmented(['L', 'M', 'H', 'X', 'Max'], [5, 5, 5, 5, 5], 3, 'violet', [...deep.DEPTH]))
    for (const chosen of [0, 2, 4]) sound(skin + ' slider', art.slider(5, 3, chosen))
    sound(skin + ' well', art.well(200, 32))
    for (const lit of [true, false]) sound(skin + ' close', art.close(lit))
    for (const look of ['auto', 'manual', 'quiet', 'deciding'] as const) sound(skin + ' meter', art.meter(3, look))
    for (const tone of ['ink', 'amber', 'red'] as const) sound(skin + ' ring', art.ring(38, tone))
    for (const tone of ['soft', 'violet', 'amber'] as const) for (const share of [0, 0.3, 1]) sound(skin + ' clock', art.clock(share, tone))
    for (const kind of ['five_hour', 'seven_day']) sound(skin + ' gauge', art.gauge(kind))
    for (const icon of ['flame', 'gear', 'agents', 'log', 'compact', 'clear'] as const) for (const on of [true, false]) sound(skin + ' icon', art.icon(icon, on, 'amber'))
    for (const count of [0, 2, 12]) sound(skin + ' agents', art.agents(count, count > 0))
    sound(skin + ' rule', art.rule())
    for (const tile of TILES) sound(skin + ' tile ' + tile.kind, art.tile(tile))
    for (const step of [1, 2, 3]) sound(skin + ' beads', art.beads(step, 3).source)
  }
})

test('flat changes paint, never geometry: pills, words and beads take the deep\'s cells', () => {
  for (const label of ['Auto', '전체 설정 열기', 'Open all settings']) {
    const sizes = PAINTS.map(([, art]) => [art.pill(label, 'ghost', 'violet', 'open').cells, art.pill(label, 'primary').cells, art.word(label, true).cells, art.beads(2, 3).width])
    for (const other of sizes.slice(1)) assert.deepEqual(other, sizes[0], label)
  }
})

test('flat follows the theme: its pictures paint with palette variables, fixed only when the appearance is', () => {
  const auto = flatPictures('auto')
  assert.ok(auto.switch(true).includes('var(--accent)'))
  assert.ok(auto.plate(100, 19).includes('@media (prefers-color-scheme:dark)'))
  assert.ok(!flatPictures('dark').plate(100, 19).includes('@media (prefers-color-scheme'))
  // The capsule is the app's surface: white, its dark surface on a dark app, fixed when the appearance is.
  assert.ok(auto.sea(600, 300, SEAS[0]!).includes('fill:#ffffff') && auto.sea(600, 300, SEAS[0]!).includes('@media (prefers-color-scheme:dark)'))
  assert.ok(!flatPictures('light').sea(600, 300, SEAS[0]!).includes('#30302e'))
  // One accent: the efforts' depths and the judge's teal are not taken.
  assert.ok(!auto.segmented(['L', 'M'], [5, 5], 0, 'teal', ['#67e8f9', '#7dd3fc']).includes('#67e8f9'))
})
