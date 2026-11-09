/* VaultManager — application shell: lock screen, navigation, auto-lock, routing. */

import { h, clear, setLabel, closeAllModals, closeTopModal, modalOpen, modal, toast, copyText } from './dom.js';
import { VaultStore } from './vault.js';
import { available } from './crypto.js';
import { estimate } from './strength.js';
import { generatePassphrase } from './generator.js';
import { renderVaultView, newItemMenu, showRecoveryKit, meter } from './views.js';
import { renderGenerator, renderHealth, renderQR, renderData } from './tools.js';
import { renderSettings } from './settings.js';
import { createBlobStore } from './blobs.js';
import { renderBeam } from './beam.js';
import { TYPE_META, GROUPS } from './templates.js';
import { syncGist } from './sync.js';
import { supported as passkeySupported, authenticate as passkeyAuth } from './passkey.js';
import { wipe } from './crypto.js';
import { health } from './vault.js';
import { normalizeLook, applyLook, resolveTheme, loadCosmetic, saveCosmetic } from './look.js';
import { landscapes } from './landscapes.js';
import { renderHome } from './widgets.js';
import { createTour } from './tour.js';
import { APP_VERSION } from './version.js';
import { fmtInt } from './util.js';

const root = document.getElementById('app');
let storage;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = null; }

const store = new VaultStore(storage || { _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, v); }, removeItem(k) { this._m.delete(k); } }, undefined, createBlobStore());

const ctx = {
  store,
  S: { view: 'all', q: '', sel: null, qrTab: 'seal', collapsed: new Set() },
  cleanup: [],
  runCleanup() { const c = ctx.cleanup.splice(0); c.forEach((f) => { try { f(); } catch { /* ignore */ } }); },
  closeModals: closeAllModals,
  go(view) { ctx.S.view = view; if (view !== 'all' && !isVaultView(view)) ctx.S.sel = null; if (!isVaultView(view)) ctx.S.q = ''; syncSearch(); draw(); window.scrollTo(0, 0); },
  refresh() { draw(); },
  applyTheme, armAutolock, lock, armSync, syncNow,
  look: () => curLook(), setLook, setTheme, newItem: () => newItemMenu(ctx),
  showItem(id) { ctx.S.sel = id; if (!isVaultView(ctx.S.view)) ctx.S.view = 'all'; syncSearch(); draw(); },
  showRecoveryKit(key) { return showRecoveryKit(ctx, key); },
  /* copy a secret, honouring the clipboard-clear setting, and note it (never the value) in the audit trail */
  copySecret(text, label, item, what) {
    if (item && store.settings.logReveal) store.log('access', 'Copied ' + (what || 'value').toLowerCase() + ' of “' + item.name + '”');
    return copyText(text, label, store.settings.clipboard);
  },
  passwordPolicy(pw) {
    if (pw.length < 12) return 'Use at least 12 characters.';
    const e = estimate(pw);
    if (e.bits < 50) return 'That password is too easy to guess' + (e.issues.length ? ' (' + e.issues[0] + ')' : '') + '. Try a passphrase of 5 or more random words.';
    return '';
  },
};

const tour = createTour(ctx);
ctx.tour = tour;

const isVaultView = (v) => ['all', 'fav', 'trash', 'conflicts'].includes(v) || v in TYPE_META || v.startsWith('tag:');

