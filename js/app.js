/* VaultManager — application shell: lock screen, navigation, auto-lock, routing. */

/* clickjacking: a vault page must never be shown inside someone else's page (a <meta> CSP cannot set frame-ancestors) */
if (window.top !== window.self) { document.documentElement.textContent = 'VaultManager cannot be shown inside another page.'; throw new Error('framed'); }
import { h, clear, setLabel, clearClipboardNow, confirmDialog, buzz, closeAllModals, closeTopModal, modalOpen, modal, toast, copyText } from './dom.js';
import { VaultStore } from './vault.js';
import { available } from './crypto.js';
import { estimate } from './strength.js';
import { generatePassphrase } from './generator.js';
import { renderVaultView, newItemMenu, showRecoveryKit, meter } from './views.js';
import { renderGenerator, renderHealth, renderQR, renderData } from './tools.js';
import { renderTaskManager } from './taskman.js';
import { renderSettings } from './settings.js';
import { createBlobStore } from './blobs.js';
import { Profiles, keysFor, newProfileId } from './profiles.js';
import { profileAvatar, avatarPicker, importProfileDialog, exportProfileDialog } from './profile-ui.js';
import { canOfferCopy, saveOfflineCopy, isSingleFile, OFFLINE_NAME } from './offline.js';
import * as admin from './admin.js';
import { initCursor } from './cursor.js';
import { startWatch, onFinding, highCount } from './devcheck.js';
import { APP_VERSION } from './version.js';
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
import { fmtInt, fmtDate } from './util.js';

const root = document.getElementById('app');
let storage;
try { storage = window.localStorage; storage.getItem('x'); } catch { storage = null; }

const memoryStorage = () => ({ _m: new Map(), getItem(k) { return this._m.get(k) ?? null; }, setItem(k, v) { this._m.set(k, v); }, removeItem(k) { this._m.delete(k); } });
const env = { storage: storage || memoryStorage(), blobs: createBlobStore(), profiles: null };
env.profiles = new Profiles(env.storage);
let store = null;   // the CURRENT profile's vault (one profile = one completely separate vault)
/* Point the app at a profile (or at an empty placeholder when none exists yet). Nothing is decrypted here. */
function openProfile(id) {
  const k = id ? keysFor(id) : null;
  store = new VaultStore(env.storage, k ? k.vault : 'vaultmanager.vault.new', env.blobs, k ? k.fails : 'vaultmanager.fails.new');
  ctx.S.profileId = id || null;
  const cos = loadCosmetic(env.storage, keysFor(id || 'main').look);
  bootLook = normalizeLook((cos && cos.look) || {}); bootTheme = (cos && cos.theme) || 'auto';
}

