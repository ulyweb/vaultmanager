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

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('EXTERNAL REQUEST: ' + r.url()); });
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