/* ---------- look & feel (theme, accent, effects, layout) ---------- */
const cosmetic = storage ? loadCosmetic(storage) : null;
let bootLook = normalizeLook((cosmetic && cosmetic.look) || {}), bootTheme = (cosmetic && cosmetic.theme) || 'auto';   // what the lock screen uses
const lightMQ = window.matchMedia('(prefers-color-scheme: light)');
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function curLook() { return store.unlocked ? normalizeLook(store.settings.look) : bootLook; }
function applyTheme() {
  const setting = store.unlocked ? store.settings.theme : bootTheme, lk = curLook();
  const theme = resolveTheme(setting, lightMQ.matches);
  applyLook(lk, theme, landscapes);
  if (storage) saveCosmetic(storage, setting, lk);
  bootLook = lk; bootTheme = setting;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = theme === 'dark' ? '#05080d' : '#eef2f6';
}
lightMQ.addEventListener('change', applyTheme);
let lookSaveTimer = null;
const saveSoon = () => { clearTimeout(lookSaveTimer); lookSaveTimer = setTimeout(() => store.save().catch(() => {}), 500); };
/* opt.redraw: re-render the page; opt.shell: rebuild top bar / dock too; opt.live: slider drag (no save churn) */
function setLook(patch, opt = {}) {
  if (!store.unlocked) return;
  store.settings.look = normalizeLook({ ...store.settings.look, ...patch });
  applyTheme(); saveSoon();
  if (opt.shell) { shell = null; draw(); } else if (opt.redraw) draw(); else if (shell) { drawDock(); drawMbar(); }
}
function setTheme(v) { store.settings.theme = v; applyTheme(); saveSoon(); }

/* tilt toward the pointer (widgets, sign-in card) */
document.addEventListener('pointermove', (e) => {
  const L = curLook(); if (!L.fxTilt || !L.animations || !e.target.closest) return;
  const el = e.target.closest('.widget, .gate-card'); if (!el) return;
  const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
  el.style.setProperty('--rx', (-py * 2 * L.fxTilt).toFixed(2) + 'deg'); el.style.setProperty('--ry', (px * 2 * L.fxTilt).toFixed(2) + 'deg');
});
document.addEventListener('pointerleave', (e) => { if (e.target.classList && e.target.matches && e.target.matches('.widget, .gate-card')) { e.target.style.setProperty('--rx', '0deg'); e.target.style.setProperty('--ry', '0deg'); } }, true);

/* unlock animation: a short, skippable log of what actually just happened */
function showBoot(L, done) {
  const iter = store.session ? store.session.iterations() : 0, n = store.active().length;
  const lines = [['VaultManager ' + APP_VERSION, ''], ['Unwrapping master key', 'PBKDF2-SHA256 · ' + fmtInt(iter) + ' rounds ✓'], ['Decrypting vault', 'AES-256-GCM ✓'], ['Verifying integrity tag', '{{check}}'], ['Loading ' + n + ' item' + (n === 1 ? '' : 's'), '{{check}}'], ['Audit trail & auto-lock', 'armed ✓'], ['Ready', '']];
  const el = h('div', { id: 'boot', role: 'status', 'aria-label': 'Starting' }, lines.map(([a, b], i) => { const l = h('div', { class: 'l' }, '> ', h('b', { text: a }), b ? '  ' + b : ''); l.style.animationDelay = (i * 0.12 / L.animSpeed) + 's'; return l; }), h('div', { class: 'bar' }, h('i')), h('div', { class: 'hint', text: 'Click or press any key to skip' }));
  document.body.append(el);
  let finished = false;
  const finish = () => { if (finished) return; finished = true; el.remove(); window.removeEventListener('keydown', finish, true); done(); };
  el.addEventListener('click', finish); window.addEventListener('keydown', finish, true);
  requestAnimationFrame(() => { const i = el.querySelector('.bar i'); if (i) i.style.width = '100%'; });
  setTimeout(finish, ((lines.length * 0.12 + 0.35) / L.animSpeed) * 1000);
}

/* the one place every successful unlock ends up */
function onUnlocked(note) {
  const L = curLook();
  ctx.S.view = L.startPage === 'home' ? 'home' : 'all';
  applyTheme(); armAutolock(); draw();
  const after = () => { armSync(); tour.maybeWelcome(); if (note === 'recovery') toast('Unlocked with your recovery key — set a new master password in Settings.', 'ok', 7000); };
  if (L.animations && L.bootAnim && !reducedMotion()) showBoot(L, after); else after();
}