const ctx = {
  get store() { return store; },
  env,
  S: { view: 'all', q: '', sel: null, qrTab: 'seal', collapsed: new Set(GROUPS.slice(1).map((g) => g[0])), profileId: null, gate: null },
  cleanup: [],
  runCleanup() { const c = ctx.cleanup.splice(0); c.forEach((f) => { try { f(); } catch { /* ignore */ } }); },
  closeModals: closeAllModals,
  go(view) { ctx.S.view = view; if (view in TYPE_META) { const g = GROUPS.find(([, keys]) => keys.includes(view)); if (g) ctx.S.collapsed.delete(g[0]); } if (view !== 'all' && !isVaultView(view)) ctx.S.sel = null; if (!isVaultView(view)) ctx.S.q = ''; syncSearch(); draw(); window.scrollTo(0, 0); },
  refresh() { draw(); },
  applyTheme, armAutolock, lock, armSync, syncNow,
  profile: () => env.profiles.get(ctx.S.profileId),
  switchProfile() { lock(false); ctx.S.gate = 'picker'; draw(); },
  updateProfile(patch) { const p = env.profiles.update(ctx.S.profileId, patch); if (p && patch.name !== undefined && store.unlocked) { store.settings.displayName = p.name; saveSoon(); } return p; },
  async removeProfile(id) { const k = keysFor(id); const st = id === ctx.S.profileId && store ? store : new VaultStore(env.storage, k.vault, env.blobs, k.fails); await st.wipe(); env.profiles.remove(id); },
  /* Purge memory: forget everything that is only held in memory — opened locked items, revealed values, QR tool fields, previews, the clipboard. Nothing stored is touched. */
  purgeMemory() {
    const n = store.itemKeys ? store.itemKeys.size : 0;
    if (store.itemKeys) store.itemKeys.clear();
    ctx.runCleanup(); closeAllModals(); clearClipboardNow(); ctx.S.q = '';
    draw();
    toast('Memory purged — ' + n + ' opened item' + (n === 1 ? '' : 's') + ' locked again, clipboard cleared, fields and previews wiped');
    return n;
  },
  contactAdmin: () => contactAdminDialog(),
  exportProfile: () => exportProfileDialog(ctx),
  importProfile: (onDone) => importProfileDialog(ctx, { onDone }),
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
let bootLook = normalizeLook({}), bootTheme = 'auto';   // what the sign-in screen uses (the last profile's look)
const cosKey = () => keysFor(ctx.S.profileId || 'main').look;
const lightMQ = window.matchMedia('(prefers-color-scheme: light)');
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function curLook() { return store.unlocked ? normalizeLook(store.settings.look) : bootLook; }
function applyTheme() {
  const setting = store.unlocked ? store.settings.theme : bootTheme, lk = curLook();
  const theme = resolveTheme(setting, lightMQ.matches);
  applyLook(lk, theme, landscapes);
  if (storage) saveCosmetic(storage, setting, lk, cosKey());
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
  if (opt.shell) { shell = null; draw(); } else if (opt.redraw) draw(); else if (shell) { drawDock(); drawMbar(); if (opt.nav) drawSide(); }
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
  const el = h('div', { id: 'boot', role: 'status', 'aria-label': 'Starting' }, h('div', { class: 'boot-box' },
    h('img', { class: 'boot-logo', src: 'icons/icon.svg', alt: '', width: '64', height: '64' }), h('div', { class: 'boot-title' }, 'Vault', h('span', { text: 'Manager' })), h('div', { class: 'bar' }, h('i')),
    h('div', { class: 'boot-lines' }, lines.map(([a, b], i) => { const l = h('div', { class: 'l' }, '> ', h('b', { text: a }), b ? '  ' + b : ''); l.style.animationDelay = (i * 0.12 / L.animSpeed) + 's'; return l; }))), h('div', { class: 'hint', text: 'Click or press any key to skip' }));
  document.body.append(el);
  let finished = false;
  const finish = () => { if (finished) return; finished = true; el.remove(); window.removeEventListener('keydown', finish, true); done(); };
  /* a click on the boot screen skips it — and if it was aimed at a menu item underneath (the side bar is already there), that item opens too, so the click is never lost */
  el.addEventListener('pointerdown', (e) => {
    const x = e.clientX, y = e.clientY; finish();
    const t = document.elementFromPoint(x, y), target = t && t.closest && t.closest('.nav, .dock-item, .mbar-item, .mbar-fab');
    if (target) setTimeout(() => target.click(), 0);
  });
  window.addEventListener('keydown', finish, true);
  requestAnimationFrame(() => { const i = el.querySelector('.bar i'); if (i) i.style.width = '100%'; });
  setTimeout(finish, ((lines.length * 0.12 + 0.35) / L.animSpeed) * 1000);
}

/* the one place every successful unlock ends up */
function onUnlocked(note) {
  const L = curLook(); ctx.S.since = Date.now();
  ctx.S.view = L.startPage === 'home' ? 'home' : 'all';
  if (ctx.S.lastView && ctx.S.lastProfile === ctx.S.profileId) ctx.S.view = ctx.S.lastView;   // after an auto-lock you land where you were, not back on Home
  ctx.S.lastView = null;
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
  closeSystemMenu(); clearTimeout(idleTimer); stopSync(); clearInterval(clockTimer); tour.stop();
  if (store.unlocked && !erased) store.log('security', why || 'Vault locked');
  ctx.runCleanup(); closeAllModals();
  clear(document.getElementById('printArea'));
  if (store.unlocked && !erased) { ctx.S.lastView = ctx.S.view; ctx.S.lastSel = ctx.S.sel; ctx.S.lastProfile = ctx.S.profileId; } else ctx.S.lastView = null;
  store.lock();
  Object.assign(ctx.S, { view: 'all', q: '', sel: null });
  if (erased && !env.profiles.get(ctx.S.profileId)) { const next = env.profiles.last(); openProfile(next ? next.id : null); ctx.S.gate = next ? 'picker' : null; }
  document.documentElement.dataset.detail = '0';
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
const brand = (sub) => h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: '44', height: '44' }), h('div', null, h('h1', null, 'Vault', h('span', { text: 'Manager' }), h('small', { class: 'ver', text: ' v' + APP_VERSION })), h('p', { text: sub })));

function pwInput(id, label, auto) {
  const i = h('input', { id, type: 'password', class: 'inp mono', autocomplete: auto, spellcheck: 'false', 'aria-label': label, required: true });
  const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show or hide ' + label, title: 'Show / hide', on: { click: () => { i.type = i.type === 'password' ? 'text' : 'password'; } } }, '{{eye}}');
  return { input: i, el: h('div', { class: 'pwwrap' }, i, eye) };
}


const contactAdminDialog = () => admin.contactAdmin({ profileName: store && store.unlocked ? (ctx.profile() || {}).name || '' : '' });

