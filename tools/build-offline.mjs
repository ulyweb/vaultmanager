#!/usr/bin/env node
/* Builds dist/VaultManager-offline.html — the whole app in ONE file. Keep it on a USB stick, e-mail it to
   yourself, double-click it on a PC or open it on a phone: it needs no server, no install and no internet.

   • all JavaScript is bundled (esbuild) and inlined, the stylesheet and icon are inlined,
   • the QR libraries travel inside the file and run from blob: URLs,
   • the Content-Security-Policy is rewritten to allow exactly the two inline blocks by SHA-256 hash (no 'unsafe-inline'),
   • the only network host it may ever contact is api.github.com (optional gist sync). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const version = JSON.parse(rd('package.json')).version;
const sha = (t) => 'sha256-' + crypto.createHash('sha256').update(t).digest('base64');

const res = await build({ entryPoints: [path.join(root, 'js/app.js')], bundle: true, format: 'iife', target: 'es2022', write: false, legalComments: 'none', logLevel: 'silent' });
let js = res.outputFiles[0].text;
const iconUri = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'icons/icon.svg')).toString('base64');
js = js.split('"icons/icon.svg"').join(JSON.stringify(iconUri));
if (/<\/script/i.test(js)) throw new Error('bundle contains "</script" — cannot be inlined safely');
if (/\bimport\s*\(|\bexport\s+(default|const|function|class)\b/.test(js.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, ''))) throw new Error('bundle still contains module syntax');
const css = rd('css/style.css');
const vendor = { 'vendor/qrcode.js': rd('vendor/qrcode.js'), 'vendor/jsQR.js': rd('vendor/jsQR.js') };
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);   // line / paragraph separators break inline JSON in some parsers
const embed = JSON.stringify(vendor).split('<').join('\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

const csp = `default-src 'none'; script-src '${sha(js)}' blob:; style-src '${sha(css)}'; img-src data: blob:; connect-src https://api.github.com; media-src blob:; font-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`;
let html = rd('index.html');
const swap = (re, to) => { const n = html.replace(re, to); if (n === html) throw new Error('template changed: ' + re); html = n; };
swap(/<meta http-equiv="Content-Security-Policy"[^>]*>/, () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
swap(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${iconUri}" type="image/svg+xml">`);
swap(/\n<link rel="apple-touch-icon"[^>]*>/, () => '');
swap(/\n<link rel="manifest"[^>]*>/, () => '');
swap(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`);
swap(/<script type="module" src="js\/app\.js"><\/script>/, () => `<script id="vm-embed" type="application/json">${embed}</script>\n<script>${js}</script>`);
html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n<!-- VaultManager v${version} — single-file offline build. Verify with the .sha256 file next to it. -->`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const outFile = path.join(root, 'dist/VaultManager-offline.html');
fs.writeFileSync(outFile, html);
const digest = crypto.createHash('sha256').update(html).digest('hex');
fs.writeFileSync(outFile + '.sha256', `${digest}  VaultManager-offline.html\n`);
console.log(`dist/VaultManager-offline.html  ${(html.length / 1024).toFixed(0)} KB  sha256 ${digest.slice(0, 16)}…`);