/* ---------- auto-lock ---------- */
let idleTimer = null;
function armAutolock() {
  clearTimeout(idleTimer);
  if (!store.unlocked) return;
  const min = store.settings.autolock;
  if (min > 0) idleTimer = setTimeout(() => lock(false, 'Locked after ' + min + ' minute' + (min > 1 ? 's' : '') + ' of inactivity'), min * 60000);
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { if (store.unlocked) armAutolock(); }, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden && store.unlocked && store.settings.lockOnHide) lock(false, 'Locked because the tab was hidden'); });

function lock(erased, why) {
  clearTimeout(idleTimer); stopSync(); clearInterval(clockTimer); tour.stop();
  if (store.unlocked && !erased) store.log('security', why || 'Vault locked');
  ctx.runCleanup(); closeAllModals();
  clear(document.getElementById('printArea'));
  store.lock();
  Object.assign(ctx.S, { view: 'all', q: '', sel: null });
  shell = null;
  applyTheme();
  draw();
  if (why) toast(why);
}

/* ---------- sync scheduler (gist method only; the file method is manual) ---------- */
let syncing = false, syncTimer = null, soonTimer = null, lastFp = '', warned = false;
const fingerprint = () => {
  const items = store.data.items;
  return [items.length, items.reduce((m, i) => Math.max(m, i.updated || 0), 0), Object.keys(store.data.tombstones).length, items.reduce((n, i) => n + (i.attachments || []).length, 0)].join(':');
};
const syncReady = () => { const c = store.unlocked && store.settings.sync; return !!(c && c.token && c.passphrase); };

async function syncNow(manual = false) {
  if (!syncReady()) return { ok: false, error: 'Sync is not set up (token and passphrase needed).' };
  if (syncing) return { ok: false, error: 'A sync is already running.' };
  syncing = true;
  const c = store.settings.sync;
  try {
    const r = await syncGist(store);
    lastFp = fingerprint(); warned = false;
    if (r.pulled && (r.pulled.added || r.pulled.updated || r.pulled.removed)) draw();
    if (r.pulled && r.pulled.conflicts) toast('Synced — ' + r.pulled.conflicts + ' item value(s) were edited on two devices. See “Needs review”.', 'err', 8000); else if (manual) toast('Synced ✓');
    return { ok: true, summary: r };
  } catch (e) {
    c.last = { at: Date.now(), ok: false, msg: e.message };
    store.log('sync', 'Sync failed — ' + e.message, 'warn'); store.save().catch(() => {});
    if (manual || !warned) toast('Sync failed: ' + e.message, 'err', 6000);
    warned = true;
    return { ok: false, error: e.message };
  } finally { syncing = false; }
}

function stopSync() { clearInterval(syncTimer); clearTimeout(soonTimer); syncTimer = soonTimer = null; store.onSaved = null; }
function armSync() {
  stopSync();
  if (!syncReady() || !store.settings.sync.auto) return;
  lastFp = fingerprint();
  syncNow(false);
  syncTimer = setInterval(() => syncNow(false), 10 * 60000);
  store.onSaved = () => {
    if (syncing || fingerprint() === lastFp) return;
    clearTimeout(soonTimer); soonTimer = setTimeout(() => syncNow(false), 30000);
  };
}

/* ---------- gate (create / unlock) ---------- */
function trustChips() {
  return h('div', { class: 'trust' }, ['Zero-knowledge', 'End-to-end encrypted', 'AES-256-GCM', 'Works offline', 'No account · no server'].map((t) => h('span', { class: 'chip accent', text: '{{check}} ' + t })));
}
const brand = (sub) => h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: '44', height: '44' }), h('div', null, h('h1', null, 'Vault', h('span', { text: 'Manager' })), h('p', { text: sub })));

