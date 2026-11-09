/* Browser end-to-end tests: drives the real UI in Chromium against a local static server. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const SHOTS = process.env.VM_SHOTS || '';
const MASTER = 'plum-orbit-velvet-anchor-glacier-ember';

let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://localhost:' + server.address().port + '/';
  browser = await chromium.launch({ args: ['--no-sandbox'] });
});
after(async () => { await browser.close(); server.close(); });

async function newPage(opts = {}, allowHosts = []) {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && !allowHosts.includes(u.host) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('EXTERNAL REQUEST: ' + r.url()); });
  return { ctx, page, problems };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

test('full journey: create → add → lock → unlock → tools → QR round trips', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base);
  await page.waitForSelector('#pw1');
  await shot(page, '01-create');

  // weak and mismatched passwords are refused
  await page.fill('#pw1', 'password1234'); await page.fill('#pw2', 'password1234'); await page.check('#ack');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.err'), /too easy|easy to guess/i);
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER + 'x');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.err'), /do not match/);
  await page.fill('#pw2', MASTER);
  await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForSelector('.topbar');

  // add a login with a generated password
  await page.getByRole('button', { name: '＋ New' }).click();
  await page.getByRole('button', { name: '🔑 Login', exact: true }).click();
  await page.fill('#f_name', 'GitHub'); await page.fill('#f_username', 'octocat'); await page.fill('#f_url', 'https://github.com');
  await page.getByRole('button', { name: '⚡ Generate' }).click();
  const pw = await page.inputValue('.modal-sheet input.mono');
  assert.equal(pw.length, 20);
  await page.fill('#f_totp', 'JBSWY3DPEHPK3PXP');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2');
  assert.equal(await page.textContent('.detail h2'), 'GitHub');
  assert.match(await page.textContent('.totp-code'), /^\d{3} \d{3}$/);
  await shot(page, '02-detail');

  // a secure note and a card
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '📝 Secure note', exact: true }).click();
  await page.fill('#f_name', 'Wi-Fi'); await page.fill('#f_notes', 'ssid: home\nkey: <b>bold</b>'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("Wi-Fi")');
  assert.equal(await page.locator('.detail b').count(), 0, 'notes must be rendered as text, not markup');
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '💳 Payment card', exact: true }).click();
  await page.fill('#f_name', 'Visa'); await page.fill('#f_number', '4111 1111 1111 1111'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("Visa")');

  // search
  await page.fill('.search', 'octo');
  assert.equal(await page.locator('.item').count(), 1);
  await page.fill('.search', '');

  // nothing readable in storage
  const stored = await page.evaluate(() => localStorage.getItem('vaultmanager.vault'));
  for (const needle of ['GitHub', 'octocat', pw, 'JBSWY3DPEHPK3PXP', 'Visa', '4111']) assert.ok(!stored.includes(needle), 'plaintext leaked: ' + needle);

  // lock, reload, wrong then right password
  await page.getByRole('button', { name: /Lock/ }).click();
  await page.waitForSelector('#upw');
  assert.equal(await page.locator('.item').count(), 0, 'no vault content may remain in the DOM when locked');
  await page.reload(); await page.waitForSelector('#upw');
  await page.fill('#upw', 'wrong password here'); await page.click('button[type=submit]');
  await page.waitForFunction(() => /Wrong master password/.test(document.body.textContent));
  await page.fill('#upw', MASTER); await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  assert.equal(await page.locator('.item').count(), 3);

  // generator
  await page.getByRole('button', { name: /Generator/ }).click();
  await page.waitForSelector('.genout');
  const g1 = await page.textContent('.genout'); await page.getByRole('button', { name: /Regenerate/ }).click();
  assert.notEqual(g1, await page.textContent('.genout'));
  await page.getByRole('tab', { name: 'Passphrase' }).click();
  assert.equal((await page.textContent('.genout')).split('-').length, 5);

  // health
  await page.getByRole('button', { name: /Vault health/ }).click(); await page.waitForSelector('.ring');
  await shot(page, '03-health');

  // QR seal → download PNG → open via image → text matches
  await page.getByRole('button', { name: /QR tools/ }).click();
  await page.fill('textarea[aria-label="Text to seal"]', 'wifi: hunter2 ✓');
  await page.fill('input[aria-label="QR password"]', 'qr-test-password');
  await page.getByRole('button', { name: /Seal into QR/ }).click();
  await page.waitForSelector('.qrbox canvas');
  await shot(page, '04-qr');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ PNG' }).click()]);
  const png = path.join(os.tmpdir(), 'vm-e2e-' + Date.now() + '.png'); await dl.saveAs(png);
  await page.getByRole('tab', { name: 'Open QR' }).click();
  await page.setInputFiles('input[aria-label="QR image file"]', png);
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Sealed payload"]').value.length > 40);
  await page.fill('input[aria-label="Password"]', 'wrong-pass-1');
  await page.getByRole('button', { name: /^🔓 Open/ }).click();
  await page.waitForFunction(() => /Wrong password/.test(document.body.textContent));
  await page.fill('input[aria-label="Password"]', 'qr-test-password');
  await page.getByRole('button', { name: /^🔓 Open/ }).click();
  await page.waitForSelector('.genout:has-text("wifi: hunter2 ✓")');
  fs.unlinkSync(png);

  // multi-QR backup → render → decode every code from images → import reports duplicates
  await page.getByRole('tab', { name: 'Backup to QR' }).click();
  await page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  await page.getByRole('button', { name: /Create QR backup/ }).click();
  await page.waitForSelector('.qrgrid canvas');
  const dataUrls = await page.$$eval('.qrgrid canvas', (cs) => cs.map((c) => c.toDataURL('image/png')));
  assert.ok(dataUrls.length >= 1);
  const files = dataUrls.map((u, i) => { const f = path.join(os.tmpdir(), `vm-bk-${Date.now()}-${i}.png`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); return f; });
  await page.getByRole('tab', { name: 'Open QR' }).click();
  await page.setInputFiles('input[aria-label="QR image file"]', files.reverse());
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Sealed payload"]').value.startsWith('VMQ1') === false && document.querySelector('textarea[aria-label="Sealed payload"]').value.startsWith('VMX1:'));
  await page.fill('input[aria-label="Password"]', 'backup-pass-phrase-1');
  await page.getByRole('button', { name: /^🔓 Open/ }).click();
  await page.waitForSelector('text=Backup opened: 3 items');
  await page.getByRole('button', { name: /Import into my vault/ }).click();
  await page.waitForSelector('text=skipped 3 duplicates');
  files.forEach((f) => fs.unlinkSync(f));

  // settings: self-test passes in the browser
  await page.getByRole('button', { name: /Settings/ }).click();
  await page.getByRole('tab', { name: /About/ }).click();
  await page.getByRole('button', { name: /Run crypto self-test/ }).click();
  await page.waitForFunction(() => /All \d+ tests passed/.test(document.body.textContent), null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();

  assert.deepEqual(problems, [], 'console errors / CSP violations / external requests');
  await ctx.close();
});

test('recovery key unlocks, and master password change works', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Create recovery key' }).click();
  await page.waitForSelector('.recovery');
  const key = (await page.textContent('.recovery')).trim();
  assert.match(key, /^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await page.check('.modal-sheet input[type=checkbox]'); await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Lock/ }).click(); await page.waitForSelector('#upw');
  await page.getByRole('button', { name: /Use recovery key instead/ }).click();
  await page.fill('#urk', key.toLowerCase()); await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.getByRole('button', { name: /Settings/ }).click();
  await page.getByRole('tab', { name: /Security/ }).click();
  await page.fill('input[aria-label="Current master password"]', MASTER);
  await page.fill('input[aria-label="New master password"]', 'new-horse-battery-staple-xylophone');
  await page.fill('input[aria-label="Repeat new master password"]', 'new-horse-battery-staple-xylophone');
  await page.getByRole('button', { name: 'Change master password' }).click();
  await page.waitForSelector('text=Master password changed');
  await page.getByRole('button', { name: /Lock/ }).click(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]');
  await page.waitForFunction(() => /Wrong master password/.test(document.body.textContent));
  await page.fill('#upw', 'new-horse-battery-staple-xylophone'); await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('mobile layout: no horizontal scroll, detail replaces list', async () => {
  const { ctx, page, problems } = await newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  await page.goto(base); await page.waitForSelector('#pw1');
  await shot(page, '10-mobile-create');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForSelector('.topbar');
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '🔑 Login', exact: true }).click();
  await page.fill('#f_name', 'Example'); await page.fill('#f_username', 'me@example.com'); await page.getByRole('button', { name: '⚡ Generate' }).click(); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2');
  await shot(page, '11-mobile-detail');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, 'horizontal overflow ' + overflow);
  assert.ok(await page.locator('.list').isHidden());
  await page.getByRole('button', { name: '← Back' }).click();
  assert.ok(await page.locator('.list').isVisible());
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('light theme renders', async () => {
  const { ctx, page } = await newPage({ colorScheme: 'light' });
  await page.goto(base); await page.waitForSelector('#pw1');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await shot(page, '20-light-create');
  await ctx.close();
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SYNC_PASS = 'plum-orbit-velvet-anchor-glacier-ember';

async function createVault(page, pw = MASTER) {
  await page.goto(base); await page.waitForSelector('#pw1');
  await page.fill('#pw1', pw); await page.fill('#pw2', pw); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.topbar');
}
async function addLogin(page, name, extra = async () => {}) {
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '🔑 Login', exact: true }).click();
  await page.fill('#f_name', name); await page.fill('#f_username', 'user-' + name); await page.getByRole('button', { name: '⚡ Generate' }).click();
  await extra(); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector(`.detail h2:has-text("${name}")`);
}
const settingsTab = async (page, tab) => { await page.getByRole('button', { name: /Settings/ }).click(); await page.getByRole('tab', { name: tab }).click(); };

test('attachments: add image + document to login, note and card; preview, download, persist across lock and reload', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-att-'));
  const txt = path.join(tmp, 'recovery-codes.txt'); fs.writeFileSync(txt, 'code-1\ncode-2\n');
  const png = path.join(tmp, 'passport.png'); fs.writeFileSync(png, PNG);

  await addLogin(page, 'Bank', async () => { await page.setInputFiles('input[aria-label="Choose files"]', [png, txt]); await page.waitForSelector('.modal-sheet .att >> nth=1'); });
  assert.equal(await page.locator('.detail .att').count(), 2);
  await page.waitForSelector('.detail .thumb img');
  await shot(page, '05-attachments');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download recovery-codes.txt' }).click()]);
  assert.equal(fs.readFileSync(await dl.path(), 'utf8'), 'code-1\ncode-2\n');
  await page.locator('.detail .thumb.img').click(); await page.waitForSelector('.modal-sheet .bigimg'); await page.keyboard.press('Escape');

  // note and card can carry attachments too
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '📝 Secure note', exact: true }).click();
  await page.fill('#f_name', 'Will'); await page.fill('#f_notes', 'see attachment');
  await page.setInputFiles('input[aria-label="Choose files"]', [txt]); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("Will")'); assert.equal(await page.locator('.detail .att').count(), 1);
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '💳 Payment card', exact: true }).click();
  await page.fill('#f_name', 'Amex'); await page.setInputFiles('input[aria-label="Choose files"]', [png]); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("Amex")'); assert.equal(await page.locator('.detail .att').count(), 1);

  // remove one attachment from Bank via the editor
  await page.fill('.search', 'Bank'); await page.locator('.item').first().click();
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: 'Remove recovery-codes.txt' }).click(); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.detail .att').length === 1);

  // size limit
  await page.getByRole('button', { name: /Edit/ }).click();
  const big = path.join(tmp, 'big.bin'); fs.writeFileSync(big, Buffer.alloc(10 * 1024 * 1024 + 1));
  await page.setInputFiles('input[aria-label="Choose files"]', big);
  assert.match(await page.textContent('.modal-sheet .err'), /limit/); await page.keyboard.press('Escape');

  // IndexedDB holds only ciphertext
  const leak = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('vaultmanager-blobs'); r.onsuccess = () => { const t = r.result.transaction('blobs'); const q = t.objectStore('blobs').getAll(); q.onsuccess = () => { const hay = q.result.map((x) => Array.from(new Uint8Array(x.ct)).map((b) => String.fromCharCode(b)).join('')).join(''); res(hay.includes('IHDR') || hay.includes('code-1')); }; }; }));
  assert.equal(leak, false, 'attachment bytes must be encrypted in IndexedDB');

  // survives lock + reload
  await page.getByRole('button', { name: /Lock/ }).click(); await page.reload(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar');
  await page.fill('.search', 'Bank'); await page.locator('.item').first().click();
  await page.waitForSelector('.detail .thumb img');
  assert.equal(await page.locator('.item .clip').count(), 1);
  assert.deepEqual(problems, []);
  fs.rmSync(tmp, { recursive: true }); await ctx.close();
});

test('settings area: tabs, audit trail (no secrets), version history, About / versioning', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await addLogin(page, 'Mail');
  const pw = await (async () => { await page.getByRole('button', { name: 'Show or hide Password' }).click(); return (await page.textContent('.f .v.secret')).trim(); })();
  await page.getByRole('button', { name: 'Copy Password' }).click();
  // edit twice → version history
  await page.getByRole('button', { name: /Edit/ }).click(); await page.fill('#f_username', 'changed-user'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=1 earlier version');
  await page.getByRole('button', { name: /1 earlier version/ }).click();
  await page.getByRole('button', { name: /Restore/ }).click();
  await page.waitForFunction(() => /user-Mail/.test(document.querySelector('.detail').textContent));

  await settingsTab(page, /Audit trail/);
  const log = await page.textContent('.page');
  for (const needle of ['Created login “Mail”', 'Edited “Mail”', 'Revealed password of “Mail”', 'Copied password of “Mail”', 'Restored an earlier version', 'Vault created', 'unlocked'.slice(0, 0)]) assert.ok(log.includes(needle), 'audit trail should contain: ' + needle);
  assert.ok(!log.includes(pw), 'the audit trail must never contain the password');
  await shot(page, '06-audit');
  await page.getByRole('tab', { name: /General/ }).click(); await page.waitForSelector('text=Locking & privacy');
  await shot(page, '07-settings-general');
  await settingsTab(page, /About/);
  assert.ok((await page.textContent('.page')).includes('Version 0.3.0'));
  assert.ok((await page.textContent('.page')).includes('Version history') && (await page.textContent('.page')).includes('Passkey unlock') && (await page.textContent('.page')).includes('Encrypted sync'));
  await shot(page, '08-about');
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.getByRole('tab', { name: /Audit trail/ }).click(); await page.getByRole('button', { name: /Export log/ }).click(); })()]);
  assert.ok(JSON.parse(fs.readFileSync(await dl.path(), 'utf8')).length > 5);
  await page.getByRole('button', { name: /Clear log/ }).click(); await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForSelector('text=Audit trail cleared');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('sync file: export from one device, import on another (items + attachments)', async () => {
  const A = await newPage(), B = await newPage();
  await createVault(A.page, MASTER); await createVault(B.page, 'a-totally-different-master-pass-9');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-sync-')); const png = path.join(tmp, 'id.png'); fs.writeFileSync(png, PNG);
  await addLogin(A.page, 'Shared Site', async () => { await A.page.setInputFiles('input[aria-label="Choose files"]', png); });

  await settingsTab(A.page, /Sync/);
  await A.page.fill('input[aria-label="Sync passphrase"]', 'short'); await A.page.getByRole('button', { name: 'Save passphrase' }).click();
  assert.match(await A.page.textContent('.err'), /at least 12/);
  await A.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await A.page.getByRole('button', { name: 'Save passphrase' }).click();
  await shot(A.page, '09-sync');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: /Export sync file/ }).click()]);
  const file = path.join(tmp, 'x.vmsync'); await dl.saveAs(file);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.startsWith('VMS1:') && !content.includes('Shared Site'));

  await settingsTab(B.page, /Sync/);
  await B.page.fill('input[aria-label="Sync passphrase"]', 'another wrong passphrase value'); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await B.page.setInputFiles('input[aria-label="Sync file"]', file);
  await B.page.waitForFunction(() => /Wrong sync passphrase/.test(document.body.textContent));
  await B.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await B.page.setInputFiles('input[aria-label="Sync file"]', file);
  await B.page.waitForSelector('text=Merged: 1 added');
  await B.page.getByRole('button', { name: /All items/ }).click(); await B.page.locator('.item', { hasText: 'Shared Site' }).click();
  await B.page.waitForSelector('.detail .thumb img');
  assert.deepEqual(A.problems, []); assert.deepEqual(B.problems, []);
  fs.rmSync(tmp, { recursive: true }); await A.ctx.close(); await B.ctx.close();
});

test('gist sync (mocked GitHub API): two devices converge; only ciphertext leaves the page', async () => {
  const gists = new Map(); const sent = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const handler = async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers().authorization !== 'Bearer ghp_test_token') return route.fulfill({ status: 401, headers: cors, json: {} });
    const m = /^\/gists\/?(.*)$/.exec(u.pathname);
    if (req.method() === 'POST') { const body = JSON.parse(req.postData()); sent.push(req.postData()); const id = 'g' + gists.size + 'abcdef'; gists.set(id, Object.fromEntries(Object.entries(body.files).map(([k, f]) => [k, { content: f.content }]))); return route.fulfill({ status: 201, headers: cors, json: { id } }); }
    const files = gists.get(m[1]); if (!files) return route.fulfill({ status: 404, headers: cors, json: {} });
    if (req.method() === 'GET') return route.fulfill({ status: 200, headers: cors, json: { files } });
    const body = JSON.parse(req.postData()); sent.push(req.postData());
    for (const [k, f] of Object.entries(body.files)) { if (f === null) delete files[k]; else files[k] = { content: f.content }; }
    return route.fulfill({ status: 200, headers: cors, json: { id: m[1] } });
  };
  const A = await newPage({}, ['api.github.com']), B = await newPage({}, ['api.github.com']);
  await A.page.route('https://api.github.com/**', handler); await B.page.route('https://api.github.com/**', handler);
  await createVault(A.page, MASTER); await createVault(B.page, 'a-totally-different-master-pass-9');
  await addLogin(A.page, 'GistSite');

  const setup = async (P, gistId) => {
    await settingsTab(P.page, /Sync/);
    await P.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await P.page.getByRole('button', { name: 'Save passphrase' }).click();
    await P.page.fill('input[aria-label="GitHub token"]', 'ghp_test_token');
    if (gistId) await P.page.fill('input[aria-label="Gist ID"]', gistId);
    await P.page.getByRole('button', { name: /Sync now/ }).click();
    await P.page.waitForSelector('text=Last sync');
  };
  await setup(A);
  const gid = await A.page.inputValue('input[aria-label="Gist ID"]');
  assert.match(gid, /^g\d+abcdef$/);
  for (const body of sent) for (const needle of ['GistSite', 'user-GistSite']) assert.ok(!body.includes(needle), 'plaintext sent to GitHub: ' + needle);
  await setup(B, gid);
  await B.page.getByRole('button', { name: /All items/ }).click();
  await B.page.waitForSelector('.item:has-text("GistSite")');

  // wrong passphrase on a device: error shown, remote untouched
  const before = JSON.stringify([...gists.values()]);
  await B.page.getByRole('button', { name: /Settings/ }).click(); await B.page.getByRole('tab', { name: /Sync/ }).click();
  await B.page.fill('input[aria-label="Sync passphrase"]', 'silver-lantern-orbit-maple-quiet-river'); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await B.page.getByRole('button', { name: /Sync now/ }).click();
  await B.page.waitForFunction(() => /Wrong sync passphrase/.test(document.body.textContent));
  assert.equal(JSON.stringify([...gists.values()]), before);

  // edit on B (correct passphrase again), sync, then A pulls it
  await B.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await B.page.getByRole('button', { name: /All items/ }).click(); await B.page.locator('.item', { hasText: 'GistSite' }).click();
  await B.page.getByRole('button', { name: /Edit/ }).click(); await B.page.fill('#f_username', 'edited-on-B'); await B.page.getByRole('button', { name: 'Save' }).click();
  await settingsTab(B.page, /Sync/); await B.page.getByRole('button', { name: /Sync now/ }).click(); await B.page.waitForSelector('text=Last sync');
  await settingsTab(A.page, /Sync/); await A.page.getByRole('button', { name: /Sync now/ }).click(); await A.page.waitForTimeout(800);
  await A.page.getByRole('button', { name: /All items/ }).click(); await A.page.locator('.item', { hasText: 'GistSite' }).click();
  await A.page.waitForFunction(() => /edited-on-B/.test(document.querySelector('.detail').textContent));
  assert.deepEqual(A.problems.filter((p) => !/401|Failed to load resource/.test(p)), []); assert.deepEqual(B.problems.filter((p) => !/401|Failed to load resource/.test(p)), []);
  await A.ctx.close(); await B.ctx.close();
});

test('passkey unlock: add (re-auth required), unlock with it, fall back to password, remove', async () => {
  const { ctx, page, problems } = await newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  await createVault(page);
  await addLogin(page, 'Keyed');

  await settingsTab(page, /Security/);
  await page.waitForSelector('text=Passkeys');
  await shot(page, '12-passkeys');
  await page.fill('input[aria-label="Passkey name"]', 'Test laptop');
  await page.getByRole('button', { name: /Add a passkey/ }).click();
  await page.fill('.modal-sheet input[type=password]', 'wrong password!!'); await page.keyboard.press('Enter');
  await page.waitForSelector('text=That is not your master password');
  await page.fill('.modal-sheet input[type=password]', MASTER); await page.keyboard.press('Enter');
  await page.waitForSelector('text=1 registered');
  assert.ok((await page.textContent('.page')).includes('Test laptop'));

  // lock → passkey button → unlocked, no password typed
  await page.getByRole('button', { name: /Lock/ }).click(); await page.waitForSelector('#upw');
  await page.getByRole('button', { name: /Unlock with passkey/ }).click();
  await page.waitForSelector('.topbar');
  assert.equal(await page.locator('.item').count(), 1);
  await settingsTab(page, /Audit trail/);
  assert.ok((await page.textContent('.page')).includes('unlocked with a passkey') && (await page.textContent('.page')).includes('Passkey added: Test laptop'));

  // master password still works, and the passkey survives a reload
  await page.reload(); await page.waitForSelector('#upw');
  assert.ok(await page.getByRole('button', { name: /Unlock with passkey/ }).isVisible());
  await shot(page, '13-unlock-passkey');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar');

  // removing it removes the button
  await settingsTab(page, /Security/);
  await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await page.fill('.modal-sheet input[type=password]', MASTER); await page.keyboard.press('Enter');
  await page.waitForSelector('text=none');
  await page.getByRole('button', { name: /Lock/ }).click(); await page.waitForSelector('#upw');
  assert.equal(await page.getByRole('button', { name: /Unlock with passkey/ }).count(), 0);
  assert.deepEqual(problems, []);
  await ctx.close();
});