const gateFoot = () => h('p', { class: 'gate-foot' }, h('span', { class: 'gate-ver', text: 'VaultManager v' + APP_VERSION + (isSingleFile() ? ' · offline copy' : '') }), ...gateFootLinks());
const gateFootLinks = () => (admin.enabled() || canOfferCopy() ? [ admin.enabled() ? h('button', { type: 'button', class: 'linkbtn', on: { click: contactAdminDialog } }, '{{mailsend}} Contact admin') : null, canOfferCopy() ? h('button', { type: 'button', class: 'linkbtn', on: { click: async () => { try { await saveOfflineCopy(); } catch (e) { toast(e.message, 'err', 7000); } } } }, '{{download}} Download the offline copy — one file, ' + OFFLINE_NAME + ' (v' + APP_VERSION + ')') : null] : []);

function profileHead(p, sub) {
  return h('div', { class: 'brand prof' }, profileAvatar(p, 52), h('div', null, h('h1', { text: p.name }), h('p', { text: sub })));
}

/* After a profile has been created or imported on the sign-in screen: open it and go straight in. */
async function enterProfile(profile, masterPassword) {
  admin.notifyNewProfile(profile.name, { source: 'import' });
  env.profiles.setLast(profile.id); openProfile(profile.id); ctx.S.gate = null;
  await store.unlock({ password: masterPassword });
  onUnlocked();
}

function gateCreate({ first }) {
  const list = env.profiles.list();
  const name = h('input', { id: 'pname', class: 'inp', value: first ? 'My vault' : '', maxlength: '40', autocomplete: 'off', placeholder: 'e.g. Alex, Family, Work', 'aria-label': 'Profile name' });
  const picker = avatarPicker(null, () => name.value); name.addEventListener('input', () => picker.refresh());
  const p1 = pwInput('pw1', 'Master password', 'new-password'), p2 = pwInput('pw2', 'Repeat master password', 'new-password');
  const m = h('div'), err = h('p', { class: 'err', role: 'alert' });
  const ack = h('input', { type: 'checkbox', id: 'ack' });
  const notifyOn = admin.notifyEnabled(), contact = h('input', { class: 'inp', id: 'contactemail', type: 'email', maxlength: '120', autocomplete: 'email', placeholder: 'Your email (optional — lets the admin reach you)', 'aria-label': 'Optional contact email' });
  p1.input.addEventListener('input', () => clear(m).append(meter(p1.input.value).el));
  const btn = h('button', { class: 'btn primary', type: 'submit', style: null }, first ? 'Create my vault' : 'Create profile');
  const suggest = h('button', { type: 'button', class: 'btn sm', on: { click: () => { const pw = generatePassphrase({ words: 6 }); p1.input.value = p2.input.value = pw; p1.input.type = p2.input.type = 'text'; p1.input.dispatchEvent(new Event('input')); } } }, '{{bolt}} Suggest a passphrase');
  const form = h('form', { novalidate: true, on: { submit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const nm = name.value.trim(); if (!nm) { err.textContent = 'Give this profile a name.'; name.focus(); return; }
    if (p1.input.value !== p2.input.value) { err.textContent = 'The two passwords do not match.'; return; }
    const pol = ctx.passwordPolicy(p1.input.value); if (pol) { err.textContent = pol; return; }
    if (!ack.checked) { err.textContent = 'Please confirm that you understand there is no password recovery.'; return; }
    btn.disabled = true; btn.textContent = 'Deriving key (600,000 rounds)…';
    const id = newProfileId(), k = keysFor(id), st = new VaultStore(env.storage, k.vault, env.blobs, k.fails);
    try { await st.create(p1.input.value); st.data.settings.displayName = nm; await st.save(); } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = first ? 'Create my vault' : 'Create profile'; return; }
    env.profiles.add({ id, name: nm, avatar: picker.get() }); env.profiles.setLast(id);
    if (notifyOn) admin.notifyNewProfile(nm, { contact: contact.value.trim().slice(0, 120) });
    store = st; ctx.S.profileId = id; ctx.S.gate = null;
    p1.input.value = p2.input.value = ''; ctx.S.since = Date.now();
    ctx.S.view = curLook().startPage === 'home' ? 'home' : 'all';
    applyTheme(); armAutolock(); draw();
    tour.maybeWelcome();
    modal({ title: 'Vault created 🎉', sub: 'One more thing', body: h('div', null, h('p', { text: 'Your master password never leaves this device and cannot be reset. A recovery key is a printable backup way in if you ever forget it.' })),
      actions: [{ label: 'Skip for now' }, { label: 'Create recovery key', kind: 'primary', onClick: async () => { const key = await store.session.createRecovery(); await store.save(); showRecoveryKit(ctx, key); } }] });
  } } },
    h('div', { class: 'field' }, h('label', { for: 'pname', text: 'Profile name' }), name, h('p', { class: 'hint', text: first ? 'One profile per person — each has its own master password and its own completely separate vault.' : 'This profile gets its own master password and its own separate vault.' })),
    picker.el,
    h('div', { class: 'field' }, h('label', { for: 'pw1', text: 'Master password' }), p1.el, m, h('p', { class: 'hint', text: '12+ characters. A passphrase of 5+ random words is easy to remember and hard to crack.' })),
    h('div', { class: 'field' }, h('label', { for: 'pw2', text: 'Repeat master password' }), p2.el),
    h('div', { class: 'row wrap' }, suggest),
    h('label', { class: 'chk', for: 'ack' }, ack, 'I understand that if I forget this password, nobody can recover my data.'),
    notifyOn ? h('div', { class: 'note', id: 'notifynote' }, 'ℹ ' + admin.DISCLOSURE, contact) : null,
    err, h('div', { class: 'row' }, btn));
  return h('div', { class: 'panel gate-card' }, brand(first ? 'Create your profile and encrypted vault' : 'Add a profile'), form,
    h('div', { class: 'gate-links' }, h('button', { type: 'button', class: 'linkbtn', on: { click: () => ctx.importProfile(enterProfile) } }, '{{importfile}} Import a profile backup — restore a whole database'), list.length ? h('button', { type: 'button', class: 'linkbtn', on: { click: () => { ctx.S.gate = 'picker'; draw(); } } }, '← Back to profiles') : null),
    trustChips(), gateFoot());
}

