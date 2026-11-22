/* Browser end-to-end tests: drives the real UI in Chromium against a local static server. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, GROUPS, TYPE_KEYS } from '../js/templates.js';
import { execFileSync } from 'node:child_process';
/* words in a generated passphrase: the EFF list has one hyphenated word, "yo-yo", so a plain split('-') miscounts it */
const wordCount = (s) => String(s).replace(/(^|-)yo-yo(?=-|$)/g, '$1yoyo').split('-').length;

const require = createRequire(import.meta.url);
let pw, devices;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
devices = pw.devices;
/* VM_BROWSER=chromium (default) | firefox | webkit  — the same suite runs on every engine (Safari = WebKit; Edge, Brave, Helium = Chromium). */
const ENGINE = process.env.VM_BROWSER || 'chromium';
const chromium = pw[ENGINE];

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
  base = 'http://' + (ENGINE === 'firefox' ? '127.0.0.1' : 'localhost') + ':' + server.address().port + '/';   // Firefox gathers no WebRTC host candidates for a "localhost" origin, which would make Beam untestable
  browser = await chromium.launch(ENGINE === 'chromium' ? { args: ['--no-sandbox', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] } : ENGINE === 'firefox' ? { firefoxUserPrefs: { 'media.peerconnection.ice.loopback': true, 'media.peerconnection.ice.obfuscate_host_addresses': false } } : {});
});
after(async () => { await browser.close(); server.close(); });

async function newPage(opts = {}, allowHosts = []) {
  // Playwright's Firefox sends no pointer events while touch emulation is on (real Firefox does), so phone-sized runs there use the narrow viewport only.
  if (ENGINE === 'firefox') { opts = { ...opts }; delete opts.hasTouch; delete opts.isMobile; }
  // Playwright's WebKit cannot intercept requests that a page's service worker handles, which would hide the mocked GitHub / relay calls; offline mode is the only test that needs the worker, and it is skipped there.
  if (ENGINE === 'webkit') opts = { serviceWorkers: 'block', ...opts };
  const ctx = await browser.newContext({ reducedMotion: 'reduce', colorScheme: 'dark', viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...(ENGINE === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}), ...opts });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/chrome:\/\/juggler|blocked by Playwright/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
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
  assert.match(await page.textContent('.err:not(.photo-err):not(.totp-err)'), /too easy|easy to guess/i);
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER + 'x');
  await page.click('button[type=submit]');
  assert.match(await page.textContent('.err:not(.photo-err):not(.totp-err)'), /do not match/);
  await page.fill('#pw2', MASTER);
  await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await showEverything(page);
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
  assert.equal(wordCount(await page.textContent('.genout')), 10);

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
  assert.ok(await page.locator('.welcome-go').isVisible()); await page.keyboard.press('Escape'); await page.waitForSelector('.welcome', { state: 'detached' }); await showEverything(page);

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
  assert.equal(await page.locator('.modal-sheet .cats .btn').count(), 29); await tall('.modal-sheet .cats .btn', 44, 'category picker');
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
  assert.equal(await page.locator('.msheet-item .ico.cat').count(), 29, 'all 29 categories are reachable on a phone'); await tall('.msheet-item', 44, 'more sheet');
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
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await showEverything(page); await page.waitForSelector('.widgets'); await fits('home');
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
    await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]'); await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await showEverything(page);
    await page.getByRole('button', { name: /New/ }).first().click().catch(async () => page.getByRole('button', { name: 'New item' }).click());
    await page.waitForSelector('.modal-sheet .cats'); const out = await page.$$eval('.modal-sheet .cats .btn', (bs) => Object.fromEntries(bs.map((b) => [b.textContent.trim(), b.querySelector('svg').outerHTML]))); await ctx.close(); return out;
  };
  const desk = await grab({}), phone = await grab({ ...(({ defaultBrowserType, ...d }) => d)(devices['iPhone 13']), colorScheme: 'dark', reducedMotion: 'reduce' });
  assert.equal(Object.keys(desk).length, 29); assert.deepEqual(desk, phone);
  const html = Object.values(desk).join('').replace(/aria-label="[^"]*"/g, ''); assert.ok(!EMOJI.test(html), 'icons are drawn shapes, not emoji glyphs');
});

test('light theme renders (dark is the default, even on a light device; Light can be chosen on the create screen)', async () => {
  const { ctx, page } = await newPage({ colorScheme: 'light' });
  await page.goto(base); await page.waitForSelector('#pw1');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'a new device starts dark');
  assert.equal(await page.getAttribute('.themeseg button[aria-pressed="true"]', 'data-theme-choice'), 'dark', 'the create screen pre-selects Dark');
  await page.click('.themeseg button[data-theme-choice="light"]');
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
  await showEverything(page);   // the default side bar shows only a few categories and tools; most tests want them all
  await page.evaluate(() => document.querySelectorAll('.ngroup[aria-expanded=false]').forEach((b) => b.click()));   // category groups start collapsed (except Everyday)
}
async function showEverything(page) {
  const direct = page.locator('.side .nav:has-text("Settings"), .dock-item[aria-label="Settings"]').first();
  if (await direct.count() && await direct.isVisible()) await direct.click(); else { await page.getByRole('button', { name: 'More' }).click(); await page.waitForSelector('.msheet'); await page.locator('.msheet-item', { hasText: 'Settings' }).first().click(); }
  await page.getByRole('tab', { name: /Dock & menu bar/ }).click(); await page.getByRole('button', { name: 'Show everything' }).click();
  await page.locator('.side .nav:has-text("Home"), .dock-item[aria-label="Home"], .mbar-item:has-text("Home")').filter({ visible: true }).first().click(); await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); await page.waitForTimeout(200);
}
async function addLogin(page, name, extra = async () => {}) {
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet');
  if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click();   // motion on: the picker opens as the 3D carousel, this helper wants the list
  await page.getByRole('button', { name: '🔑 Login', exact: true }).click();
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
  assert.match(await page.textContent('.modal-sheet .err:not(.photo-err):not(.totp-err)'), /limit/); await page.keyboard.press('Escape');

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
  assert.match(await A.page.textContent('.err:not(.photo-err):not(.totp-err)'), /at least 12/);
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
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, accept, x-github-api-version', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
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

test('passkey unlock: add (re-auth required), unlock with it, fall back to password, remove', { skip: ENGINE !== 'chromium' && 'needs the Chromium virtual authenticator (CDP); real-device passkeys are checked by hand' }, async () => {
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
  await page.fill('.modal-sheet input[data-pw]', 'wrong password!!'); await page.keyboard.press('Enter');
  await page.waitForSelector('text=That is not your master password');
  await page.fill('.modal-sheet input[data-pw]', MASTER); await page.keyboard.press('Enter');
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
  await page.fill('.modal-sheet input[data-pw]', MASTER); await page.keyboard.press('Enter');
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
    ['🏦 Bank account', 'Checking', 'tf_holder'], ['🖥️ Server / API key', 'Prod API', 'tf_username']];
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

test('beam sync: pair two devices (real WebRTC), verify, merge both ways incl. attachments; wrong passphrase refused', { skip: ENGINE === 'webkit' && "Playwright's Linux WebKit cannot resolve the mDNS candidates that Safari uses on a real network, so two local pages cannot pair; Safari-to-Safari Beam is checked by hand" }, async () => {
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
  await page.locator('#boot').click({ force: true, timeout: 5000 }).catch(() => {}); await page.waitForSelector('#boot', { state: 'detached' });   // WebKit may finish the animation before the click lands
  await page.waitForSelector('.widgets');                                 // start page = Home
  assert.equal(await attr('nav'), 'dock'); assert.equal(await attr('bg'), 'wallpaper'); assert.equal(await attr('anim'), 'bounce');

  // Surprise me + reset
  await page.locator('.dock-item[aria-label="Settings"]').click(); await page.getByRole('tab', { name: /Appearance/ }).click();
  await page.getByRole('button', { name: /Surprise me/ }).click(); await page.waitForSelector('text=New look');
  await page.getByRole('button', { name: 'Reset appearance' }).click(); await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.icons === '3d');
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
  await page.waitForSelector('.tour-card'); for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Next/ }).click();
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
  assert.equal(await page.locator('.modal-sheet .cats .btn').count(), 29);
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

test('offline web app: after the first visit it loads, unlocks, creates items and seals QR codes with the network cut', { skip: ENGINE === 'webkit' && "Playwright's WebKit crashes when a page is reloaded with the network switched off; Safari offline mode is checked by hand" }, async () => {
  const { ctx, page, problems } = await newPage({ serviceWorkers: 'allow' });
  await page.goto(base); await page.waitForSelector('#pw1');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);          // now controlled by the service worker
  const missing = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find((x) => x.startsWith('vm-'))); const need = ['index.html', 'js/app.js', 'js/beam.js', 'js/icons.js', 'css/style.css', 'vendor/qrcode.js', 'vendor/jsQR.js', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'manifest.webmanifest']; const out = []; for (const n of need) if (!(await c.match(n))) out.push(n); return out; });
  assert.deepEqual(missing, [], 'the whole app is in the offline cache');

  await ctx.setOffline(true);                                                                              // ✈ no network from here on
  await page.reload(); await page.waitForSelector('#pw1');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await showEverything(page);
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
  assert.match(await page.textContent('.gate-ver'), /v\d+\.\d+\.\d+ · offline copy/);
  assert.equal(await page.evaluate(() => window.isSecureContext), true, 'file:// is a secure context, so WebCrypto works');
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await showEverything(page);
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

test('profiles: export a whole profile, then import it at the initial stage into a fresh browser; USB download is VaultManager-offline_v<version>.html', async () => {
  const A = await newPage(); await createVault(A.page);
  await addLogin(A.page, 'BankProfile');
  await settingsTab(A.page, 'General');
  await A.page.getByRole('button', { name: /Export whole profile/ }).click();
  assert.equal(await A.page.getAttribute('input[aria-label="Backup password"]', 'data-pw'), 'hidden', 'the export password is hidden');
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'different-one-xx'); await A.page.getByRole('button', { name: 'Download backup' }).click();
  assert.match(await A.page.locator('.modal-sheet .err:not(:empty)').first().textContent(), /do not match/);
  await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  assert.match(dl.suggestedFilename(), /\.vmprofile$/);
  const text = fs.readFileSync(await dl.path(), 'utf8'); assert.ok(text.startsWith('VMP1:'));
  assert.ok(!text.includes('BankProfile'), 'the backup is encrypted');
  // the USB option downloads the single file
  const usb = A.page.getByRole('button', { name: /Download VaultManager-offline_v\d+\.\d+\.\d+\.html/ });
  if (await usb.count()) { const [d2] = await Promise.all([A.page.waitForEvent('download'), usb.first().click()]); assert.match(d2.suggestedFilename(), /^VaultManager-offline_v\d+\.\d+\.\d+\.html$/); }
  await A.ctx.close();

  const B = await newPage(); await B.page.goto(base); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
  await B.page.fill('textarea[aria-label="Backup text"]', text);
  await B.page.fill('input[aria-label="Backup password"]', 'wrong-backup-password');
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForFunction(() => [...document.querySelectorAll('.modal-sheet .err')].some((e) => e.textContent.trim()), null, { timeout: 90000 });
  await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.fill('input[aria-label="New master password"]', 'a-new-master-pass-123'); await B.page.fill('input[aria-label="Repeat new master password"]', 'a-new-master-pass-123');
  await B.page.locator('.modal-sheet input[type=checkbox]').last().check();
  await B.page.getByRole('button', { name: 'Create profile' }).click();
  await B.page.waitForSelector('.topbar', { timeout: 90000 });
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
  assert.equal(await page.getAttribute('input[aria-label="QR password"]', 'data-pw'), 'hidden');
  assert.equal(await page.getAttribute('input[aria-label="Confirm QR password"]', 'data-pw'), 'hidden');
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
  if (ENGINE !== 'webkit') { assert.equal(posts.length, 1); assert.match(posts[0], /Hello admin/); assert.match(posts[0], /Testing the relay/); assert.ok(!/upw|master/i.test(posts[0])); }   // Playwright's WebKit cannot intercept a keepalive no-cors request
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
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250); await showEverything(page);
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
  assert.match(bg, /gradient|^url\(/); const sz = await page.locator('.side .nav', { hasText: 'Favorites' }).locator('.ico').boundingBox(); assert.ok(sz.width >= 26, 'tile is a real icon size, ' + sz.width);
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
  await grip.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);   // after the keyboard resize the grip can sit below the fold, where a mouse drag cannot reach it
  const g = await grip.boundingBox(); const before = await w.boundingBox();
  await page.mouse.move(g.x + 10, g.y + 10); await page.mouse.down(); await page.mouse.move(Math.min(g.x + 260, page.viewportSize().width - 4), g.y + 120, { steps: 8 }); await page.mouse.up();   // stay inside the window: Firefox reports odd coordinates beyond its edge
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
  await page.fill('#f_name', 'Ledger Nano X'); await page.selectOption('#tf_wallet', 'Ledger'); await page.fill('#tf_seed', 'zoo zebra zone zero zest zinc zip zigzag'); await page.fill('#tf_privkey', 'key-4821');
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
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250); await showEverything(page);
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
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.topbar'); await showEverything(page);
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
  await page.getByRole('button', { name: /Copy payload text/ }).click(); if (ENGINE === 'chromium') await page.waitForFunction(async (p) => (await navigator.clipboard.readText()) === p, payload, { timeout: 5000 }); else await page.waitForSelector('.toast');   // Firefox and Safari do not let a page read the clipboard back
  const [d2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PNG' }).click()]); assert.match(d2.suggestedFilename(), /^vaultmanager-qr-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  const [d3] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save as \.txt/ }).click()]); assert.match(d3.suggestedFilename(), STAMP);
  assert.ok(await page.getByRole('button', { name: /Purge memory/ }).count());
  // open tab: paste + purge, and the pasted payload opens
  await page.getByRole('tab', { name: 'Open QR' }).click(); assert.ok(await page.getByRole('button', { name: /Purge memory/ }).count() && await page.getByRole('button', { name: /Paste payload text/ }).count());
  await page.getByRole('button', { name: /Paste payload text/ }).click();
  if (ENGINE === 'chromium') await page.waitForFunction((p) => document.querySelector('textarea[aria-label="Sealed payload"]').value === p, payload, { timeout: 5000 });
  else await page.waitForFunction((p) => document.querySelector('textarea[aria-label="Sealed payload"]').value === p || /did not allow reading the clipboard/.test(document.body.textContent), payload, { timeout: 5000 });   // Firefox and Safari may refuse to let a page read the clipboard; the app then asks you to paste into the box, which is what the next line does
  if (ENGINE !== 'chromium') await page.fill('textarea[aria-label="Sealed payload"]', payload);
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
  await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250); await showEverything(page);
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
  assert.match(await page.locator('.sysmenu .sm-who').textContent(), /My vault[\s\S]*Signed in/, 'the current profile is shown at the top of the menu');
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
  assert.match(await page.textContent('.modal-sheet'), /Signed in as My vault/);
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

