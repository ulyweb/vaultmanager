#!/usr/bin/env node
/* Assembles the static app into dist/web — what gets hosted (GitHub Pages, a NAS) and what the native
   Tauri apps wrap. `--native` adds the two Tauri IPC origins to the Content-Security-Policy so the
   system "Save as…" dialog works inside the phone / desktop apps; everything else stays identical. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/web');
const native = process.argv.includes('--native');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(out, rel), { recursive: true, filter: (src) => !/icon-1024\.png$/.test(src) });
for (const rel of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'icons', 'wallpapers']) copy(rel);
if (!native && fs.existsSync(path.join(root, 'offline'))) copy('offline');   // the downloadable single-file copy is part of the hosted site

if (native) {
  const f = path.join(out, 'index.html');
  let html = fs.readFileSync(f, 'utf8');
  const before = html;
  html = html.replace("https://script.googleusercontent.com;", "https://script.googleusercontent.com ipc: http://ipc.localhost;");
  if (html === before) throw new Error('could not adjust the CSP for the native build');
  fs.writeFileSync(f, html);
}
const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
console.log(`dist/web ready (${count(out)} files${native ? ', native CSP' : ''})`);