function gatePicker(list) {
  const card = (p) => h('button', { class: 'profcard', 'aria-label': 'Sign in as ' + p.name, on: { click: () => { openProfile(p.id); ctx.S.gate = null; applyTheme(); draw(); } } }, profileAvatar(p, 72), h('b', { text: p.name }), h('small', { text: p.last ? 'Last used ' + fmtDate(p.last) : 'Never opened' }));
  const add = h('button', { class: 'profcard add', 'aria-label': 'Add a profile', on: { click: () => { ctx.S.gate = 'create'; draw(); } } }, h('div', { class: 'pav addpav', 'aria-hidden': 'true' }, '{{plus}}'), h('b', { text: 'Add profile' }), h('small', { text: 'A new, separate vault' }));
  return h('div', { class: 'panel gate-card wide' }, brand('Who is signing in?'), h('div', { class: 'profgrid' }, list.map(card), add),
    h('div', { class: 'gate-links' }, h('button', { type: 'button', class: 'linkbtn', on: { click: () => ctx.importProfile(enterProfile) } }, '{{importfile}} Import a profile backup')), trustChips(), gateFoot());
}

function gateUnlock(profile) {
  const list = env.profiles.list();
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
      env.profiles.setLast(profile.id);
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
      env.profiles.setLast(profile.id);
      onUnlocked(mode === 'recovery' ? 'recovery' : '');
      return;
    } catch (x) {
      err.textContent = x.message === 'bad-secret' ? (mode === 'password' ? 'Wrong master password.' : 'That recovery key does not open this vault.') : x.message === 'locked-out' ? 'Too many wrong attempts. Please wait.' : x.message;
      p1.input.select();
    }
    btn.textContent = 'Unlock'; throttle();
  } } }, pwBox, rkBox, err, h('div', { class: 'row' }, btn), h('p', { style: null }, toggle));
  setTimeout(throttle, 0);
  const removeBtn = h('button', { type: 'button', class: 'linkbtn danger', on: { click: () => removeProfileFromGate(profile) } }, 'Remove this profile…');
  return h('div', { class: 'panel gate-card' }, profileHead(profile, 'Your vault is locked'), pkBtn, pkBtn ? h('p', { class: 'or', text: 'or use your master password' }) : null, form,
    h('div', { class: 'gate-links' }, list.length > 1 ? h('button', { type: 'button', class: 'linkbtn', on: { click: () => { ctx.S.gate = 'picker'; draw(); } } }, '{{contact}} Switch profile') : null,
      h('button', { type: 'button', class: 'linkbtn', on: { click: () => { ctx.S.gate = 'create'; draw(); } } }, '{{plus}} Add a profile'), h('button', { type: 'button', class: 'linkbtn', on: { click: () => ctx.importProfile(enterProfile) } }, '{{importfile}} Import a profile backup'), removeBtn),
    trustChips(), gateFoot());
}

/* Deleting a profile from the sign-in screen: it cannot be undone, so the name must be typed. */
function removeProfileFromGate(profile) {
  const t = h('input', { class: 'inp', autocomplete: 'off', 'aria-label': 'Type the profile name to confirm', placeholder: profile.name }), err = h('p', { class: 'err', role: 'alert' });
  modal({ title: 'Remove “' + profile.name + '”?', body: h('div', null, h('p', { class: 'note danger', text: 'This permanently deletes this profile’s vault and all its attachments from this device. Backups and synced copies are not touched, but without one of them the data is gone.' }), h('p', { text: 'Type the profile name to confirm:' }), t, err),
    actions: [{ label: 'Cancel' }, { label: 'Remove forever', kind: 'danger', onClick: async () => {
      if (t.value.trim() !== profile.name) { err.textContent = 'The name does not match.'; return false; }
      await ctx.removeProfile(profile.id); const next = env.profiles.last(); openProfile(next ? next.id : null); ctx.S.gate = next && env.profiles.list().length > 1 ? 'picker' : null; applyTheme(); draw(); toast('Profile removed');
    } }] });
}