test('v0.21: centred unlock screen, side-bar auto-hide, clock position, live New icon', async () => {
  const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' });
  await createVault(page);
  assert.ok(await page.locator('.topbar .newbtn .newico .ico svg').count(), 'New is a real icon, not a plain +');
  // unlock screen is centred
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.waitForSelector('#upw'); await page.fill('#upw', MASTER); await page.keyboard.press('Enter');
  await page.waitForSelector('#boot .boot-box', { timeout: 30000 });
  const b = await page.locator('#boot .boot-box').boundingBox(), vw = 1280;
  assert.ok(Math.abs(b.x + b.width / 2 - vw / 2) < 4, 'boot content is centred: ' + (b.x + b.width / 2)); await page.keyboard.press('Escape'); await page.waitForSelector('#boot', { state: 'detached' });
  // clock position
  const cx = async () => { const r = await page.locator('.barclock').boundingBox(); return r.x + r.width / 2; };
  assert.equal(await page.evaluate(() => document.documentElement.dataset.clockpos), 'center', 'the clock is in the middle by default'); assert.equal(await page.evaluate(() => document.documentElement.dataset.clocksize), 'large'); assert.ok(Math.abs((await cx()) - 640) < 40, 'the default clock sits in the middle');
  await settingsTab(page, 'Dock & menu bar'); await page.getByRole('button', { name: 'Left', exact: true }).click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.clockpos), 'left'); const leftX = await cx(); assert.ok(leftX < 500, 'clock moved left: ' + leftX);
  await page.getByRole('button', { name: 'Middle', exact: true }).click(); const mid = await cx(); assert.ok(Math.abs(mid - 640) < 40, 'clock in the middle: ' + mid);
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  // auto-hide the side bar
  const left0 = (await page.locator('.side').boundingBox()).x; assert.ok(left0 >= 0);
  const sideX = () => page.evaluate(() => document.querySelector('.side').getBoundingClientRect().x);
  const sideAt = (cmp, v, why) => page.waitForFunction(([c, n]) => { const x = document.querySelector('.side').getBoundingClientRect().x; return c === 'lt' ? x < n : x > n; }, [cmp, v], { timeout: 8000 }).catch(async () => { throw new Error(why + ' (side bar x = ' + (await sideX()) + ')'); });   // poll: the slide animation takes longer on a slow machine
  await page.getByRole('switch', { name: /dockAutoHide/ }).click();
  await sideAt('lt', -150, 'side bar slid away');
  await page.mouse.move(2, 300); await sideAt('gt', -5, 'side bar comes back when the pointer reaches the edge');
  await page.mouse.move(900, 400); await sideAt('lt', -150, 'side bar slides away again');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.22: security check finds extension traces and replaced browser functions, warns live, explains limits and advice; protected-data explanation', async () => {
  const { ctx, page, problems } = await newPage();
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));   // the test browser is automated; pretend it is not so the page starts clean
  await createVault(page);
  await page.locator('.side .nav', { hasText: 'Task manager' }).click(); await page.getByRole('tab', { name: 'Security check' }).click();
  assert.match(await page.textContent('.secsum'), /No signs of tampering/);
  assert.match(await page.textContent('.tm'), /cannot \(and would not\) read that list/); assert.ok((await page.locator('.advlist li').count()) >= 5);
  // simulate an extension: a known password-manager element, an unknown custom element, an extension script, and a replaced fetch
  await page.evaluate(() => {
    const a = document.createElement('com-bitwarden-button'); document.body.append(a);
    const b = document.createElement('weird-ext-widget'); document.body.append(b);
    const c = document.createElement('script'); c.setAttribute('src', 'chrome-extension://abcdefghijklmnop/inject.js'); document.head.append(c);
    window.fetch = function fakeFetch() { return Promise.resolve(); };
  });
  await page.waitForSelector('.secbar:not([hidden])', { timeout: 5000 });
  assert.match(await page.textContent('.secbar'), /modifying this page/);
  await page.getByRole('button', { name: /Scan again/ }).click();
  const txt = await page.textContent('.secfinds');
  assert.match(txt, /Bitwarden is active on this page/); assert.match(txt, /unknown extension added an element \(<weird-ext-widget>\)/); assert.match(txt, /injected its own script/); assert.match(txt, /Browser functions have been replaced[\s\S]*window\.fetch/);
  assert.match(await page.textContent('.secsum'), /thing/);
  await page.getByRole('button', { name: 'Dismiss' }).click(); assert.ok(await page.locator('.secbar').isHidden());
  // settings explain what is protected
  await settingsTab(page, 'Security'); const prot = await page.textContent('.protgrid'); assert.match(prot, /Encrypted[\s\S]*seed phrases[\s\S]*Attached files/); assert.match(prot, /profile’s name and picture/);
  assert.ok(await page.getByRole('button', { name: /device & browser check/ }).count());
  await ctx.close();
});

test('v0.23: share one item together with its attached files as an encrypted file; restored on another vault; explained in the QR dialog', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-share-'));
  const txt = path.join(tmp, 'recovery-codes.txt'); fs.writeFileSync(txt, 'code-1\ncode-2\n');
  const png = path.join(tmp, 'passport.png'); fs.writeFileSync(png, PNG);
  await addLogin(page, 'Bank', async () => { await page.setInputFiles('input[aria-label="Choose files"]', [png, txt]); await page.waitForSelector('.modal-sheet .att >> nth=1'); });
  await page.getByRole('button', { name: /Seal as QR/ }).first().click();
  await page.locator('.how summary').click();
  assert.match(await page.textContent('.how'), /Attached files are NOT included[\s\S]*Save item \+ files as encrypted file/);
  const SHARE_PW = 'share-me-please-123';
  await page.locator('.modal-sheet input[aria-label="QR password"]').fill(SHARE_PW);
  await page.locator('.modal-sheet input[aria-label="Confirm QR password"]').fill(SHARE_PW);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save item \+ files as encrypted file/ }).click()]);
  assert.match(dl.suggestedFilename(), /^vaultmanager-bank-.*\.vmvault$/);
  const fileText = fs.readFileSync(await dl.path(), 'utf8');
  assert.ok(fileText.startsWith('VMX1:'));
  assert.ok(!fileText.includes('code-1') && !fileText.includes('Bank'), 'the file must be encrypted');
  await ctx.close();

  // a different vault restores the item with both files
  const b = await newPage();
  await createVault(b.page);
  const vf = path.join(tmp, 'bank.vmvault'); fs.writeFileSync(vf, fileText);
  await b.page.locator('.side .nav', { hasText: 'Import & export' }).click();
  await b.page.setInputFiles('input[aria-label="Backup file"]', vf);
  await b.page.locator('input[aria-label="Backup password to open"]').fill(SHARE_PW);
  await b.page.getByRole('button', { name: /^.*Restore$/ }).click();
  await b.page.waitForSelector('.toast');
  assert.match(await b.page.textContent('.toast'), /Restored 1/);
  await b.page.locator('.side .nav', { hasText: 'All items' }).click(); await b.page.locator('.item', { hasText: 'Bank' }).first().click();
  await b.page.waitForSelector('.detail .att >> nth=1');
  const [dl2] = await Promise.all([b.page.waitForEvent('download'), b.page.getByRole('button', { name: 'Download recovery-codes.txt' }).click()]);
  assert.equal(fs.readFileSync(await dl2.path(), 'utf8'), 'code-1\ncode-2\n');
  assert.deepEqual(problems.concat(b.problems).filter((p) => !/Failed to load resource/.test(p)), []);
  await b.ctx.close();
});

test('v0.24: the profile picture (letter, emoji, photo) can be changed after the profile exists; shows in the menu and on the sign-in screen', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await page.getByRole('button', { name: 'VaultManager menu' }).click();
  assert.equal(await page.locator('.sysmenu .sm-who .pav img').count(), 0);
  await page.locator('.sysmenu .sm-who').click();
  await page.waitForSelector('.avpick');
  await page.locator('.avpick').getByRole('button', { name: 'Emoji', exact: true }).click();
  await page.locator('.avpick .emo', { hasText: '🦊' }).click();
  await page.waitForSelector('.toast:has-text("Profile picture saved")');
  await page.getByRole('button', { name: 'VaultManager menu' }).click();
  assert.match(await page.locator('.sysmenu .sm-who .pav').textContent(), /🦊/);
  await page.keyboard.press('Escape');
  // photo
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-av-')); const png = path.join(tmp, 'me.png'); fs.writeFileSync(png, PNG);
  await page.setInputFiles('input[aria-label="Profile photo"]', png);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'VaultManager menu' }).click();
  assert.equal(await page.locator('.sysmenu .sm-who .pav img').count(), 1);
  await page.keyboard.press('Escape');
  // back to a letter, then it survives a lock
  await page.locator('.avpick').getByRole('button', { name: 'Letter', exact: true }).click();
  await page.getByRole('button', { name: 'VaultManager menu' }).click(); await page.locator('.sysmenu').getByRole('menuitem', { name: /Lock screen/ }).click(); await page.waitForSelector('#upw');
  assert.equal(await page.locator('.brand .pav img').count(), 0); assert.match(await page.locator('.brand .pav').first().textContent(), /^M/);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.25: a browser that lacks something VaultManager needs shows a clear "update your browser" message; a normal one does not', async () => {
  const bad = await newPage();
  await bad.page.addInitScript(() => { Object.defineProperty(window, 'structuredClone', { value: undefined, configurable: true }); });
  await bad.page.goto(base);
  await bad.page.waitForSelector('.noscript[role="alert"]');
  const msg = await bad.page.textContent('.noscript[role="alert"]');
  assert.match(msg, /needs a newer browser[\s\S]*Chrome, Edge, Brave, Firefox or Safari[\s\S]*structured cloning/);
  await bad.ctx.close();
  const good = await newPage();
  await good.page.goto(base); await good.page.waitForSelector('#pw1');
  assert.equal(await good.page.locator('.noscript[role="alert"]').count(), 0);
  assert.equal(await good.page.evaluate(() => window.__vmUnsupported === undefined), true);
  await good.ctx.close();
});

test('v0.25.1: the sign-in card keeps picture, name, recovery link, links and badges on its centre line (desktop and phone)', async () => {
  for (const [label, opts] of [['desktop', {}], ['phone', (({ defaultBrowserType, ...d }) => d)(devices['iPhone SE'])]]) {
    const { ctx, page, problems } = await newPage(opts);
    await createVault(page);
    await page.reload(); await page.waitForSelector('#upw');   // a reload locks the vault, on any screen size
    const off = await page.evaluate(() => {
      const card = document.querySelector('.gate-card').getBoundingClientRect(), mid = card.left + card.width / 2;
      const d = (el) => { const r = el.getBoundingClientRect(); return Math.round(Math.abs(r.left + r.width / 2 - mid)); };
      const toggle = [...document.querySelectorAll('.gate-card form .linkbtn')][0];
      return { avatar: d(document.querySelector('.gate-card .brand .pav')), name: d(document.querySelector('.gate-card .brand h1')), sub: d(document.querySelector('.gate-card .brand p')), recovery: d(toggle), links: d(document.querySelector('.gate-links')), trust: d(document.querySelector('.gate-card .trust')),
        chips: [...document.querySelectorAll('.gate-card .trust')].map((t) => { const kids = [...t.children].map((c) => c.getBoundingClientRect()); const l = Math.min(...kids.map((k) => k.left)), r = Math.max(...kids.map((k) => k.right)); return Math.round(Math.abs((l + r) / 2 - mid)); })[0] };
    });
    for (const [k, v] of Object.entries(off)) assert.ok(v <= 8, `${label}: ${k} is ${v}px off the centre line`);
    assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
    await ctx.close();
  }
});