function pwInput(id, label, auto) {
  const i = h('input', { id, type: 'password', class: 'inp mono', autocomplete: auto, spellcheck: 'false', 'aria-label': label, required: true });
  const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show or hide ' + label, title: 'Show / hide', on: { click: () => { i.type = i.type === 'password' ? 'text' : 'password'; } } }, '{{eye}}');
  return { input: i, el: h('div', { class: 'pwwrap' }, i, eye) };
}

function gateCreate() {
  const p1 = pwInput('pw1', 'Master password', 'new-password'), p2 = pwInput('pw2', 'Repeat master password', 'new-password');
  const m = h('div'), err = h('p', { class: 'err', role: 'alert' });
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  p1.input.addEventListener('input', () => clear(m).append(meter(p1.input.value).el));
  const btn = h('button', { class: 'btn primary', type: 'submit', style: null }, 'Create my vault');
  const suggest = h('button', { type: 'button', class: 'btn sm', on: { click: () => { const pw = generatePassphrase({ words: 6 }); p1.input.value = p2.input.value = pw; p1.input.type = p2.input.type = 'text'; p1.input.dispatchEvent(new Event('input')); } } }, '{{bolt}} Suggest a passphrase');
  const form = h('form', { novalidate: true, on: { submit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (p1.input.value !== p2.input.value) { err.textContent = 'The two passwords do not match.'; return; }
    const pol = ctx.passwordPolicy(p1.input.value); if (pol) { err.textContent = pol; return; }
    if (!ack.checked) { err.textContent = 'Please confirm that you understand there is no password recovery.'; return; }
    btn.disabled = true; btn.textContent = 'Deriving key (600,000 rounds)…';
    try { await store.create(p1.input.value); } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Create my vault'; return; }
    p1.input.value = p2.input.value = '';
    ctx.S.view = curLook().startPage === 'home' ? 'home' : 'all';
    applyTheme(); armAutolock(); draw();
    tour.maybeWelcome();
    modal({ title: 'Vault created 🎉', sub: 'One more thing', body: h('div', null, h('p', { text: 'Your master password never leaves this device and cannot be reset. A recovery key is a printable backup way in if you ever forget it.' })),
      actions: [{ label: 'Skip for now' }, { label: 'Create recovery key', kind: 'primary', onClick: async () => { const key = await store.session.createRecovery(); await store.save(); showRecoveryKit(ctx, key); } }] });
  } } },
    h('div', { class: 'field' }, h('label', { for: 'pw1', text: 'Master password' }), p1.el, m, h('p', { class: 'hint', text: '12+ characters. A passphrase of 5+ random words is easy to remember and hard to crack.' })),
    h('div', { class: 'field' }, h('label', { for: 'pw2', text: 'Repeat master password' }), p2.el),
    h('div', { class: 'row wrap' }, suggest),
    h('label', { class: 'chk', for: 'ack' }, ack, 'I understand that if I forget this password, nobody can recover my data.'),
    err, h('div', { class: 'row' }, btn));
  return h('div', { class: 'panel gate-card' }, brand('Create your encrypted vault'), form, trustChips());
}