function drawGate() {
  clear(root);
  ctx.runCleanup();
  if (!available()) {
    root.append(h('div', { class: 'gate' }, h('div', { class: 'panel gate-card' }, brand('Cannot start'), h('p', { class: 'note danger', text: 'WebCrypto is unavailable. Open VaultManager over https:// or http://localhost — browsers disable encryption on insecure origins.' }))));
    return;
  }
  const storageWarn = storage ? null : h('p', { class: 'note warn', text: 'Browser storage is blocked, so this vault will disappear when you close the tab. Allow site data to keep it.' });
  const list = env.profiles.list();
  let card;
  if (!list.length) card = gateCreate({ first: true });
  else if (ctx.S.gate === 'create') card = gateCreate({ first: false });
  else if (ctx.S.gate === 'picker' && list.length > 0) card = gatePicker(list);
  else { let p = env.profiles.get(ctx.S.profileId); if (!p) { p = list[0]; openProfile(p.id); applyTheme(); } card = gateUnlock(p); }
  root.append(h('div', { class: 'gate' }, h('div', null, storageWarn, card)));
  const f = root.querySelector('input'); if (f) f.focus();
}

/* ---------- main shell ---------- */
let shell = null;

const NAV = [['home', '{{home}}', 'Home'], ['all', '{{vault}}', 'All items'], ['fav', '{{star}}', 'Favorites'], ['trash', '{{trash}}', 'Trash']];
const TOOLS = [['health', '{{pulse}}', 'Vault health'], ['gen', '{{bolt}}', 'Generator'], ['qr', '{{qr}}', 'QR tools'], ['beam', '{{beam}}', 'Beam sync'], ['data', '{{swap}}', 'Import & export'], ['tm', '{{chip}}', 'Task manager'], ['settings', '{{gear}}', 'Settings']];

/* what the user chose to hide from the side bar, dock and menu (Settings → Dock & menu bar) */
const hid = { cat: (k) => curLook().hiddenCats.includes(k), nav: (id) => curLook().hiddenNav.includes(id) };
const visGroups = () => GROUPS.map(([g, keys]) => [g, keys.filter((k) => !hid.cat(k))]).filter(([, keys]) => keys.length);
const visTools = () => TOOLS.filter(([id]) => !hid.nav(id));
const visNav = () => NAV.filter(([id]) => !hid.nav(id));

function syncSearch() { if (shell && shell.search.value !== ctx.S.q) shell.search.value = ctx.S.q; }

let clockTimer = null;
function tickClock() {
  if (!shell || !shell.clock) return;
  const L = curLook(), n = new Date();
  shell.clock.firstChild.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !L.clock24 });
  shell.clock.lastChild.textContent = L.dateFmt === 'none' ? '' : n.toLocaleDateString([], L.dateFmt === 'long' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
}

const DOCK = [['home', '{{home}}', 'Home'], ['all', '{{vault}}', 'All items'], ['fav', '{{star}}', 'Favorites'], ['cats', '{{puzzle}}', 'Categories'], null, ['health', '{{pulse}}', 'Health'], ['gen', '{{bolt}}', 'Generator'], ['qr', '{{qr}}', 'QR tools'], ['beam', '{{beam}}', 'Beam'], ['tm', '{{chip}}', 'Tasks'], null, ['settings', '{{gear}}', 'Settings'], ['help', '{{help}}', 'Help'], ['new', '{{plus}}', 'New item']];

function categoriesModal() {
  const cnt = (k) => store.active().filter((i) => i.type === k).length;
  modal({ title: 'Categories', wide: true, body: h('div', null, visGroups().map(([g, keys]) => h('div', { class: 'catgroup' }, h('p', { class: 'lbl', text: g }),
    h('div', { class: 'checks cats' }, keys.map((k) => h('button', { class: 'btn', on: { click: () => { closeAllModals(); ctx.go(k); } } }, h('span', { class: 'icn', text: TYPE_META[k].icon }), ' ' + TYPE_META[k].plural + ' · ' + cnt(k))))))), actions: [{ label: 'Close' }] });
}

