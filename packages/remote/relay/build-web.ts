// Builds the PWA the relay serves into relay/dist: the same files, at the same paths, that the
// host serves itself (server.ts) — web/* at the root with TypeScript types stripped (the .ts names
// stay, so imports need no rewriting; the worker serves them as JavaScript), plus SHARED.
//   node packages/remote/relay/build-web.ts
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CSP, SHARED } from "../src/server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const web = path.join(pkg, "web");
const out = path.join(here, "dist");

function emit(rel: string, src: string): void {
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (src.endsWith(".ts")) fs.writeFileSync(dest, module.stripTypeScriptTypes(fs.readFileSync(src, "utf8"), { mode: "strip" }));
  else fs.copyFileSync(src, dest);
}

fs.rmSync(out, { recursive: true, force: true });
for (const name of fs.readdirSync(web)) emit(name, path.join(web, name));
for (const [rel, file] of Object.entries(SHARED)) emit(rel, file(pkg));
// Static asset requests are served without running the worker (free and unlimited on Cloudflare;
// wrangler.toml routes only /ws/* to it), so the headers server.ts sets come from _headers here.
fs.writeFileSync(path.join(out, "_headers"), `/*
  Cache-Control: no-cache
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/*.ts
  Content-Type: text/javascript; charset=utf-8
/*.webmanifest
  Content-Type: application/manifest+json
/
  Content-Security-Policy: ${CSP}
/index.html
  Content-Security-Policy: ${CSP}
`);
process.stdout.write(`relay: PWA built into ${path.relative(process.cwd(), out) || out}\n`);