function gateUnlock() {
  let mode = 'password';
  const p1 = pwInput('upw', 'Master password', 'current-password');
  const rk = h('input', { id: 'urk', class: 'inp mono', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-…', 'aria-label': 'Recovery key' });
  const err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Unlock');
  const pwBox = h('div', { class: 'field' }, h('label', { for: 'upw', text: 'Master password' }), p1.el);
  const rkBox = h('div', { class: 'field', hidden: true }, h('label', { for: 'urk', text: 'Recovery key' }), rk);
  const toggle = h('button', { type: 'button', class: 'linkbtn', on: { click: () => { mode = mode === 'password' ? 'recovery' : 'password'; pwBox.hidden = mode !== 'password'; rkBox.hidden = mode === 'password'; toggle.textContent = mode === 'password' ? 'Use recovery key instead' : 'Use master password instead'; err.textContent = ''; (mode === 'password' ? p1.input : rk).focus(); } } }, 'Use recovery key instead');
  let tick = null;
  const throttle = () => {
    const left = store.delayLeft();
    if (left > 0) { btn.disabled = true; err.textContent = `Too many wrong attempts. Try again in ${Math.ceil(left / 1000)}s.`; tick = setTimeout(throttle, 500); }
    else { btn.disabled = false; if (/Too many/.test(err.textContent)) err.textContent = ''; }
  };
  ctx.cleanup.push(() => clearTimeout(tick));
  const pkBtn = store.hasPasskeys() && passkeySupported() ? h('button', { type: 'button', class: 'btn primary', on: { click: async () => {
    err.textContent = ''; pkBtn.disabled = true; pkBtn.textContent = 'Waiting for your passkey…';
    try {
      const pk = await passkeyAuth(store.passkeyWraps());
      await store.unlock({ passkey: pk }); wipe(pk.prf);
      onUnlocked();
      return;
    } catch (x) { err.textContent = x.message === 'bad-secret' ? 'That passkey did not unlock the vault. Use your master password.' : x.message; }
    pkBtn.disabled = false; setLabel(pkBtn, '{{login}} Unlock with passkey');
  } } }, '{{login}} Unlock with passkey') : null;
  const form = h('form', { novalidate: true, on: { submit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (store.delayLeft() > 0) { throttle(); return; }
    btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      await store.unlock(mode === 'password' ? { password: p1.input.value } : { recovery: rk.value });
      p1.input.value = ''; rk.value = '';
      onUnlocked(mode === 'recovery' ? 'recovery' : '');
      return;
    } catch (x) {
      err.textContent = x.message === 'bad-secret' ? (mode === 'password' ? 'Wrong master password.' : 'That recovery key does not open this vault.') : x.message === 'locked-out' ? 'Too many wrong attempts. Please wait.' : x.message;
      p1.input.select();
    }
    btn.textContent = 'Unlock'; throttle();
  } } }, pwBox, rkBox, err, h('div', { class: 'row' }, btn), h('p', { style: null }, toggle));
  setTimeout(throttle, 0);
  return h('div', { class: 'panel gate-card' }, brand('Your vault is locked'), pkBtn, pkBtn ? h('p', { class: 'or', text: 'or use your master password' }) : null, form, trustChips());
}

function drawGate() {
  clear(root);
  ctx.runCleanup();
  if (!available()) {
    root.append(h('div', { class: 'gate' }, h('div', { class: 'panel gate-card' }, brand('Cannot start'), h('p', { class: 'note danger', text: 'WebCrypto is unavailable. Open VaultManager over https:// or http://localhost — browsers disable encryption on insecure origins.' }))));
    return;
  }
  const storageWarn = storage ? null : h('p', { class: 'note warn', text: 'Browser storage is blocked, so this vault will disappear when you close the tab. Allow site data to keep it.' });
  root.append(h('div', { class: 'gate' }, h('div', null, storageWarn, store.exists() ? gateUnlock() : gateCreate())));
  const f = root.querySelector('input'); if (f) f.focus();
}

/* ---------- main shell ---------- */
let shell = null;

const NAV = [['home', '{{home}}', 'Home'], ['all', '{{vault}}', 'All items'], ['fav', '{{star}}', 'Favorites'], ['trash', '{{trash}}', 'Trash']];
const TOOLS = [['health', '{{pulse}}', 'Vault health'], ['gen', '{{bolt}}', 'Generator'], ['qr', '{{qr}}', 'QR tools'], ['beam', '{{beam}}', 'Beam sync'], ['data', '{{swap}}', 'Import & export'], ['settings', '{{gear}}', 'Settings']];

function syncSearch() { if (shell && shell.search.value !== ctx.S.q) shell.search.value = ctx.S.q; }

let clockTimer = null;
function tickClock() {
  if (!shell || !shell.clock) return;
  const L = curLook(), n = new Date();
  shell.clock.firstChild.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !L.clock24 });
  shell.clock.lastChild.textContent = L.dateFmt === 'none' ? '' : n.toLocaleDateString([], L.dateFmt === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
}