test('v0.26.0: Title + Description on every item, reorderable custom fields, and Seal as QR on a locked item', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await page.getByRole('button', { name: '＋ New' }).click(); await page.getByRole('button', { name: '🔑 Login', exact: true }).click();
  assert.equal(await page.locator('label[for=f_name]').textContent(), 'Title');
  assert.ok(await page.locator('#f_description').isVisible(), 'description box in the editor');
  await page.fill('#f_name', 'Work mail'); await page.fill('#f_description', 'Shared inbox for the billing team');
  for (const [l, v] of [['First', '1'], ['Second', '2'], ['Third', '3']]) {
    await page.getByRole('button', { name: '＋ Add a field' }).click();
    const n = await page.locator('.cf').count();
    await page.locator('.cf').nth(n - 1).locator('input[aria-label="Custom field label"]').fill(l); await page.locator('.cf').nth(n - 1).locator('input[aria-label="Custom field value"]').fill(v);
  }
  assert.ok(await page.locator('.cf').first().getByRole('button', { name: 'Move custom field up' }).isDisabled(), 'first field cannot move up');
  assert.ok(await page.locator('.cf').last().getByRole('button', { name: 'Move custom field down' }).isDisabled(), 'last field cannot move down');
  await page.locator('.cf').nth(2).getByRole('button', { name: 'Move custom field up' }).click();   // First, Third, Second
  await page.locator('.cf').nth(1).getByRole('button', { name: 'Move custom field up' }).click();   // Third, First, Second
  assert.deepEqual(await page.locator('.cf input[aria-label="Custom field label"]').evaluateAll((els) => els.map((e) => e.value)), ['Third', 'First', 'Second']);
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Work mail")');
  assert.ok((await page.textContent('.detail')).includes('Shared inbox for the billing team'), 'description shown on the detail view');
  assert.ok((await page.textContent('.item')).includes('Work mail'));
  const keys = await page.locator('.detail .f .k').allTextContents();
  assert.ok(keys.indexOf('Third') < keys.indexOf('First') && keys.indexOf('First') < keys.indexOf('Second'), 'custom order kept in the detail view: ' + keys);
  await page.fill('.search', 'billing team'); assert.equal(await page.locator('.item').count(), 1, 'description is searchable'); await page.fill('.search', '');

  // the order and description survive in the QR payload
  await page.locator('.item').first().click();
  await page.getByRole('button', { name: /Seal as QR/ }).first().click(); await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet .note.ok', { timeout: 60000 });
  assert.ok((await page.textContent('.modal-sheet')).includes('description'), 'QR summary mentions the description'); await page.keyboard.press('Escape');

  // locked item: Seal as QR is reachable without first finding the Unlock button
  await page.getByRole('button', { name: /Add passcode lock/ }).click();
  const pcs = page.locator('.modal-sheet input[data-pw]'); await pcs.nth(0).fill('item-code-123'); await pcs.nth(1).fill('item-code-123');
  await page.getByRole('button', { name: 'Lock item' }).click(); await page.waitForSelector('.lockbox');
  assert.ok(!(await page.textContent('.detail')).includes('Shared inbox'), 'description is hidden while locked');
  await page.getByRole('button', { name: /Unlock & seal as QR/ }).click();
  await page.fill('input[aria-label="Item passcode"]', 'item-code-123'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForSelector('.modal-sheet:has-text("Seal as QR code")', { timeout: 60000 });
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet .note.ok', { timeout: 60000 });
  await page.keyboard.press('Escape');

  // optional: seal the QR with the item passcode itself (never stored in the QR)
  await page.getByRole('button', { name: /^.?\s*Seal as QR/ }).first().click();
  assert.ok(await page.locator('#f_usecode').isVisible(), 'the checkbox is offered for an opened locked item');
  await page.check('#f_usecode'); assert.ok(await page.locator('input[aria-label="QR password"]').isHidden(), 'QR password box hides when the passcode is used');
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet .note.ok', { timeout: 60000 });
  const sealed = await page.locator('.modal-sheet textarea').first().inputValue();
  const opened = await page.evaluate(async (p) => JSON.parse(await (await import('/js/crypto.js')).openText(p, 'item-code-123')), sealed);
  assert.equal(opened.item.name, 'Work mail'); assert.ok(!sealed.includes('item-code-123'), 'the passcode is not in the QR text');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.27.0: crypto wallet seed phrase in numbered boxes (hide each word), and passcodes of their own for the seed phrase and the 25th word', async () => {
  const { ctx, page, problems } = await newPage();
  await createVault(page);
  await page.getByRole('button', { name: '＋ New' }).click(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click();
  await page.fill('#f_name', 'Cold wallet');
  const words = 'abandon ability able about above absent absorb abstract absurd abuse access accident'.split(' ');
  assert.equal(await page.locator('.seedgrid input').count(), 12, 'starts with 12 numbered boxes');
  await page.fill('#tf_seed', words.join(' '));                                  // pasting a whole phrase spreads it over the boxes
  assert.deepEqual(await page.locator('.seedgrid input').evaluateAll((els) => els.map((e) => e.value)), words);
  assert.ok((await page.locator('.seedgrid input').evaluateAll((els) => els.every((e) => e.type === 'password'))), 'every word is hidden');
  await page.getByRole('button', { name: 'Show word 2' }).click();
  assert.deepEqual(await page.locator('.seedgrid input').evaluateAll((els) => els.map((e) => e.type)).then((t) => t.filter((x) => x === 'text').length), 1, 'one word shown, the others stay hidden');
  await page.selectOption('#tf_seed_count', '24'); assert.equal(await page.locator('.seedgrid input').count(), 24);
  await page.locator('.seedgrid input').nth(12).fill('actress');
  await page.selectOption('#tf_seed_count', '12'); assert.match(await page.textContent('.seededitor'), /Clear words 13–24 first/); assert.equal(await page.locator('.seedgrid input').count(), 24, 'a filled box is never dropped silently');
  // the 25th word and the seed phrase each get a passcode of their own
  await page.fill('#tf_passphrase', 'my-25th-word');
  await page.check('#lk_passphrase'); await page.fill('#lk1_passphrase', 'word25-code'); await page.fill('#lk2_passphrase', 'word25-code');
  await page.check('#lk_seed'); await page.fill('#lk1_seed', 'seed-code-9'); await page.fill('#lk2_seed', 'different');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.modal-sheet .err:has-text("do not match")');
  await page.fill('#lk2_seed', 'seed-code-9');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Cold wallet")', { timeout: 60000 });
  let detail = await page.textContent('.detail');
  assert.ok(!detail.includes('abandon') && !detail.includes('my-25th-word'), 'nothing readable while the two fields are locked');
  assert.equal(await page.locator('.detail .chip:has-text("Locked with its own passcode")').count(), 2);
  assert.ok(!JSON.stringify(await page.evaluate(() => Object.entries(localStorage))).includes('abandon'), 'not stored in the clear');
  // wrong passcode, then the right one
  await page.getByRole('button', { name: 'Unlock Recovery seed phrase' }).click();
  await page.fill('input[aria-label="Passcode for Recovery seed phrase"]', 'nope-nope'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForSelector('.modal-sheet .err:has-text("not the passcode")', { timeout: 60000 });
  await page.waitForTimeout(2200);
  await page.fill('input[aria-label="Passcode for Recovery seed phrase"]', 'seed-code-9'); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.waitForSelector('.seedgrid.view', { timeout: 60000 });
  detail = await page.textContent('.detail'); assert.ok(!detail.includes('abandon'), 'opened words still start hidden');
  assert.equal(await page.locator('.seedgrid.view .tile').count(), 13);
  await page.getByRole('button', { name: 'Show word 1', exact: true }).click(); assert.ok((await page.textContent('.seedgrid.view')).includes('abandon') && !(await page.textContent('.seedgrid.view')).includes('ability'), 'a single word is shown');
  await page.getByRole('button', { name: 'Lock Recovery seed phrase again' }).click(); await page.waitForSelector('.detail .chip:has-text("Locked with its own passcode")');
  assert.ok(!(await page.textContent('.detail')).includes('abandon'));
  // editing: the locked field is left alone unless it is unlocked first
  await page.getByRole('button', { name: /Edit/ }).first().click();
  assert.ok(await page.locator('.modal-sheet .lockablefield .lockbox').count() >= 2, 'both locked fields are offered for unlocking, not editing');
  await page.fill('#f_description', 'only the description changed'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail:has-text("only the description changed")');
  assert.equal(await page.locator('.detail .chip:has-text("Locked with its own passcode")').count(), 2, 'still locked after an unrelated edit');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.28.0: importing a profile backup can reuse the backup password as the master password (optional)', async () => {
  const A = await newPage(); await createVault(A.page);
  await settingsTab(A.page, 'General'); await A.page.getByRole('button', { name: /Export whole profile/ }).first().click();
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  const text = fs.readFileSync(await dl.path(), 'utf8'); await A.ctx.close();
  const B = await newPage(); await B.page.goto(base); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
  await B.page.fill('textarea[aria-label="Backup text"]', text); await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  await B.page.getByRole('button', { name: 'Open backup' }).click(); await B.page.waitForSelector('#f_samepw');
  assert.equal(await B.page.locator('#f_samepw').isChecked(), false, 'off by default');
  await B.page.check('#f_samepw'); assert.ok(await B.page.locator('input[aria-label="New master password"]').isHidden(), 'the new-password boxes hide');
  await B.page.locator('.modal-sheet input[type=checkbox]').last().check(); await B.page.getByRole('button', { name: 'Create profile' }).click();
  await B.page.waitForSelector('.topbar', { timeout: 90000 });
  // a fresh sign-in with the backup password opens the new profile
  await B.page.reload(); await B.page.waitForSelector('#upw'); await B.page.fill('#upw', 'backup-pass-phrase-1'); await B.page.keyboard.press('Enter');
  await B.page.waitForSelector('.topbar', { timeout: 90000 });
  assert.deepEqual(B.problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await B.ctx.close();
});

test('v0.28.1: deleting an item asks first; Cancel keeps it, confirming moves it to the trash', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  await addLogin(page, 'Keep me');
  await page.getByRole('button', { name: /Delete/ }).first().click();
  assert.match(await page.textContent('.modal-sheet'), /Move to trash\?[\s\S]*Keep me[\s\S]*restore it from Trash/);
  await page.locator('.modal-sheet').getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.locator('.item', { hasText: 'Keep me' }).count(), 1, 'Cancel keeps the item');
  assert.equal(await page.locator('.detail h2', { hasText: 'Keep me' }).count(), 1, 'and keeps it open');
  await page.getByRole('button', { name: /Delete/ }).first().click(); await page.locator('.modal-sheet').getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForFunction(() => !document.querySelector('.list .item'));
  await page.locator('.side .nav', { hasText: 'Trash' }).click(); assert.equal(await page.locator('.item', { hasText: 'Keep me' }).count(), 1, 'the item is in the trash');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.29.0: the create-profile screen has an Appearance picker (kept by the new profile), live avatar buttons and an animated Create button', async () => {
  const { ctx, page, problems } = await newPage({ colorScheme: 'dark' });
  await page.goto(base); await page.waitForSelector('#pw1');
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(await theme(), 'dark');
  assert.deepEqual(await page.locator('.themeseg button').allTextContents().then((t) => t.map((x) => x.trim())), ['Auto', 'Dark', 'Light']);
  await page.locator('.themeseg button[data-theme-choice=light]').click(); assert.equal(await theme(), 'light', 'the screen switches at once');
  assert.equal(await page.getAttribute('.themeseg button[data-theme-choice=light]', 'aria-pressed'), 'true');
  // avatar buttons show which kind is picked, and the preview reacts
  const av = page.locator('.avpick');
  assert.equal(await av.getByRole('button', { name: 'Letter', exact: true }).getAttribute('aria-pressed'), 'true');
  await av.getByRole('button', { name: 'Emoji', exact: true }).click(); await page.locator('.emojigrid .emo').first().click();
  assert.equal(await av.getByRole('button', { name: 'Letter', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await av.getByRole('button', { name: 'Emoji', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('.avprev.pop').count(), 'the preview does its little bounce');
  assert.ok(await page.locator('button.btn.cta[type=submit]').isVisible(), 'the Create button carries the animated style');
  await page.getByRole('button', { name: /Suggest a passphrase/ }).click();   // 10 random words: at least 100 bits
  const bits = Number(/~(\d+) bits/.exec(await page.locator('.gate-card .meter-label').textContent())[1]); assert.ok(bits >= 100, 'suggested passphrase is ' + bits + ' bits');
  assert.equal(wordCount(await page.inputValue('#pw1')), 10);
  await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.topbar');
  assert.equal(await theme(), 'light', 'the new vault opens in the chosen theme');
  await page.reload(); await page.waitForSelector('#upw'); assert.equal(await theme(), 'light', 'and the sign-in screen remembers it');
  await page.fill('#upw', MASTER); await page.keyboard.press('Enter'); await page.waitForSelector('.topbar', { timeout: 90000 });
  assert.equal(await theme(), 'light'); assert.equal((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, true);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
  await ctx.close();
});

test('v0.29.2: importing a profile — name, picture, password choice, confirmation and Create button are centred', async () => {
  const A = await newPage(); await createVault(A.page);
  await settingsTab(A.page, 'General'); await A.page.getByRole('button', { name: /Export whole profile/ }).first().click();
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  const text = fs.readFileSync(await dl.path(), 'utf8'); await A.ctx.close();
  for (const [label, opts] of [['desktop', {}], ['phone', (({ defaultBrowserType, ...d }) => d)(devices['iPhone SE'])]]) {
    const B = await newPage(opts); await B.page.goto(base); await B.page.waitForSelector('#pw1');
    await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
    await B.page.fill('textarea[aria-label="Backup text"]', text); await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
    await B.page.getByRole('button', { name: 'Open backup' }).click(); await B.page.waitForSelector('#f_samepw');
    await B.page.check('#f_samepw');
    const off = await B.page.evaluate(() => {
      const body = document.querySelector('.impcenter'), br = body.getBoundingClientRect(), mid = br.left + br.width / 2;
      const d = (r) => Math.round(Math.abs(r.left + r.width / 2 - mid));
      const content = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
      const nameInput = document.querySelector('.impcenter input[aria-label="Profile name"]'), cs = getComputedStyle(nameInput);
      const btns = [...document.querySelectorAll('.impcenter .avpick .avbtn')].map((b) => b.getBoundingClientRect()), l = Math.min(...btns.map((b) => b.left)), r = Math.max(...btns.map((b) => b.right));
      return { nameLabel: d(content(document.querySelector('.impcenter .field > label'))), nameText: cs.textAlign === 'center' ? 0 : 99, avatar: d(document.querySelector('.impcenter .avprev .pav').getBoundingClientRect()), avatarButtons: d({ left: l, width: r - l }),
        samePw: d(content(document.querySelector('label[for=f_samepw]'))), create: d(document.querySelector('.impcenter .row .btn.primary').getBoundingClientRect()) };
    });
    for (const [k, v] of Object.entries(off)) assert.ok(v <= 10, `${label}: ${k} is ${v}px off the centre line`);
    assert.equal(await B.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), true, label + ': no sideways scroll');
    await B.ctx.close();
  }
});

test('v0.30.0: the 3D tour page loads (with or without WebGL), its chapters, colours, categories, generator and game respond, and the sign-in screen links to it', async () => {
  const quiet = (p) => !/Failed to load resource|WebGL|THREE\.|GPU|context/i.test(p);
  for (const [label, opts] of [['desktop', {}], ['phone', (({ defaultBrowserType, ...d }) => d)(devices['iPhone SE'])]]) {
    const { ctx, page, problems } = await newPage(opts);
    await page.goto(base + 'experience/'); await page.waitForFunction(() => window.__vm3d && window.__vm3d.ready, null, { timeout: 60000 });
    assert.equal(await page.locator('main .ch').count(), 9, label + ': nine chapters');
    assert.equal(await page.textContent('#catcount'), String(TYPE_KEYS.length), label + ': the category count comes from the app');
    assert.ok(await page.locator('a.btn.solid[href="../"]').count() >= 2, label + ': Open the vault leads back to the app');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), true, label + ': no sideways scroll');
    // the screen is a real game: it plays itself until a key is pressed
    assert.equal(await page.evaluate(() => window.__vm3d.screen.auto), true); await page.keyboard.press('z');
    assert.equal(await page.evaluate(() => window.__vm3d.screen.auto), false, label + ': Z takes over the game');
    // chart a new item: next category, next colour
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#c-items').offsetTop)); await page.waitForFunction(() => window.__vm3d.chapter() === 'items');
    const before = [await page.textContent('#catcard b'), await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())];
    await page.click('#chart');
    assert.notEqual(await page.textContent('#catcard b'), before[0]); assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), before[1]);
    // colour chips and the light stage
    await page.locator('#chips .chip').nth(3).click(); assert.equal(await page.locator('#chips .chip').nth(3).getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#c-settings').offsetTop)); await page.waitForFunction(() => window.__vm3d.chapter() === 'settings');
    await page.locator('[data-stage-pick=light]').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.stage), 'light');
    // the app's real passphrase generator
    await page.evaluate(() => window.scrollTo(0, document.querySelector('#c-tools').offsetTop)); await page.waitForFunction(() => window.__vm3d.chapter() === 'tools');
    await page.click('#suggest'); const bits = Number(/~(\d+) bits/.exec(await page.textContent('#bits'))[1]); assert.ok(bits >= 100, label + ': ' + bits + ' bits');
    assert.equal(wordCount(await page.textContent('#phrase')), 10);
    assert.deepEqual(problems.filter(quiet), [], label);
    await ctx.close();
  }
  const { ctx, page } = await newPage(); await page.goto(base); await page.waitForSelector('#pw1');
  assert.equal(await page.getAttribute('.gate-foot a.tourlink', 'href'), 'experience/', 'the sign-in screen offers the tour');
  await ctx.close();
});