/* phone navigation: a bottom bar (Home · Items · New · Generator · More) and a "More" sheet with everything else */
function moreSheet() {
  const go = (v) => () => { closeAllModals(); ctx.go(v); };
  const c = counts();
  const item = (ic, label, fn, n) => h('button', { class: 'btn msheet-item', on: { click: fn } }, ic, h('span', { class: 'grow', text: label }), n !== undefined ? h('span', { class: 'n', text: String(n) }) : null);
  const me = ctx.profile();
  const m = modal({ title: 'Menu', sub: me ? 'Signed in as ' + me.name : '', wide: true, body: h('div', { class: 'msheet' },
    h('p', { class: 'lbl', text: 'Vault' }), h('div', { class: 'mgrid' }, hid.nav('fav') ? null : item('{{star}}', 'Favorites', go('fav'), c.fav), hid.nav('trash') ? null : item('{{trash}}', 'Trash', go('trash'), c.trash), store.conflictCount() ? item('{{alert}}', 'Needs review', go('conflicts'), store.conflictCount()) : null),
    h('p', { class: 'lbl', text: 'Tools' }), h('div', { class: 'mgrid' }, visTools().map(([id, ic, l]) => item(ic, l, go(id)))),
    visGroups().map(([g, keys]) => h('div', null, h('p', { class: 'lbl', text: g }), h('div', { class: 'mgrid' }, keys.map((k) => item(TYPE_META[k].icon, TYPE_META[k].plural, go(k), c[k]))))),
    h('p', { class: 'lbl', text: 'More' }), h('div', { class: 'mgrid' }, item('{{help}}', 'Help & tour', () => { closeAllModals(); tour.help(); }), item('{{trash}}', 'Purge memory now', () => { closeAllModals(); ctx.purgeMemory(); }), item('{{swap}}', 'Switch profile', () => { closeAllModals(); ctx.switchProfile(); }), item('{{refresh}}', 'Restart…', () => { closeAllModals(); restartApp(); }), admin.enabled() ? item('{{mailsend}}', 'Contact admin', () => { closeAllModals(); contactAdminDialog(); }) : null, item('{{lock}}', 'Lock now', () => { closeAllModals(); lock(false); }))), actions: [{ label: 'Close' }] });
  return m;
}

function drawMbar() {
  if (!shell || !shell.mbar) return;
  const v = ctx.S.view, hl = health(store.items), attention = hl.weak.length + hl.reused.length + hl.expiring.length + store.conflictCount();
  const it = (id, ic, label, on, fn, badge) => h('button', { class: 'mbar-item' + (on ? ' on' : ''), 'aria-label': label, 'aria-current': on ? 'page' : null, on: { click: () => { buzz(); fn(); } } }, ic, h('span', { class: 'mlbl', text: label }), badge ? h('span', { class: 'badge', text: String(badge) }) : null);
  const inMore = !['home', 'gen'].includes(v) && !isVaultView(v) ? true : (v === 'fav' || v === 'trash' || v === 'conflicts' || (v in TYPE_META));
  clear(shell.mbar).append(
    it('home', '{{home}}', 'Home', v === 'home', () => ctx.go('home')),
    it('all', '{{vault}}', 'Items', ['all'].includes(v) || v.startsWith('tag:'), () => ctx.go('all')),
    h('button', { class: 'mbar-fab', 'aria-label': 'New item', on: { click: () => { buzz(12); newItemMenu(ctx); } } }, '{{plus}}'),
    it('gen', '{{bolt}}', 'Generator', v === 'gen', () => ctx.go('gen')),
    it('more', '{{menu}}', 'More', inMore && v !== 'home' && v !== 'gen' && v !== 'all', () => moreSheet(), attention));
}

const viewTitle = (v) => ({ home: 'Home', all: 'All items', fav: 'Favorites', trash: 'Trash', conflicts: 'Needs review', gen: 'Generator', health: 'Vault health', qr: 'QR tools', beam: 'Beam sync', data: 'Import & export', tm: 'Task manager', settings: 'Settings' })[v] || (v in TYPE_META ? TYPE_META[v].plural : v.startsWith('tag:') ? '#' + v.slice(4) : '');
function drawTitle() { if (shell && shell.title) shell.title.textContent = viewTitle(ctx.S.view); document.documentElement.dataset.detail = isVaultView(ctx.S.view) && ctx.S.sel ? '1' : '0'; }

function drawDock() {
  if (!shell || !shell.dock) return;
  const L = curLook(), hl = health(store.items), attention = hl.weak.length + hl.reused.length + hl.expiring.length;
  const items = DOCK.filter((d) => !d || !hid.nav(d[0])).map((d) => {
    if (!d) return h('span', { class: 'dock-sep' });
    const [id, ic, label] = d;
    const on = id === 'cats' ? (ctx.S.view in TYPE_META) : ctx.S.view === id;
    return h('button', { class: 'dock-item' + (on ? ' on' : ''), title: label, 'aria-label': label, 'aria-current': on ? 'page' : null, on: { click: () => (id === 'new' ? newItemMenu(ctx) : id === 'help' ? tour.help() : id === 'cats' ? categoriesModal() : ctx.go(id)) } },
      h('span', { class: 'icn', text: ic }), L.dockLabels ? h('small', { text: label }) : null, id === 'health' && attention ? h('span', { class: 'badge', text: String(attention) }) : null);
  });
  if (store.conflictCount()) items.splice(3, 0, h('button', { class: 'dock-item' + (ctx.S.view === 'conflicts' ? ' on' : ''), title: 'Needs review', 'aria-label': 'Needs review', on: { click: () => ctx.go('conflicts') } }, h('span', { class: 'icn', text: '{{alert}}' }), L.dockLabels ? h('small', { text: 'Review' }) : null, h('span', { class: 'badge', text: String(store.conflictCount()) })));
  clear(shell.dock).append(items);
}


