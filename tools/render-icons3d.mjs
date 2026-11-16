#!/usr/bin/env node
/* Renders the 3D icon objects (tools/icons3d-scene.js, real three.js models) to transparent pictures in icons3d/*.png.
   Run:  node tools/render-icons3d.mjs [name ...]     then convert with PIL / cwebp (see icons3d/README.md). Dev tool only; not part of the app. */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const { chromium } = createRequire(root + '/')('playwright');
const out = process.env.OUT || path.join(root, 'icons3d'); fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const page0 = '<!doctype html><meta charset=utf-8><canvas id=c width=512 height=512></canvas><script type=module>import * as S from "/tools/icons3d-scene.js"; const T=S.T; const canvas=document.getElementById("c"); const r=new T.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true}); r.toneMapping=T.ACESFilmicToneMapping; r.toneMappingExposure=1.05; r.outputColorSpace=T.SRGBColorSpace; window.NAMES=S.NAMES; window.env=S.makeEnv(r); window.renderOne=(n,s)=>{ return S.renderOne(r,n,s); }; window.ready=true;</script>';
const server = http.createServer((q, r) => { const p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') { r.writeHead(200, { 'content-type': 'text/html' }); r.end(page0); return; } const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
await new Promise((ok) => server.listen(0, 'localhost', ok));
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await b.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:' + server.address().port + '/'); await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
const want = process.argv.slice(2), names = await page.evaluate(() => window.NAMES);
for (const n of names.filter((x) => !want.length || want.includes(x))) {
  const url = await page.evaluate((name) => window.renderOne(name, 512), n);
  fs.writeFileSync(path.join(out, n + '.png'), Buffer.from(url.split(',')[1], 'base64')); console.log('rendered', n);
}
await b.close(); server.close();