const DOCK = [['home', '{{home}}', 'Home'], ['all', '{{vault}}', 'All items'], ['fav', '{{star}}', 'Favorites'], ['cats', '{{puzzle}}', 'Categories'], null, ['health', '{{pulse}}', 'Health'], ['gen', '{{bolt}}', 'Generator'], ['qr', '{{qr}}', 'QR tools'], ['beam', '{{beam}}', 'Beam'], null, ['settings', '{{gear}}', 'Settings'], ['help', '{{help}}', 'Help'], ['new', '{{plus}}', 'New item']];

function categoriesModal() {
  const cnt = (k) => store.active().filter((i) => i.type === k).length;
  modal({ title: 'Categories', wide: true, body: h('div', null, GROUPS.map(([g, keys]) => h('div', { class: 'catgroup' }, h('p', { class: 'lbl', text: g }),
    h('div', { class: 'checks cats' }, keys.map((k) => h('button', { class: 'btn', on: { click: () => { closeAllModals(); ctx.go(k); } } }, h('span', { class: 'icn', text: TYPE_META[k].icon }), ' ' + TYPE_META[k].plural + ' · ' + cnt(k))))))), actions: [{ label: 'Close' }] });
}

/* phone navigation: a bottom bar (Home · Items · New · Generator · More) and a "More" sheet with everything else */
function moreSheet() {
  const go = (v) => () => { closeAllModals(); ctx.go(v); };
  const c = counts();
  const item = (ic, label, fn, n) => h('button', { class: 'btn msheet-item', on: { click: fn } }, ic, h('span', { class: 'grow', text: label }), n !== undefined ? h('span', { class: 'n', text: String(n) }) : null);
  const m = modal({ title: 'Menu', wide: true, body: h('div', { class: 'msheet' },
    h('p', { class: 'lbl', text: 'Vault' }), h('div', { class: 'mgrid' }, item('{{star}}', 'Favorites', go('fav'), c.fav), item('{{trash}}', 'Trash', go('trash'), c.trash), store.conflictCount() ? item('{{alert}}', 'Needs review', go('conflicts'), store.conflictCount()) : null),
    h('p', { class: 'lbl', text: 'Tools' }), h('div', { class: 'mgrid' }, TOOLS.map(([id, ic, l]) => item(ic, l, go(id)))),
    GROUPS.map(([g, keys]) => h('div', null, h('p', { class: 'lbl', text: g }), h('div', { class: 'mgrid' }, keys.map((k) => item(TYPE_META[k].icon, TYPE_META[k].plural, go(k), c[k]))))),
    h('p', { class: 'lbl', text: 'More' }), h('div', { class: 'mgrid' }, item('{{help}}', 'Help & tour', () => { closeAllModals(); tour.help(); }), item('{{lock}}', 'Lock now', () => { closeAllModals(); lock(false); }))), actions: [{ label: 'Close' }] });
  return m;
}

function drawMbar() {
  if (!shell || !shell.mbar) return;
  const v = ctx.S.view, hl = health(store.items), attention = hl.weak.length + hl.reused.length + hl.expiring.length + store.conflictCount();
  const it = (id, ic, label, on, fn, badge) => h('button', { class: 'mbar-item' + (on ? ' on' : ''), 'aria-label': label, 'aria-current': on ? 'page' : null, on: { click: fn } }, ic, h('span', { class: 'mlbl', text: label }), badge ? h('span', { class: 'badge', text: String(badge) }) : null);
  const inMore = !['home', 'gen'].includes(v) && !isVaultView(v) ? true : (v === 'fav' || v === 'trash' || v === 'conflicts' || (v in TYPE_META));
  clear(shell.mbar).append(
    it('home', '{{home}}', 'Home', v === 'home', () => ctx.go('home')),
    it('all', '{{vault}}', 'Items', ['all'].includes(v) || v.startsWith('tag:'), () => ctx.go('all')),
    h('button', { class: 'mbar-fab', 'aria-label': 'New item', on: { click: () => newItemMenu(ctx) } }, '{{plus}}'),
    it('gen', '{{bolt}}', 'Generator', v === 'gen', () => ctx.go('gen')),
    it('more', '{{menu}}', 'More', inMore && v !== 'home' && v !== 'gen' && v !== 'all', () => moreSheet(), attention));
}

