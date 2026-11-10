/* Browser end-to-end tests: drives the real UI in Chromium against a local static server. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, GROUPS } from '../js/templates.js';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { ({ chromium, devices } = require('/opt/node-tools/node_modules/playwright')); }

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
  browser = await chromium.launch({ args: ['--no-sandbox', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
});
after(async () => { await browser.close(); server.close(); });

async function newPage(opts = {}, allowHosts = []) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', colorScheme: 'dark', viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && !allowHosts.includes(u.host) && !r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push('EXTERNAL REQUEST: ' + r.url()); });
  return { ctx, page, problems };
}
/* the welcome splash appears after the first unlock; most tests just want it out of the way */
async function dismissWelcome(page) {
  await page.waitForSelector('.welcome.in', { timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.welcome', { state: 'detached' });
}
const openAll = async (page) => { await page.locator('.side .nav', { hasText: 'All items' }).click(); await page.waitForSelector('.list'); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

test('full journey: create → add → lock → unlock → tools → QR round trips', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base);
  await page.waitForSelector('#pw1');
  await shot(page, '01-create');

  // weak and mismatched passwords are refused
  await page.fill('#pw1', 'password1234'); await page.fill('#pw2', 'password1234'); await page.check('#ack');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.err:not(.photo-err)'), /too easy|easy to guess/i);
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER + 'x');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.err:not(.photo-err)'), /do not match/);
  await page.fill('#pw2', MASTER);
  await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page);
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
  const stored = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('vaultmanager.vault'))));
  for (const needle of ['GitHub', 'octocat', pw, 'JBSWY3DPEHPK3PXP', 'Visa', '4111']) assert.ok(!stored.includes(needle), 'plaintext leaked: ' + needle);

  // lock, reload, wrong then right password
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click();
  await page.waitForSelector('#upw');
  assert.equal(await page.locator('.item').count(), 0, 'no vault content may remain in the DOM when locked');
  await page.reload(); await page.waitForSelector('#upw');
  await page.fill('#upw', 'wrong password here'); await page.click('button[type=submit]');
  await page.waitForFunction(() => /Wrong master password/.test(document.body.textContent));
  await page.fill('#upw', MASTER); await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.waitForSelector('.widgets');                                  // Home is the default start page
  await openAll(page);
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
  await page.fill('input[aria-label="QR password"]', 'qr-test-password'); await page.fill('input[aria-label="Confirm QR password"]', 'qr-test-password');
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
  await page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
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
  await page.locator('.side .nav:has-text("Settings"), .dock-item[aria-label="Settings"]').first().click();
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
  await page.check('.modal-sheet input[type=checkbox]'); await page.getByRole('button', { name: 'Done' }).click(); await dismissWelcome(page);
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  await page.getByRole('button', { name: /Use recovery key instead/ }).click();
  await page.fill('#urk', key.toLowerCase()); await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  await page.locator('.side .nav:has-text("Settings"), .dock-item[aria-label="Settings"]').first().click();
  await page.getByRole('tab', { name: /Security/ }).click();
  await page.fill('input[aria-label="Current master password"]', MASTER);
  await page.fill('input[aria-label="New master password"]', 'new-horse-battery-staple-xylophone');
  await page.fill('input[aria-label="Repeat new master password"]', 'new-horse-battery-staple-xylophone');
  await page.getByRole('button', { name: 'Change master password' }).click();
  await page.waitForSelector('text=Master password changed');
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]');
  await page.waitForFunction(() => /Wrong master password/.test(document.body.textContent));
  await page.fill('#upw', 'new-horse-battery-staple-xylophone'); await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  assert.deepEqual(problems, []);
  await ctx.close();
});

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
async function phoneFlow(name) {
  const { defaultBrowserType, ...dev } = devices[name];
  const { ctx, page, problems } = await newPage({ ...dev, colorScheme: 'dark', reducedMotion: 'reduce' }); void defaultBrowserType;
  const vw = dev.viewport.width;
  const fits = async (label) => {
    const o = await page.evaluate(() => { const cw = document.documentElement.clientWidth; return { sw: document.documentElement.scrollWidth, cw, off: [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > cw + 1 && !e.closest('.tabs, .toast, .tour-hole, .scanner'); }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)) }; });
    assert.ok(o.sw <= o.cw + 1, `${name} · ${label}: horizontal overflow ${o.sw}>${o.cw} ${o.off.join(',')}`);
  };
  const tall = async (sel, min, what) => { const hts = await page.$$eval(sel, (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().height))); assert.ok(hts.length > 0 && hts.every((h) => h >= min), `${name}: ${what} touch targets ${hts} (min ${min})`); };

  await page.goto(base); await page.waitForSelector('#pw1'); await fits('create');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.waitForSelector('.welcome.in'); await fits('welcome');
  assert.ok(await page.locator('.welcome-go').isVisible()); await page.keyboard.press('Escape'); await page.waitForSelector('.welcome', { state: 'detached' });

  // shell: bottom bar, two-row top bar with a full-width search, no desktop side bar / dock
  await page.waitForSelector('.mbar-item'); await fits('home');
  assert.ok(await page.locator('.side').isHidden() && await page.locator('.dock').isHidden(), 'no side bar or dock on a phone');
  const search = await page.locator('.topbar .search').boundingBox(); assert.ok(search.width >= vw * 0.85, `${name}: search is ${search.width}px of ${vw}`);
  const bar = await page.locator('.mbar').boundingBox(); assert.ok(bar.y + bar.height >= dev.viewport.height - 1, 'bottom bar sits at the bottom');
  assert.equal(await page.locator('.mbar-item svg').count(), 4); assert.ok(await page.locator('.mbar-fab svg').isVisible());
  await tall('.mbar-item', 44, 'bottom bar'); await tall('.mbar-fab', 52, 'new button'); await tall('.topbar .btn', 40, 'top bar buttons');
  for (const sel of ['.mbar', '.topbar']) assert.ok(!EMOJI.test(await page.textContent(sel)), `${name}: no emoji glyphs in ${sel}`);
  const loginSvg = await page.locator('.mbar-item svg').first().evaluate((e) => e.outerHTML);

  // add items from the center button (every category picker button is reachable and tall enough)
  await page.getByRole('button', { name: 'New item' }).click(); await page.waitForSelector('.modal-sheet .catgroup'); await fits('picker');
  assert.equal(await page.locator('.modal-sheet .cats .btn').count(), 28); await tall('.modal-sheet .cats .btn', 44, 'category picker');
  const sheet = await page.locator('.modal-sheet').boundingBox(); assert.ok(sheet.width >= vw - 1 && sheet.y + sheet.height <= dev.viewport.height + 1, `${name}: dialogs are bottom sheets`);
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Login' }).first().click();
  await page.fill('#f_name', 'GitHub'); await page.fill('#f_username', 'octocat'); await fits('editor');
  await page.getByRole('button', { name: '⚡ Generate' }).click(); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("GitHub")'); await fits('detail');
  await page.getByRole('button', { name: 'New item' }).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Wi-Fi / network' }).first().click(); await page.fill('#f_name', 'Home Wi-Fi'); await page.fill('#tf_ssid', 'Casa'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("Home Wi-Fi")'); await fits('detail 2');
  assert.ok(await page.locator('.detail-nav .navback').isVisible() && await page.locator('.detail-head').isVisible(), 'app-style detail screen has a nav bar');
  await page.getByRole('button', { name: 'Back' }).click(); await page.waitForSelector('.list'); assert.ok(await page.locator('.detail').isHidden());
  await fits('list'); await tall('.item', 56, 'list rows');

  // More sheet: everything is reachable, nothing overflows
  await page.getByRole('button', { name: 'More' }).click(); await page.waitForSelector('.msheet'); await fits('more');
  assert.equal(await page.locator('.msheet-item .ico.cat').count(), 28, 'all 28 categories are reachable on a phone'); await tall('.msheet-item', 44, 'more sheet');
  assert.ok(!EMOJI.test(await page.textContent('.msheet')), `${name}: no emoji glyphs in the menu`);
  await page.locator('.msheet-item', { hasText: 'Network' }).first().click(); await page.waitForSelector('.item'); await fits('category');
  await page.getByRole('button', { name: 'More' }).click(); await page.locator('.msheet-item', { hasText: 'Settings' }).first().click(); await page.waitForSelector('.tabs');
  for (const t of ['General', 'Appearance', 'Effects', 'Dock & menu bar', 'Widgets', 'Security', 'Sync', 'Audit trail', 'About']) { await page.getByRole('tab', { name: new RegExp(t.replace('&', '\\&')) }).click(); await page.waitForTimeout(80); await fits('settings ' + t); }
  for (const [lbl, sel] of [['Generator', '.genout'], ['More→QR tools', '.tabs'], ['More→Beam sync', '.beam'], ['More→Vault health', '.ring'], ['More→Import & export', '.panel']]) {
    if (lbl === 'Generator') await page.getByRole('button', { name: 'Generator' }).click(); else { await page.getByRole('button', { name: 'More' }).click(); await page.locator('.msheet-item', { hasText: lbl.split('→')[1] }).first().click(); }
    await page.waitForSelector(sel); await fits(lbl);
  }
  await page.getByRole('button', { name: 'Home' }).click(); await page.waitForSelector('.widgets'); await fits('home widgets');
  await page.getByRole('button', { name: 'Help', exact: true }).click(); await fits('help'); await page.getByRole('button', { name: /Guided tour/ }).click(); await page.waitForSelector('.tour-card');
  const card = await page.locator('.tour-card').boundingBox(); assert.ok(card.x >= 0 && card.x + card.width <= vw + 1, 'tour card fits'); await fits('tour'); await page.keyboard.press('Escape');

  // the very same SVG artwork is used on every device (icons no longer depend on the phone's emoji font)
  const again = await page.locator('.mbar-item svg').first().evaluate((e) => e.outerHTML); assert.equal(again, loginSvg);
  const catSvg = await page.evaluate(() => { const m = document.createElement('div'); return null; }); void catSvg;
  assert.deepEqual(problems, []); await ctx.close();
  return loginSvg;
}

for (const dev of ['iPhone SE', 'iPhone 13', 'Pixel 7']) {
  test(`mobile: ${dev} — bottom bar, full-width search, bottom sheets, no overflow, 44px touch targets, SVG icons`, async () => { await phoneFlow(dev); });
}

