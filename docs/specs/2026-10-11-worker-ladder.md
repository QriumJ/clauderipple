# Worker ladder — design (2026-10-11)

Status: **superseded by docs/specs/2026-10-12-worker-tiers.md.** Replaced the Worker Auto settings of docs/specs/2026-10-10-ripple-mod.md
§2 as the default; Auto stays as an option.

## Why

Measured 2026-10-11 (ten routing probes, `ClaudeRipple worker pick:` debug lines): the judge's
levels were sensible, but AA-floor Auto sent every standard and deep task to GPT-6.1 Sol and could
never reach Astra or Opus — Sol high (index 50.2, $0.32) clears the deep floor at a fifth of their
AA price. AA prices are API list prices, while the real costs are a ChatGPT quota, a Claude 5-hour
window and pay-per-token APIs. Opinions asked of Fable and Astra agreed on the diagnosis.

The owner's conclusion: setups differ (Claude-only, Claude + GPT, GPT-first) and models come and
go (DeepSeek today, a free model tomorrow), so automatic routing has a hard ceiling. What is
needed is **manual routing that is quick to set and quick to change**, as detailed as wanted.
The current settings are also too fine at the top level: nine fields, each with its own rule.

## Model

One **ladder** of four rungs. The judge picks the rung; the user picks what runs on it.

| Rung | Judge | Example (preset "Claude + GPT") |
|---|---|---|
| 가벼운 일 Light | level light | DeepSeek V4.1 Flash · max |
| 보통 일 Standard | level standard | GPT-6.1 Sol · medium |
| 어려운 일 Hard | level deep | GPT-6 Astra · high |
| 설계·계획 Plan | `kind: plan` and level standard/deep | Claude Opus · high |

- The judge gains one field, `kind: plan | do` (plan = architecture, design decisions, specs,
  reviews that decide; do = carrying out). Jev gets one more choice question.
- Low confidence moves up: a verdict with `sure < 0.5` takes the next rung (Light → Standard,
  Standard → Hard). Plan does not move.
- Each rung is **model + effort**. Effort defaults from the preset; the model's own ladder limits it.
- **When a rung's model is unavailable** (provider off, quota exhausted, 429), the pick moves to the
  rung's backup if set, else one rung up, else the session model — and says so (existing
  `fallbackReason` toast). Never down.

## Fields, collapsed

Nine judge domains stay inside the judge. The settings show **two** optional overrides, because only
these change who should do the work:

- **디자인 (시각)** — design. Default override: Claude only (Sonnet → Opus).
- **웹 조사** — research. Default: same as the ladder.

Everything else uses the ladder. "더 세밀하게" (collapsed) exposes the full nine fields, each
"ladder" or its own four rungs, for those who want it.

## Presets

One click fills the four rungs from what is connected; afterwards every rung is editable.

- **Claude만** — Haiku · low / Sonnet · medium / Opus · high / Opus · high
- **Claude + GPT** — cheapest pay-per-token model if one is connected else Luna · low / Sol · medium / Astra · high / Opus · high
- **GPT 위주** — Luna · low / Sol · medium / Astra · high / Astra · xhigh
- **최대한 싸게** — the cheapest pay-per-token or free model on every rung but Plan (Sonnet · high)

A preset offers only models that are connected and ticked; a missing one leaves the rung on its
nearest available choice and marks it.

## Screens

**Dashboard `#mod` → Workers card** (top to bottom):
1. 적용 대상 (off / ripple:auto / all subagents) — as now.
2. 프리셋 row of buttons.
3. Four rung rows: name, one-line meaning ("이름 바꾸기·찾아보기·한 줄 답"), model select grouped by
   provider (free / pay-per-token / subscription tags; AA index as small grey text, never a gate),
   effort segmented control limited to the model's ladder, optional backup select (collapsed).
4. 분야별 따로: two switches (디자인, 웹 조사), each opening its own four rows.
5. 더 세밀하게 (collapsed): the nine fields; 자동(실험) mode with the AA floors.

**In-session quick settings:** the four rungs as model selects only (effort stays the rung's),
plus 프리셋. A new model ticked on the dashboard appears in every select without restarting.

## Migration

- Existing `rules.general` Pin with light/standard/deep → Light/Standard/Hard; Plan takes Hard's
  model at one effort higher.
- Existing Auto → keep Auto (now labelled 실험) so nobody's routing changes silently; the
  Workers card shows a one-time line offering a preset.
- Field rules other than design/research survive under 더 세밀하게.

## Acceptance

Re-run the ten probes of 2026-10-11 under "Claude + GPT": rename / Node LTS → Light; CLI flag,
LRU, vendor pricing → Standard; lock race, CRDT, CI log root cause → Hard (CRDT may go up by
confidence); billing architecture → Plan; settings visual → design override. Every pick logged.