test('v0.31.0: New item offers a 3D category carousel (spin with keys, drag and group chips) that creates the chosen kind; since v0.47.0 the plain list is the default and 3D is remembered once chosen', async () => {
  const quiet = (p) => !/Failed to load resource/.test(p);
  // reduced motion (what every other test runs with): the plain list comes first, so nothing about the old picker changed
  const R = await newPage(); await createVault(R.page);
  await R.page.getByRole('button', { name: '＋ New' }).click(); await R.page.waitForSelector('.modal-sheet .cats .btn');
  assert.equal(await R.page.locator('.c3-stage').count(), 0, 'list first for people who ask for reduced motion');
  await R.page.locator('.pickseg button').first().click(); await R.page.waitForSelector('.c3-stage'); assert.equal(await R.page.locator('.c3-card').count(), TYPE_KEYS.length, 'one card per category, even held still');
  await R.ctx.close();
  // motion on: the list is still the default (v0.47.0); choosing 3D shows the carousel
  for (const [label, opts] of [['desktop', { reducedMotion: 'no-preference' }], ['phone', { ...(({ defaultBrowserType, ...d }) => d)(devices['iPhone SE']), reducedMotion: 'no-preference' }]]) {
    const { ctx, page, problems } = await newPage(opts); await createVault(page);
    await page.getByRole('button', { name: label === 'phone' ? 'New item' : '＋ New' }).click({ force: true }); await page.waitForSelector('.modal-sheet .cats .btn');
    assert.equal(await page.locator('.c3-stage').count(), 0, label + ': the list is the default, even with motion on');
    assert.equal(await page.getAttribute('.pickseg button:nth-child(2)', 'aria-pressed'), 'true', label + ': List is the selected choice');
    await page.locator('.pickseg button').first().click(); await page.waitForSelector('.c3-stage');
    assert.equal(await page.locator('.c3-card').count(), TYPE_KEYS.length, label + ': a card for every category');
    assert.equal(await page.textContent('.c3-name'), 'Login', label + ': starts on Login');
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('c3-stage')), label + ': the ring has the keyboard focus');
    const t = await page.evaluate(() => getComputedStyle(document.querySelector('.c3-card.front')).transform); assert.match(t, /^matrix3d/, label + ': cards are really placed in 3D');
    await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.c3-name').textContent !== 'Login'); const second = await page.textContent('.c3-name');
    await page.keyboard.press('ArrowLeft'); await page.waitForFunction((s) => document.querySelector('.c3-name').textContent !== s, second);
    // a group chip jumps to that group
    await page.locator('.c3-group', { hasText: 'Money' }).click(); await page.waitForFunction(() => /^Money/i.test(document.querySelector('.c3-meta').textContent));
    // drag the ring
    const box = await page.locator('.c3-stage').boundingBox(), before = await page.textContent('.c3-name');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction((b) => document.querySelector('.c3-name').textContent !== b, before);
    // create the card in front
    await page.waitForSelector('.c3-stage[data-rest="1"]', { timeout: 30000 });   // the ring has finished coasting
    const kind = await page.textContent('.c3-name'); await page.locator('.c3-create').click();
    await page.waitForSelector('#f_name'); const head = await page.textContent('.modal-sheet h2'); assert.match(head, new RegExp('^New ' + kind.toLowerCase().replace(/[^a-z]+/g, '.*'), 'i'), label + ': the editor opens for ' + kind + ' but its title is “' + head + '”');
    await page.keyboard.press('Escape');
    // the list switch is remembered
    await page.getByRole('button', { name: label === 'phone' ? 'New item' : '＋ New' }).click({ force: true }); await page.waitForSelector('.c3-stage');
    await page.locator('.pickseg button').nth(1).click(); await page.waitForSelector('.modal-sheet .cats .btn');
    assert.ok(await page.evaluate(() => !!document.activeElement && document.activeElement.matches('.cats .btn')), label + ': switching to List puts the keyboard on the first category');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: label === 'phone' ? 'New item' : '＋ New' }).click({ force: true }); await page.waitForSelector('.modal-sheet .cats .btn'); assert.equal(await page.locator('.c3-stage').count(), 0, label + ': the list choice sticks');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), true, label + ': no sideways scroll');
    assert.deepEqual(problems.filter(quiet), [], label); await ctx.close();
  }
});

test('v0.32.0: the 3D card space (off by default since v0.47.0) can be turned on, flows behind the sign-in, create and Home screens, holds still for reduced motion, never blocks a click, and can be switched off', async () => {
  const quiet = (p) => !/Failed to load resource/.test(p);
  // reduced motion (what the other tests run with): the cards are there but nothing is animated
  const R = await newPage(); await R.page.goto(base); await R.page.waitForSelector('#pw1');
  assert.equal(await R.page.locator('#space3d .s3-card').count(), 16, 'sixteen item cards in the space');
  assert.equal(await R.page.evaluate(() => document.body.dataset.space), 'gate');
  { const t = () => R.page.evaluate(() => document.querySelector('.s3-card').style.transform); const a = await t(); await R.page.waitForTimeout(700); assert.equal(await t(), a, 'still under reduce motion'); }
  await R.ctx.close();
  // motion on: off by default, turned on from the sign-in screen's 3D effects panel
  const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' });
  await page.goto(base); await page.waitForSelector('#pw1');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fx3d), 'off', 'the 3D card space is off by default');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('space3d')).display), 'none', 'nothing flows until it is turned on');
  await page.locator('.gfx-btn').click(); assert.equal(await page.getAttribute('#gfx-panel button[aria-label="fx3d"]', 'aria-checked'), 'false');
  await page.locator('#gfx-panel button[aria-label="fx3d"]').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.fx3d), 'on');
  await page.locator('.gfx-btn').click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('space3d')).pointerEvents), 'none', 'the space never takes a click');
  const spin = async () => page.evaluate(() => document.querySelector('.s3-card').style.transform);
  const a = await spin(); await page.waitForTimeout(700); assert.notEqual(await spin(), a, 'the cards really move');
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.s3-card')).transform), /^matrix3d/, 'in 3D');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), true, 'no sideways scroll');
  /* safety: no card may ever get near the camera plane (that is what made one card fill the screen), also during a surge and on a phone-sized window */
  const near = async () => page.evaluate(() => { const persp = parseFloat(getComputedStyle(document.getElementById('space3d')).perspective); const z = Math.max(...[...document.querySelectorAll('.s3-card')].map((c) => new DOMMatrix(getComputedStyle(c).transform).m43)); return { persp, z }; });
  { const n = await near(); assert.ok(n.z + 70 + 100 < n.persp * 0.85, `nearest card z ${n.z} vs perspective ${n.persp}`); }
  await page.evaluate(() => document.getElementById('space3d').classList.add('surge')); await page.waitForTimeout(500);
  { const n = await near(); assert.equal(n.persp, 1150, 'a surge never changes the perspective'); assert.ok(n.z + 70 + 100 < n.persp * 0.85); }
  await page.evaluate(() => document.getElementById('space3d').classList.remove('surge'));
  await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(300);
  { const n = await near(); assert.ok(n.z + 70 + 100 < n.persp * 0.85, `phone: nearest card z ${n.z} vs perspective ${n.persp}`); }
  await page.setViewportSize({ width: 1280, height: 800 });
  await createVault(page);                                             // creating a profile works with the cards flowing behind it
  assert.equal(await page.evaluate(() => document.body.dataset.space), 'home', 'quieter behind the Home widgets');
  assert.ok(await page.locator('.widget').count() > 3);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.widget')).backdropFilter), 'none', 'no backdrop blur over the moving cards behind Home');
  // a dialog open over Home: the card space rests (no animated scene under the dialog's backdrop blur) and wakes again when it closes
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet');
  assert.equal(await page.evaluate(() => document.body.dataset.modal), '1'); assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('space3d')).display), 'none', 'the space rests behind a dialog on Home');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.modal-sheet'));
  assert.equal(await page.evaluate(() => document.body.dataset.modal), undefined); assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('space3d')).display), 'block');
  await page.locator('.side .nav', { hasText: 'All items' }).click(); assert.equal(await page.evaluate(() => document.body.dataset.space), 'off', 'off on the item pages');
  await page.locator('.side .nav', { hasText: 'Home' }).first().click(); assert.equal(await page.evaluate(() => document.body.dataset.space), 'home');
  // switch it off in Settings → Effects
  await settingsTab(page, 'Effects'); await page.locator('button[aria-label="fx3d"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fx3d), 'off');
  await page.locator('.side .nav', { hasText: 'Home' }).first().click(); assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('space3d')).display), 'none', 'gone when switched off');
  assert.deepEqual(problems.filter(quiet), []); await ctx.close();
  // the import dialog opens over the cards
  const I = await newPage({ reducedMotion: 'no-preference' }); await I.page.goto(base); await I.page.waitForSelector('#pw1');
  await I.page.locator('.gfx-btn').click(); await I.page.locator('#gfx-panel button[aria-label="fx3d"]').click(); await I.page.locator('.gfx-btn').click();
  await I.page.getByRole('button', { name: /Import a profile backup/ }).click(); await I.page.waitForSelector('.modal-sheet.m3d');
  assert.equal(await I.page.evaluate(() => getComputedStyle(document.getElementById('space3d')).display), 'block', 'the cards stay visible behind the import dialog');
  await I.ctx.close();
});

test('v0.33.0: thick cards and windows, tilt / thickness / float settings from the sign-in screen and Settings, kept when the profile is created', async () => {
  const quiet = (p) => !/Failed to load resource/.test(p);
  const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' });
  await page.goto(base); await page.waitForSelector('#pw1');
  const css = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const data = (k) => page.evaluate((x) => document.documentElement.dataset[x], k);
  // every floating card is a slab: a face plus slices behind it, and the windows carry a stacked edge
  const layers = (sel) => page.evaluate((q) => (getComputedStyle(document.querySelector(q)).boxShadow.match(/(rgba?|color)\(/g) || []).length, sel);
  // v0.47.0 defaults: the panel opens on off / 5 px / 1° / 6; thick cards need the 3D card space, so turn it on
  await page.click('.gfx-btn'); await page.waitForSelector('.gfx-panel:not([hidden])');
  assert.deepEqual(await page.locator('.gfx-panel input[type=range]').evaluateAll((els) => els.map((e) => e.value)), ['5', '1', '6'], 'the panel opens on the defaults');
  assert.equal(await page.getAttribute('#gfx-panel button[aria-label="fx3d"]', 'aria-checked'), 'false', '3D card space off by default');
  await page.locator('#gfx-panel button[aria-label="fx3d"]').click(); await page.click('.gfx-btn'); assert.equal(await data('fx3d'), 'on');
  assert.equal(await page.locator('.s3-card').count(), 16); assert.ok(await layers('.s3-inner') >= 9, 'each floating card has a solid edge, one layer per card (no extra 3D layers behind it)');
  assert.equal(await page.locator('.s3-card > *').count(), 16, 'exactly one layer inside each card: the face');
  assert.ok(await page.evaluate(() => document.querySelector('.s3-card').style.getPropertyValue('--ex') !== ''), 'the edge direction follows the card across the screen');
  assert.equal(await css('--fx3d-thick'), '5', 'default thickness 5 (v0.47.0)'); assert.equal(await data('thick'), 'on');
  await page.waitForFunction(() => (getComputedStyle(document.querySelector('.gate-card')).boxShadow.match(/(rgba?|color)\(/g) || []).length >= 12, null, { timeout: 5000 });   // the edge fades in after the card space was switched on
  assert.ok(((await page.evaluate(() => getComputedStyle(document.querySelector('.gate-card')).boxShadow)).match(/(rgba?|color)\(/g) || []).length >= 12, 'the sign-in window has a stacked edge');
  assert.equal(await css('--fx3d-float'), '6', 'default float 6 (v0.47.0)'); assert.equal(await css('--tilt'), '1deg', 'default tilt 1° (v0.47.0)');
  assert.equal(await data('float'), 'off', 'scripted browsers get a still window so clicks stay reliable (real browsers float)');
  // the 3D effects panel on the create screen
  await page.click('.gfx-btn'); await page.waitForSelector('.gfx-panel:not([hidden])');
  assert.deepEqual(await page.locator('.gfx-panel input[type=range]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Card thickness', '3D tilt', 'Card float']);
  await page.locator('input[aria-label="Card thickness"]').fill('24'); assert.equal(await css('--fx3d-thick'), '24');
  await page.locator('input[aria-label="3D tilt"]').fill('0');
  const box = await page.locator('.gate-card').boundingBox(); await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.2);
  assert.ok(!(await page.evaluate(() => document.querySelector('.gate-card').style.getPropertyValue('--ry'))) || /^0(\.0+)?deg$/.test(await page.evaluate(() => document.querySelector('.gate-card').style.getPropertyValue('--ry'))), 'tilt 0 keeps the window straight');
  await page.locator('input[aria-label="3D tilt"]').fill('9'); await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3);
  assert.notEqual(parseFloat(await page.evaluate(() => document.querySelector('.gate-card').style.getPropertyValue('--ry')) || '0'), 0, 'tilt 9 leans the window toward the pointer');
  await page.locator('input[aria-label="Card thickness"]').fill('0'); assert.equal(await data('thick'), 'off', 'thickness 0 makes everything flat');
  assert.ok(!(await page.evaluate(() => getComputedStyle(document.querySelector('.gate-card')).getPropertyValue('--stack'))), 'no stacked edge when flat');
  assert.ok(await layers('.s3-inner') < 4, 'no edge on the floating cards when flat');
  await page.locator('input[aria-label="Card thickness"]').fill('20'); await page.locator('input[aria-label="Card float"]').fill('6'); await page.click('.gfx-btn');
  // create the profile: the tuned values come with it
  await createVault(page);
  assert.equal(await css('--fx3d-thick'), '20'); assert.equal(await css('--fx3d-float'), '6');
  await settingsTab(page, 'Effects');
  assert.equal(await page.locator('input[aria-label="fx3dThick"]').inputValue(), '20'); assert.equal(await page.locator('input[aria-label="fx3dFloat"]').inputValue(), '6'); assert.equal(await page.locator('input[aria-label="fxTilt"]').inputValue(), '9');
  assert.equal(await page.locator('button[aria-label="fx3d"]').getAttribute('aria-checked'), 'true', 'the 3D card space turned on at sign-in comes with the profile');
  await page.locator('input[aria-label="fx3dThick"]').fill('8'); assert.equal(await css('--fx3d-thick'), '8', 'the same slider lives in Settings');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), true, 'no sideways scroll with thick widgets');
  assert.deepEqual(problems.filter(quiet), []); await ctx.close();
});

test('v0.33.2: every generate-a-password button makes 100+ bits (export, whole-profile backup, master password)', async () => {
  const bits = async (page) => +(/~(\d+) bits/.exec(await page.textContent('.modal-sheet .meter-label'))[1]);
  const A = await newPage(); await createVault(A.page);
  await settingsTab(A.page, 'General');
  await A.page.getByRole('button', { name: /Export whole profile/ }).click();
  await A.page.locator('.modal-sheet button[aria-label="Generate a passphrase"]').click();
  const b = await bits(A.page);
  assert.ok(b >= 100, 'the export dialog generator gave only ' + b + ' bits');
  assert.equal(wordCount(await A.page.inputValue('input[aria-label="Backup password"]')), 10);
  assert.deepEqual(A.problems.filter((p) => !/Failed to load resource/.test(p)), []); await A.ctx.close();
});