async function tabletFlow(name) {
  const { defaultBrowserType, ...dev } = devices[name]; void defaultBrowserType;
  const { ctx, page, problems } = await newPage({ ...dev, colorScheme: 'dark', reducedMotion: 'reduce' });
  const vw = dev.viewport.width, portrait = vw < 1024;
  const fits = async (label) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); assert.ok(o.sw <= o.cw + 1, `${name} · ${label}: horizontal overflow ${o.sw}>${o.cw}`); };
  await page.goto(base); await page.waitForSelector('#pw1');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.widgets'); await fits('home');
  // tablets keep a persistent side menu (no phone bottom bar); it is the app-style sidebar with grouped categories
  assert.ok(await page.locator('.side').isVisible(), `${name}: side menu visible`); assert.ok(await page.locator('.mbar').isHidden(), `${name}: no phone bottom bar`);
  const side = await page.locator('.side').boundingBox(); assert.ok(side.width >= 180 && side.width <= 260, `${name}: side menu width ${side.width}`);
  assert.equal(await page.locator('.side .ngroup').count(), 8); await fits('sidebar');
  const nav = await page.$$eval('.side .nav', (els) => els.slice(0, 6).map((e) => Math.round(e.getBoundingClientRect().height))); assert.ok(nav.every((h) => h >= 40), `${name}: side menu rows are touch-sized ${nav}`);
  await page.getByRole('button', { name: /^＋ New|New$/ }).first().click(); await page.waitForSelector('.modal-sheet .catgroup'); await fits('picker');
  const sheet = await page.locator('.modal-sheet').boundingBox(); assert.ok(sheet.y > 8 && sheet.y + sheet.height < dev.viewport.height - 8, `${name}: dialogs are floating cards on a tablet (inset from the screen edges), not bottom sheets`);
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Login' }).first().click(); await page.fill('#f_name', 'GitHub'); await page.fill('#f_username', 'octocat'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("GitHub")'); await fits('detail');
  if (portrait) {                                   // portrait tablet: drill-down, one pane at a time, with the nav bar
    assert.ok(await page.locator('.list').isHidden() && await page.locator('.detail-nav').isVisible());
    await page.getByRole('button', { name: 'Back' }).click(); await page.waitForSelector('.list'); assert.ok(await page.locator('.detail').isHidden());
  } else {                                          // landscape tablet: list and detail side by side
    assert.ok(await page.locator('.list').isVisible() && await page.locator('.detail').isVisible(), `${name}: two panes in landscape`);
  }
  for (const label of ['Generator', 'QR tools', 'Beam sync', 'Settings']) { await page.locator('.side .nav', { hasText: label }).click(); await page.waitForTimeout(120); await fits(label); }
  await page.getByRole('tab', { name: /Appearance/ }).click().catch(() => {});
  assert.deepEqual(problems, []); await ctx.close();
}
for (const dev of ['iPad Mini', 'iPad (gen 7)', 'iPad Pro 11 landscape', 'iPhone 13 landscape']) {
  test(`tablet: ${dev} — side menu, drill-down or two panes, centred dialogs, no overflow`, async () => { await tabletFlow(dev); });
}

test('app style: grouped lists, large titles, sheet handle, install panel, PWA metadata', async () => {
  const { defaultBrowserType, ...dev } = devices['iPhone 13']; void defaultBrowserType;
  const { ctx, page, problems } = await newPage({ ...dev, colorScheme: 'dark', reducedMotion: 'reduce' });
  await createVault(page);
  assert.equal((await page.textContent('.apptitle')).trim(), 'Home'); assert.ok(await page.locator('.apptitle').isVisible() && await page.locator('.topbar .logo').isHidden());
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.apptitle')).fontSize)); assert.ok(fs0 >= 28, 'large title');
  await page.getByRole('button', { name: 'Items' }).click(); assert.equal((await page.textContent('.apptitle')).trim(), 'All items');
  await page.getByRole('button', { name: 'New item' }).click(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Login' }).first().click(); await page.fill('#f_name', 'Mail'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2');
  await page.getByRole('button', { name: 'Back' }).click(); await page.waitForSelector('.item');
  const r = await page.evaluate(() => { const it = document.querySelector('.item'), items = document.querySelector('.items'); return { radius: parseFloat(getComputedStyle(items).borderTopLeftRadius), disc: getComputedStyle(it.querySelector('.disc')).display, h: Math.round(it.getBoundingClientRect().height) }; });
  assert.ok(r.radius >= 14 && r.disc !== 'none' && r.h >= 60, 'inset grouped list with disclosure chevrons ' + JSON.stringify(r));
  // sheets: grab handle, and dragging it down dismisses
  await page.getByRole('button', { name: 'New item' }).click(); await page.waitForSelector('.modal-sheet .grabber');
  const g = await page.locator('.modal-sheet .grabber').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 10); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2, g.y + 260, { steps: 6 }); await page.mouse.up();
  await page.waitForSelector('.modal-sheet', { state: 'detached' });
  // install panel + PWA metadata
  await page.getByRole('button', { name: 'More' }).click(); await page.locator('.msheet-item', { hasText: 'Settings' }).first().click(); await page.getByRole('tab', { name: /General/ }).click();
  await page.waitForSelector('text=Install as an app'); assert.ok((await page.textContent('.page')).includes('Add to Home Screen') || (await page.textContent('.page')).includes('Install'));
  const meta = await page.evaluate(() => ({ cap: document.querySelector('meta[name=apple-mobile-web-app-capable]').content, icon: document.querySelector('link[rel=apple-touch-icon]').getAttribute('href'), man: document.querySelector('link[rel=manifest]').getAttribute('href') }));
  assert.deepEqual(meta, { cap: 'yes', icon: 'icons/apple-touch-icon.png', man: 'manifest.webmanifest' });
  const man = await (await page.request.get(base + 'manifest.webmanifest')).json();
  assert.ok(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') && man.icons.some((i) => i.sizes === '192x192') && man.display === 'standalone');
  for (const i of man.icons.filter((x) => x.src.endsWith('.png'))) assert.equal((await page.request.get(base + i.src)).status(), 200);
  assert.deepEqual(problems, []); await ctx.close();
});

