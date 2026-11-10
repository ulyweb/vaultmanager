#!/usr/bin/env node
/* Static checks (npm run lint, and in CI): syntax, strict-CSP rules, no innerHTML, no secrets committed. */
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = [];
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    if (['node_modules', '.git', 'test-results', 'playwright-report', 'dist', 'target', 'gen'].includes(e.name)) continue;
    const rel = path.posix.join(d, e.name);
    if (e.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
};
const files = walk('.').map((f) => f.replace(/^\.\//, ''));
const own = (f) => !f.startsWith('vendor/');

// 1. every script parses (modules need --input-type; check via a dynamic import-free syntax check)
for (const f of files.filter((f) => f.endsWith('.js') && f !== 'playwright.config.js')) {
  const r = cp.spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  if (r.status !== 0) fail.push('syntax error in ' + f + '\n' + r.stderr.split('\n').slice(0, 4).join('\n'));
}

// 2. HTML: strict CSP, no inline script/style/handlers, no remote URLs
for (const f of files.filter((f) => f.endsWith('.html') && !f.startsWith('offline/'))) {   // offline/ is verified by rebuild + hash below
  const html = rd(f);
  const csp = (html.match(/Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
  if (!csp) fail.push(f + ': no Content-Security-Policy');
  if (/unsafe-inline|unsafe-eval/.test(csp)) fail.push(f + ': CSP allows unsafe-inline / unsafe-eval');
  if (!/default-src 'none'/.test(csp)) fail.push(f + ': CSP must start from default-src \'none\'');
  const conn = (csp.match(/connect-src ([^;]*)/) || [])[1] || '';
  if (conn.split(/\s+/).some((t) => t && t !== "'self'" && !['https://api.github.com', 'https://script.google.com', 'https://script.googleusercontent.com'].includes(t))) fail.push(f + ': CSP connect-src may only allow \'self\', https://api.github.com (gist sync) and the Contact Admin relay (script.google.com) — a password manager must not phone home');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)) fail.push(f + ': inline <script>');
  if (/\son[a-z]+=["']/.test(html)) fail.push(f + ': inline event handler');
  if (/<style[\s>]/.test(html) || /\sstyle=["']/.test(html)) fail.push(f + ': inline style');
  if (/(src|href)=["']https?:/.test(html)) fail.push(f + ': remote resource');
}

// 3. app code: no innerHTML / eval / network APIs / plaintext secret storage
for (const f of files.filter((f) => /^js\/.*\.js$/.test(f) || f === 'sw.js')) {
  const s = rd(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(s)) fail.push(f + ': HTML string injection API');
  if (/\beval\(|new Function\(/.test(s)) fail.push(f + ': eval / Function constructor');
  if (f !== 'sw.js' && f !== 'js/wordlist.js' && f !== 'js/sync.js' && f !== 'js/offline.js' && f !== 'js/admin.js' && /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/.test(s.replace(/'[^']*'|"[^"]*"/g, ''))) fail.push(f + ': network API used — VaultManager must make no network requests');
  if (/localStorage\.setItem\([^)]*(password|passphrase|secret|recovery)\b/i.test(s)) fail.push(f + ': secret-looking value written straight to localStorage');
  if (f !== 'js/beam.js' && /RTCPeerConnection/.test(s)) fail.push(f + ': WebRTC is only allowed in js/beam.js');
  if (/console\.(log|debug|info)\(/.test(s)) fail.push(f + ': console logging (could leak secrets)');
}

// 4. service worker precache list matches reality
{
  const sw = rd('sw.js');
  const list = [...(sw.match(/const ASSETS = \[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const a of list) if (a !== './' && !fs.existsSync(path.join(root, a))) fail.push('sw.js precaches missing file ' + a);
  for (const f of files.filter((f) => /^js\/.*\.js$/.test(f))) if (!list.includes(f)) fail.push('sw.js does not precache ' + f + ' (offline use would break)');
}

// 4b. the committed single-file offline copy is built from the current source
{
  const { buildOffline, OUT_FILE } = await import('./build-offline.mjs');
  const built = await buildOffline();
  const have = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (have !== built.html) fail.push('offline/VaultManager-offline.html is out of date — run "npm run build:offline" and commit it');
  const sum = fs.existsSync(OUT_FILE + '.sha256') ? fs.readFileSync(OUT_FILE + '.sha256', 'utf8') : '';
  if (!sum.startsWith(built.digest)) fail.push('offline/VaultManager-offline.html.sha256 does not match — run "npm run build:offline"');
  const off = fs.readFileSync(path.join(root, 'js/offline.js'), 'utf8');
  if (/https?:\/\//.test(off.replace(/\/\*[\s\S]*?\*\//g, ''))) fail.push('js/offline.js must only request same-origin files');
}

// 5. nothing that looks like a secret is committed
const SECRET = [/ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /xox[bap]-[0-9A-Za-z-]{20,}/, /sk-[A-Za-z0-9]{32,}/];
for (const f of files.filter((f) => own(f) && !f.startsWith('offline/') && /\.(js|html|json|md|yml|webmanifest|css)$/.test(f) && !f.startsWith('node_modules/') && f !== 'package-lock.json')) {
  const s = rd(f); for (const re of SECRET) if (re.test(s)) fail.push(f + ': looks like a committed secret (' + re + ')');
}

if (fail.length) { console.error('Lint failed:\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('Lint OK (' + files.length + ' files checked)');