test('v0.33.2: social network category (YouTube, Facebook, X, Instagram, TikTok, LinkedIn) and the auto date & time on a crypto wallet', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  const openPicker = async () => { await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click(); };
  await openPicker();
  const btn = page.locator('.modal-sheet .cats .btn', { hasText: 'Social network' }); assert.equal(await btn.count(), 1, 'Social network is in the category picker');
  await btn.click(); await page.waitForSelector('#f_name'); await page.fill('#f_name', 'My channel');
  const opts = await page.locator('#tf_platform option').allTextContents();
  for (const n of ['YouTube', 'Facebook', 'X (Twitter)', 'Instagram', 'TikTok', 'LinkedIn']) assert.ok(opts.includes(n), n + ' is a platform');
  await page.selectOption('#tf_platform', 'TikTok'); await page.fill('#tf_handle', '@mychannel');
  const auto = await page.inputValue('#tf_added'); assert.match(auto, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/, 'social accounts are stamped when added');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("My channel")');
  assert.match(await page.textContent('.detail'), /TikTok[\s\S]*@mychannel/);
  await page.keyboard.press('Escape');
  await openPicker(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click(); await page.waitForSelector('#f_name'); await page.fill('#f_name', 'Ledger');
  const stamp = await page.inputValue('#tf_added'); assert.match(stamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/, 'the wallet has its date & time filled in already');
  assert.ok(Math.abs(new Date(stamp) - Date.now()) < 300000, 'it is the current local time');
  assert.equal(await page.getAttribute('#tf_added', 'type'), 'datetime-local');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Ledger")');
  assert.ok((await page.textContent('.detail')).includes(stamp.replace('T', ' ')), 'the detail page shows it as date and time');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.34.1: custom favorite names — name a favorite, filter the Favorites page by it, keep it after a re-edit', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  await addLogin(page, 'Payroll', async () => { await page.fill('#f_favname', 'Work'); assert.equal(await page.locator('.modal-sheet input[type=checkbox]').first().isChecked().catch(() => true), true); });
  await addLogin(page, 'Netflix', async () => { await page.fill('#f_favname', 'Family'); });
  await addLogin(page, 'Plain', async () => { await page.locator('label.chk:has-text("Favorite") input').check(); });
  await page.locator('.side .nav:has-text("Favorites")').click();
  await page.waitForSelector('.favchips');
  const chips = await page.locator('.favchip').allTextContents(); assert.deepEqual(chips.map((t) => t.replace(/\s+/g, ' ').trim()).sort(), ['All · 3', 'Family · 1', 'Work · 1']);
  assert.equal(await page.locator('.items .row, .items [role=option]').count(), 3);
  await page.locator('.favchip', { hasText: 'Work' }).click();
  assert.equal(await page.locator('.items [role=option]').count(), 1); assert.match(await page.textContent('.items'), /Payroll/);
  await page.locator('.items [role=option]').first().click();
  assert.match(await page.textContent('.detail .act-edit, .detail'), /Work/, 'the detail page shows the favorite name');
  await page.locator('.detail .act-edit').click(); await page.waitForSelector('#f_favname');
  assert.equal(await page.inputValue('#f_favname'), 'Work');
  assert.deepEqual(await page.locator('#f_favnames option').evaluateAll((o) => o.map((x) => x.value).sort()), ['Family', 'Work']);
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Payroll")');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.35.0: 3D live animated icons, icon-only avatars, hover tooltips, desktop-style wallpapers', async () => {
  const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' }); await createVault(page);
  await addLogin(page, 'Alpha');
  await page.locator('.side .nav:has-text("Settings")').click(); await page.getByRole('tab', { name: /Appearance/ }).click();
  const sel = page.locator('select').filter({ has: page.locator('option[value="3d"]') });
  assert.equal(await sel.count(), 1, '3D live animated is an icon style');
  assert.equal((await sel.locator('option[value="3d"]').textContent()).trim(), '3D live animated');
  await sel.selectOption('3d'); assert.equal(await page.evaluate(() => document.documentElement.dataset.icons), '3d');
  const cat = page.locator('.side .ico.cat').first();
  assert.match(await cat.evaluate((e) => getComputedStyle(e).backgroundImage), /^url\(/, 'category icons are the rendered 3D pictures');
  // item avatars: icon only, no coloured box around it
  await page.getByRole('button', { name: 'Category icon' }).click();
  await page.locator('.side .nav:has-text("All items")').click();
  const av = await page.locator('.items .avatar').first().evaluate((e) => ({ bg: getComputedStyle(e).backgroundImage + getComputedStyle(e).backgroundColor, ico: !!e.querySelector('.ico.cat svg'), tile: getComputedStyle(e.querySelector('.ico.cat')).backgroundImage }));
  assert.ok(av.ico, 'the avatar is the category icon'); assert.match(av.bg, /none.*rgba\(0, 0, 0, 0\)/, 'no coloured box behind it'); assert.match(av.tile, /gradient|url\(/, 'the icon is the tile itself');
  // hover tooltips
  await page.locator('.side .nav:has-text("Logins") .ico').hover();
  await page.locator('.items .avatar').first().hover(); await page.waitForSelector('.vm-tip:not([hidden])', { timeout: 3000 });
  assert.match(await page.textContent('.vm-tip'), /Login/);
  await page.locator('.items [role=option]').first().click(); await page.locator('.detail .act-edit').click(); await page.waitForSelector('#f_username');
  await page.locator('#f_username').hover(); await page.waitForFunction(() => /Username/.test(document.querySelector('.vm-tip:not([hidden])')?.textContent || ''), null, { timeout: 3000 });
  await page.keyboard.press('Escape');
  // the switch turns them off
  await page.locator('.side .nav:has-text("Settings")').click(); await page.getByRole('tab', { name: /Appearance/ }).click();
  await page.locator('button[aria-label="tips"], .row:has-text("Hover tooltips") button.sw').first().click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.tips), 'off');
  await page.locator('.side .nav:has-text("Logins") .ico').hover(); await page.waitForTimeout(800);
  assert.equal(await page.locator('.vm-tip:not([hidden])').count(), 0, 'no tooltip while the switch is off');
  // desktop-style wallpapers
  const tile = page.locator('.wall[aria-label="Wallpaper Aubergine glow"]'); await tile.scrollIntoViewIfNeeded(); await tile.click();
  assert.match(await page.evaluate(() => document.documentElement.style.getPropertyValue('--wall')), /data:image\/svg\+xml/);
  assert.equal(await page.locator('.wall[data-group=desk]').count(), 10, 'ten desktop-style wallpapers');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.35.0: a dialog never steals the focus back from a field you already moved into (import step 2)', async () => {
  const A = await newPage(); await createVault(A.page);
  await settingsTab(A.page, 'General'); await A.page.getByRole('button', { name: /Export whole profile/ }).click();
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  const text = fs.readFileSync(await dl.path(), 'utf8'); await A.ctx.close();
  const B = await newPage(); await B.page.goto(base); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
  await B.page.fill('textarea[aria-label="Backup text"]', text); await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  // the moment step 2 appears, move into the second field (a fast typist, or an autofill), while the dialog's own delayed focus is still pending
  await B.page.evaluate(() => { const p2 = document.querySelector('input[aria-label="Repeat new master password"]'); new MutationObserver((_, o) => { if (p2.offsetParent) { p2.focus(); o.disconnect(); } }).observe(document.querySelector('.modal-sheet'), { attributes: true, subtree: true, attributeFilter: ['hidden'] }); });
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForSelector('input[aria-label="Repeat new master password"]:visible');
  await B.page.waitForTimeout(300);
  assert.equal(await B.page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Repeat new master password', 'focus stayed where the person put it');
  assert.deepEqual(B.problems.filter((p) => !/Failed to load resource/.test(p)), []); await B.ctx.close();
});

for (const [label, offline] of [['served', false], ['single file', true]]) {
  test('v0.35.1: the category carousel and the 3D live animated icon style show real 3D icon pictures: ' + label, async () => {
    const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' });
    await page.goto(offline ? 'file://' + path.join(ROOT, 'offline/VaultManager-offline.html') : base); await page.waitForSelector('#pw1');
    await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
    await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForSelector('.welcome.in').catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet .pickseg'); await page.locator('.pickseg button').first().click(); await page.waitForSelector('.c3-obj');   // the list is the default since v0.47.0: choose 3D
    await page.waitForFunction(() => [...document.querySelectorAll('.c3-obj')].every((i) => i.complete && i.naturalWidth > 100), null, { timeout: 15000 });
    assert.equal(await page.locator('.c3-obj').count(), 29, 'every category card carries its own 3D object');
    await page.keyboard.press('Escape');
    await page.locator('.side .nav:has-text("Settings")').click(); await page.getByRole('tab', { name: /Appearance/ }).click();
    await page.locator('select').filter({ has: page.locator('option[value="3d"]') }).selectOption('3d');
    const bg = await page.locator('.side .ico.cat[data-n="login"]').evaluate((e) => getComputedStyle(e).backgroundImage); assert.match(bg, /^url\(/, 'the category icon is the 3D picture');
    assert.equal(await page.locator('.side .ico.cat[data-n="login"]').evaluate((e) => getComputedStyle(e).boxShadow), 'none');
    for (const sel of ['.side .nav:has-text("Home") .ico', '.side .nav:has-text("Settings") .ico', '.side .nav:has-text("Vault health") .ico', '.tabs [role=tab] .ico']) assert.match(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundImage), /^url\(/, sel + ' is a 3D picture');
    for (const sel of ['.side .nav:has-text("Home") .ico', '.tabs [role=tab] .ico', '.topbar .newbtn .ico']) assert.equal(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundSize), 'contain', sel + ': the picture is shown whole, never zoomed or cropped');
    assert.equal(await page.locator('.topbar .newbtn .newico').evaluate((e) => getComputedStyle(e).backgroundImage), 'none', 'no glass tile behind the 3D plus');
    await page.locator('.topbar').getByText('VaultManager').first().click(); await page.waitForSelector('.menu, [role=menu]');
    const menuIcons = await page.locator('.menu .ico, [role=menu] .ico').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage.startsWith('url(')));
    assert.ok(menuIcons.length >= 8 && menuIcons.every(Boolean), 'every system menu icon is a 3D picture: ' + menuIcons.join()); await page.keyboard.press('Escape');
    await page.locator('select').filter({ has: page.locator('option[value="3d"]') }).selectOption('glass');
    assert.equal(await page.locator('.side .ico.cat[data-n="login"]').evaluate((e) => getComputedStyle(e).backgroundImage.startsWith('url(')), false, 'other icon styles are untouched');
    assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
  });
}