function drawDock() {
  if (!shell || !shell.dock) return;
  const L = curLook(), hl = health(store.items), attention = hl.weak.length + hl.reused.length + hl.expiring.length;
  const items = DOCK.map((d) => {
    if (!d) return h('span', { class: 'dock-sep' });
    const [id, ic, label] = d;
    const on = id === 'cats' ? (ctx.S.view in TYPE_META) : ctx.S.view === id;
    return h('button', { class: 'dock-item' + (on ? ' on' : ''), title: label, 'aria-label': label, 'aria-current': on ? 'page' : null, on: { click: () => (id === 'new' ? newItemMenu(ctx) : id === 'help' ? tour.help() : id === 'cats' ? categoriesModal() : ctx.go(id)) } },
      h('span', { class: 'icn', text: ic }), L.dockLabels ? h('small', { text: label }) : null, id === 'health' && attention ? h('span', { class: 'badge', text: String(attention) }) : null);
  });
  if (store.conflictCount()) items.splice(3, 0, h('button', { class: 'dock-item' + (ctx.S.view === 'conflicts' ? ' on' : ''), title: 'Needs review', 'aria-label': 'Needs review', on: { click: () => ctx.go('conflicts') } }, h('span', { class: 'icn', text: '{{alert}}' }), L.dockLabels ? h('small', { text: 'Review' }) : null, h('span', { class: 'badge', text: String(store.conflictCount()) })));
  clear(shell.dock).append(items);
}

function buildShell() {
  const L = curLook();
  const search = h('input', { class: 'inp search', type: 'search', placeholder: 'Search your vault  ( / )', 'aria-label': 'Search your vault', autocomplete: 'off', spellcheck: 'false', on: { input: (e) => { ctx.S.q = e.target.value; if (!isVaultView(ctx.S.view)) ctx.S.view = 'all'; drawMain(); drawSide(); } } });
  const clock = L.clock ? h('div', { class: 'barclock', 'aria-label': 'Clock' }, h('b'), h('span')) : null;
  const top = h('header', { class: 'topbar' }, h('div', { class: 'logo' }, h('img', { src: 'icons/icon.svg', alt: '', width: '26', height: '26' }), h('b', null, 'Vault', h('span', { text: 'Manager' }))), search, clock,
    h('button', { class: 'btn primary', on: { click: () => newItemMenu(ctx) } }, '{{plus}}', h('span', { class: 'lbl', text: ' New' })), h('button', { class: 'btn', title: 'Lock now (Alt+L)', on: { click: () => lock(false) } }, '{{lock}}', h('span', { class: 'lbl', text: ' Lock' })), h('button', { class: 'btn icon', title: 'Help, tour and shortcuts', 'aria-label': 'Help', on: { click: () => tour.help() } }, '{{help}}'));
  const side = h('nav', { class: 'side', 'aria-label': 'Sections' }), main = h('main', { class: 'main' });
  const dock = h('nav', { class: 'dock', 'aria-label': 'Dock' });
  const mbar = h('nav', { class: 'mbar', 'aria-label': 'Main navigation' });
  dock.addEventListener('pointermove', (e) => {
    const cur = curLook(); if (!cur.dockMagnify || !cur.animations) return;
    for (const it of dock.querySelectorAll('.dock-item')) { const r = it.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2)); it.style.setProperty('--s', (1 + 0.6 * Math.exp(-((d / 64) ** 2))).toFixed(3)); }
  });
  dock.addEventListener('pointerleave', () => dock.querySelectorAll('.dock-item').forEach((it) => it.style.setProperty('--s', '1')));
  shell = { search, side, main, dock, mbar, clock, el: h('div', null, top, h('div', { class: 'shell' }, side, main), dock, mbar) };
  clearInterval(clockTimer); tickClock(); clockTimer = setInterval(tickClock, 15000);
}

