// Renders the PNG exports in brand/png/ (and brand/social-preview.png) from the master SVGs, and
// copies the dashboard's favicons into packages/ui. Run: node brand/export.mts
// Needs Chrome for Testing (or set CHROME to any Chromium binary); it screenshots tiny HTML wrappers.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-brand-"));
const read = (name: string) => fs.readFileSync(path.join(here, name), "utf8");
const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const ACCENT = "#6a56d6";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function shoot(html: string, width: number, height: number, out: string): void {
  const page = path.join(tmp, `${path.basename(out)}.html`);
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>${html}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--default-background-color=00000000", `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`], { stdio: "ignore" });
  console.log(`✓ ${path.relative(path.dirname(here), out)} ${width}×${height}`);
}

const img = (svg: string, size: number) => `<img src="${dataUrl(svg)}" width="${size}" height="${size}" style="display:block">`;

// Favicons: 16px follows the spec's 16px rules (favicon.svg: ring, crest, eyes); 22px and up may carry the ears (mark-mono).
const mono = read("mark-mono.svg").replaceAll("currentColor", ACCENT);
shoot(img(read("favicon.svg"), 16), 16, 16, path.join(here, "png/favicon-16.png"));
shoot(img(mono, 32), 32, 32, path.join(here, "png/favicon-32.png"));
shoot(img(mono, 48), 48, 48, path.join(here, "png/favicon-48.png"));

// Tiles: apple-touch is full-bleed (iOS rounds the corners itself); the 512 keeps the spec's rx 22.4 squircle.
const tile = read("app-icon.svg");
shoot(img(tile.replaceAll('rx="22.4"', 'rx="0"'), 180), 180, 180, path.join(here, "png/apple-touch-icon.png"));
shoot(img(tile, 512), 512, 512, path.join(here, "png/app-icon-512.png"));

// GitHub social preview, 1280×640 with 40px safe margins.
const social = `
<div style="width:1280px;height:640px;box-sizing:border-box;padding:40px;position:relative;overflow:hidden;background:#1d1b26;font-family:${FONT};display:flex;align-items:center;justify-content:center;gap:56px">
  <div style="position:relative">
    <!-- ripples centred on the ring (28, 31 of 56 → 150, 166 of 300) -->
    <svg style="position:absolute;left:-850px;top:-834px" width="2000" height="2000" viewBox="-1000 -1000 2000 2000" fill="none" stroke="#a594f5" stroke-width="3">
      <circle r="190" stroke-opacity="0.12"/>
      <circle r="280" stroke-opacity="0.08"/>
      <circle r="370" stroke-opacity="0.05"/>
    </svg>
    ${img(read("mark-dark.svg"), 300)}
  </div>
  <div style="position:relative;display:flex;flex-direction:column;gap:18px">
    <div style="font-size:104px;line-height:1;letter-spacing:-0.02em;color:#ecebf2;white-space:nowrap"><span style="font-weight:500">Claude</span><span style="font-weight:800;color:#a594f5">Ripple</span></div>
    <div style="font-size:34px;line-height:1.25;color:#c9c6d2;font-weight:500">Chat stays Claude. Only Code becomes GPT.</div>
  </div>
  <div style="position:absolute;right:40px;bottom:40px;font-size:18px;color:#a19fae">Not affiliated with Anthropic</div>
</div>`;
shoot(social, 1280, 640, path.join(here, "social-preview.png"));

// The dashboard serves its favicons from packages/ui (the router's static root).
const ui = path.join(here, "../packages/ui");
fs.copyFileSync(path.join(here, "favicon.svg"), path.join(ui, "favicon.svg"));
fs.copyFileSync(path.join(here, "png/favicon-32.png"), path.join(ui, "favicon-32.png"));
console.log("✓ packages/ui/favicon.svg, packages/ui/favicon-32.png");
fs.rmSync(tmp, { recursive: true, force: true });