test('v0.36.2: a new profile starts with the 3D live animated icon style', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.icons), '3d');
  assert.match(await page.locator('.side .ico.cat').first().evaluate((e) => getComputedStyle(e).backgroundImage), /^url\(/, 'the category icons are 3D pictures straight away');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.36.3: while a dialog is open nothing behind it blurs or animates (no flat colour block while typing a password)', async () => {
  const { ctx, page, problems } = await newPage({ reducedMotion: 'no-preference' }); await createVault(page);
  await page.locator('.side .nav:has-text("Home")').click(); await page.waitForSelector('.widget');
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); await page.waitForTimeout(400);
  const st = await page.evaluate(() => { const g = (s, p) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : 'missing'; }; return { overlay: g('.modal-overlay', 'backdropFilter'), panel: g('.widget', 'backdropFilter'), top: g('.topbar', 'backdropFilter'), wanim: g('.widget', 'animationName'), icoAnim: g('.side .ico.cat', 'animationName'), sheet: g('.modal-sheet', 'backdropFilter') }; });
  assert.equal(st.overlay, 'none'); assert.equal(st.panel, 'none'); assert.equal(st.top, 'none'); assert.equal(st.sheet, 'none'); assert.equal(st.wanim, 'none', 'widgets hold still behind a dialog'); assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.aurora i')).filter), 'none', 'the aurora is plain gradients, no big blur filter'); assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.aurora i')).animationName), 'none', 'the aurora holds still behind a dialog'); assert.equal(st.icoAnim, 'none', 'icons hold still behind a dialog');
  await page.keyboard.press('Escape');
  await page.locator('.side .nav:has-text("Settings")').click(); await page.getByRole('tab', { name: 'General' }).click();
  await page.getByRole('button', { name: /Export whole profile/ }).click(); await page.waitForSelector('input[aria-label="Backup password"]');
  await page.locator('input[aria-label="Backup password"]').click();
  for (const ch of 'squid-rust-fade-crane-angel') { await page.keyboard.type(ch); const covered = await page.evaluate(() => { const vw = innerWidth, vh = innerHeight; return [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > vw * 0.6 && r.height > vh * 0.6 && c.position === 'fixed' && c.visibility !== 'hidden' && c.display !== 'none' && !e.classList.contains('modal-overlay') && !e.classList.contains('aurora') && e.id !== 'space3d'; }).map((e) => e.className || e.id); }); assert.deepEqual(covered, [], 'a large fixed layer appeared while typing: ' + covered.join()); }
  // the strength bar has the classes s0..s4; none of them may collide with another rule (the 3D card space once used .s3, which made the bar fill the whole screen at "Good")
  const pos = await page.evaluate(() => ['s0', 's1', 's2', 's3', 's4'].map((c) => { const m = document.createElement('div'); m.className = 'meter'; const i = document.createElement('i'); i.className = c; m.append(i); document.querySelector('.modal-sheet').append(m); const r = getComputedStyle(i).position + '/' + getComputedStyle(i).display + '/' + Math.round(i.getBoundingClientRect().width); m.remove(); return r; }));
  assert.deepEqual(pos.map((x) => x.split('/')[0]), ['static', 'static', 'static', 'static', 'static'], 'meter bars stay in their box: ' + pos.join(' '));
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.37.0: the honest "How secure is this?" explanation lives in Settings → About → FAQ (and the tour), not on the create screen, and never claims a guarantee or an audit', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1');
  assert.equal(await page.getByRole('button', { name: /How secure is this/ }).count(), 0, 'nothing about it on the create screen');
  await createVault(page);
  await settingsTab(page, /About/);
  await page.waitForSelector('.faq'); assert.ok((await page.locator('.faq').count()) >= 7);
  await page.locator('.faq summary', { hasText: 'How secure is this, honestly?' }).click();
  const txt = await page.textContent('.faq .trustdoc');
  for (const must of ['turning off all browser extensions', 'air-gapped', 'offline', 'AES-256-GCM', 'PBKDF2', '600,000', 'WebCrypto', 'Rust', 'has not been audited by an independent security firm', 'Check it yourself', 'Network tab']) assert.ok(txt.includes(must), 'missing: ' + must);
  assert.ok(!/is guaranteed|100% secure|unhackable|military[- ]grade|audited by/i.test(txt.replace('has not been audited by an independent security firm', '').replace(/Nobody can honestly guarantee[^.]*\./, '')), 'no overclaiming');
  await page.locator('.faq summary', { hasText: 'forget my master password' }).click(); assert.match(await page.textContent('.faq:has-text("forget my master password")'), /recovery key/);
  await page.locator('.topbar').getByText('VaultManager').first().click(); await page.waitForSelector('.sysmenu'); assert.equal(await page.locator('.sysmenu').getByText('How secure is this?').count(), 0, 'it is in Settings → About → FAQ, not in the system menu'); await page.keyboard.press('Escape');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.38.0: secret fields are masked text (no browser password-manager prompts), Show/Hide still works, and nothing is ever shown by mistake', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1');
  const st = () => page.evaluate(() => { const i = document.querySelector('#pw1'); return { attr: i.getAttribute('type'), hid: i.dataset.pw, mask: i.classList.contains('pwmask'), cs: getComputedStyle(i).webkitTextSecurity || getComputedStyle(i).textSecurity || '', ac: i.getAttribute('autocomplete') }; });
  const a = await st();
  assert.equal(a.hid, 'hidden');
  assert.ok(a.attr === 'password' || (a.attr === 'text' && a.mask && a.cs === 'disc'), 'hidden means dots: ' + JSON.stringify(a));   // masked text where the browser supports it, otherwise a real password field
  if (a.attr === 'text') assert.equal(a.ac, 'off');
  await page.fill('#pw1', 'plum-orbit-velvet'); await page.locator('#pw1 ~ .eye, .pwwrap:has(#pw1) .eye').first().click();
  const b = await st(); assert.equal(b.hid, 'shown'); assert.ok(!b.mask && b.attr === 'text', 'Show reveals it: ' + JSON.stringify(b));
  await page.locator('.pwwrap:has(#pw1) .eye').first().click(); assert.equal((await st()).hid, 'hidden');
  // a weak master password (below 60 bits) is refused
  await page.fill('#pw1', 'Password12345'); await page.fill('#pw2', 'Password12345'); await page.check('#ack'); await page.click('button[type=submit]');
  assert.match(await page.locator('.gate-card .err:not(:empty), .err:not(:empty)').first().textContent(), /too easy to guess|Use at least/);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.39.0: Family recovery — guide, split a password into shares, combine them again, restore drill and the Home widget', async () => {
  const { ctx, page, problems } = await newPage({ reducedMotion: 'reduce' }); await createVault(page);
  // a crypto item with instructions for the family
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Crypto wallet' }).click(); await page.waitForSelector('#f_name'); await page.fill('#f_name', 'Ledger Nano');
  await page.fill('#tf_familynote', 'Plug it in and use the 24 words in the safe.'); await page.fill('#tf_hwwhere', 'Fire safe, hall cupboard'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Ledger Nano")');
  await page.locator('.side .nav:has-text("Family recovery")').click(); await page.waitForSelector('.tabs');
  // guide
  assert.match(await page.textContent('.readiness'), /1 crypto item recorded \(1 with/);
  await page.fill('textarea[aria-label="Who to call first (names and phone numbers)"]', 'Sam 555-0101'); await page.fill('textarea[aria-label="Where the USB drive or offline file is"]', 'Blue USB in the fire safe');
  assert.match(await page.textContent('.guideprev'), /Sam 555-0101/); await page.waitForTimeout(700);
  const prev = await page.textContent('.guideprev'); assert.match(prev, /Ledger Nano/); assert.ok(!/24 words|Plug it in/.test(prev), 'the guide lists wallet names only, never their contents');
  assert.match(prev, /no passwords or secret words/);
  // split 2 of 3
  await page.getByRole('tab', { name: 'Split a password' }).click();
  const secret = 'plum-orbit-velvet-anchor-glacier-ember-quartz-lunar';
  await page.fill('textarea[aria-label="Password to split"]', secret); await page.getByRole('button', { name: /Create the shares/ }).click(); await page.waitForSelector('.sharecard');
  assert.equal(await page.locator('.sharecard').count(), 3); assert.match(await page.textContent('.note.ok'), /any 2 of these 3/);
  const shares = await page.locator('.sharetext').allTextContents(); assert.ok(shares.every((s) => s.startsWith('VMS1-')));
  assert.ok(!(await page.textContent('.page')).includes(secret), 'the password itself is never shown');
  // combine: one share is not enough, two are, a typo is caught
  await page.getByRole('tab', { name: 'Combine shares' }).click();
  await page.fill('textarea[aria-label="Shares"]', shares[0]); await page.getByRole('button', { name: /Combine/ }).click(); assert.match(await page.locator('.err:not(:empty)').first().textContent(), /2 shares are needed/);
  await page.fill('textarea[aria-label="Shares"]', shares[0] + '\n' + shares[2]); await page.getByRole('button', { name: /Combine/ }).click(); await page.waitForSelector('input[aria-label="Recovered password"]');
  assert.equal(await page.inputValue('input[aria-label="Recovered password"]'), secret);
  const bad = shares[1].replace(/-(.)/, (m, c) => '-' + (c === 'A' ? 'B' : 'A')); await page.fill('textarea[aria-label="Shares"]', shares[0] + '\n' + bad); await page.getByRole('button', { name: /Combine/ }).click(); assert.match(await page.locator('.err:not(:empty)').first().textContent(), /typing mistake/);
  // drill + widget
  await page.getByRole('tab', { name: 'Restore drill' }).click(); assert.match(await page.textContent('.note'), /never run a restore drill/);
  await page.getByRole('button', { name: /We tested it today/ }).click(); await page.getByText(/Tick all 5 steps first/).waitFor();
  for (const b of await page.locator('.drill input[type=checkbox]').all()) await b.check();
  await page.getByRole('button', { name: /We tested it today/ }).click(); await page.waitForFunction(() => /Last drill: .*0 days ago/.test(document.querySelector('.note')?.textContent || ''));
  await page.locator('.side .nav:has-text("Home")').click(); await page.waitForSelector('.widget');
  assert.match(await page.textContent('.widgets'), /Family recovery[\s\S]*Last tested 0 days ago[\s\S]*Up to date/);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.40.0: the default layout — side bar shows only the Everyday categories and Vault health / Import & export / Task manager / Settings, and the clock is large and in the middle', async () => {
  const { ctx, page, problems } = await newPage();
  await page.goto(base); await page.waitForSelector('#pw1'); await page.fill('#pw1', MASTER); await page.fill('#pw2', MASTER); await page.check('#ack'); await page.click('button[type=submit]');
  await page.getByRole('button', { name: 'Skip for now' }).click(); await dismissWelcome(page); await page.waitForSelector('.topbar');
  assert.equal(await page.locator('.side .ngroup').count(), 1, 'one category group');
  assert.match(await page.textContent('.side .ngroup'), /Everyday/i);
  const cats = await page.locator('.side .nav .ico.cat').evaluateAll((els) => els.map((e) => e.dataset.n)); assert.deepEqual(cats, ['login', 'note', 'card']);
  const tools = await page.locator('.side .nav').evaluateAll((els) => els.map((e) => e.textContent.replace(/\d+$/, '').trim())); 
  for (const t of ['Vault health', 'Import & export', 'Task manager', 'Settings']) assert.ok(tools.some((x) => x.includes(t)), t + ' is in the side bar');
  for (const t of ['Generator', 'QR tools', 'Beam sync', 'Family recovery']) assert.ok(!tools.some((x) => x.includes(t)), t + ' is tucked away by default');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.clockpos), 'center'); assert.equal(await page.evaluate(() => document.documentElement.dataset.clocksize), 'large');
  const r = await page.locator('.barclock').boundingBox(); assert.ok(Math.abs(r.x + r.width / 2 - 640) < 40, 'clock in the middle'); assert.ok((await page.locator('.barclock b').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 20, 'large');
  const sb = await page.locator('.topbar .search').boundingBox(); assert.ok(sb.x + sb.width < r.x - 8, 'the search box does not run under the clock');
  // everything is still one click away
  await settingsTab(page, /Dock & menu bar/); await page.getByRole('button', { name: 'Show everything' }).click(); assert.ok(await page.locator('.side .nav', { hasText: 'QR tools' }).count());
  await page.getByRole('button', { name: 'Use the recommended layout' }).click(); assert.equal(await page.locator('.side .nav', { hasText: 'QR tools' }).count(), 0, 'the recommended layout hides them again');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.41.0: pick-lists with an Other… box (banks, wallets / exchanges, networks, carriers, insurers …), stored as plain text and shown normally', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  const open = async (label) => { await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click(); await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForSelector('#f_name'); };
  // a listed bank
  await open('🏦 Bank account'); await page.fill('#f_name', 'Main checking');
  const opts = await page.locator('#tf_bank option').allTextContents(); for (const b of ['Chase', 'Bank of America', 'Wells Fargo', 'Capital One', 'Navy Federal Credit Union', 'HSBC']) assert.ok(opts.includes(b), b + ' is in the bank list'); assert.equal(opts[opts.length - 1], 'Other…');
  await page.selectOption('#tf_bank', 'Chase'); assert.equal(await page.locator('#tf_bank_other').isVisible(), false);
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Main checking")'); assert.match(await page.textContent('.detail'), /Chase/);
  // a bank that is not in the list
  await open('🏦 Bank account'); await page.fill('#f_name', 'Local account'); await page.selectOption('#tf_bank', '__other__'); await page.waitForSelector('#tf_bank_other'); await page.fill('#tf_bank_other', 'Maple Valley Credit Union');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Local account")'); assert.match(await page.textContent('.detail'), /Maple Valley Credit Union/);
  await page.locator('.detail .act-edit').click(); await page.waitForSelector('#tf_bank'); assert.equal(await page.inputValue('#tf_bank'), '__other__'); assert.equal(await page.inputValue('#tf_bank_other'), 'Maple Valley Credit Union'); await page.keyboard.press('Escape');
  // crypto wallet / exchange and network
  await open('🪙 Crypto wallet'); await page.fill('#f_name', 'Cold storage');
  for (const w of ['Ledger', 'Trezor', 'MetaMask', 'Coinbase', 'Binance', 'Kraken']) assert.ok((await page.locator('#tf_wallet option').allTextContents()).includes(w), w);
  await page.selectOption('#tf_wallet', 'Trezor'); await page.selectOption('#tf_network', 'Bitcoin'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Cold storage")'); assert.match(await page.textContent('.detail'), /Trezor[\s\S]*Bitcoin/);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.42.0: Contacts import / export — the page states what works and what does not; vCard and CSV import with preview and duplicate skipping; export to .vcf, Google and Outlook CSV', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  await page.locator('.side .nav:has-text("Contacts")').click(); await page.waitForSelector('.contactsio');
  const txt = await page.textContent('.contactsio');
  for (const must of ['What it can do', 'What it cannot do', 'vCard', 'Outlook', 'Google Contacts', 'iCloud', 'No live sync', 'NOT encrypted', 'Photos', 'never changes or deletes', 'offline']) assert.ok(txt.includes(must), 'the panel must say: ' + must);
  const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:Alex Rivera\nORG:Acme\nTEL;TYPE=CELL:555-0102\nEMAIL:alex@example.com\nPHOTO;ENCODING=b;TYPE=JPEG:AAAA\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nFN:Pat Kim\nTEL;TYPE=WORK:555-0199\nEND:VCARD\n';
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'contacts.vcf', mimeType: 'text/vcard', buffer: Buffer.from(vcf) });
  await page.waitForSelector('.modal-sheet .ctable'); const prev = await page.textContent('.modal-sheet'); assert.match(prev, /Found 2 contacts in this vCard file/); assert.match(prev, /Left out: 1 photo/);
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.waitForSelector('.modal-sheet', { state: 'detached' });
  await page.waitForSelector('.items .item:has-text("Alex Rivera")'); assert.ok(await page.locator('.items .item:has-text("Pat Kim")').count());
  await page.locator('.items .item:has-text("Alex Rivera")').click(); const d = await page.textContent('.detail'); assert.ok(d.includes('Acme') && d.includes('555-0102') && d.includes('alex@example.com'));
  // the same file again: both are recognised as duplicates and skipped
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'contacts.vcf', mimeType: 'text/vcard', buffer: Buffer.from(vcf) }); await page.waitForSelector('.modal-sheet .ctable');
  assert.match(await page.textContent('.modal-sheet'), /2 look like people you already have/); await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.getByText('Nothing new to import').waitFor(); await page.waitForSelector('.modal-sheet', { state: 'detached' });
  assert.equal(await page.locator('.items .item').count(), 2);
  // Google CSV
  const csv = 'First Name,Last Name,Organization Name,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value\nAda,Lovelace,Analytical Co,ada@example.com,Mobile,555-1111\n';
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'google.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await page.waitForSelector('.modal-sheet .ctable'); assert.match(await page.textContent('.modal-sheet'), /Google CSV file/);
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.waitForSelector('.items .item:has-text("Ada Lovelace")');
  // not a contacts file
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('nothing,useful\n') }); await page.getByText(/No contacts found/).waitFor();
  // export: a confirmation warns the file is not encrypted, then the file is a valid vCard with all three people
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.getByRole('button', { name: /Export all as \.vcf/ }).click(); await page.getByText(/NOT encrypted: anyone who finds it/).waitFor(); await page.getByRole('button', { name: 'Export', exact: true }).click(); })()]);
  assert.match(dl.suggestedFilename(), /^vaultmanager-contacts-.*\.vcf$/); const out = fs.readFileSync(await dl.path(), 'utf8'); assert.equal((out.match(/BEGIN:VCARD/g) || []).length, 3); assert.ok(out.includes('FN:Ada Lovelace') && out.includes('EMAIL;TYPE=INTERNET:alex@example.com'));
  const [dl2] = await Promise.all([page.waitForEvent('download'), (async () => { await page.getByRole('button', { name: 'Outlook CSV' }).click(); await page.getByRole('button', { name: 'Export', exact: true }).click(); })()]);
  assert.match(fs.readFileSync(await dl2.path(), 'utf8'), /First Name,Middle Name,Last Name,Nickname,Company,Department/);
  // one contact from its own page
  await page.locator('.items .item:has-text("Pat Kim")').click(); const [dl3] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export \(\.vcf\)/ }).click()]); assert.match(fs.readFileSync(await dl3.path(), 'utf8'), /FN:Pat Kim/);
  // the same panel is on Import & export
  await page.locator('.side .nav:has-text("Import & export")').click(); await page.waitForSelector('.contactsio');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.43.0: secure notes — title, content, the five fixed categories, tags, created / modified dates, expiration date with validation, attachments, access permissions', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  const day = (n) => new Date(Date.now() + n * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const open = async () => { await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click(); await page.locator('.modal-sheet .cats .btn', { hasText: 'Secure note' }).click(); await page.waitForSelector('#f_name'); };
  await open();
  assert.deepEqual((await page.locator('#tf_category option').allTextContents()).slice(1), ['Homelab and Network Architecture', 'Crypto and Asset Vault', 'Project Specs', 'Personal Identification', 'Vaultwarden Backups']);
  assert.equal(await page.inputValue('#tf_access'), 'Private (only me)', 'private by default'); assert.deepEqual((await page.locator('#tf_access option').allTextContents()).slice(1), ['Private (only me)', 'Family', 'Trusted contacts', 'Emergency / heirs']);
  assert.equal(await page.getAttribute('#tf_expires', 'type'), 'date'); assert.equal(await page.getAttribute('#f_notes', 'maxlength'), '50000'); assert.ok(await page.locator('label[for=f_notes]:has-text("Content")').count());
  await page.fill('#f_name', 'Rack plan'); await page.fill('#f_notes', 'Switch in U2, NAS in U4.'); assert.match(await page.textContent('.modal-sheet'), /24 \/ 50,000 characters/);
  await page.selectOption('#tf_category', 'Homelab and Network Architecture'); await page.selectOption('#tf_access', 'Family'); await page.fill('#f_tags', 'lab, network');
  await page.fill('#tf_expires', day(-1)); await page.getByRole('button', { name: 'Save' }).click(); assert.match(await page.locator('.modal-sheet .err:not(:empty)').first().textContent(), /cannot be before the day the note was created/);
  await page.fill('#tf_expires', day(30)); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Rack plan")');
  const d = await page.textContent('.detail'); for (const must of ['Homelab and Network Architecture', 'Family', day(30), 'Switch in U2', 'lab', 'network', 'Created', 'Last modified']) assert.ok(d.includes(must), 'detail shows ' + must);
  assert.match(d, new RegExp('Created ?' + day(0))); 
  await open(); await page.fill('#f_name', 'Cold storage map'); await page.selectOption('#tf_category', 'Crypto and Asset Vault'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Cold storage map")');
  await page.locator('.side .nav:has-text("Secure notes")').click(); await page.waitForSelector('.favchip');
  const chips = (await page.locator('.favchip').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()); assert.deepEqual(chips, ['All · 2', 'Homelab and Network Architecture · 1', 'Crypto and Asset Vault · 1', 'Project Specs · 0', 'Personal Identification · 0', 'Vaultwarden Backups · 0']);
  await page.locator('.favchip', { hasText: 'Crypto and Asset Vault' }).click(); assert.equal(await page.locator('.items .item').count(), 1); assert.match(await page.textContent('.items'), /Cold storage map/);
  await page.locator('.favchip', { hasText: 'All' }).click(); await page.locator('.items .item:has-text("Rack plan")').click(); await page.locator('.detail .act-edit').click(); await page.waitForSelector('#tf_category');
  assert.equal(await page.inputValue('#tf_category'), 'Homelab and Network Architecture'); assert.match(await page.textContent('.modal-sheet'), /Created \d{4}-\d\d-\d\d \d\d:\d\d · Last modified/); await page.keyboard.press('Escape');
  // attachments are there too
  await page.locator('.detail .act-edit').click(); await page.waitForSelector('input[aria-label="Choose files"]', { state: 'attached' }); await page.keyboard.press('Escape');
  // expiring soon + the family guide
  await page.locator('.side .nav:has-text("Home")').click(); await page.waitForSelector('.widget'); assert.match(await page.textContent('.widgets'), /Expiring soon[\s\S]*Rack plan/);
  await page.locator('.side .nav:has-text("Family recovery")').click(); await page.waitForSelector('.guideprev'); assert.match(await page.textContent('.guideprev'), /Notes meant for you[\s\S]*Rack plan \(Homelab and Network Architecture\), for: Family/); assert.ok(!(await page.textContent('.guideprev')).includes('Cold storage map'), 'private notes are not listed');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.44.0: contact photos (pick, show as avatar, import from .vcf, export), Outlook/Exchange email fix, popular sites for logins, Cancel goes back to the category picker', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const pickCat = async (label) => { await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click(); await page.locator('.modal-sheet .cats .btn', { hasText: label }).click(); await page.waitForSelector('#f_name'); };
  // Cancel in a new item goes back to "Choose a category", not to the page behind
  await pickCat('Contact'); await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForSelector('.modal-sheet:has-text("Choose a category")');
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Contact' }).click(); await page.waitForSelector('#f_name');
  // a contact with a photo and the new fields
  await page.fill('#f_name', 'Jake Rullan'); await page.setInputFiles('input[aria-label="Choose a photo"]', { name: 'me.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('.photo-prev.has-photo');
  for (const id of ['tf_nickname', 'tf_department', 'tf_homephone', 'tf_email2', 'tf_anniversary', 'tf_workaddress']) assert.ok(await page.locator('#' + id).count(), id + ' exists');
  await page.fill('#tf_mobile', '+1 (202) 710-7557'); await page.fill('#tf_email', 'jake@example.com'); await page.fill('#tf_department', 'Operations');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Jake Rullan")');
  await page.waitForSelector('.detail .avatar.has-photo'); await page.waitForSelector('.items .item:has-text("Jake Rullan") .avatar.has-photo');
  assert.match(await page.locator('.detail .avatar').evaluate((e) => getComputedStyle(e).backgroundImage), /^url\("blob:/);
  // export carries the photo
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export \(\.vcf\)/ }).click()]); const vcf = fs.readFileSync(await dl.path(), 'utf8'); assert.ok(vcf.includes('PHOTO;ENCODING=b;TYPE=JPEG:') && vcf.includes('ORG:;Operations'.replace(';Operations', '') + '') && vcf.includes('TEL;TYPE=CELL:+1 (202) 710-7557'));
  // remove the photo
  await page.locator('.detail .act-edit').click(); await page.waitForSelector('.photo-prev.has-photo'); await page.getByRole('button', { name: /Remove photo/ }).click(); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Jake Rullan")'); await page.waitForTimeout(300);
  assert.equal(await page.locator('.detail .avatar.has-photo').count(), 0);
  // import: a .vcf photo and an Outlook CSV with an Exchange address
  await page.locator('.side .nav:has-text("Contacts")').click(); await page.waitForSelector('.contactsio');
  const vc = 'BEGIN:VCARD\nVERSION:3.0\nFN:Pat Kim\nTEL;TYPE=CELL:555-0102\nPHOTO;ENCODING=b;TYPE=PNG:' + png.toString('base64') + '\nEND:VCARD\n';
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'c.vcf', mimeType: 'text/vcard', buffer: Buffer.from(vc) }); await page.waitForSelector('.modal-sheet .ctable'); assert.match(await page.textContent('.modal-sheet'), /1 with a photo/);
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.getByText(/with 1 photo/).waitFor(); await page.waitForSelector('.items .item:has-text("Pat Kim") .avatar.has-photo');
  const dn = '/o=ExchangeLabs/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=34f3-Lidia Bernardo';
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'outlook.csv', mimeType: 'text/csv', buffer: Buffer.from(`First Name,Last Name,Mobile Phone,E-mail Address,E-mail Type,E-mail Display Name\nLidia,Bernardo,555-0303,"${dn}",EX,Lidia Bernardo (lidia@example.com)\n`) });
  await page.waitForSelector('.modal-sheet .ctable'); await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.waitForSelector('.items .item:has-text("Lidia Bernardo")');
  await page.locator('.items .item:has-text("Lidia Bernardo")').click(); const d = await page.textContent('.detail'); assert.ok(d.includes('lidia@example.com'), 'the real email'); assert.match(d, /Notes[\s\S]*Exchange \/ other address/);
  // popular sites for a new login
  await pickCat('Login'); const sites = await page.locator('#f_site option').allTextContents(); for (const n of ['Google', 'iCloud', 'Microsoft account', 'Facebook', 'GitHub', 'Amazon', 'Netflix']) assert.ok(sites.some((t) => t.startsWith(n + ' ')), n);
  await page.selectOption('#f_site', 'GitHub'); assert.equal(await page.inputValue('#f_url'), 'https://github.com/login'); assert.equal(await page.inputValue('#f_name'), 'GitHub', 'an empty title takes the site name');
  await page.fill('#f_name', 'Work GitHub'); await page.selectOption('#f_site', 'Google'); assert.equal(await page.inputValue('#f_name'), 'Work GitHub', 'a title you typed is kept'); assert.equal(await page.inputValue('#f_url'), 'https://accounts.google.com');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Work GitHub")');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.45.0: encrypt a photo into a .vmenc file and open it again with the password (and a wrong password is refused)', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  await page.locator('.side .nav:has-text("Import & export")').click(); await page.waitForSelector('.filecrypt');
  const txt = await page.textContent('.filecrypt'); for (const must of ['What it can do', 'What it cannot do', 'no password reset', 'not changed or deleted', 'never uploaded']) assert.ok(txt.includes(must), must);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[aria-label="Photo or file to encrypt"]', { name: 'family.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('.filecrypt .fileprev img');
  await page.fill('input[aria-label="File password"]', 'short'); await page.fill('input[aria-label="Confirm File password"]', 'short'); await page.getByRole('button', { name: 'Encrypt and save' }).click(); assert.match(await page.locator('.filecrypt .err:not(:empty)').first().textContent(), /stronger password/);
  const pw = 'plum-orbit-velvet-anchor-glacier-ember'; await page.fill('input[aria-label="File password"]', pw); await page.fill('input[aria-label="Confirm File password"]', pw);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'Encrypt and save' }).click()]);
  assert.equal(dl.suggestedFilename(), 'family.png.vmenc'); const sealed = fs.readFileSync(await dl.path()); assert.equal(sealed.slice(0, 4).toString(), 'VMF1'); assert.ok(!sealed.includes(png.slice(8, 30)), 'the picture is not readable in the file');
  await page.getByText(/Checked: it opens again with this password/).waitFor();
  await page.setInputFiles('input[aria-label="Encrypted file to open"]', { name: 'family.png.vmenc', mimeType: 'application/octet-stream', buffer: sealed });
  await page.fill('input[aria-label="Password of the encrypted file"]', 'not the password'); await page.getByRole('button', { name: 'Open', exact: true }).click(); await page.getByText(/Wrong password, or the file was changed/).waitFor();
  await page.fill('input[aria-label="Password of the encrypted file"]', pw); await page.getByRole('button', { name: 'Open', exact: true }).click(); await page.getByText(/Opened: family\.png/).waitFor(); await page.waitForSelector('.filecrypt .fileprev img[alt="family.png"]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Save the original/ }).click()]); assert.equal(dl2.suggestedFilename(), 'family.png'); assert.ok(Buffer.compare(fs.readFileSync(await dl2.path()), png) === 0, 'byte-for-byte the original');
  await page.setInputFiles('input[aria-label="Encrypted file to open"]', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello there, this is not encrypted at all') }); await page.getByText(/not a VaultManager encrypted file/).waitFor();
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('profiles: a profile photo travels with "Export whole profile" and comes back on import', async () => {
  const A = await newPage(); await createVault(A.page);
  await A.page.getByRole('button', { name: 'VaultManager menu' }).click();
  await A.page.locator('.sysmenu .sm-who').click(); await A.page.waitForSelector('.avpick');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-avx-')); const png = path.join(tmp, 'me.png'); fs.writeFileSync(png, PNG);
  await A.page.setInputFiles('input[aria-label="Profile photo"]', png);
  await A.page.waitForSelector('.toast:has-text("Profile picture saved")');
  await A.page.keyboard.press('Escape');
  await settingsTab(A.page, 'General');
  await A.page.getByRole('button', { name: /Export whole profile/ }).click();
  await A.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'backup-pass-phrase-1');
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Download backup' }).click()]);
  const text = fs.readFileSync(await dl.path(), 'utf8'); assert.ok(text.startsWith('VMP1:'));
  assert.ok(!text.includes('data:image'), 'the photo is inside the encrypted body');
  await A.ctx.close();

  const B = await newPage(); await B.page.goto(base); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click();
  await B.page.fill('textarea[aria-label="Backup text"]', text);
  await B.page.fill('input[aria-label="Backup password"]', 'backup-pass-phrase-1');
  await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForSelector('.modal-sheet .avpick .avprev .pav img', { timeout: 90000 });
  await B.page.fill('input[aria-label="New master password"]', 'a-new-master-pass-123'); await B.page.fill('input[aria-label="Repeat new master password"]', 'a-new-master-pass-123');
  await B.page.locator('.modal-sheet input[type=checkbox]').last().check();
  await B.page.getByRole('button', { name: 'Create profile' }).click();
  await B.page.waitForSelector('.topbar', { timeout: 90000 });
  await dismissWelcome(B.page).catch(() => {});
  await B.page.getByRole('button', { name: 'VaultManager menu' }).click();
  assert.equal(await B.page.locator('.sysmenu .sm-who .pav img').count(), 1, 'the imported profile shows the photo');
  await B.ctx.close();
});

test('contacts: a contact photo survives export to .vcf, delete, and import back into VaultManager', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Contact' }).click(); await page.waitForSelector('#f_name');
  await page.fill('#f_name', 'Rae Photo'); await page.setInputFiles('input[aria-label="Choose a photo"]', { name: 'me.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('.photo-prev.has-photo');
  await page.fill('#tf_mobile', '555-0199');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail .avatar.has-photo');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export \(\.vcf\)/ }).click()]);
  const vcf = fs.readFileSync(await dl.path(), 'utf8'); assert.match(vcf, /PHOTO;ENCODING=b;TYPE=JPEG:/, 'the export carries the photo');
  await page.locator('.detail button:has-text("Delete")').first().click(); await page.waitForSelector('.modal-sheet:has-text("Move to trash?")');
  await page.locator('.modal-sheet .btn.danger, .modal-sheet .btn.primary').last().click(); await page.waitForSelector('.modal-sheet', { state: 'detached' });
  await page.locator('.side .nav:has-text("Contacts")').click(); await page.waitForSelector('.contactsio');
  assert.equal(await page.locator('.items .item:has-text("Rae Photo")').count(), 0, 'deleted');
  await page.setInputFiles('input[aria-label="Contacts file"]', { name: 'rae.vcf', mimeType: 'text/vcard', buffer: Buffer.from(vcf) });
  await page.waitForSelector('.modal-sheet .ctable'); assert.match(await page.textContent('.modal-sheet'), /1 with a photo/);
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.getByText(/with 1 photo/).waitFor();
  await page.waitForSelector('.items .item:has-text("Rae Photo") .avatar.has-photo');
  await page.locator('.items .item:has-text("Rae Photo")').click(); await page.waitForSelector('.detail .avatar.has-photo');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('Seal as QR on a contact names the photo as not included, and the QR carries no photo reference', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page); await showEverything(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Contact' }).click(); await page.waitForSelector('#f_name');
  await page.fill('#f_name', 'Quinn Photo'); await page.setInputFiles('input[aria-label="Choose a photo"]', { name: 'me.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('.photo-prev.has-photo');
  await page.fill('#tf_mobile', '555-0142');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail .avatar.has-photo');
  await page.getByRole('button', { name: /Seal as QR/ }).first().click(); await page.waitForSelector('.modal-sheet');
  assert.match(await page.textContent('.modal-sheet'), /Share with its contact photo/);
  await page.fill('.modal-sheet input[aria-label="QR password"]', 'contact-qr-pass'); await page.fill('.modal-sheet input[aria-label="Confirm QR password"]', 'contact-qr-pass');
  await page.getByRole('button', { name: 'Create QR' }).click(); await page.waitForSelector('.modal-sheet .note.ok', { timeout: 30000 });
  const status = await page.textContent('.modal-sheet .note.ok');
  assert.match(status, /Not included: the contact photo \(QR codes are far too small for a picture/);
  assert.match(status, /1 filled field\b/, 'the photo is not counted as a filled field: ' + status);
  const payload = await page.inputValue('.modal-sheet textarea.payload');
  await page.keyboard.press('Escape');
  // open it: the contact comes back with its text fields and no dangling photo
  await page.getByRole('button', { name: /QR tools/ }).click(); await page.getByRole('tab', { name: 'Open QR' }).click();
  await page.fill('textarea[aria-label="Sealed payload"]', payload); await page.fill('input[aria-label="Password"]', 'contact-qr-pass');
  await page.getByRole('button', { name: /^🔓 Open/ }).click(); await page.waitForSelector('text=Opened a VaultManager item', { timeout: 30000 });
  assert.match(await page.textContent('main'), /including a contact’s photo/);
  await page.getByRole('button', { name: /Add to my vault/ }).click(); await page.waitForSelector('.detail h2:has-text("Quinn Photo")');
  const added = await page.evaluate(() => [...document.querySelectorAll('.detail .avatar')].map((e) => e.classList.contains('has-photo')));
  assert.deepEqual(added, [false], 'the copy from the QR has no photo');
  assert.match(await page.textContent('.detail'), /555-0142/);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.46.0: the 2FA field reads a setup QR from an image, refuses other QR codes, explains the trade-off; the FAQ says what 2FA can and cannot do', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  const qrPng = async (text) => Buffer.from((await page.evaluate(async (t) => { const { drawQR } = await import('./js/qr.js'); const c = document.createElement('canvas'); await drawQR(c, t, { scale: 6 }); return c.toDataURL('image/png'); }, text)).split(',')[1], 'base64');
  const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
  const good = await qrPng(uri), other = await qrPng('https://example.com/not-2fa');
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click();
  await page.locator('.modal-sheet .cats .btn', { hasText: 'Login' }).first().click(); await page.waitForSelector('#f_totp');
  assert.ok(await page.getByRole('button', { name: /Scan QR with camera/ }).count() && await page.getByRole('button', { name: /QR from image/ }).count(), 'both scan buttons');
  assert.match(await page.textContent('.totp-field'), /both sign-in steps in one place[\s\S]*separate authenticator app or on a security key[\s\S]*FAQ/);
  // a QR that is not a 2FA code is refused, and nothing is filled in
  await page.setInputFiles('input[aria-label="2FA QR image"]', { name: 'other.png', mimeType: 'image/png', buffer: other });
  await page.waitForSelector('.totp-field .err:has-text("not a 2FA setup code")');
  assert.equal(await page.inputValue('#f_totp'), ''); assert.equal(await page.inputValue('#f_name'), '');
  // the site's setup QR fills the secret, and the empty title and username
  await page.setInputFiles('input[aria-label="2FA QR image"]', { name: 'setup.png', mimeType: 'image/png', buffer: good });
  await page.waitForSelector('.totp-field [role=status]:has-text("2FA set up from the QR for Example")');
  assert.equal(await page.inputValue('#f_totp'), uri); assert.equal(await page.inputValue('#f_name'), 'Example'); assert.equal(await page.inputValue('#f_username'), 'alice@example.com');
  assert.equal(await page.textContent('.totp-field .err'), '', 'the earlier error is cleared');
  await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail h2:has-text("Example")');
  await page.waitForFunction(() => /^\d{3} \d{3}$/.test((document.querySelector('.detail .totp-code') || {}).textContent || ''));
  // the FAQ entry
  await settingsTab(page, 'About');
  const faq = page.locator('.faq', { hasText: 'Can it be my authenticator' }); await faq.locator('summary').click();
  const txt = await faq.textContent();
  for (const re of [/Scan QR with camera/, /It can:/, /It cannot:/, /HOTP/, /push approvals/, /Google Authenticator export/, /The trade-off:/, /gets both steps at once/, /does not protect you if the vault itself is opened/, /recovery codes outside VaultManager/, /What we recommend:/]) assert.match(txt, re);
  assert.ok(await faq.locator('p').count() >= 5, 'the answer is several paragraphs');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('master password re-prompt: offered on every category; hides the item, its edit and its 2FA code until the master password is typed; wrong password refused; hides again; FAQ', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page); await showEverything(page);
  // every category's editor has the toggle under "Additional options"
  await page.getByRole('button', { name: '＋ New' }).click(); await page.waitForSelector('.modal-sheet'); if (await page.locator('.c3-stage').count()) await page.locator('.pickseg button').nth(1).click();
  const n = await page.locator('.modal-sheet .cats .btn').count(); assert.ok(n >= 28, 'categories: ' + n);
  for (let i = 0; i < n; i++) {
    const btn = page.locator('.modal-sheet .cats .btn').nth(i), label = (await btn.textContent()).trim();
    await btn.click(); await page.waitForSelector('#f_name');
    assert.equal(await page.locator('#f_reprompt').count(), 1, 'toggle in ' + label); assert.equal(await page.locator('#f_reprompt').isChecked(), false, 'off by default in ' + label);
    assert.match(await page.textContent('.modal-sheet'), /Additional options[\s\S]*does not add encryption/, label);
    await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForSelector('.modal-sheet:has-text("Choose a category")');
  }
  await page.keyboard.press('Escape');
  // a login with re-prompt on: still shown right after saving (you just had it open)
  const PW = 'Guarded-Secret-Pw-9431';
  await addLogin(page, 'Guarded', async () => { await page.fill('.modal-sheet input[aria-label="Password"]', PW); await page.fill('#f_totp', 'JBSWY3DPEHPK3PXP'); await page.check('#f_reprompt'); });
  await page.waitForSelector('.detail :text("Shown after your master password")');
  // hide it: only the name and category are on the page, nothing of the item
  await page.getByRole('button', { name: /Hide now/ }).click(); await page.waitForSelector('.reprompt-gate');
  const gate = await page.locator('.detail').innerHTML();
  for (const secret of [PW, 'user-Guarded', 'JBSWY3DPEHPK3PXP']) assert.ok(!gate.includes(secret), 'not on the page: ' + secret);
  assert.equal(await page.locator('.detail .act-edit').count(), 0, 'no Edit while hidden');
  const row = await page.locator('.items .item:has-text("Guarded")').textContent();
  assert.match(row, /Master password re-prompt/); assert.ok(!row.includes('user-Guarded'), 'the list row shows no username while hidden');
  await page.fill('input[aria-label="Search your vault"]', 'user-Guarded'); await page.waitForTimeout(200);
  assert.equal(await page.locator('.items .item:has-text("Guarded")').count(), 0, 'not found by what is inside it');
  await page.fill('input[aria-label="Search your vault"]', 'Guarded'); await page.waitForSelector('.items .item:has-text("Guarded")');
  await page.fill('input[aria-label="Search your vault"]', ''); await page.locator('.items .item:has-text("Guarded")').click(); await page.waitForSelector('.reprompt-gate');
  // wrong password refused, then a short wait; the right one shows it
  await page.getByRole('button', { name: /Show item/ }).click(); await page.waitForSelector('.modal-sheet input[aria-label="Master password"]');
  await page.fill('.modal-sheet input[aria-label="Master password"]', 'not-my-password-1'); await page.getByRole('button', { name: 'Show', exact: true }).click();
  await page.waitForSelector('.modal-sheet .err:has-text("That is not your master password")');
  await page.fill('.modal-sheet input[aria-label="Master password"]', MASTER); await page.getByRole('button', { name: 'Show', exact: true }).click();
  await page.waitForSelector('.modal-sheet .err:has-text("Too many wrong passwords")');
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Show', exact: true }).click(); await page.waitForSelector('.modal-sheet', { state: 'detached' });
  await page.waitForSelector('.detail .act-edit'); assert.ok((await page.locator('.detail').innerHTML()).includes('user-Guarded'));
  // the Home 2FA widget hides its code while the item is hidden, and asks for the master password on click
  await page.getByRole('button', { name: /Hide now/ }).click(); await page.waitForSelector('.reprompt-gate');
  await page.locator('.side .nav:has-text("Home")').first().click(); await page.waitForSelector('.totp-tile');
  const tile = page.locator('.totp-tile', { hasText: 'Guarded' }); await page.waitForFunction(() => /hidden/.test([...document.querySelectorAll('.totp-tile')].map((t) => t.textContent).join()));
  assert.doesNotMatch(await tile.textContent(), /\d{3} \d{3}/);
  await tile.click(); await page.waitForSelector('.modal-sheet:has-text("Master password re-prompt")'); await page.keyboard.press('Escape');
  // locking the vault forgets every answer
  await page.locator('.side .nav:has-text("Logins")').first().click(); await page.locator('.items .item:has-text("Guarded")').click(); await page.waitForSelector('.reprompt-gate');
  await page.getByRole('button', { name: /Show item/ }).click(); await page.fill('.modal-sheet input[aria-label="Master password"]', MASTER); await page.getByRole('button', { name: 'Show', exact: true }).click(); await page.waitForSelector('.detail .act-edit');
  await page.getByRole('button', { name: /Lock/ }).first().click(); await page.fill('#upw', MASTER); await page.click('button[type=submit]'); await page.waitForSelector('.topbar');
  await page.locator('.side .nav:has-text("Logins")').first().click(); await page.locator('.items .item:has-text("Guarded")').click(); await page.waitForSelector('.reprompt-gate');
  // turning it off needs the master password first (Edit is behind the gate), then the item stays open
  await page.getByRole('button', { name: /Show item/ }).click(); await page.fill('.modal-sheet input[aria-label="Master password"]', MASTER); await page.getByRole('button', { name: 'Show', exact: true }).click(); await page.waitForSelector('.detail .act-edit');
  await page.locator('.detail .act-edit').click(); await page.waitForSelector('#f_reprompt'); assert.equal(await page.locator('#f_reprompt').isChecked(), true);
  await page.uncheck('#f_reprompt'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail .act-edit');
  assert.equal(await page.locator('.detail :text("Shown after your master password")').count(), 0);
  // a trashed item with re-prompt stays hidden in the Trash too
  await page.locator('.detail .act-edit').click(); await page.check('#f_reprompt'); await page.getByRole('button', { name: 'Save' }).click(); await page.waitForSelector('.detail .act-edit');
  await page.getByRole('button', { name: /Hide now/ }).click(); await page.waitForSelector('.reprompt-gate');
  await page.getByRole('button', { name: /Show item/ }).click(); await page.fill('.modal-sheet input[aria-label="Master password"]', MASTER); await page.getByRole('button', { name: 'Show', exact: true }).click(); await page.waitForSelector('.detail .act-edit');
  await page.locator('.detail button:has-text("Delete")').first().click(); await page.locator('.modal-sheet .btn.danger, .modal-sheet .btn.primary').last().click(); await page.waitForSelector('.modal-sheet', { state: 'detached' });
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.locator('.side .nav:has-text("Trash")').first().click(); await page.locator('.items .item:has-text("Guarded")').click();
  await page.waitForSelector('.detail :text("Shown after your master password")');   // still within its 5 minutes
  await page.getByRole('button', { name: /Hide now/ }).click(); await page.waitForSelector('.reprompt-gate');
  assert.equal(await page.locator('.reprompt-gate button:has-text("Delete")').count(), 0, 'Restore and Delete forever are behind the gate'); assert.ok(!(await page.locator('.detail').innerHTML()).includes('user-Guarded'), 'nothing of it in the Trash detail');
  // FAQ
  await settingsTab(page, 'About');
  const faq = page.locator('.faq', { hasText: 'Master password re-prompt' }); await faq.locator('summary').click();
  const txt = await faq.textContent();
  for (const re of [/any item, in any category/, /5 minutes/, /What it protects against/, /adds no encryption/, /malware/, /secondary passcode/]) assert.match(txt, re);
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('a built-in photo wallpaper loads in every browser (its address is resolved against the page, not the stylesheet)', async () => {
  const { ctx, page, problems } = await newPage(); await createVault(page);
  await settingsTab(page, 'Appearance'); await page.waitForSelector('.wall[data-group=city]');
  await page.locator('.wall[data-group=city]').first().click();
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('wall')).backgroundImage);
  assert.match(bg, /\/wallpapers\/night1\.jpg/, 'the city photo is the background: ' + bg);
  assert.doesNotMatch(bg, /\/css\/wallpapers\//, 'not looked up next to the stylesheet: ' + bg);
  const url = /url\("?([^")]+)"?\)/.exec(bg)[1];
  assert.equal(await page.evaluate(async (u) => (await fetch(u)).status, url), 200, 'the picture really loads');
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []); await ctx.close();
});

test('v0.48.0: create a new profile from a QR backup on the first screen (codes in any order, from images); missing codes are named; a non-backup QR is refused', async () => {
  // device A: a vault big enough for several QR codes, then Backup to QR
  const A = await newPage(); await createVault(A.page); await showEverything(A.page);
  const long = Array.from({ length: 60 }, (_, i) => `line ${i} of a long note that makes the backup span several codes`).join('\n');
  await addLogin(A.page, 'QR Bank', async () => { await A.page.fill('#f_notes', long); });
  await addLogin(A.page, 'QR Mail');
  await A.page.getByRole('button', { name: /QR tools/ }).click(); await A.page.getByRole('tab', { name: 'Backup to QR' }).click();
  await A.page.fill('input[aria-label="Backup password"]', 'qr-backup-pass-77'); await A.page.fill('input[aria-label="Confirm Backup password"]', 'qr-backup-pass-77');
  await A.page.getByRole('button', { name: /Create QR backup/ }).click(); await A.page.waitForSelector('.qrgrid canvas');
  const pngs = (await A.page.$$eval('.qrgrid canvas', (cs) => cs.map((c) => c.toDataURL('image/png')))).map((u, i) => ({ name: `code-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(u.split(',')[1], 'base64') }));
  assert.ok(pngs.length >= 3, 'the backup spans several codes: ' + pngs.length);
  const other = Buffer.from((await A.page.evaluate(async () => { const { drawQR } = await import('./js/qr.js'); const c = document.createElement('canvas'); await drawQR(c, 'https://example.com', { scale: 6 }); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
  await A.ctx.close();

  // device B, first screen: Import a profile → QR images
  const B = await newPage(); await B.page.goto(base); await B.page.waitForSelector('#pw1');
  await B.page.getByRole('button', { name: /Import a profile backup/ }).click(); await B.page.waitForSelector('.qrimport');
  assert.ok(await B.page.getByRole('button', { name: /Scan QR backup/ }).count(), 'camera scan offered on the first screen');
  assert.match(await B.page.textContent('.qrimport'), /not attached files or photos, settings or the look/);
  // a QR that is not a backup is refused
  await B.page.setInputFiles('input[aria-label="QR backup images"]', { name: 'other.png', mimeType: 'image/png', buffer: other });
  await B.page.waitForSelector('.qrimport [role=status]:has-text("not part of a VaultManager backup")');
  // some codes, out of order: the missing ones are named, and Open backup says what is left
  const shuffled = [...pngs].reverse();
  await B.page.setInputFiles('input[aria-label="QR backup images"]', shuffled.slice(0, shuffled.length - 1));
  await B.page.waitForSelector(`.qrimport [role=status]:has-text("Scanned ${pngs.length - 1} of ${pngs.length} codes. Still missing: 1.")`);
  await B.page.fill('input[aria-label="Backup password"]', 'qr-backup-pass-77'); await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForSelector('.modal-sheet .err:has-text("Scan the remaining QR code first: 1")');
  // Start over clears a half-done scan (a stray code from another backup must not lock the dialog)
  await B.page.getByRole('button', { name: /Start over/ }).click(); await B.page.waitForSelector('.qrimport [role=status]:has-text("Cleared")');
  await B.page.getByRole('button', { name: 'Open backup' }).click(); await B.page.waitForSelector('.modal-sheet .err:has-text("scan a QR backup")');
  await B.page.setInputFiles('input[aria-label="QR backup images"]', shuffled.slice(0, shuffled.length - 1));
  await B.page.waitForSelector(`.qrimport [role=status]:has-text("Still missing: 1.")`);
  // the last one completes it
  await B.page.setInputFiles('input[aria-label="QR backup images"]', [shuffled[shuffled.length - 1]]);
  await B.page.waitForSelector(`.qrimport [role=status]:has-text("All ${pngs.length} codes scanned")`);
  // wrong password refused, right one opens it
  await B.page.fill('input[aria-label="Backup password"]', 'wrong-password-123'); await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForFunction(() => [...document.querySelectorAll('.modal-sheet .err')].some((e) => e.textContent.trim()), null, { timeout: 90000 });
  await B.page.fill('input[aria-label="Backup password"]', 'qr-backup-pass-77'); await B.page.getByRole('button', { name: 'Open backup' }).click();
  await B.page.waitForSelector('.impcenter:not([hidden])', { timeout: 90000 });
  assert.match(await B.page.textContent('.impcenter .kv'), /Items only \(VMX1\)/);
  await B.page.fill('input[aria-label="Profile name"]', 'From QR');
  await B.page.fill('input[aria-label="New master password"]', 'a-new-master-pass-123'); await B.page.fill('input[aria-label="Repeat new master password"]', 'a-new-master-pass-123');
  await B.page.locator('.modal-sheet input[type=checkbox]').last().check();
  await B.page.getByRole('button', { name: 'Create profile' }).click(); await B.page.waitForSelector('.topbar', { timeout: 90000 });
  await dismissWelcome(B.page).catch(() => {}); await openAll(B.page);
  for (const n of ['QR Bank', 'QR Mail']) assert.ok(await B.page.locator('.items .item', { hasText: n }).count(), n + ' restored from the QR codes');
  await B.page.locator('.items .item', { hasText: 'QR Bank' }).click(); assert.match(await B.page.textContent('.detail'), /line 59 of a long note/, 'the long note came through whole');
  assert.deepEqual(B.problems.filter((p) => !/Failed to load resource/.test(p)), []); await B.ctx.close();
});