/* The system menu (like ulyOS): About, shortcuts, tour, settings, task manager, lock, purge memory, switch profile, restart. */
let sysMenuEl = null, sysMenuOff = null;
function closeSystemMenu() { if (sysMenuOff) { document.removeEventListener('pointerdown', sysMenuOff, true); sysMenuOff = null; } if (sysMenuEl) { sysMenuEl.remove(); sysMenuEl = null; } document.querySelectorAll('.sysbtn[aria-expanded=true]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
async function restartApp() {
  const ok = await confirmDialog({ title: 'Restart VaultManager?', text: 'This locks your vault, forgets everything held in memory and reloads the app. Nothing stored is changed.', okLabel: 'Restart', danger: true });
  if (!ok) return;
  ctx.purgeMemory(); lock(false, 'Restarting…'); setTimeout(() => location.reload(), 350);
}
function systemMenu(anchor) {
  if (sysMenuEl) { closeSystemMenu(); return; }
  const item = (ic, label, fn, { danger = false, hint = '' } = {}) => h('button', { class: 'sm-item' + (danger ? ' danger' : ''), role: 'menuitem', type: 'button', on: { click: () => { closeSystemMenu(); fn(); } } }, h('span', { class: 'ic icn', text: ic }), h('span', { class: 'grow', text: label }), hint ? h('kbd', { text: hint }) : null);
  const sep = () => h('div', { class: 'sm-sep', role: 'separator' });
  const me = ctx.profile();
  const who = me ? h('button', { class: 'sm-who', role: 'menuitem', type: 'button', title: 'Profile settings', on: { click: () => { closeSystemMenu(); ctx.S.setTab = 'general'; ctx.go('settings'); } } }, profileAvatar(me, 38), h('span', { class: 'grow' }, h('b', { text: me.name }), h('small', { text: 'Signed in · ' + store.active().length + ' item' + (store.active().length === 1 ? '' : 's') }))) : null;
  const m = h('div', { class: 'sysmenu', role: 'menu', 'aria-label': 'VaultManager menu' }, who, who ? sep() : null,
    item('{{info}}', 'About VaultManager ' + APP_VERSION + (isSingleFile() ? ' (offline copy)' : ''), () => { ctx.S.setTab = 'about'; ctx.go('settings'); }), item('{{keyboard}}', 'Keyboard shortcuts…', () => tour.help(), { hint: 'F1' }), item('{{compass}}', 'Guided tour', () => tour.start()), sep(),
    item('{{gear}}', 'Settings…', () => ctx.go('settings')), item('{{chip}}', 'Task manager', () => ctx.go('tm')), sep(),
    item('{{lock}}', 'Lock screen', () => lock(false), { hint: 'Alt+L' }), item('{{trash}}', 'Purge memory now', () => ctx.purgeMemory()), item('{{swap}}', 'Switch profile…', () => ctx.switchProfile()),
    admin.enabled() ? item('{{mailsend}}', 'Contact admin…', () => contactAdminDialog()) : null, item('{{refresh}}', 'Restart…', restartApp, { danger: true }));
  document.body.append(m); sysMenuEl = m; anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
  const first = m.querySelector('.sm-item'); if (first) first.focus();
  const off = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeSystemMenu(); };
  sysMenuOff = off; document.addEventListener('pointerdown', off, true);
  m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('.sm-item')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); } else if (e.key === 'Escape') { e.stopPropagation(); closeSystemMenu(); anchor.focus(); }
  });
}

