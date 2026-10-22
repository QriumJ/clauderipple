// 리플이 v2 (물마루): ring body + wave-crest forelock, on the 56-unit grid of
// design-drafts/ripple-char-v2.html. The face is always ink and the tone lives in the body, so
// light and dark differ only by tokens. Used sparingly: empty and connection states.

export type Face = "calm" | "pleased" | "sleepy" | "uneasy" | "going" | "sorry";

const CREST_UP = "M24.7 12.29C24.2 6.2 29.2 2.4 35 2.6C39.6 2.8 42.6 6.2 41.6 9.8C40.6 8 38.6 7 36.8 7.6C35 8.2 35 11 36.33 13.92Z";
const CREST_SHORT = "M24.7 12.29C25 8.4 28.4 6.4 32 6.6C34.8 6.8 36.8 8.4 36.8 10.2C36 9.6 35.2 9.8 34.9 10.6C34.7 11.6 35.4 12.8 36.33 13.92Z";
const CREST_WIND = "M24.7 12.29C25.6 6.4 31.6 3.6 38 4C42 4.2 44.6 6 45.2 8.4C43.4 7.4 40.8 7.4 38.8 8.4C37.2 9.4 36 11.6 36.33 13.92Z";
const CREST_WILT = "M24.7 12.29C25.4 6 31.4 3.8 36.6 4.6C41.6 5.4 44.4 9.6 43.6 14.6C42.4 12 40.2 10.6 38.2 11C37.2 11.4 36.6 12.6 36.33 13.92Z";

const line = (d: string, color: string, w: number, extra = ""): string =>
  `<path d="${d}" fill="none" stroke="var(--${color})" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const ears = (tone: string, dim: boolean): string => {
  const o = dim ? ` stroke-opacity="0.4"` : "";
  return line("M49.47 21.44A23.5 23.5 0 0 1 49.47 40.56", tone, 2.4, o) + line("M6.53 40.56A23.5 23.5 0 0 1 6.53 21.44", tone, 2.4, o);
};
const eyes = (x1: number, x2: number, y: number, h: number): string =>
  `<rect x="${x1}" y="${y}" width="3.6" height="${h}" rx="1.8" fill="var(--ink)"/><rect x="${x2}" y="${y}" width="3.6" height="${h}" rx="1.8" fill="var(--ink)"/>`;
const ring = (tone: string, extra = ""): string =>
  `<circle cx="28" cy="31" r="16.5" fill="none" stroke="var(--${tone})" stroke-width="5"${extra}/>`;
const crest = (d: string, tone: string): string => `<path d="${d}" fill="var(--${tone})"/>`;
const drop = (d: string): string => `<path d="${d}" fill="var(--muted)"/>`;

const FACES: Record<Face, string> = {
  calm: crest(CREST_UP, "accent") + ring("accent") + ears("accent", false) + eyes(20.6, 31.8, 26.2, 5.6) + line("M24.8 36.2q3.2 2.6 6.4 0", "ink", 2.2),
  pleased: crest(CREST_UP, "ok") + ring("ok") + ears("ok", false) + line("M20 30q2.4 -3.4 4.8 0", "ink", 2.2) + line("M31.2 30q2.4 -3.4 4.8 0", "ink", 2.2) +
    `<path d="M23.8 35.4h8.4a4.2 4.2 0 0 1 -8.4 0z" fill="var(--ink)"/>`,
  sleepy: `<g opacity="0.45">${crest(CREST_SHORT, "accent")}${ring("accent")}</g>` + line("M20 29q2.4 2.2 4.8 0", "ink", 2.2) + line("M31.2 29q2.4 2.2 4.8 0", "ink", 2.2) +
    line("M26.6 37.2q1.4 1 2.8 0", "ink", 2.2) + line("M44.4 4.6h4l-4 4.4h4", "muted", 1.6) + line("M50 10.6h2.8l-2.8 3h2.8", "muted", 1.3, ` opacity=".7"`),
  uneasy: crest(CREST_UP, "warn") + ring("faint") + line("M28 14.5A16.5 16.5 0 1 1 13.07 23.97", "warn", 5) + ears("warn", true) + eyes(20.6, 31.8, 26.9, 5) +
    line("M19.4 24.4L25 22.4", "ink", 2) + line("M36.6 24.4L31 22.4", "ink", 2) + line("M22.9 37.2q1.275 -1.7 2.55 0t2.55 0t2.55 0t2.55 0", "ink", 2.2) +
    drop("M46.6 13.8q-2.3 3.1 -2.3 4.5a2.3 2.3 0 0 0 4.6 0q0 -1.4 -2.3 -4.5z"),
  going: crest(CREST_WIND, "accent") + ring("accent", ` stroke-dasharray="9.2 3.76" transform="rotate(-99 28 31)"`) + ears("accent", true) + eyes(22.2, 33.4, 26.2, 5.6) +
    line("M26.6 37.2q1.4 1 2.8 0", "ink", 2.2),
  sorry: crest(CREST_WILT, "bad") + ring("bad") + eyes(20.6, 31.8, 27.6, 4.4) + line("M19.2 24.8L24.6 22.2", "ink", 2) + line("M36.8 24.8L31.4 22.2", "ink", 2) +
    line("M24.8 38.4q3.2 -2.6 6.4 0", "ink", 2.2) + drop("M36.4 33.2q-1.84 2.48 -1.84 3.6a1.84 1.84 0 0 0 3.68 0q0 -1.12 -1.84 -3.6z"),
};

export function ripple(face: Face, size: number, label = ""): string {
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg class="ripple" width="${size}" height="${size}" viewBox="0 0 56 56" ${a11y}>${FACES[face]}</svg>`;
}

/**
 * The small state glyph in lists and headers: the same ring, no face. Dashed = in progress,
 * warn = needs you, ok = done, faint = paused, bad = error (the mascot's own prop rules).
 */
export function stateRing(state: string, size = 22): string {
  // Background work only (subagents, shells): the app's dark blinking dot.
  if (state === "background") return `<svg class="ring ring-background" width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="Background work"><circle cx="28" cy="28" r="9" fill="var(--ink)"/></svg>`;
  if (state === "unread" || state === "read") return `<svg class="ring ring-${state}" width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="${state === "unread" ? "Unread activity" : "Read"}"><circle cx="28" cy="28" r="${state === "unread" ? 9 : 8}" fill="${state === "unread" ? "var(--warn)" : "none"}" stroke="var(--${state === "unread" ? "warn" : "faint"})" stroke-width="3"/></svg>`;
  const tone = state === "waiting" ? "warn" : state === "error" ? "bad" : state === "idle" ? "ok" : state === "stopped" ? "faint" : "accent";
  const dashed = state === "running" || state === "starting";
  const body = dashed
    ? `<circle cx="28" cy="31" r="16.5" fill="none" stroke="var(--${tone})" stroke-width="6" stroke-dasharray="9.2 3.76" transform="rotate(-99 28 31)"/>`
    : `<circle cx="28" cy="31" r="16.5" fill="none" stroke="var(--${tone})" stroke-width="6"/>`;
  const dot = state === "waiting" ? `<circle cx="28" cy="31" r="6" fill="var(--warn)"/>` : "";
  return `<svg class="ring ring-${state}" width="${size}" height="${size}" viewBox="0 0 56 56" aria-hidden="true">${crest(state === "stopped" ? CREST_SHORT : CREST_UP, tone)}${body}${dot}</svg>`;
}
