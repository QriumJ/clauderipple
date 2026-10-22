# Brand — 리플이 v2 (물마루)

The ClaudeRipple mascot: a hollow ripple ring (the body, which doubles as a gauge), a wave crest
curling right from 12 o'clock (the forelock), and two wave arcs at 3 and 9 o'clock (the ears).
Approved 2026-10-11. The spec, with every expression and the full geometry, is the design draft
`design-drafts/ripple-char-v2.html` (untracked); the files here copy its values exactly.

## Files

| File | What it is |
|---|---|
| `mark.svg` / `mark-dark.svg` | Colour mark for light / dark backgrounds. 56 grid, ring centre (28, 31). Face is always `ink`; tone is only on the body. |
| `mark-mono.svg` | Single colour (`currentColor`), the template weights: ring 6.4, eyes 5 × 8.4, ears r 24.5 / 4, no mouth. For 22px and up. |
| `favicon.svg` | The 16px rules: ring, crest and eyes only (no ears, no mouth), mono weights; accent, lighter accent in dark mode. |
| `lockup.svg` / `lockup-dark.svg` | Horizontal mark + wordmark ("Ripple" in accent, heavier) + the not-affiliated line, which every horizontal lockup carries. The wordmark is live text in the system UI font. |
| `app-icon.svg` / `app-icon-dark.svg` | App tile, 100 grid, rx 22.4, faint ripples, mark at ×1.25. The ring stays hollow so the tile shows through. |
| `png/favicon-{16,32,48}.png` | 16 from `favicon.svg`; 32 and 48 from `mark-mono.svg` in accent. |
| `png/apple-touch-icon.png` | 180, full-bleed tile (iOS rounds the corners). |
| `png/app-icon-512.png` | 512 tile with its corners. |
| `social-preview.png` | 1280 × 640 GitHub social preview, 40px safe margins. |

`node brand/export.mts` re-renders every PNG with headless Chrome for Testing (`CHROME=` to point at
another Chromium) and copies `favicon.svg` and `favicon-32.png` into `packages/ui`, which the router
serves (`/favicon.ico` answers with the PNG).

The social preview is not read from the repo: upload `social-preview.png` in the GitHub repository's
Settings → General → Social preview.

## Colour tokens

Same as `packages/mod/hooks/ui/theme.ts`: accent `#6a56d6` / `#a594f5`, ink `#1d1b26` / `#ecebf2`,
muted `#64616f` / `#a19fae`, faint `#c9c6d2` / `#55535f` (light / dark).

## Rules that keep it ours

- The ring is never filled — a filled disc under the curl reads as a cartoon bomb.
- The crest keeps its convex back and concave curl; bulging on both sides makes it a flame.
- No pixel creatures, no radiating star or burst marks, nothing that echoes another company's mark.
- Below 34px there is no colour badge; use the mono mark.

## Tray and app icons still to follow

The tray icons and the Electron app icon are still the old concentric-ripple set drawn by
`packages/app/scripts/make-icons.mts`, which only has ring/arc distance fields. To move them to v2,
that script needs a path filler (crest curve and capsule eyes) — no new dependencies, same 56 grid
and the mono numbers from the spec:

- **Template tray (macOS, black + alpha), 22 / 44px:** ok = `mark-mono.svg`; warn = the ring as a
  58°→378° arc (a gap, round caps); down = ring r 17.7 width 3.4, closed eyes and the `short` crest.
  At 16px drop the ears, as `favicon.svg` does.
- **Windows tray (colour), 32 / 64px:** the same shapes in the state tones instead of the current
  `TRAY_WIN` values — accent for ok, `warn` and `bad` from the token table.
- **App icon (1024 + iconset / icns):** `app-icon.svg` on the macOS grid (824px squircle centred on
  1024), replacing the current gradient tile.