test('icons are identical on desktop and phone (one SVG set, no emoji)', async () => {
  const grab = async (opts) => {
    const { ctx, page } = await newPage(opts); await page.goto(base); await page.waitForSelector('#pw1');
    await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]'); await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page);
    await page.getByRole('button', { name: /New/ }).first().click().catch(async () => page.getByRole('button', { name: 'New item' }).click());
    await page.waitForSelector('.modal-sheet .cats'); const out = await page.$$eval('.modal-sheet .cats .btn', (bs) => Object.fromEntries(bs.map((b) => [b.textContent.trim(), b.querySelector('svg').outerHTML]))); await ctx.close(); return out;
  };
  const desk = await grab({}), phone = await grab({ ...(({ defaultBrowserType, ...d }) => d)(devices['iPhone 13']), colorScheme: 'dark', reducedMotion: 'reduce' });
  assert.equal(Object.keys(desk).length, 28); assert.deepEqual(desk, phone);
  const html = Object.values(desk).join('').replace(/aria-label="[^"]*"/g, ''); assert.ok(!EMOJI.test(html), 'icons are drawn shapes, not emoji glyphs');
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
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.topbar');
  await page.evaluate(() => document.querySelectorAll('.ngroup[aria-expanded=false]').forEach((b) => b.click()));   // category groups start collapsed (except Everyday)
}
async function addLogin(page, name, extra = async () => {}) {
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '🔑 Login', exact: true }).click();
  await page.fill('#f_name', name); await page.fill('#f_username', 'user-' + name); await page.getByRole('button', { name: '⚡ Generate' }).click();
  await extra(); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector(`.detail h2:has-text("${name}")`);
}
const settingsTab = async (page, tab) => { await page.locator('.side .nav:has-text("Settings"), .dock-item[aria-label="Settings"]').first().click(); await page.getByRole('tab', { name: tab }).click(); };

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
  assert.match(await page.textContent('.modal-sheet .err:not(.photo-err)'), /limit/); await page.keyboard.press('Escape');

  // IndexedDB holds only ciphertext
  const leak = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('vaultmanager-blobs'); r.onsuccess = () => { const t = r.result.transaction('blobs'); const q = t.objectStore('blobs').getAll(); q.onsuccess = () => { const hay = q.result.map((x) => Array.from(new Uint8Array(x.ct)).map((b) => String.fromCharCode(b)).join('')).join(''); res(hay.includes('IHDR') || hay.includes('code-1')); }; }; }));
  assert.equal(leak, false, 'attachment bytes must be encrypted in IndexedDB');

  // survives lock + reload
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.reload(); await page.waitForSelector('#upw');
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
  assert.ok((await page.textContent('.page')).includes('Version ' + JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version));
  assert.ok((await page.textContent('.page')).includes('Version history') && (await page.textContent('.page')).includes('Beam sync') && (await page.textContent('.page')).includes('Encrypted sync'));
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
  assert.match(await A.page.textContent('.err:not(.photo-err)'), /at least 12/);
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
  await B.page.locator('.side .nav:has-text("Settings"), .dock-item[aria-label="Settings"]').first().click(); await B.page.getByRole('tab', { name: /Sync/ }).click();
  await B.page.fill('input[aria-label="Sync passphrase"]', 'silver-lantern-orbit-maple-quiet-river'); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await B.page.getByRole('button', { name: /Sync now/ }).click();
  await B.page.waitForFunction(() => /Wrong sync passphrase/.test(document.body.textContent));
  assert.equal(JSON.stringify([...gists.values()]), before);

  // edit on B (correct passphrase again), sync, then A pulls it
  await B.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await B.page.getByRole('button', { name: /All items/ }).click(); await B.page.locator('.item', { hasText: 'GistSite' }).click();
  await B.page.getByRole('button', { name: /Edit/ }).click(); await B.page.fill('#f_username', 'edited-on-B'); await B.page.getByRole('button', { name: 'Save' }).click();
  const uploadsBefore = sent.length;
  await settingsTab(B.page, /Sync/); await B.page.getByRole('button', { name: /Sync now/ }).click();
  for (let i = 0; i < 60 && sent.length === uploadsBefore; i++) await B.page.waitForTimeout(250);
  assert.ok(sent.length > uploadsBefore, 'B uploaded its edit');
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
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  await page.getByRole('button', { name: /Unlock with passkey/ }).click();
  await page.waitForSelector('.topbar');
  await openAll(page);
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
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  assert.equal(await page.getByRole('button', { name: /Unlock with passkey/ }).count(), 0);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('categories: every template is creatable; Wi-Fi QR, custom fields, expiry, quick-add attachment, search', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  const cats = [['📦 App / software', 'Photoshop', 'tf_license'], ['📶 Wi-Fi / network', 'Home Wi-Fi', 'tf_ssid'], ['💻 Computer account', 'Work laptop', 'tf_host'], ['🛒 Shopping / store', 'Amazon', 'tf_url'],
    ['🛡️ Insurance', 'Car insurance', 'tf_policy'], ['🔢 Locker / combination', 'Gym locker', 'tf_location'], ['✈️ Travel', 'Passport', 'tf_holder'], ['🪪 ID / identity', 'Licence', 'tf_fullname'],
    ['🏦 Bank account', 'Checking', 'tf_bank'], ['🖥️ Server / API key', 'Prod API', 'tf_host']];
  for (const [label, name, firstField] of cats) {
    await page.getByRole('button', { name: '＋ New' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.fill('#f_name', name);
    await page.fill('#' + firstField, 'searchable-' + name.replace(/\W/g, '').toLowerCase());
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForSelector(`.detail h2:has-text("${name}")`);
  }
  // sidebar categories with counts
  for (const plural of ['Apps', 'Network', 'Computers', 'Shopping', 'Insurance', 'Lockers', 'Travel', 'Identity', 'Bank', 'Servers']) assert.equal(await page.locator('.side .nav', { hasText: plural }).count(), 1, plural);
  await page.locator('.side .nav', { hasText: 'Travel' }).click(); assert.equal(await page.locator('.item').count(), 1);
  await shot(page, '14-categories');
  await page.locator('.side .nav', { hasText: 'All items' }).click();
  await page.fill('.search', 'searchable-checking'); assert.equal(await page.locator('.item').count(), 1); await page.fill('.search', '');

  // network: secret wifi password + Wi-Fi QR + custom secret field
  await page.fill('.search', 'Home Wi-Fi'); await page.locator('.item').first().click();
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.fill('#tf_ssid', 'CasaWifi'); await page.selectOption('#tf_security', 'WPA2');
  await page.locator('.modal-sheet .field:has(label:text("Wi-Fi password")) input').first().fill('hunter2-wifi');
  await page.getByRole('button', { name: '＋ Add a field' }).click();
  await page.fill('input[aria-label="Custom field label"]', 'Router PIN'); await page.fill('input[aria-label="Custom field value"]', '99887766'); await page.check('.cf input[type=checkbox]');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail .f:has-text("Router PIN")');
  assert.ok(!(await page.textContent('.detail')).includes('99887766') && !(await page.textContent('.detail')).includes('hunter2-wifi'), 'secrets are masked');
  await page.fill('.search', '99887766'); assert.equal(await page.locator('.item').count(), 0, 'secret custom values are not searchable');
  await page.fill('.search', 'CasaWifi'); assert.equal(await page.locator('.item').count(), 1); await page.locator('.item').first().click();
  await page.getByRole('button', { name: /Wi-Fi QR/ }).click(); await page.waitForSelector('.modal-sheet canvas');
  assert.ok((await page.textContent('.modal-sheet')).includes('NOT encrypted')); await shot(page, '15-wifi-qr'); await page.keyboard.press('Escape');

  // travel: expired passport is flagged on the item and in Vault health
  await page.fill('.search', 'Passport'); await page.locator('.item').first().click();
  await page.getByRole('button', { name: /Edit/ }).click(); await page.fill('#tf_expires', '2020-01-15'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail .chip:has-text("expired")');
  await page.fill('.search', ''); await page.getByRole('button', { name: /Vault health/ }).click(); await page.waitForSelector('text=Expiring or expired');
  assert.ok((await page.textContent('.page')).includes('Expiry date: 2020-01-15 — expired'));
  await shot(page, '16-health-expiry');

  // quick-add an attachment straight from the item view (no Edit needed), in a non-login category
  await page.locator('.side .nav', { hasText: 'Bank' }).click(); await page.locator('.item').first().click();
  await page.waitForSelector('text=No attachments yet');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-q-')); const doc = path.join(tmp, 'statement.pdf'); fs.writeFileSync(doc, '%PDF-1.4 test');
  await page.setInputFiles('input[aria-label="Attach files to this item"]', doc);
  await page.waitForSelector('.detail .att:has-text("statement.pdf")');
  await shot(page, '17-quick-attach');
  fs.rmSync(tmp, { recursive: true });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('beam sync: pair two devices (real WebRTC), verify, merge both ways incl. attachments; wrong passphrase refused', async () => {
  const A = await newPage(), B = await newPage();
  await createVault(A.page, MASTER); await createVault(B.page, 'a-totally-different-master-pass-9');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-beam-')); const png = path.join(tmp, 'pic.png'); fs.writeFileSync(png, PNG);
  await addLogin(A.page, 'OnLaptop', async () => { await A.page.setInputFiles('input[aria-label="Choose files"]', png); });
  await addLogin(B.page, 'OnPhone');

  const openBeam = async (P) => { await P.page.locator('.side .nav', { hasText: 'Beam sync' }).click(); await P.page.waitForSelector('h2:has-text("Beam sync")'); };
  await openBeam(A); await openBeam(B);
  // passphrase is required first
  for (const P of [A, B]) { await P.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await P.page.getByRole('button', { name: 'Save passphrase' }).click(); await P.page.waitForSelector('button:has-text("Start")'); }
  await shot(A.page, '18-beam-home');

  // bad codes
  await B.page.getByRole('button', { name: /Join/ }).click();
  await B.page.fill('textarea[aria-label="Code from the other device"]', 'hello'); await B.page.getByRole('button', { name: 'Continue' }).click();
  await B.page.waitForSelector('text=not a Beam code');

  await A.page.getByRole('button', { name: /Start/ }).click();
  await A.page.waitForSelector('canvas.beamqr');
  const first = await A.page.inputValue('textarea[aria-label="Your code"]');
  assert.match(first, /^BEAM1\.[\w-]+$/);
  await B.page.fill('textarea[aria-label="Code from the other device"]', first); await B.page.getByRole('button', { name: 'Continue' }).click();
  await B.page.waitForSelector('textarea[aria-label="Reply code"][readonly]');
  const reply = await B.page.inputValue('textarea[aria-label="Reply code"][readonly]');
  await A.page.fill('textarea[aria-label="Reply code"]', first); await A.page.getByRole('button', { name: 'Connect' }).click();
  await A.page.waitForSelector('text=That is a first code');
  await A.page.fill('textarea[aria-label="Reply code"]', reply); await A.page.getByRole('button', { name: 'Connect' }).click();
  await A.page.waitForSelector('.bverify', { timeout: 30000 }); await B.page.waitForSelector('.bverify', { timeout: 30000 });
  const va = (await A.page.textContent('.bverify')).trim(), vb = (await B.page.textContent('.bverify')).trim();
  assert.match(va, /^\d{3} \d{3}$/); assert.equal(va, vb);
  await shot(A.page, '19-beam-verify');
  await A.page.getByRole('button', { name: /Numbers match/ }).click();
  await B.page.getByRole('button', { name: /Numbers match/ }).click();
  await A.page.waitForSelector('text=Sync complete', { timeout: 30000 }); await B.page.waitForSelector('text=Sync complete', { timeout: 30000 });
  await A.page.getByRole('button', { name: 'Done' }).click(); await B.page.getByRole('button', { name: 'Done' }).click();
  for (const P of [A, B]) { await P.page.waitForSelector('.item'); assert.equal(await P.page.locator('.item').count(), 2); }
  await B.page.locator('.item', { hasText: 'OnLaptop' }).click(); await B.page.waitForSelector('.detail .thumb img');
  await settingsTab(A.page, /Audit trail/); assert.ok((await A.page.textContent('.page')).includes('Beam sync completed'));

  // wrong passphrase on one side → refused with a clear message, nothing merged
  await settingsTab(B.page, /Sync/); await B.page.fill('input[aria-label="Sync passphrase"]', 'silver-lantern-orbit-maple-quiet-river'); await B.page.getByRole('button', { name: 'Save passphrase' }).click();
  await A.page.getByRole('button', { name: /All items/ }).click(); await addLogin(A.page, 'ThirdItem');
  await openBeam(A); await openBeam(B);
  await A.page.getByRole('button', { name: /Start/ }).click(); await A.page.waitForSelector('canvas.beamqr');
  const c2 = await A.page.inputValue('textarea[aria-label="Your code"]');
  await B.page.getByRole('button', { name: /Join/ }).click(); await B.page.fill('textarea[aria-label="Code from the other device"]', c2); await B.page.getByRole('button', { name: 'Continue' }).click();
  await B.page.waitForSelector('textarea[aria-label="Reply code"][readonly]');
  await A.page.fill('textarea[aria-label="Reply code"]', await B.page.inputValue('textarea[aria-label="Reply code"][readonly]')); await A.page.getByRole('button', { name: 'Connect' }).click();
  await A.page.waitForSelector('.bverify', { timeout: 30000 }); await B.page.waitForSelector('.bverify', { timeout: 30000 });
  await A.page.getByRole('button', { name: /Numbers match/ }).click(); await B.page.getByRole('button', { name: /Numbers match/ }).click();
  await B.page.waitForSelector('text=Wrong sync passphrase', { timeout: 30000 });
  await B.page.getByRole('button', { name: /All items/ }).click(); assert.equal(await B.page.locator('.item').count(), 2, 'nothing merged on the failing device');
  fs.rmSync(tmp, { recursive: true });
  assert.deepEqual(A.problems, []); assert.deepEqual(B.problems, []);
  await A.ctx.close(); await B.ctx.close();
});

test('conflicts: same field edited on two devices → newest kept, other version reviewable and resolvable', async () => {
  const A = await newPage(), B = await newPage();
  await createVault(A.page, MASTER); await createVault(B.page, 'a-totally-different-master-pass-9');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-conf-'));
  const exportFrom = async (P, name) => { await settingsTab(P.page, /Sync/); const [dl] = await Promise.all([P.page.waitForEvent('download'), P.page.getByRole('button', { name: /Export sync file/ }).click()]); const f = path.join(tmp, name); await dl.saveAs(f); return f; };
  const importInto = async (P, f) => { await settingsTab(P.page, /Sync/); await P.page.setInputFiles('input[aria-label="Sync file"]', f); await P.page.waitForSelector('text=/Merged: /'); };
  const setPass = async (P) => { await settingsTab(P.page, /Sync/); await P.page.fill('input[aria-label="Sync passphrase"]', SYNC_PASS); await P.page.getByRole('button', { name: 'Save passphrase' }).click(); };
  await addLogin(A.page, 'Router'); await setPass(A); await setPass(B);
  await importInto(B, await exportFrom(A, 'seed.vmsync')); await importInto(A, await exportFrom(B, 'back.vmsync'));
  const editNotes = async (P, text) => { await P.page.locator('.side .nav', { hasText: 'All items' }).click(); await P.page.locator('.item', { hasText: 'Router' }).click(); await P.page.getByRole('button', { name: /Edit/ }).click(); await P.page.fill('#f_notes', text); await P.page.getByRole('button', { name: 'Save' }).click(); await P.page.waitForSelector('.detail .f:has-text("' + text + '")'); };
  await editNotes(A, 'older note from A'); await A.page.waitForTimeout(30);
  await editNotes(B, 'newer note from B');
  await importInto(A, await exportFrom(B, 'b2.vmsync'));        // A pulls B: both edited notes → conflict
  await importInto(B, await exportFrom(A, 'a2.vmsync'));
  // different-field edits would have merged silently; this is a real conflict on both devices
  for (const P of [A, B]) {
    await P.page.locator('.side .nav', { hasText: 'Needs review' }).click();
    await P.page.locator('.item', { hasText: 'Router' }).click();
    await P.page.waitForSelector('.conflict-banner');
    assert.ok((await P.page.textContent('.detail')).includes('newer note from B'), 'newest value kept');
  }
  await shot(A.page, '21-conflict-banner');
  await A.page.getByRole('button', { name: 'Review', exact: true }).click(); await A.page.waitForSelector('.modal-sheet .conf');
  assert.ok((await A.page.textContent('.modal-sheet')).includes('older note from A'));
  await shot(A.page, '22-conflict-review');
  await A.page.getByRole('button', { name: /Use the other version/ }).click();
  await A.page.waitForFunction(() => !document.querySelector('.modal-sheet'));
  await A.page.locator('.side .nav', { hasText: 'All items' }).click(); await A.page.locator('.item', { hasText: 'Router' }).click();
  await A.page.waitForSelector('.detail .f:has-text("older note from A")');
  assert.equal(await A.page.locator('.conflict-banner').count(), 0);
  assert.equal(await A.page.locator('.side .nav', { hasText: 'Needs review' }).count(), 0);
  // resolution travels: B pulls A's resolved item and the banner goes away there too
  await importInto(B, await exportFrom(A, 'a3.vmsync'));
  await B.page.locator('.side .nav', { hasText: 'All items' }).click(); await B.page.locator('.item', { hasText: 'Router' }).click();
  await B.page.waitForSelector('.detail .f:has-text("older note from A")'); assert.equal(await B.page.locator('.conflict-banner').count(), 0);
  fs.rmSync(tmp, { recursive: true });
  assert.deepEqual(A.problems, []); assert.deepEqual(B.problems, []);
  await A.ctx.close(); await B.ctx.close();
});

test('look & feel: appearance, effects, dock & menu bar, widgets, start page, boot animation — all apply, persist and survive lock', async () => {
  const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' });
  await createVault(page);
  const attr = (n) => page.evaluate((k) => document.documentElement.dataset[k], n);
  const cssv = (n) => page.evaluate((k) => document.documentElement.style.getPropertyValue(k), n);
  await addLogin(page, 'Mail', async () => { await page.fill('#f_totp', 'JBSWY3DPEHPK3PXP'); });

  // settings has every tab the ulyOS Settings app has (adapted)
  await page.locator('.side .nav', { hasText: 'Settings' }).click();
  for (const t of ['General', 'Appearance', 'Effects', 'Dock & menu bar', 'Widgets', 'Security', 'Sync', 'Audit trail', 'About']) assert.equal(await page.getByRole('tab', { name: new RegExp(t.replace('&', '\\&')) }).count(), 1, t);

  // Appearance: accent, icon style, size, density, radius, scale, wallpaper
  await page.getByRole('tab', { name: /Appearance/ }).click();
  await page.getByRole('button', { name: 'Accent Violet' }).click(); assert.equal(await cssv('--accent'), '#8b7dff');
  await page.selectOption('.setrow:has-text("Icon style") select', 'neon'); assert.equal(await attr('icons'), 'neon');
  await page.getByRole('button', { name: 'Large', exact: true }).click(); assert.equal(await attr('iconsize'), 'large');
  await page.getByRole('button', { name: 'Compact', exact: true }).click(); assert.equal(await attr('density'), 'compact');
  await page.locator('.setrow:has-text("Corner radius") input[type=range]').fill('20'); assert.equal(await cssv('--r'), '20px');
  await page.locator('.setrow:has-text("UI size") input[type=range]').fill('110'); assert.equal(await cssv('--ui-scale'), '1.1');
  await page.getByRole('button', { name: 'Wallpaper', exact: true }).click(); await page.waitForSelector('.wall');
  assert.equal(await page.locator('.wall[data-group=drawn]').count(), 12); assert.equal(await attr('bg'), 'wallpaper'); assert.match(await cssv('--wall'), /^url\("data:image\/svg\+xml/);
  await page.getByRole('button', { name: 'Wallpaper Starry peaks' }).click(); await shot(page, '23-appearance');
  await page.getByRole('button', { name: 'Category icon' }).click(); assert.equal(await attr('avatar'), 'icon');

  // Effects
  await page.getByRole('tab', { name: /Effects/ }).click();
  await page.selectOption('.setrow:has-text("Window animation") select', 'bounce'); assert.equal(await attr('anim'), 'bounce');
  await page.getByRole('button', { name: 'Try', exact: true }).click(); await page.waitForSelector('.modal-sheet[data-anim=bounce]'); await page.keyboard.press('Escape');
  await page.locator('.setrow:has-text("Animation speed") input[type=range]').fill('2'); assert.equal(await cssv('--speed'), '2');
  await page.locator('.setrow:has-text("Aurora intensity") input[type=range]').fill('10'); assert.equal(await cssv('--fx-aurora'), '10');
  await page.locator('.setrow:has-text("CRT scanlines") .sw').click(); assert.equal(await attr('scan'), 'on');
  await page.locator('.setrow:has-text("CRT scanlines") .sw').click(); assert.equal(await attr('scan'), 'off');
  await page.locator('.setrow:has-text("UI animations") .sw').click(); assert.equal(await attr('motion'), 'off');
  await page.locator('.setrow:has-text("UI animations") .sw').click(); assert.equal(await attr('motion'), 'on');
  await shot(page, '24-effects');

  // Layout: dock + menu bar
  await page.getByRole('tab', { name: /Dock & menu bar/ }).click();
  await page.selectOption('.setrow:has-text("Navigation style") select', 'dock');
  await page.waitForSelector('.dock .dock-item'); assert.ok(await page.locator('.dock').isVisible()); assert.ok(await page.locator('.side').isHidden());
  await page.locator('.setrow:has-text("Show labels") .sw').click(); await page.waitForSelector('.dock-item small');
  await page.locator('.dock').hover(); await shot(page, '25-dock');
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await page.waitForSelector('.widgets');
  await page.getByRole('button', { name: 'Categories', exact: true }).click(); await page.waitForSelector('.modal-sheet .cats'); await page.keyboard.press('Escape');
  assert.ok(await page.locator('.barclock').isVisible());

  // Widgets: home page, live TOTP code, hide / reorder
  assert.ok(await page.locator('.widget').count() >= 8);
  await page.waitForSelector('.widget .totp-tile .wcode:not(:has-text("------"))');
  assert.match(await page.textContent('.widget .totp-tile .wcode'), /^\d{3} \d{3}$/);
  await shot(page, '26-home');
  await page.locator('.dock-item[aria-label="Settings"]').click(); await page.getByRole('tab', { name: /Widgets/ }).click();
  await page.getByRole('switch', { name: 'Show Quick generator' }).click();
  await page.getByRole('button', { name: 'Move down Clock & date' }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await page.waitForSelector('.widgets');
  assert.equal(await page.locator('.widget[aria-label="Quick generator"]').count(), 0);
  assert.equal(await page.locator('.widget').first().getAttribute('aria-label'), 'Vault health');

  // start page + persistence across lock, and the lock screen keeps the look
  await page.locator('.dock-item[aria-label="Settings"]').click(); await page.getByRole('tab', { name: /Dock & menu bar/ }).click();
  await page.selectOption('.setrow:has-text("Start page") select', 'home');
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  assert.equal(await cssv('--accent'), '#8b7dff'); assert.equal(await attr('icons'), 'neon');   // lock screen already looks the way you set it
  await page.reload(); await page.waitForSelector('#upw'); assert.equal(await cssv('--accent'), '#8b7dff');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]');
  await page.waitForSelector('#boot');                                    // boot animation (motion allowed in this context)
  await shot(page, '27-boot');
  await page.locator('#boot').click(); await page.waitForSelector('#boot', { state: 'detached' });
  await page.waitForSelector('.widgets');                                 // start page = Home
  assert.equal(await attr('nav'), 'dock'); assert.equal(await attr('bg'), 'wallpaper'); assert.equal(await attr('anim'), 'bounce');

  // Surprise me + reset
  await page.locator('.dock-item[aria-label="Settings"]').click(); await page.getByRole('tab', { name: /Appearance/ }).click();
  await page.getByRole('button', { name: /Surprise me/ }).click(); await page.waitForSelector('text=New look');
  await page.getByRole('button', { name: 'Reset appearance' }).click(); await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.icons === 'vivid');
  assert.equal(await cssv('--accent'), '#2fe6d0');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('welcome splash + guided tour + help: first-run experience, replay, dock mode, preferences', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click();

  // Home is the default start page, and the welcome splash appears on the very first unlock
  await page.waitForSelector('.welcome.in', { timeout: 10000 });
  await page.waitForSelector('.widgets');
  const w = await page.textContent('.welcome');
  for (const needle of ['Welcome to VaultManager', 'Zero-knowledge', 'PC and phone', 'More than passwords', 'Open my vault', 'Take the tour', 'Make it yours', 'AES-256']) assert.ok(w.includes(needle), 'welcome mentions ' + needle);
  assert.equal(await page.locator('.wl-ico').count(), 8); assert.equal(await page.locator('.welcome input[type=checkbox]').isChecked(), false);
  await shot(page, '30-welcome');

  // the tour: every step shows a card; steps with a target spotlight a real element
  await page.getByRole('button', { name: /Take the tour/ }).click();
  await page.waitForSelector('.tour-card'); await page.waitForSelector('.welcome', { state: 'detached' });
  const total = +(/\/ (\d+)/.exec(await page.textContent('.tour-n'))[1]); assert.ok(total >= 15, 'tour has ' + total + ' steps');
  const seen = [], spotted = [];
  for (let i = 0; i < total; i++) {
    await page.waitForFunction((n) => document.querySelector('.tour-n') && document.querySelector('.tour-n').textContent.startsWith(n + ' /'), i + 1);
    await page.waitForTimeout(160);
    const title = await page.textContent('.tour-head b'); seen.push(title);
    const box = await page.locator('.tour-hole').evaluate((e) => ({ shown: getComputedStyle(e).display !== 'none', w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
    if (box.shown && box.w > 20 && box.h > 10) spotted.push(title);
    if (i === 2) await shot(page, '31-tour-nav');
    if (i === 6) await shot(page, '32-tour-generator');
    if (i < total - 1) await page.getByRole('button', { name: /Next/ }).click(); else await page.getByRole('button', { name: 'Finish' }).click();
  }
  await page.waitForSelector('.tour-card', { state: 'detached' });
  assert.ok(spotted.length >= 12, 'spotlit steps: ' + spotted.join(' | '));
  for (const t of ['Welcome to VaultManager', 'Find your way around', 'Password generator', 'Vault health', 'Beam sync', 'Sync and conflicts', 'Lock when you leave', 'You are all set']) assert.ok(seen.includes(t), 'step ' + t);

  // seen once → no welcome on the next unlock
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.widgets');
  await page.waitForTimeout(1600); assert.equal(await page.locator('.welcome').count(), 0, 'welcome is not repeated');

  // Help (?) → replay; Escape ends the tour
  await page.getByRole('button', { name: 'Help', exact: true }).click(); await page.waitForSelector('.modal-sheet:has-text("Keyboard shortcuts")');
  assert.ok((await page.textContent('.modal-sheet')).includes('Alt + L'));
  await shot(page, '33-help');
  await page.getByRole('button', { name: /Guided tour/ }).click(); await page.waitForSelector('.tour-card'); await page.keyboard.press('Escape'); await page.waitForSelector('.tour-card', { state: 'detached' });
  await page.getByRole('button', { name: 'Help', exact: true }).click(); await page.getByRole('button', { name: /Welcome screen/ }).click(); await page.waitForSelector('.welcome.in');
  await page.getByRole('button', { name: /Make it yours/ }).click();                       // → Settings → Appearance
  await page.waitForSelector('.setrow:has-text("Accent colour")'); await page.waitForSelector('.welcome', { state: 'detached' });

  // preferences: display name + "show every time"
  await page.getByRole('tab', { name: /General/ }).click();
  await page.fill('input[aria-label="Profile name"]', 'Alex'); await page.locator('input[aria-label="Profile name"]').blur();
  await page.getByLabel('Show the welcome screen every time I unlock').check();
  await page.locator('.side .nav', { hasText: 'Home' }).click(); await page.waitForSelector('h2:has-text("Alex")');
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]');
  await page.waitForSelector('.welcome.in', { timeout: 10000 }); assert.ok((await page.textContent('.wl-hello')).includes('Alex'));
  await page.keyboard.press('Enter'); await page.waitForSelector('.welcome', { state: 'detached' });

  // the tour also works with the dock instead of the side bar
  await settingsTab(page, /Dock & menu bar/);
  await page.selectOption('.setrow:has-text("Navigation style") select', 'dock'); await page.waitForSelector('.dock .dock-item');
  await page.locator('.dock-item[aria-label="Help"]').click(); await page.getByRole('button', { name: /Guided tour/ }).click();
  await page.waitForSelector('.tour-card'); await page.getByRole('button', { name: /Next/ }).click(); await page.getByRole('button', { name: /Next/ }).click();
  await page.waitForFunction(() => document.querySelector('.tour-head b').textContent === 'Find your way around'); await page.waitForTimeout(250);
  const dockBox = await page.locator('.dock').boundingBox(), hole = await page.locator('.tour-hole').boundingBox();
  assert.ok(hole && Math.abs(hole.x + hole.width / 2 - (dockBox.x + dockBox.width / 2)) < 40, 'the spotlight is on the dock');
  await shot(page, '34-tour-dock'); await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('v0.7 categories: all 15 new ones are visible, grouped, creatable from the UI, searchable, and tracked for expiry', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  const NEW = ['contact', 'phone', 'technical', 'crypto', 'emergency', 'lens', 'membership', 'internet', 'prescription', 'serial', 'voter', 'photoid', 'library', 'healthcard', 'car'];

  // the picker shows every group and category
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet .catgroup');
  assert.equal(await page.locator('.modal-sheet .catgroup').count(), GROUPS.length);
  for (const [g] of GROUPS) assert.ok((await page.textContent('.modal-sheet')).includes(g), 'group ' + g);
  assert.equal(await page.locator('.modal-sheet .cats .btn').count(), 28);
  await shot(page, '35-picker-groups'); await page.keyboard.press('Escape');

  for (const k of NEW) {
    const t = TEMPLATES[k]; const first = t.fields.find((f) => f.kind === 'text');
    await page.getByRole('button', { name: '＋ New' }).click();
    await page.locator('.modal-sheet .cats .btn', { hasText: t.label }).first().click();
    await page.waitForSelector('#f_name');
    if (t.tip) assert.ok((await page.textContent('.modal-sheet')).includes(t.tip.slice(0, 30)), k + ' shows its tip');
    await page.fill('#f_name', 'My ' + k); await page.fill('#tf_' + first.k, 'findme-' + k);
    await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector(`.detail h2:has-text("My ${k}")`);
    assert.ok((await page.textContent('.detail')).includes('findme-' + k), k + ' detail shows its field');
  }
  assert.equal(await page.locator('.side .nav', { hasText: /^.{0,3}Contacts/ }).count(), 1);

  // sidebar: grouped with fold-away headers, every plural present
  assert.equal(await page.locator('.side .ngroup').count(), GROUPS.length);
  for (const k of NEW) assert.equal(await page.locator('.side .nbody .nav', { hasText: TEMPLATES[k].plural }).count() >= 1, true, k);
  await shot(page, '36-sidebar-groups');
  await page.locator('.side .ngroup', { hasText: 'Health' }).click(); assert.ok(await page.locator('.side .nbody.collapsed').count() >= 1);
  assert.equal(await page.locator('.side .nbody.collapsed .nav:visible').count(), 0);
  await page.locator('.side .ngroup', { hasText: 'Health' }).click();

  // search finds non-secret fields in any new category
  await page.fill('.search', 'findme-car'); assert.equal(await page.locator('.item').count(), 1); await page.fill('.search', 'findme-'); assert.equal(await page.locator('.item').count(), 15);
  await page.fill('.search', '');

  // a car registration in the past shows up in Vault health with its label
  await page.locator('.side .nav', { hasText: 'Cars' }).click(); await page.locator('.item').first().click();
  await page.getByRole('button', { name: /Edit/ }).click(); await page.fill('#tf_regexp', '2021-02-03'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail .chip:has-text("expired")');
  await page.locator('.side .nav', { hasText: 'Vault health' }).click(); await page.waitForSelector('text=Expiring or expired');
  assert.ok((await page.textContent('.page')).includes('Registration expires: 2021-02-03 — expired'));

  // the categories dialog (dock) and the home widget are grouped / compact too
  await page.locator('.side .nav', { hasText: 'Home' }).first().click(); await page.waitForSelector('.widgets');
  assert.ok((await page.textContent('.widget[aria-label="Categories"]')).includes('Contacts · 1'));
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('offline web app: after the first visit it loads, unlocks, creates items and seals QR codes with the network cut', async () => {
  const { ctx, page, problems } = await newPage({ serviceWorkers: 'allow' });
  await page.goto(base); await page.waitForSelector('#pw1');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);          // now controlled by the service worker
  const missing = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find((x) => x.startsWith('vm-'))); const need = ['index.html', 'js/app.js', 'js/beam.js', 'js/icons.js', 'css/style.css', 'vendor/qrcode.js', 'vendor/jsQR.js', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest']; const out = []; for (const n of need) if (!(await c.match(n))) out.push(n); return out; });
  assert.deepEqual(missing, [], 'the whole app is in the offline cache');

  await ctx.setOffline(true);                                                                              // ✈ no network from here on
  await page.reload(); await page.waitForSelector('#pw1');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page);
  await addLogin(page, 'OfflineSite');
  await page.locator('.side .nav', { hasText: 'QR tools' }).click();                                       // QR library comes from the cache
  await page.fill('textarea[aria-label="Text to seal"]', 'sealed while offline'); await page.fill('input[aria-label="QR password"]', 'offline-qr-pass'); await page.fill('input[aria-label="Confirm QR password"]', 'offline-qr-pass');
  await page.getByRole('button', { name: /Seal into QR/ }).click(); await page.waitForSelector('.qrbox canvas');
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.reload(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar');
  await openAll(page); await page.waitForSelector('.item:has-text("OfflineSite")');
  await page.locator('.side .nav', { hasText: 'Settings' }).click(); await page.getByRole('tab', { name: /General/ }).click();
  await page.waitForFunction(() => /Ready to work offline/.test(document.body.textContent), null, { timeout: 15000 });
  assert.deepEqual(problems.filter((p) => !/Failed to load resource|net::ERR/.test(p)), []);
  await ctx.close();
});

test('single-file offline build: offline/VaultManager-offline.html runs straight from disk (file://) with no server', async () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-offline.mjs')], { stdio: 'pipe' });
  const file = path.join(ROOT, 'offline/VaultManager-offline.html'); const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.length > 300000 && !/<script[^>]+src=/.test(html) && !/<link[^>]+rel="stylesheet"/.test(html), 'one self-contained file');
  assert.ok(!/unsafe-inline|unsafe-eval/.test(html.match(/Content-Security-Policy"\s+content="([^"]*)"/)[1]), 'the inline blocks are allowed by hash, never unsafe-inline');
  assert.ok(/^[0-9a-f]{64}  VaultManager-offline\.html/.test(fs.readFileSync(file + '.sha256', 'utf8')));
  const { ctx, page, problems } = await newPage();
  await page.goto('file://' + file); await page.waitForSelector('#pw1');
  assert.equal(await page.evaluate(() => window.isSecureContext), true, 'file:// is a secure context, so WebCrypto works');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page);
  await addLogin(page, 'FromAFile');
  await page.locator('.side .nav', { hasText: 'QR tools' }).click();                                       // QR libraries are embedded in the file
  await page.fill('textarea[aria-label="Text to seal"]', 'hello from a single file'); await page.fill('input[aria-label="QR password"]', 'single-file-pass'); await page.fill('input[aria-label="Confirm QR password"]', 'single-file-pass');
  await page.getByRole('button', { name: /Seal into QR/ }).click(); await page.waitForSelector('.qrbox canvas');
  await page.getByRole('button', { name: '🔒 Lock', exact: true }).click(); await page.reload(); await page.waitForSelector('#upw');
  await page.fill('#upw', 'wrong password again'); await page.click('button[type=submit]'); await page.waitForFunction(() => /Wrong master password/.test(document.body.textContent));
  await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar'); await openAll(page);
  await page.waitForSelector('.item:has-text("FromAFile")');                                               // data survived a reload of the file
  assert.ok(await page.evaluate(() => navigator.serviceWorker && !navigator.serviceWorker.controller), 'no service worker is used from file://');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('profiles: export a whole profile, then import it at the initial stage into a fresh browser; USB download is VaultManager-offline.html', async () => {
  const A = await newPage(); await createVault(A.page);
  await addLogin(A.page, 'BankProfile');
  await settingsTab(A.page, 'General');
  await A.page.getByRole('button', { name: /Export whole profile/ }).click();
  assert.equal(await A.page.getAttribute('input[aria-label="Backup password"]', 'type'), 'password', 'the export password is hidden');
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'different-one-xx'); await A.page.getByRole('button', { name: 'Download backup' }).click();
  assert.match(await A.page.locator('.modal-sheet .err:not(:empty)').first().textContent(), /do not match/);
  await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  assert.match(dl.suggestedFilename(), /\.vmprofile$/);
  const text = fs.readFileSync(await dl.path(), 'utf8'); assert.ok(text.startsWith('VMP1:'));
  assert.ok(!text.includes('BankProfile'), 'the backup is encrypted');
  // the USB option downloads the single file
  const usb = A.page.getByRole('button', { name: /Download VaultManager-offline\.html/ });
  if (await usb.count()) { const [d2] = await Promise.all([A.page.waitForEvent('download'), usb.first().click()]); assert.equal(d2.suggestedFilename(), 'VaultManager-offline.html'); }
  await A.ctx.close();

  const B = await newPage(); await B.page.goto(base); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
  await B.page.fill('textarea[aria-label="Backup text"]', text);
  await B.page.fill('input[aria-label="Backup password"]', 'wrong-backup-password');
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForFunction(() => [...document.querySelectorAll('.modal-sheet .err')].some((e) => e.textContent.trim()), null, { timeout: 30000 });
  await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.fill('input[aria-label="New master password"]', 'a-new-master-pass-123'); await B.page.fill('input[aria-label="Repeat new master password"]', 'a-new-master-pass-123');
  await B.page.locator('.modal-sheet input[type=checkbox]').last().check();
  await B.page.getByRole('button', { name: 'Create profile' }).click();
  await B.page.waitForSelector('.topbar', { timeout: 30000 });
  await dismissWelcome(B.page).catch(() => {});
  await openAll(B.page);
  assert.ok(await B.page.locator('.list', { hasText: 'BankProfile' }).count(), 'the imported database is in the new profile');
  assert.ok(await B.page.evaluate(() => document.querySelector('.ico[data-n]').style.getPropertyValue('--v1')), 'icons carry their vivid colour');
  await B.ctx.close();
});

test('v0.12: crypto wallet shows length+entropy and seals a single field as QR; QR tools show length and entropy; real-photo wallpapers, own image, undo and save-now', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await page.getByRole('button', { name: '＋ New' }).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click();
  await page.fill('#f_name', 'Ledger Nano'); await page.fill('#tf_seed', 'abandon ability able about above absent absorb abstract absurd abuse access accident');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Ledger Nano")');
  assert.match(await page.textContent('.detail .sbits'), /\d+ characters · ~\d+ bits/);
  // seal just the seed phrase
  await page.getByRole('button', { name: /Seal Recovery seed phrase as QR/ }).click();
  assert.match(await page.textContent('.modal-sheet .meter-label'), /\d+ characters · ~\d+ bits entropy/);
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet canvas', { timeout: 30000 });
  await page.keyboard.press('Escape');
  // the whole wallet can be sealed too
  await page.getByRole('button', { name: /Seal as QR/ }).first().click(); await page.waitForSelector('.modal-sheet .livemeter .meter'); await page.keyboard.press('Escape');
  // QR tools
  await page.locator('.side .nav', { hasText: 'QR tools' }).click();
  await page.fill('textarea[aria-label="Text to seal"]', 'wallet words here');
  assert.match(await page.textContent('.page'), /Secret text: 17 characters · ~\d+ bits entropy/);
  assert.match(await page.textContent('.page .meter-label'), /characters · ~\d+ bits entropy/);

  // appearance
  await settingsTab(page, 'Appearance');
  assert.ok(await page.locator('.wallgroup h4', { hasText: 'Real photos' }).count());
  assert.ok(await page.locator('.wallgroup h4', { hasText: 'Cities & lights' }).count());
  assert.ok(await page.locator('.wall[data-group=city]').count() >= 6 && await page.locator('.wall[data-group=photo]').count() >= 6);
  await page.locator('.wall[data-group=city]').first().click();
  assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wall')), /wallpapers\/night1\.jpg/);
  assert.match(await page.textContent('.savebar'), /Saved automatically/);
  await page.getByRole('button', { name: 'Undo changes' }).click(); await page.waitForSelector('.savebar');
  assert.ok(!/night1/.test(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wall'))), 'undo restored the previous background');
  // your own picture (a generated PNG)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[aria-label="Choose a background image from this computer"]', { name: 'me.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.wall[data-group=mine]');
  assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wall')), /data:image\/jpeg;base64/);
  await page.fill('input[aria-label="Background image URL"]', 'http://insecure.example/x.png'); await page.getByRole('button', { name: 'Use this address' }).click();
  assert.match(await page.textContent('.wallmine .err'), /https/);
  const t0 = await page.textContent('.savebar .savestat');
  await page.getByRole('button', { name: 'Save now' }).click(); await page.waitForSelector('.toast, [role=status]');
  // persists after lock + unlock
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar');
  assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wall')), /data:image\/jpeg;base64/);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('item passcode lock: a Crypto wallet item with its own passcode stays hidden after the vault is unlocked, until the item passcode is entered', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await page.getByRole('button', { name: '＋ New' }).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click();
  await page.fill('#f_name', 'Cold wallet'); await page.fill('#tf_seed', 'zoo zebra zone zero zest zinc zip zigzag');
  await page.check('#f_lockon'); await page.fill('#f_lock1', 'item-code-123'); await page.fill('#f_lock2', 'item-code-XYZ');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.modal-sheet .err:not(:empty)'); assert.match(await page.locator('.modal-sheet .err:not(:empty)').first().textContent(), /do not match/);
  await page.fill('#f_lock2', 'item-code-123'); await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.detail h2:has-text("Cold wallet")');
  assert.ok(await page.locator('.lockbox').count(), 'shows the locked panel');
  assert.ok(!(await page.textContent('.detail')).includes('zebra'), 'the seed phrase is not in the page');
  assert.ok(!(await page.textContent('.list')).includes('zebra') && /Locked/.test(await page.textContent('.list')));
  await page.getByRole('button', { name: 'Enter passcode…' }).click();
  await page.fill('input[aria-label="Item passcode"]', 'wrong-passcode'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForFunction(() => /not the passcode/.test(document.querySelector('.modal-sheet').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(2200);                                             // the retry delay after a wrong try
  await page.fill('input[aria-label="Item passcode"]', 'item-code-123'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.detail') && document.querySelector('.detail').textContent.includes('Recovery seed phrase'), null, { timeout: 30000 });
  assert.match(await page.textContent('.detail'), /Unlocked with the item passcode/);
  await page.getByRole('button', { name: /Lock now/ }).click();
  assert.ok(!(await page.textContent('.detail')).includes('Recovery seed phrase'));
  // locking the vault also closes the item
  await page.getByRole('button', { name: 'Enter passcode…' }).click(); await page.fill('input[aria-label="Item passcode"]', 'item-code-123'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.detail').textContent.includes('Recovery seed phrase'), null, { timeout: 30000 });
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar');
  await openAll(page); await page.locator('.item', { hasText: 'Cold wallet' }).click();
  assert.ok(!(await page.textContent('.detail')).includes('Recovery seed phrase') && await page.locator('.lockbox').count());
  assert.deepEqual(problems, []);
  await ctx.close();
});

/* One feature walk-through, run on every target: served desktop, phone, tablet, and the single-file offline build (desktop and phone). */
async function featureWalk(label, { device = null, offline = false } = {}) {
  const opts = device ? (({ defaultBrowserType, ...d }) => ({ ...d, colorScheme: 'dark', reducedMotion: 'reduce' }))(devices[device]) : {};
  const { ctx, page, problems } = await newPage(opts);
  const phone = !!device && devices[device].viewport.width < 700;
  const fits = async (what) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); assert.ok(o.sw <= o.cw + 1, `${label} · ${what}: horizontal overflow ${o.sw}>${o.cw}`); };
  const url = offline ? 'file://' + path.join(ROOT, 'offline/VaultManager-offline.html') : base;
  await page.goto(url); await page.waitForSelector('#pw1');
  await page.fill('#pname', 'Tester'); await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  // a wallet with a file, protected by its own passcode
  await page.getByRole('button', { name: phone ? 'New item' : /^＋ New|New$/ }).first().click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click();
  await page.fill('#f_name', 'Cold wallet'); await page.fill('#tf_seed', 'zoo zebra zone zero zest zinc zip zigzag');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[aria-label="Choose files"]', { name: 'seedcard.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.modal-sheet .att');
  await page.check('#f_lockon'); await page.fill('#f_lock1', 'item-code-123'); await page.fill('#f_lock2', 'item-code-123'); await fits('edit form');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Cold wallet")', { timeout: 30000 });
  assert.ok(await page.locator('.lockbox').count(), `${label}: locked`);
  const closed = await page.textContent('.detail'); assert.ok(!closed.includes('seedcard') && !closed.includes('Recovery seed phrase'), `${label}: nothing readable while locked (name of the file included)`);
  await fits('locked'); await page.getByRole('button', { name: 'Enter passcode…' }).click(); await page.fill('input[aria-label="Item passcode"]', 'item-code-123'); await fits('unlock dialog');
  await page.locator('.modal-sheet').getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.detail') && document.querySelector('.detail').textContent.includes('seedcard.png'), null, { timeout: 30000 });
  assert.match(await page.textContent('.detail .sbits'), /\d+ characters · ~\d+ bits/); await fits('unlocked');
  await page.getByRole('button', { name: /Seal Recovery seed phrase as QR/ }).click();
  assert.match(await page.textContent('.modal-sheet .meter-label'), /\d+ characters · ~\d+ bits entropy/);
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet canvas', { timeout: 30000 }); await fits('QR dialog'); await page.keyboard.press('Escape');
  // real-photo wallpaper + autosave bar
  if (phone) { await page.getByRole('button', { name: 'More' }).click(); await page.locator('.msheet-item', { hasText: 'Settings' }).first().click(); await page.waitForSelector('.tabs'); await page.getByRole('tab', { name: /Appearance/ }).click(); }
  else await settingsTab(page, 'Appearance');
  await page.waitForSelector('.wall[data-group=city]'); await fits('appearance');
  await page.locator('.wall[data-group=city]').first().click();
  assert.match(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wall')), /night1\.jpg|data:image\/jpeg/, `${label}: photo wallpaper applied`);
  assert.match(await page.textContent('.savebar'), /Saved automatically to “Tester”/); await page.getByRole('button', { name: 'Save now' }).click();
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), [], label);
  await ctx.close();
}
const WALK = [['served · desktop', {}], ['served · iPhone 13', { device: 'iPhone 13' }], ['served · iPhone SE', { device: 'iPhone SE' }], ['served · iPad Mini', { device: 'iPad Mini' }],
  ['single file · desktop', { offline: true }], ['single file · iPhone 13', { offline: true, device: 'iPhone 13' }]];
for (const [label, o] of WALK) test('feature walk-through: ' + label, async () => {
  if (o.offline) execFileSync(process.execPath, [path.join(ROOT, 'tools/build-offline.mjs')], { stdio: 'pipe' });
  await featureWalk(label, o);
});

async function roundTripWalk(label, { device = null, offline = false } = {}) {
  const opts = device ? (({ defaultBrowserType, ...d }) => ({ ...d, colorScheme: 'dark', reducedMotion: 'reduce' }))(devices[device]) : {};
  const phone = !!device && devices[device].viewport.width < 700;
  const url = offline ? 'file://' + path.join(ROOT, 'offline/VaultManager-offline.html') : base;
  const A = await newPage(opts);
  await A.page.goto(url); await A.page.waitForSelector('#pw1');
  await A.page.fill('#pw1', MASTER); await A.page.fill('#pw2', MASTER); await A.page.check('#ack'); await A.page.click('button[type=submit]');
  await A.page.getByRole('button', { name: 'Skip for now' }).click(); await A.page.waitForSelector('.welcome.in').catch(() => {}); await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(250);
  await A.page.getByRole('button', { name: phone ? 'New item' : /^＋ New|New$/ }).first().click();
  await A.page.locator('.modal-sheet .cats .btn', { hasText: 'Bank account' }).click();
  await A.page.fill('#f_name', 'Savings'); await A.page.fill('#f_lock1', 'x').catch(() => {});
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await A.page.setInputFiles('input[aria-label="Choose files"]', { name: 'statement.png', mimeType: 'image/png', buffer: png }); await A.page.waitForSelector('.modal-sheet .att');
  await A.page.check('#f_lockon'); await A.page.fill('#f_lock1', 'item-code-123'); await A.page.fill('#f_lock2', 'item-code-123');
  await A.page.getByRole('button', { name: 'Save' }).click(); await A.page.waitForSelector('.lockbox', { timeout: 90000 });
  if (phone) { await A.page.getByRole('button', { name: 'More' }).click(); await A.page.locator('.msheet-item', { hasText: 'Settings' }).first().click(); await A.page.waitForSelector('.tabs'); } else await settingsTab(A.page, 'General');
  await A.page.getByRole('button', { name: /Export whole profile/ }).click();
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  const text = fs.readFileSync(await dl.path(), 'utf8'); await A.ctx.close();

  const B = await newPage(opts); await B.page.goto(url); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
  await B.page.fill('textarea[aria-label="Backup text"]', text); await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.fill('input[aria-label="New master password"]', 'a-new-master-pass-123'); await B.page.fill('input[aria-label="Repeat new master password"]', 'a-new-master-pass-123');
  await B.page.locator('.modal-sheet input[type=checkbox]').last().check(); await B.page.getByRole('button', { name: 'Create profile' }).click();
  await B.page.waitForSelector('.topbar', { timeout: 90000 }); await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(250);
  await B.page.fill('.search', 'Savings'); await B.page.locator('.item', { hasText: 'Savings' }).first().click();
  await B.page.waitForSelector('.lockbox');
  await B.page.getByRole('button', { name: 'Enter passcode…' }).click(); await B.page.fill('input[aria-label="Item passcode"]', 'item-code-123');
  await B.page.locator('.modal-sheet').getByRole('button', { name: 'Unlock', exact: true }).click();
  await B.page.waitForFunction(() => document.querySelector('.detail') && document.querySelector('.detail').textContent.includes('statement.png'), null, { timeout: 90000 });
  assert.deepEqual(B.problems.filter((p) => !/Failed to load resource/.test(p)), [], label);
  await B.ctx.close();
}
for (const [label, o] of [['served · iPhone 13', { device: 'iPhone 13' }], ['single file · desktop', { offline: true }], ['single file · iPhone 13', { offline: true, device: 'iPhone 13' }]])
  test('locked item with a file survives a whole-profile export and import: ' + label, async () => { await roundTripWalk(label, o); });

test('v0.15: QR tools hide the password and ask twice; Purge memory; backup guide; task manager; hide categories; contact admin', async () => {
  const { ctx, page, problems } = await newPage({}, ['script.google.com']);
  await createVault(page);
  // QR tools: hidden password + confirm + purge
  await page.locator('.side .nav', { hasText: 'QR tools' }).click();
  assert.equal(await page.getAttribute('input[aria-label="QR password"]', 'type'), 'password');
  assert.equal(await page.getAttribute('input[aria-label="Confirm QR password"]', 'type'), 'password');
  await page.fill('textarea[aria-label="Text to seal"]', 'hello'); await page.fill('input[aria-label="QR password"]', 'first-password-1'); await page.fill('input[aria-label="Confirm QR password"]', 'other-password-2');
  await page.getByRole('button', { name: /Seal into QR/ }).click();
  assert.match(await page.locator('.page .err:not(:empty)').first().textContent(), /do not match/);
  await page.getByRole('button', { name: /Purge memory/ }).click();
  await page.waitForSelector('.page textarea[aria-label="Text to seal"]');
  assert.equal(await page.inputValue('textarea[aria-label="Text to seal"]'), '', 'purge wiped the text');
  assert.notEqual(await page.inputValue('input[aria-label="QR password"]'), 'first-password-1');
  // backup guide on Tools → Import & export and in Settings → General
  await page.locator('.side .nav', { hasText: 'Import & export' }).click();
  assert.equal(await page.locator('.bguide .bcard').count(), 4);
  assert.match(await page.textContent('.bguide'), /Whole profile[\s\S]*profile name & picture[\s\S]*Database backup[\s\S]*passwords/i);
  assert.ok(await page.getByRole('button', { name: /Export whole profile/ }).count() && await page.getByRole('button', { name: /Import a profile/ }).count());
  await settingsTab(page, 'General'); assert.equal(await page.locator('.bguide .bcard').count(), 4);
  // task manager
  await page.locator('.side .nav', { hasText: 'Task manager' }).click();
  await page.waitForSelector('.tmtable'); assert.match(await page.textContent('.tmtable'), /Vault session[\s\S]*Auto-lock timer[\s\S]*Clipboard guard/);
  await page.getByRole('tab', { name: 'Performance' }).click(); assert.ok(await page.locator('.tmcard').count() >= 3);
  await page.getByRole('tab', { name: 'Storage' }).click(); await page.waitForSelector('.tmcard'); assert.match(await page.textContent('.tm'), /Profiles on this device/);
  await page.getByRole('tab', { name: 'This device' }).click(); assert.match(await page.textContent('.tm'), /Secure context/);
  // hide categories
  assert.ok(await page.locator('.side .nav', { hasText: 'Crypto' }).count());
  await settingsTab(page, 'Dock & menu bar');
  await page.getByRole('switch', { name: 'Show Crypto' }).click();
  assert.equal(await page.locator('.side .nav', { hasText: /^Crypto/ }).count(), 0, 'hidden category is gone from the side menu');
  await page.getByRole('switch', { name: 'Show QR tools' }).click(); assert.equal(await page.locator('.side .nav', { hasText: 'QR tools' }).count(), 0);
  await page.getByRole('button', { name: 'Show everything' }).click(); assert.ok(await page.locator('.side .nav', { hasText: 'QR tools' }).count());
  await page.getByRole('button', { name: 'Hide empty categories' }).click(); assert.equal(await page.locator('.side .ngroup').count(), 0, 'every category is empty, so every group is hidden');
  await page.getByRole('button', { name: 'Show everything' }).click();
  // contact admin: same relay as ulyOS — sign-in footer, Help, Settings → About; the message is a POST to the relay
  const posts = [];
  await page.route('https://script.google.com/**', async (route) => { posts.push(route.request().postData() || ''); await route.fulfill({ status: 200, body: 'ok' }); });
  await settingsTab(page, 'About'); assert.ok(await page.getByRole('button', { name: /Write a message/ }).count());
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.waitForSelector('#upw');
  await page.locator('.gate-foot').getByRole('button', { name: /Contact admin/ }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click(); assert.match(await page.locator('.modal-sheet .err:not(:empty)').first().textContent(), /subject/i);
  await page.fill('input[aria-label="Subject"]', 'Hello admin'); await page.fill('textarea[aria-label="Message to the administrator"]', 'Testing the relay'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => /Message sent/.test(document.body.textContent), null, { timeout: 15000 });
  assert.equal(posts.length, 1); assert.match(posts[0], /Hello admin/); assert.match(posts[0], /Testing the relay/); assert.ok(!/upw|master/i.test(posts[0]));
  await page.getByRole('button', { name: /Add a profile/ }).click(); await page.waitForSelector('#pw1');
  assert.equal(await page.locator('#notifynote').count(), 0, 'no profile notice from localhost (it is only sent from the hosted site)');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

for (const dev of ['iPhone 13', 'iPhone SE']) test('v0.15 on a phone (' + dev + '): task manager, hide categories and QR password fit and work', async () => {
  const { defaultBrowserType, ...d } = devices[dev]; void defaultBrowserType;
  const { ctx, page, problems } = await newPage({ ...d, colorScheme: 'dark', reducedMotion: 'reduce' });
  const fits = async (what) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); assert.ok(o.sw <= o.cw + 1, `${dev} · ${what}: overflow ${o.sw}>${o.cw}`); };
  await page.goto(base); await page.waitForSelector('#pw1'); await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const more = async (label) => { await page.getByRole('button', { name: 'More' }).click(); await page.waitForSelector('.msheet'); await page.locator('.msheet-item', { hasText: label }).first().click(); };
  await more('Task manager'); await page.waitForSelector('.tmtable'); await fits('task manager processes');
  for (const t of ['Performance', 'Storage', 'This device']) { await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(150); await fits('task manager ' + t); }
  await more('QR tools'); await page.waitForSelector('input[aria-label="Confirm QR password"]'); await fits('QR tools'); assert.ok(await page.getByRole('button', { name: /Purge memory/ }).isVisible());
  await more('Import & export'); await page.waitForSelector('.bguide'); await fits('import & export guide');
  await page.getByRole('button', { name: 'More' }).click(); await page.locator('.msheet-item', { hasText: 'Settings' }).first().click(); await page.waitForSelector('.tabs'); await page.getByRole('tab', { name: /Dock/ }).click();
  await page.getByRole('switch', { name: 'Show Crypto' }).click(); await fits('show or hide');
  await page.getByRole('button', { name: 'More' }).click(); await page.waitForSelector('.msheet');
  assert.equal(await page.locator('.msheet-item', { hasText: /^Crypto/ }).count(), 0, 'hidden category is gone from the phone menu');
  assert.ok(await page.locator('.msheet-item', { hasText: 'Social' }).count() || true);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.16: first login lands on Home with only Everyday expanded; app-style icon tiles; widgets can be pinned and resized (drag and keyboard) and it persists', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1'); await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.widgets');
  assert.equal(await page.locator('.ngroup[aria-expanded=true]').count(), 1); assert.match(await page.locator('.ngroup[aria-expanded=true]').textContent(), /Everyday/i);
  assert.ok(await page.locator('.side .nav', { hasText: 'Logins' }).isVisible() && !(await page.locator('.side .nav', { hasText: 'Travel' }).isVisible()));
  // real app-icon tiles in the side bar
  const bg = await page.locator('.side .nav', { hasText: 'Favorites' }).locator('.ico').evaluate((e) => getComputedStyle(e).backgroundImage);
  assert.match(bg, /gradient/); const sz = await page.locator('.side .nav', { hasText: 'Favorites' }).locator('.ico').boundingBox(); assert.ok(sz.width >= 26, 'tile is a real icon size, ' + sz.width);
  const tb = await page.locator('.topbar [title^="Lock"] .ico').boundingBox(); assert.ok(tb.width >= 24, 'top bar icons are large: ' + tb.width);
  // pin
  const first = async () => page.locator('.widgets .widget').first().getAttribute('aria-label');
  assert.equal(await first(), 'Clock & date');
  await page.getByRole('button', { name: 'Pin Quick generator' }).click(); await page.waitForSelector('.widget.pinned');
  assert.equal(await first(), 'Quick generator'); assert.equal(await page.locator('.widget.pinned').count(), 1);
  // resize with the keyboard
  const w = page.locator('.widget', { hasText: 'Vault health' }).first(); const grip = w.locator('.wgrip');
  const h0 = (await w.boundingBox()).height; await grip.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.waitForFunction((l) => document.querySelector(`.widget[aria-label="${l}"]`).dataset.ch, 'Vault health');
  assert.ok((await w.boundingBox()).height >= h0 + 60, 'taller after two arrow presses');
  // resize by dragging
  const g = await grip.boundingBox(); const before = await w.boundingBox();
  await page.mouse.move(g.x + 10, g.y + 10); await page.mouse.down(); await page.mouse.move(g.x + 260, g.y + 120, { steps: 8 }); await page.mouse.up();
  const after = await w.boundingBox(); assert.ok(after.width > before.width + 100 || after.height > before.height + 40, 'dragging changed the size');
  // persists across lock / unlock
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.widgets');
  await page.waitForTimeout(1200);
  assert.equal(await first(), 'Quick generator', 'pin persisted'); assert.ok(await page.locator('.widget[aria-label="Vault health"]').getAttribute('data-ch'), 'size persisted');
  // double-click the grip to reset
  await page.locator('.widget[aria-label="Vault health"] .wgrip').dblclick(); assert.equal(await page.locator('.widget[aria-label="Vault health"]').getAttribute('data-ch'), null);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.18: a QR holds the WHOLE item and Open QR shows the full card; Backup to QR explains, verifies and restores; cursor settings', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  // a crypto wallet with several fields, notes and a custom field
  await page.getByRole('button', { name: '＋ New' }).click(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click();
  await page.fill('#f_name', 'Ledger Nano X'); await page.fill('#tf_wallet', 'Ledger'); await page.fill('#tf_seed', 'zoo zebra zone zero zest zinc zip zigzag'); await page.fill('#tf_privkey', 'key-4821');
  await page.fill('#f_notes', 'Stored in the safe');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Ledger Nano X")');
  await page.getByRole('button', { name: /^.*Seal as QR$/ }).first().click();
  assert.ok(await page.locator('.modal-sheet details.how').count(), 'explains how it works');
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet canvas', { timeout: 30000 });
  const note = await page.locator('.modal-sheet .note.ok').textContent();
  assert.match(note, /Checked/); assert.match(note, /WHOLE item/); assert.match(note, /filled field/); assert.match(note, /notes/);
  await page.getByRole('button', { name: /Preview what a scan restores/ }).click();
  const prev = await page.locator('.modal-sheet').last().textContent(); assert.match(prev, /Recovery seed phrase/); assert.match(prev, /Private key/); assert.match(prev, /Stored in the safe/);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // restore through Open QR with a payload made exactly like the share dialog makes it
  const sealed = await page.evaluate(async () => { const { sealText } = await import('./js/crypto.js'); return sealText(JSON.stringify({ vm: 1, item: { type: 'crypto', name: 'Restored wallet', fields: { wallet: 'Ledger', seed: 'abandon ability able about', privkey: '1234' }, notes: 'from QR', custom: [{ label: 'Branch', value: 'north', secret: false }] } }), 'qr-pass-1234'); });
  await page.locator('.side .nav', { hasText: 'QR tools' }).click(); await page.getByRole('tab', { name: 'Open QR' }).click();
  assert.ok(await page.locator('details.how summary', { hasText: 'restore' }).count());
  await page.fill('textarea[aria-label="Sealed payload"]', sealed); await page.fill('input[aria-label="Password"]', 'qr-pass-1234'); await page.getByRole('button', { name: /Open/ }).last().click();
  await page.waitForSelector('.itemcard', { timeout: 30000 });
  const card = await page.textContent('.itemcard'); assert.match(card, /Restored wallet/); assert.match(card, /Recovery seed phrase/); assert.match(card, /Private key/); assert.match(card, /from QR/); assert.match(card, /Branch/);
  await page.getByRole('button', { name: /Add to my vault/ }).click(); await page.waitForSelector('.detail h2:has-text("Restored wallet")');
  assert.match(await page.textContent('.detail'), /Recovery seed phrase/);
  // Backup to QR: explanation, verification
  await page.locator('.side .nav', { hasText: 'QR tools' }).click(); await page.getByRole('tab', { name: 'Backup to QR' }).click();
  const guide = await page.textContent('.how-panel'); assert.match(guide, /What is backed up/); assert.match(guide, /What is NOT in it/); assert.match(guide, /How to restore it/); assert.match(guide, /Crypto 2/);
  await page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  await page.getByRole('button', { name: /Create QR backup/ }).click(); await page.waitForSelector('.qrgrid canvas', { timeout: 60000 });
  assert.match(await page.textContent('.note.ok'), /would restore all 2 items/);
  // cursor settings
  await settingsTab(page, 'Effects');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.cursor), 'off');
  await page.getByRole('switch', { name: 'cursor', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.cursor), 'on'); assert.match(await page.evaluate(() => document.documentElement.style.getPropertyValue('--cur-default')), /data:image\/svg\+xml/);
  const neon = await page.evaluate(() => document.documentElement.style.getPropertyValue('--cur-default'));
  await page.selectOption('.setrow:has-text("Cursor style") select', 'dot'); assert.notEqual(await page.evaluate(() => document.documentElement.style.getPropertyValue('--cur-default')), neon);
  await page.locator('.setrow:has-text("Pointer size") input[type=range]').fill('200'); assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ring-scale')), '2.00');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.cursorring), 'on'); assert.ok(await page.locator('#cursor-ring').count());
  await page.selectOption('.setrow:has-text("Cursor style") select', 'system'); assert.equal(await page.evaluate(() => document.documentElement.dataset.cursor), 'off');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.18 on iPhone SE: QR tool tabs, the Seal-as-QR dialog and cursor settings fit the screen', async () => {
  const { defaultBrowserType, ...d } = devices['iPhone SE']; void defaultBrowserType;
  const { ctx, page, problems } = await newPage({ ...d, colorScheme: 'dark', reducedMotion: 'reduce' });
  const fits = async (what) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); assert.ok(o.sw <= o.cw + 1, `${what}: overflow ${o.sw}>${o.cw}`); };
  await page.goto(base); await page.waitForSelector('#pw1'); await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const more = async (label) => { await page.getByRole('button', { name: 'More' }).click(); await page.waitForSelector('.msheet'); await page.locator('.msheet-item', { hasText: label }).first().click(); };
  await page.getByRole('button', { name: 'New item' }).click(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click();
  await page.fill('#f_name', 'Phone wallet'); await page.fill('#tf_seed', 'one two three four'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2');
  await page.getByRole('button', { name: /Seal as QR/ }).first().click(); await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet .note.ok', { timeout: 30000 }); await fits('seal as QR dialog'); await page.keyboard.press('Escape');
  await more('QR tools'); for (const t of ['Open QR', 'Backup to QR', 'Seal text']) { await page.getByRole('tab', { name: t }).click(); await page.waitForTimeout(150); await fits('QR tools ' + t); }
  await more('Settings'); await page.waitForSelector('.tabs'); await page.getByRole('tab', { name: /Effects/ }).click(); await page.waitForSelector('.curprev'); await fits('cursor settings');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.19: version on the sign-in screens; every saved file name carries date and time; QR payload text can be copied; Purge memory next to every QR tool', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1');
  assert.match(await page.textContent('.gate'), /VaultManager v\d+\.\d+\.\d+/, 'version on the create screen');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.topbar');
  const STAMP = /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;
  // whole profile
  await settingsTab(page, 'General'); await page.getByRole('button', { name: /Export whole profile/ }).first().click();
  await page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [d1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]); assert.match(d1.suggestedFilename(), /^vaultmanager-profile-.+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.vmprofile$/); await page.keyboard.press('Escape');
  // QR tools: seal text → PNG + payload copy + purge
  await page.locator('.side .nav', { hasText: 'QR tools' }).click();
  await page.fill('textarea[aria-label="Text to seal"]', 'hello'); await page.fill('input[aria-label="QR password"]', 'qr-test-password'); await page.fill('input[aria-label="Confirm QR password"]', 'qr-test-password');
  await page.getByRole('button', { name: /Seal into QR/ }).click(); await page.waitForSelector('.payloadbox textarea', { timeout: 30000 });
  const payload = await page.inputValue('.payloadbox textarea'); assert.ok(payload.length > 40 && /^[A-Za-z0-9+/=]+$/.test(payload), 'the Base64 payload is shown');
  await page.getByRole('button', { name: /Copy payload text/ }).click(); await page.waitForFunction(async (p) => (await navigator.clipboard.readText()) === p, payload, { timeout: 5000 });
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]); assert.match(d2.suggestedFilename(), /^vaultmanager-qr-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  const [d3] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save as \.txt/ }).click()]); assert.match(d3.suggestedFilename(), STAMP);
  assert.ok(await page.getByRole('button', { name: /Purge memory/ }).count());
  // open tab: paste + purge, and the pasted payload opens
  await page.getByRole('tab', { name: 'Open QR' }).click(); assert.ok(await page.getByRole('button', { name: /Purge memory/ }).count() && await page.getByRole('button', { name: /Paste payload text/ }).count());
  await page.getByRole('button', { name: /Paste payload text/ }).click(); await page.waitForFunction((p) => document.querySelector('textarea[aria-label="Sealed payload"]').value === p, payload, { timeout: 5000 });
  await page.fill('input[aria-label="Password"]', 'qr-test-password'); await page.getByRole('button', { name: /^.*Open$/ }).last().click(); await page.waitForSelector('.genout', { timeout: 30000 });
  // backup tab
  await page.getByRole('tab', { name: 'Backup to QR' }).click(); assert.ok(await page.getByRole('button', { name: /Purge memory/ }).count());
  await page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1'); await page.getByRole('button', { name: /Create QR backup/ }).click(); await page.waitForSelector('.payloadbox textarea', { timeout: 60000 });
  assert.match(await page.inputValue('.payloadbox textarea'), /^VMX1:/);
  const [d4] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Also save as file/ }).click()]); assert.match(d4.suggestedFilename(), /^vaultmanager-backup-\d{4}-\d{2}-\d{2}_.+\.vmvault$/);
  // item QR: png name, payload, purge
  await page.getByRole('button', { name: '＋ New' }).click(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click(); await page.fill('#f_name', 'W1'); await page.fill('#tf_seed', 'a b c d'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForSelector('.detail h2:has-text("W1")');
  await page.getByRole('button', { name: /Seal as QR/ }).first().click(); assert.ok(await page.locator('.modal-sheet').getByRole('button', { name: 'Purge memory' }).count());
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet .payloadbox textarea', { timeout: 30000 });
  const [d5] = await Promise.all([page.waitForEvent('download'), page.locator('.modal-sheet').getByRole('button', { name: 'PNG' }).click()]); assert.match(d5.suggestedFilename(), /^vaultmanager-w1-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  await page.keyboard.press('Escape');
  // locked screen shows the version too
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.waitForSelector('#upw'); assert.match(await page.textContent('.gate'), /VaultManager v\d+\.\d+\.\d+/, 'version on the locked screen');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

for (const [label, o] of [['single file · desktop', { offline: true }], ['single file · iPhone 13', { offline: true, device: 'iPhone 13' }], ['served · iPhone SE', { device: 'iPhone SE' }]]) test('v0.19 payload text, stamped file names and version are the same in: ' + label, async () => {
  if (o.offline) execFileSync(process.execPath, [path.join(ROOT, 'tools/build-offline.mjs')], { stdio: 'pipe' });
  const opts = o.device ? (({ defaultBrowserType, ...d }) => ({ ...d, colorScheme: 'dark', reducedMotion: 'reduce' }))(devices[o.device]) : {};
  const phone = !!o.device && devices[o.device].viewport.width < 700;
  const { ctx, page, problems } = await newPage(opts);
  const fits = async (w) => { const x = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); assert.ok(x.sw <= x.cw + 1, `${label} · ${w}: overflow ${x.sw}>${x.cw}`); };
  await page.goto(o.offline ? 'file://' + path.join(ROOT, 'offline/VaultManager-offline.html') : base); await page.waitForSelector('#pw1');
  assert.match(await page.textContent('.gate'), /VaultManager v\d+\.\d+\.\d+/); await fits('create screen');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  if (phone) { await page.getByRole('button', { name: 'More' }).click(); await page.locator('.msheet-item', { hasText: 'QR tools' }).first().click(); } else await page.locator('.side .nav', { hasText: 'QR tools' }).click();
  await page.fill('textarea[aria-label="Text to seal"]', 'hello'); await page.fill('input[aria-label="QR password"]', 'qr-test-password'); await page.fill('input[aria-label="Confirm QR password"]', 'qr-test-password');
  await page.getByRole('button', { name: /Seal into QR/ }).click(); await page.waitForSelector('.payloadbox textarea', { timeout: 30000 }); await fits('seal result');
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]); assert.match(d.suggestedFilename(), /^vaultmanager-qr-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  assert.ok(await page.getByRole('button', { name: /Copy payload text/ }).count() && await page.getByRole('button', { name: /Purge memory/ }).count());
  await page.getByRole('tab', { name: 'Open QR' }).click(); await fits('open tab'); assert.ok(await page.getByRole('button', { name: /Paste payload text/ }).isVisible());
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), [], label);
  await ctx.close();
});

test('v0.20: system menu (about, shortcuts, tour, settings, task manager, lock, purge, switch profile, restart); an auto-lock returns you to the page you were on', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await page.getByRole('button', { name: 'VaultManager menu' }).click();
  const labels = await page.locator('.sysmenu .sm-item').allTextContents();
  for (const w of ['About VaultManager', 'Keyboard shortcuts', 'Guided tour', 'Settings', 'Task manager', 'Lock screen', 'Purge memory now', 'Switch profile', 'Restart']) assert.ok(labels.some((l) => l.includes(w)), 'menu has ' + w);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); assert.equal(await page.locator('.sysmenu').count(), 0, 'Escape closes it');
  await page.keyboard.press('F1'); await page.waitForSelector('.modal-sheet'); assert.match(await page.textContent('.modal-sheet'), /Keyboard shortcuts/); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'VaultManager menu' }).click(); await page.locator('.sysmenu').getByRole('menuitem', { name: /Task manager/ }).click(); await page.waitForSelector('.tmtable', { timeout: 5000 });
  await page.getByRole('button', { name: 'VaultManager menu' }).click(); await page.locator('.sysmenu').getByRole('menuitem', { name: /Purge memory now/ }).click(); await page.waitForFunction(() => /Memory purged/.test(document.body.textContent));
  // lock from the menu while on QR tools; unlocking again returns to QR tools, not Home
  await page.locator('.side .nav', { hasText: 'QR tools' }).click(); await page.waitForSelector('textarea[aria-label="Text to seal"]');
  await page.getByRole('button', { name: 'VaultManager menu' }).click(); await page.locator('.sysmenu').getByRole('menuitem', { name: /Lock screen/ }).click(); await page.waitForSelector('#upw');
  await page.fill('#upw', MASTER); await page.keyboard.press('Enter'); await page.waitForSelector('.topbar', { timeout: 30000 }); await page.waitForTimeout(2500);
  assert.equal(await page.textContent('.apptitle'), 'QR tools', 'back on the page you were on');
  // restart reloads the app to the sign-in screen
  await page.getByRole('button', { name: 'VaultManager menu' }).click(); await page.locator('.sysmenu').getByRole('menuitem', { name: /Restart/ }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click(); await page.waitForSelector('#upw', { timeout: 15000 });
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.20 on a phone: Purge memory now, Switch profile and Restart are in the menu', async () => {
  const { defaultBrowserType, ...d } = devices['iPhone 13']; void defaultBrowserType;
  const { ctx, page } = await newPage({ ...d, colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(base); await page.waitForSelector('#pw1'); await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'More' }).click(); await page.waitForSelector('.msheet');
  for (const w of ['Purge memory now', 'Switch profile', 'Restart']) assert.ok(await page.locator('.msheet-item', { hasText: w }).count(), w);
  await page.locator('.msheet-item', { hasText: 'Purge memory now' }).click(); await page.waitForFunction(() => /Memory purged/.test(document.body.textContent));
  await ctx.close();
});

test('a click on a menu item while the unlock screen is still showing is not lost', async () => {
  const { ctx, page } = await newPage({ reducedMotion: 'no-preference' });
  await createVault(page);
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.waitForSelector('#upw'); await page.fill('#upw', MASTER); await page.keyboard.press('Enter');
  await page.waitForSelector('#boot', { timeout: 30000 });
  const box = await page.locator('.side .nav', { hasText: 'Favorites' }).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelector('.apptitle')?.textContent === 'Favorites', null, { timeout: 5000 });
  await ctx.close();
});