/* a warning bar under the top bar when something on this device is clearly tampering with the page */
function drawSecBar() {
  if (!shell || !shell.secbar) return;
  const n = highCount(), show = n > 0 && !ctx.S.secDismissed;
  shell.secbar.hidden = !show; clear(shell.secbar);
  if (show) shell.secbar.append(h('span', { class: 'grow', text: '⚠ Something on this device is modifying this page — it may be a malicious or over-privileged browser extension. Do not enter secrets until you have checked.' }),
    h('button', { class: 'btn sm', type: 'button', on: { click: () => { ctx.S.tmTab = 'sec'; ctx.go('tm'); } } }, 'Open security check'), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Dismiss', on: { click: () => { ctx.S.secDismissed = true; drawSecBar(); } } }, '{{close}}'));
}

function buildShell() {
  const L = curLook();
  const search = h('input', { class: 'inp search', type: 'search', placeholder: 'Search your vault  ( / )', 'aria-label': 'Search your vault', autocomplete: 'off', spellcheck: 'false', on: { input: (e) => { ctx.S.q = e.target.value; if (!isVaultView(ctx.S.view)) ctx.S.view = 'all'; drawMain(); drawSide(); } } });
  const clock = L.clock ? h('div', { class: 'barclock', 'aria-label': 'Clock' }, h('b'), h('span')) : null;
  const title = h('div', { class: 'apptitle', role: 'heading', 'aria-level': '1' });
  const top = h('header', { class: 'topbar' }, title, h('button', { class: 'logo sysbtn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'VaultManager menu', title: 'VaultManager menu', on: { click: (e) => systemMenu(e.currentTarget) } }, h('img', { src: 'icons/icon.svg', alt: '', width: '26', height: '26' }), h('b', null, 'Vault', h('span', { text: 'Manager' }))), search, clock,
    h('button', { class: 'btn primary newbtn', on: { click: () => newItemMenu(ctx) } }, h('span', { class: 'newico' }, '{{plus}}'), h('span', { class: 'lbl', text: ' New' })), h('button', { class: 'btn', title: 'Lock now (Alt+L)', on: { click: () => lock(false) } }, '{{lock}}', h('span', { class: 'lbl', text: ' Lock' })), h('button', { class: 'btn icon', title: 'Help, tour and shortcuts', 'aria-label': 'Help', on: { click: () => tour.help() } }, '{{help}}'));
  const side = h('nav', { class: 'side', 'aria-label': 'Sections' }), main = h('main', { class: 'main' });
  const dock = h('nav', { class: 'dock', 'aria-label': 'Dock' });
  const mbar = h('nav', { class: 'mbar', 'aria-label': 'Main navigation' });
  dock.addEventListener('pointermove', (e) => {
    const cur = curLook(); if (!cur.dockMagnify || !cur.animations) return;
    for (const it of dock.querySelectorAll('.dock-item')) { const r = it.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2)); it.style.setProperty('--s', (1 + 0.6 * Math.exp(-((d / 64) ** 2))).toFixed(3)); }
  });
  dock.addEventListener('pointerleave', () => dock.querySelectorAll('.dock-item').forEach((it) => it.style.setProperty('--s', '1')));
  const secbar = h('div', { class: 'secbar', role: 'alert', hidden: true });
  shell = { search, side, main, dock, mbar, title, clock, secbar, el: h('div', null, top, secbar, h('div', { class: 'shell' }, side, main), dock, mbar) };
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
  clear(shell.side).append(h('h4', { text: 'Vault' }), visNav().map(([id, ic, l]) => btn(id, ic, l, id === 'home' ? undefined : c[id])), store.conflictCount() ? btn('conflicts', '{{alert}}', 'Needs review', store.conflictCount()) : null, visGroups().length ? [h('h4', { text: 'Categories' }), visGroups().map(([g, keys]) => groupBlock(g, keys, c, btn))] : null,
    store.tags().length ? [h('h4', { text: 'Tags' }), store.tags().map(([t, n]) => btn('tag:' + t, '#', t, n))] : null,
    h('h4', { text: 'Tools' }), visTools().map(([id, ic, l]) => btn(id, ic, l, undefined, id === 'health' && attention)));
}

function drawMain() {
  ctx.runCleanup();
  const v = ctx.S.view;
  clear(shell.main).append(isVaultView(v) ? renderVaultView(ctx) : v === 'gen' ? renderGenerator(ctx) : v === 'health' ? renderHealth(ctx) : v === 'home' ? renderHome(ctx) : v === 'tm' ? renderTaskManager(ctx) : v === 'qr' ? renderQR(ctx) : v === 'beam' ? renderBeam(ctx) : v === 'data' ? renderData(ctx) : renderSettings(ctx));
}

function draw() {
  if (!store.unlocked) { shell = null; drawGate(); return; }
  if (!shell) { buildShell(); clear(root).append(shell.el); }
  drawSide(); drawMain(); drawDock(); drawMbar(); drawTitle(); drawSecBar();
}

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'F1' && store.unlocked) { e.preventDefault(); tour.help(); return; }
  if (e.key === 'Escape') { if (sysMenuEl) { closeSystemMenu(); e.preventDefault(); return; } if (closeTopModal()) e.preventDefault(); return; }
  if (!store.unlocked || modalOpen()) return;
  if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); lock(false); }
  else if (e.key === '/' && !typing) { e.preventDefault(); if (!isVaultView(ctx.S.view)) ctx.go('all'); shell.search.focus(); }
});

/* ---------- installable app (PWA) ---------- */
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
document.documentElement.dataset.standalone = standalone() ? '1' : '0';
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ctx.installEvent = e; if (shell && ctx.S.view === 'settings') draw(); });
window.addEventListener('appinstalled', () => { ctx.installEvent = null; document.documentElement.dataset.standalone = '1'; toast('VaultManager is installed — find it on your home screen or app list.'); });
ctx.isStandalone = standalone;
ctx.installApp = async () => { const e = ctx.installEvent; if (!e) return false; e.prompt(); const r = await e.userChoice; ctx.installEvent = null; return r && r.outcome === 'accepted'; };

/* ---------- boot ---------- */
initCursor(); startWatch();
onFinding((f) => { if (f.level === 'high') { ctx.S.secDismissed = false; drawSecBar(); } });
{ const last = env.profiles.last(); openProfile(last ? last.id : null); }
applyTheme();
draw();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.__TAURI__) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready — tap here to reload.', 'ok', 20000, () => location.reload()); });
    });
  }).catch(() => {});
}
