#!/usr/bin/env node
/* Renders icons/icon.svg to the PNG sizes iOS, Android and desktop installers need.
   Dev tool (needs the `playwright` package); the PNGs are committed, so a normal build does not run this. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
/* maskable icons need the artwork inside the centre 80% "safe zone", on a full-bleed background */
const full = (size, scale) => `<html><body style="margin:0;background:#05080d"><div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:#05080d"><div style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`;
const jobs = [['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['apple-touch-icon.png', 180, 1], ['icon-maskable-512.png', 512, 0.78], ['icon-1024.png', 1024, 1]];
const b = await chromium.launch({ args: ['--no-sandbox'] });
for (const [name, size, scale] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(full(size, scale)); await p.screenshot({ path: path.join(root, 'icons', name), omitBackground: false }); await p.close();
  console.log('wrote icons/' + name);
}
await b.close();