function counts() {
  const a = store.active();
  const c = { all: a.length, fav: a.filter((i) => i.favorite).length, trash: store.trashed().length };
  for (const k of Object.keys(TYPE_META)) c[k] = a.filter((i) => i.type === k).length;
  return c;
}

function groupBlock(g, keys, c, btn) {
  const closed = ctx.S.collapsed.has(g), total = keys.reduce((n, k) => n + c[k], 0);
  const head = h('button', { class: 'ngroup', 'aria-expanded': String(!closed), title: closed ? 'Expand ' + g : 'Collapse ' + g, on: { click: () => { if (ctx.S.collapsed.has(g)) ctx.S.collapsed.delete(g); else ctx.S.collapsed.add(g); drawSide(); } } },
    h('span', { class: 'chev', text: closed ? '{{chevright}}' : '{{chevdown}}' }), h('span', { text: g }), total ? h('span', { class: 'n', text: String(total) }) : null);
  return h('div', { class: 'ngroup-wrap' }, head, h('div', { class: 'nbody' + (closed ? ' collapsed' : '') }, keys.map((k) => btn(k, TYPE_META[k].icon, TYPE_META[k].plural, c[k]))));
}

function drawSide() {
  const c = counts(), btn = (id, ic, label, n, dot) => h('button', { class: 'nav' + (ctx.S.view === id ? ' on' : ''), 'aria-current': ctx.S.view === id ? 'page' : null, on: { click: () => ctx.go(id) } }, h('span', { class: 'ic icn', text: ic }), label, dot ? h('span', { class: 'dot', title: 'Needs attention' }) : n !== undefined ? h('span', { class: 'n', text: String(n) }) : null);
  const hl = health(store.items);
  const attention = hl.weak.length + hl.reused.length + hl.expiring.length > 0;
  clear(shell.side).append(h('h4', { text: 'Vault' }), NAV.map(([id, ic, l]) => btn(id, ic, l, id === 'home' ? undefined : c[id])), store.conflictCount() ? btn('conflicts', '{{alert}}', 'Needs review', store.conflictCount()) : null, h('h4', { text: 'Categories' }), GROUPS.map(([g, keys]) => groupBlock(g, keys, c, btn)),
    store.tags().length ? [h('h4', { text: 'Tags' }), store.tags().map(([t, n]) => btn('tag:' + t, '#', t, n))] : null,
    h('h4', { text: 'Tools' }), TOOLS.map(([id, ic, l]) => btn(id, ic, l, undefined, id === 'health' && attention)));
}

function drawMain() {
  ctx.runCleanup();
  const v = ctx.S.view;
  clear(shell.main).append(isVaultView(v) ? renderVaultView(ctx) : v === 'gen' ? renderGenerator(ctx) : v === 'health' ? renderHealth(ctx) : v === 'home' ? renderHome(ctx) : v === 'qr' ? renderQR(ctx) : v === 'beam' ? renderBeam(ctx) : v === 'data' ? renderData(ctx) : renderSettings(ctx));
}

function draw() {
  if (!store.unlocked) { shell = null; drawGate(); return; }
  if (!shell) { buildShell(); clear(root).append(shell.el); }
  drawSide(); drawMain(); drawDock(); drawMbar();
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'Escape') { if (closeTopModal()) e.preventDefault(); return; }
  if (!store.unlocked || modalOpen()) return;
  if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); lock(false); }
  else if (e.key === '/' && !typing) { e.preventDefault(); if (!isVaultView(ctx.S.view)) ctx.go('all'); shell.search.focus(); }
});

/* ---------- boot ---------- */
applyTheme();
draw();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
