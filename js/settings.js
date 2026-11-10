/* Settings: one place for every adjustment, plus sync, audit trail and About / versioning. */

import { h, clear, setLabel, modal, toast, confirmDialog, askPassword, download, readFileText } from './dom.js';
import { generatePassphrase } from './generator.js';
import { estimate } from './strength.js';
import { meter, fmtSize } from './views.js';
import { page, field, sel, persist, selfTest, backupGuide } from './tools.js';
import { appearance, effects, layout, widgetsTab } from './settings-look.js';
import { supported as passkeySupported, enroll as passkeyEnroll } from './passkey.js';
import { wipe } from './crypto.js';
import { exportSyncFile, importSyncFile, validateSyncPassphrase } from './sync.js';
import { APP_NAME, APP_VERSION, CHANGELOG, FORMATS, REPO_URL } from './version.js';
import { KEY } from './vault.js';
import { fmtDate, fmtInt, stamp } from './util.js';
import { canOfferCopy, saveOfflineCopy, OFFLINE_NAME } from './offline.js';
import { enabled as adminEnabled } from './admin.js';
import { avatarPicker } from './profile-ui.js';

const TABS = [['general', '{{gear}} General'], ['appearance', '{{palette}} Appearance'], ['effects', '{{sparkles}} Effects'], ['layout', '{{compass}} Dock & menu bar'], ['widgets', '{{puzzle}} Widgets'], ['security', '{{shieldlock}} Security'], ['sync', '{{sync}} Sync'], ['audit', '{{scroll}} Audit trail'], ['about', 'ⓘ About']];

export function renderSettings(ctx) {
  const body = h('div');
  const show = (k) => {
    ctx.S.setTab = k; ctx.runCleanup();
    Array.from(bar.children).forEach((b, i) => { b.classList.toggle('on', TABS[i][0] === k); b.setAttribute('aria-selected', String(TABS[i][0] === k)); });
    clear(body).append({ general, appearance, effects, layout, widgets: widgetsTab, security, sync, audit, about }[k](ctx));
  };
  const bar = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', on: { click: () => show(k) } }, l)));
  show(ctx.S.setTab || 'general');
  return page('Settings', 'Every adjustment lives here. Everything is stored encrypted on this device — there is no account and no server.', bar, body);
}

const panel = (title, ...kids) => h('div', { class: 'panel pad' }, title ? h('h3', { text: title }) : null, ...kids);
const chk = (label, checked, onChange) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked, on: { change: (e) => onChange(e.target.checked) } }), label);

/* ======================= Install & offline ======================= */
async function offlineInfo() {
  if (!('serviceWorker' in navigator) || !window.caches) return 'Offline caching is not available in this browser, but the vault itself is always stored on this device.';
  try {
    const reg = await navigator.serviceWorker.getRegistration(), keys = await caches.keys(), vm = keys.find((k) => k.startsWith('vm-'));
    const n = vm ? (await (await caches.open(vm)).keys()).length : 0;
    return reg && reg.active && vm ? `✓ Ready to work offline — ${n} app files are cached on this device (${vm}). ${navigator.onLine ? 'You are online right now.' : 'You are offline right now.'}` : 'The offline files are still being saved. Keep the page open for a moment, then check again.';
  } catch { return 'Could not read the offline cache.'; }
}

function installPanel(ctx) {
  const ua = navigator.userAgent || '', ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  const status = h('p', { class: 'hint', 'aria-live': 'polite', text: 'Checking offline files…' });
  offlineInfo().then((t) => { status.textContent = t; });
  const how = ios ? 'On iPhone / iPad: tap the Share button in Safari, then “Add to Home Screen”.' : android ? 'On Android: open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.' : 'On a PC: use the install icon in the address bar of Chrome or Edge (or the browser menu → “Install VaultManager”).';
  return panel('Install as an app & work offline',
    h('p', { class: 'hint', text: 'Installed, VaultManager opens like any other app — its own window, its own icon, no browser bars — and keeps working with no internet at all. Your vault is stored on this device either way.' }),
    ctx.isStandalone() ? h('div', { class: 'note', text: '✓ You are running the installed app.' }) : [ctx.installEvent ? h('button', { class: 'btn primary', on: { click: async () => { const ok = await ctx.installApp(); toast(ok ? 'Installing…' : 'Installation cancelled'); ctx.refresh(); } } }, '{{download}} Install VaultManager') : h('p', { class: 'hint', text: how })],
    canOfferCopy() ? h('div', { class: 'usb' }, h('h4', { text: 'Keep one file on a USB stick' }),
      h('p', { class: 'hint', text: 'One single file — ' + OFFLINE_NAME + ' (this is version ' + APP_VERSION + '; the version is part of the file name so you can tell copies apart) — that contains the whole app. Copy it to a USB stick, e-mail it to yourself or put it on any device; double-click it and it opens in the browser with no internet, no install and no server. (This is different from “installing” the app, which creates a browser app entry instead of a file.)' }),
      (() => { const note = h('p', { class: 'hint', 'aria-live': 'polite' }); return h('div', null, h('button', { class: 'btn primary', on: { click: async (e) => { e.target.disabled = true; try { const d = await saveOfflineCopy(); note.textContent = '✓ Saved. SHA-256 ' + d; } catch (x) { note.textContent = x.message; } e.target.disabled = false; } } }, '{{download}} Download ' + OFFLINE_NAME), note); })()) : null,
    status);
}

/* ======================= General ======================= */
function general(ctx) {
  const { store } = ctx, s = store.settings;
  const set = (k, v, label) => { s[k] = v; store.log('settings', `${label} changed to ${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`); persist(ctx); if (k === 'theme') ctx.applyTheme(); if (k === 'autolock' || k === 'lockOnHide') ctx.armAutolock(); };
  return h('div', null,
    panel('Locking & privacy',
      h('div', { class: 'grid2' },
        field('Auto-lock after inactivity', sel(s.autolock, [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never (not recommended)']], (v) => set('autolock', +v, 'Auto-lock'))),
        field('Clear clipboard after copying', sel(s.clipboard, [[15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [0, 'Never']], (v) => set('clipboard', +v, 'Clipboard clearing')))),
      chk('Lock immediately when this tab is hidden or the window is minimised', s.lockOnHide, (v) => set('lockOnHide', v, 'Lock on hide')),
      chk('Record copy / reveal / download events in the audit trail (never the values)', s.logReveal, (v) => set('logReveal', v, 'Access logging'))),
    panel('Trash',
      field('Delete trashed items permanently after', sel(s.trashDays, [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'Never (I will empty it myself)']], (v) => set('trashDays', +v, 'Trash retention')), 'Trashed items (and their attachments) are removed for good at your next unlock after this time.')),
    installPanel(ctx),
    panel('Backup & profile', h('p', { class: 'hint', text: 'Two places offer exports. This one is for the WHOLE PROFILE; Tools → Import & export also has the passwords-only database backup, sync files and CSV.' }),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', on: { click: () => ctx.exportProfile() } }, '{{download}} Export whole profile…'),
        h('button', { class: 'btn sm', on: { click: () => ctx.importProfile(async (p) => { toast('Imported “' + p.name + '”. Lock and pick it on the sign-in screen.'); }) } }, '{{importfile}} Import a profile…'),
        h('button', { class: 'btn sm', on: { click: () => ctx.switchProfile() } }, '{{contact}} Switch profile')),
      h('h4', { text: 'Which one do I need?' }), backupGuide({ compact: true }), h('button', { class: 'btn', on: { click: () => ctx.go('data') } }, '{{swap}} Open Tools → Import & export')),
    panel('Welcome & help',
      (() => {
        const nameBox = h('input', { class: 'inp', value: (ctx.profile() || {}).name || '', maxlength: '40', autocomplete: 'off', 'aria-label': 'Profile name', on: { change: (e) => { const v = e.target.value.trim(); if (v) { ctx.updateProfile({ name: v }); s.displayName = v; persist(ctx); picker.refresh(); } } } });
        const picker = avatarPicker((ctx.profile() || {}).avatar, () => nameBox.value.trim() || (ctx.profile() || {}).name || '', (a) => { ctx.updateProfile({ avatar: a }); store.log('settings', 'Profile picture changed (' + a.type + ')'); persist(ctx); toast('Profile picture saved'); });
        nameBox.addEventListener('input', () => picker.refresh());
        return h('div', null, field('Profile name', nameBox), field('Profile picture', picker.el, 'Shown on the sign-in screen and in the menu. Choose the first letter of your name, an emoji, or a photo (it is cropped to a small square and kept on this device, outside the encrypted vault).'));
      })(),
      chk('Show the welcome screen every time I unlock', s.welcomeAlways, (v) => set('welcomeAlways', v, 'Welcome screen')),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => ctx.tour.welcome() } }, '{{wave}} Welcome screen'), h('button', { class: 'btn', on: { click: () => ctx.tour.start() } }, '{{compass}} Guided tour'), h('button', { class: 'btn', on: { click: () => ctx.tour.help() } }, '{{help}} Help & shortcuts'))),
    panel('Look & feel', h('p', { class: 'hint', text: 'Theme, accent colour, wallpaper, icons, animations, dock and widgets have their own tabs.' }), h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => { ctx.S.setTab = 'appearance'; ctx.refresh(); } } }, '{{palette}} Appearance'), h('button', { class: 'btn', on: { click: () => { ctx.S.setTab = 'effects'; ctx.refresh(); } } }, '{{sparkles}} Effects'))),
    panel('Generator defaults',
      h('p', { class: 'hint', text: 'Length, character sets and passphrase options are remembered as you change them on the Generator page, and used by “Generate” in the item editor.' }),
      h('button', { class: 'btn', on: { click: () => ctx.go('gen') } }, '{{bolt}} Open the generator')),
    panel('Data', h('p', { class: 'hint', text: 'Import from other managers, encrypted backups and plaintext export are on their own page.' }), h('button', { class: 'btn', on: { click: () => ctx.go('data') } }, '{{swap}} Import & export')));
}

/* Contact admin: same relay as ulyOS (js/config.js). Only what you type is sent, and only after you press Send. */
function contactPanel(ctx) {
  if (!adminEnabled()) return panel('Contact admin', h('p', { class: 'hint', text: 'Not available in the offline copy, which never contacts anyone.' }));
  return panel('Contact admin',
    h('p', { class: 'hint', text: 'Send a message to the person who runs this site. Only what you type is sent, and only after you press Send. Never include passwords.' }),
    h('button', { class: 'btn primary', on: { click: () => ctx.contactAdmin() } }, '{{mailsend}} Write a message'));
}

/* ======================= Security ======================= */
function security(ctx) {
  const { store } = ctx, sess = store.session;
  const pw0 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'current-password', 'aria-label': 'Current master password' });
  const pw1 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', 'aria-label': 'New master password' });
  const pw2 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', 'aria-label': 'Repeat new master password' });
  const pwM = h('div'); pw1.addEventListener('input', () => clear(pwM).append(meter(pw1.value).el));
  const pwErr = h('p', { class: 'err', role: 'alert' });
  const recStatus = h('span', { class: 'chip ' + (sess.hasRecovery() ? 'accent' : 'warn'), text: sess.hasRecovery() ? '{{check}} recovery key set' : 'no recovery key' });
  return h('div', null,
    panel('What is protected',
      h('p', { class: 'hint', text: 'Everything you store is encrypted on this device with AES-256-GCM under a key only your master password (or passkey / recovery key) can open.' }),
      h('div', { class: 'protgrid' },
        h('div', { class: 'prot ok' }, h('b', { text: '✓ Encrypted' }), h('ul', null, ['Every item and field (passwords, cards, seed phrases, bank numbers…)', 'Notes, custom fields, tags, favourites', 'Attached files and pictures (each file separately)', 'Settings, look, audit trail, version history', 'Your GitHub sync token and passphrase', 'Items with a secondary passcode get a second layer'].map((t) => h('li', { text: t })))),
        h('div', { class: 'prot' }, h('b', { text: 'Visible on the sign-in screen' }), h('ul', null, ['Each profile’s name and picture (so you can choose who signs in)', 'Harmless appearance choices such as colours and wallpaper', 'A counter of failed unlock attempts']. map((t) => h('li', { text: t }))), h('p', { class: 'hint', text: 'So keep secrets out of profile names. That is the only rule.' }))),
      h('button', { class: 'btn', on: { click: () => { ctx.S.tmTab = 'sec'; ctx.go('tm'); } } }, '{{shieldlock}} Run the device & browser check')),
    panel('Master password',
      field('Current password', pw0), field('New password', h('div', null, h('div', { class: 'pwwrap' }, pw1), pwM), 'At least 12 characters. A passphrase of 5+ random words is ideal.'), field('Repeat new password', pw2),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: async (e) => {
        pwErr.textContent = '';
        if (pw1.value !== pw2.value) { pwErr.textContent = 'The new passwords do not match.'; return; }
        const pol = ctx.passwordPolicy(pw1.value); if (pol) { pwErr.textContent = pol; return; }
        e.target.disabled = true;
        try { await store.changePassword(pw0.value, pw1.value); pw0.value = pw1.value = pw2.value = ''; clear(pwM); toast('Master password changed'); } catch (x) { pwErr.textContent = x.message; }
        e.target.disabled = false;
      } } }, 'Change master password'), h('button', { class: 'btn', on: { click: () => { pw1.type = pw2.type = 'text'; pw1.value = pw2.value = generatePassphrase({ words: 6 }); pw1.dispatchEvent(new Event('input')); } } }, '{{bolt}} Suggest a passphrase')), pwErr),
    passkeys(ctx),
    panel('Key derivation',
      h('div', { class: 'kv' }, h('span', { text: 'Encryption' }), h('b', { text: 'AES-256-GCM, fresh 96-bit IV per write' }), h('span', { text: 'Key derivation' }), h('b', { text: `PBKDF2-HMAC-SHA256 · ${fmtInt(sess.iterations())} rounds` }), h('span', { text: 'Master key' }), h('b', { text: 'random 256-bit, stored only wrapped' })),
      field('Strength', sel(sess.iterations(), [[600000, '600,000 rounds (default)'], [1000000, '1,000,000 rounds'], [2000000, '2,000,000 rounds (slow on phones)'], [5000000, '5,000,000 rounds (very slow)']], async (v) => {
        const ok = await askPassword({ title: 'Change key-derivation strength', text: 'Enter your master password to re-wrap the vault key.', okLabel: 'Apply', verify: (p) => sess.verifyPassword(p) });
        if (!ok) { ctx.refresh(); return; }
        try { await sess.changePassword(ok, +v); store.log('security', 'Key derivation set to ' + fmtInt(+v) + ' rounds', 'warn'); await store.save(); toast('Key derivation updated'); } catch (e) { toast(e.message, 'err'); } ctx.refresh();
      }), 'Higher is slower to unlock but makes offline guessing of your master password slower, too.')),
    panel(null, h('h3', null, 'Recovery key ', recStatus),
      h('p', { class: 'hint', text: 'A 256-bit key that can unlock the vault if you forget your master password. Creating a new one invalidates the old one.' }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: async () => {
        const ok = await askPassword({ title: 'Create recovery key', text: 'Enter your master password to continue.', okLabel: 'Create', verify: (p) => sess.verifyPassword(p) });
        if (!ok) return; const key = await sess.createRecovery(); store.log('security', 'Recovery key created', 'warn'); await store.save(); ctx.showRecoveryKit(key); ctx.refresh();
      } } }, sess.hasRecovery() ? '⟳ Replace recovery key' : '{{plus}} Create recovery key'),
      sess.hasRecovery() ? h('button', { class: 'btn danger', on: { click: async () => { if (await confirmDialog({ title: 'Remove recovery key?', text: 'The printed key will stop working.', okLabel: 'Remove', danger: true })) { sess.removeRecovery(); store.log('security', 'Recovery key removed', 'warn'); await store.save(); toast('Recovery key removed'); ctx.refresh(); } } } }, 'Remove') : null)),
    panel('Danger zone', h('p', { class: 'hint', text: 'Erasing deletes the encrypted vault and all attachments from this device. Synced copies and backups are not touched.' }),
      h('button', { class: 'btn danger', on: { click: async () => {
        if (!(await confirmDialog({ title: 'Remove this profile?', text: 'This permanently deletes this profile’s encrypted vault from this device. Make sure you have a backup.', okLabel: 'Continue', danger: true }))) return;
        const ok = await askPassword({ title: 'Remove profile', text: 'Enter your master password to remove this profile.', okLabel: 'Remove forever', verify: (p) => sess.verifyPassword(p) });
        if (ok) { await ctx.removeProfile(ctx.S.profileId); ctx.lock(true); toast('Profile removed'); }
      } } }, '{{trash}} Remove this profile from this device…')));
}

function passkeys(ctx) {
  const { store } = ctx, sess = store.session, list = sess.passkeys();
  const label = h('input', { class: 'inp', value: guessDevice(), maxlength: '40', 'aria-label': 'Passkey name', autocomplete: 'off' });
  const err = h('p', { class: 'err', role: 'alert' });
  const verify = (p) => sess.verifyPassword(p);
  return panel(null, h('h3', null, 'Passkeys ', h('span', { class: 'chip ' + (list.length ? 'accent' : ''), text: list.length ? list.length + ' registered' : 'none' })),
    h('p', { class: 'hint', text: 'Unlock with your fingerprint, face, Windows Hello, a phone or a security key instead of typing the master password. The authenticator releases a 256-bit secret that wraps the vault key, so it cannot be guessed offline. Your master password always keeps working as the fallback.' }),
    !passkeySupported() ? h('p', { class: 'note warn', text: 'Passkeys are not available here. They need HTTPS (or localhost) and a recent browser: Chrome / Edge 116+, Safari 18+.' }) : null,
    list.map((w) => h('div', { class: 'hl' }, h('span', { class: 'ic', text: '{{login}}' }), h('div', { class: 't' }, h('b', { text: w.label }), h('small', { text: 'added ' + fmtDate(w.added) })),
      h('button', { class: 'btn sm danger', on: { click: async () => {
        const ok = await askPassword({ title: 'Remove passkey', text: 'Enter your master password to remove “' + w.label + '”.', okLabel: 'Remove', verify });
        if (!ok) return; sess.removePasskey(w.cred); store.log('security', 'Passkey removed: ' + w.label, 'warn'); await store.save(); toast('Passkey removed'); ctx.refresh();
      } } }, 'Remove'))),
    passkeySupported() ? [field('Name for the new passkey', label, 'Passkeys belong to this device and this web address only — add one on each device you use.'),
      h('button', { class: 'btn primary', on: { click: async (e) => {
        err.textContent = '';
        const ok = await askPassword({ title: 'Add a passkey', text: 'Enter your master password to authorise this.', okLabel: 'Continue', verify });
        if (!ok) return;
        e.target.disabled = true;
        try {
          const r = await passkeyEnroll(label.value.trim() || 'Passkey', sess.id);
          await sess.addPasskey(r.cred, r.salt, r.prf, label.value.trim() || 'Passkey'); wipe(r.prf);
          store.log('security', 'Passkey added: ' + (label.value.trim() || 'Passkey'), 'warn'); await store.save(); toast('Passkey added — you can now unlock with it'); ctx.refresh(); return;
        } catch (x) { err.textContent = x.message; }
        e.target.disabled = false;
      } } }, '{{plus}} Add a passkey'), err] : null);
}
function guessDevice() {
  const ua = navigator.userAgent || '';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'This device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return os + ' · ' + br;
}

/* ======================= Sync ======================= */
function sync(ctx) {
  const { store } = ctx, c = store.settings.sync;
  const status = h('div', { 'aria-live': 'polite' });
  const drawStatus = () => {
    clear(status).append(c.last ? h('div', { class: 'note' + (c.last.ok ? '' : ' danger') }, (c.last.ok ? '{{check}} Last sync ' : '{{close}} Last attempt ') + new Date(c.last.at).toLocaleString() + ' — ' + c.last.msg) : h('div', { class: 'note', text: 'Not synced yet.' }));
  };
  drawStatus();

  const pass = h('input', { class: 'inp mono', type: 'password', value: c.passphrase, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Sync passphrase' });
  const passErr = h('p', { class: 'err', role: 'alert' }), passM = h('div');
  const savePass = () => {
    passErr.textContent = '';
    const e = validateSyncPassphrase(pass.value, estimate); if (e) { passErr.textContent = e; return false; }
    c.passphrase = pass.value; store.log('sync', 'Sync passphrase set', 'warn'); persist(ctx); toast('Sync passphrase saved in your encrypted vault'); return true;
  };
  pass.addEventListener('input', () => clear(passM).append(meter(pass.value).el));
  const needPass = () => (c.passphrase ? true : (passErr.textContent = 'Save a sync passphrase first.', false));

  const fileIn = h('input', { type: 'file', accept: '.vmsync,.txt', class: 'offscreen', 'aria-label': 'Sync file', on: { change: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !needPass()) return;
    try { const r = await importSyncFile(store, (await readFileText(f)).trim(), c.passphrase); toast(`Merged: ${r.added} added, ${r.updated} updated, ${r.removed} removed`); ctx.refresh(); } catch (x) { fileErr.textContent = x.message; }
  } } });
  const fileErr = h('p', { class: 'err', role: 'alert' });

  const token = h('input', { class: 'inp mono', type: 'password', value: c.token, autocomplete: 'off', spellcheck: 'false', placeholder: 'ghp_… / github_pat_…', 'aria-label': 'GitHub token' });
  const gist = h('input', { class: 'inp mono', type: 'text', value: c.gistId, autocomplete: 'off', spellcheck: 'false', placeholder: 'Leave empty on the first device', 'aria-label': 'Gist ID' });
  const gErr = h('p', { class: 'err', role: 'alert' });
  const syncBtn = h('button', { class: 'btn primary', on: { click: async () => {
    gErr.textContent = ''; c.token = token.value.trim(); c.gistId = gist.value.trim();
    if (!c.token) { gErr.textContent = 'Paste a GitHub token with only the “gist” permission.'; return; }
    if (!needPass()) { gErr.textContent = 'Save a sync passphrase first.'; return; }
    syncBtn.disabled = true; syncBtn.textContent = 'Syncing…';
    const r = await ctx.syncNow(true);
    syncBtn.disabled = false; setLabel(syncBtn, '{{sync}} Sync now');
    if (!r.ok) gErr.textContent = r.error; else { gist.value = c.gistId; ctx.refresh(); }
    drawStatus();
  } } }, '{{sync}} Sync now');

  return h('div', null,
    panel('How sync works',
      h('p', { class: 'hint', text: 'Your items (and, if you choose, attachments) are packed into one bundle, encrypted on this device with a sync passphrase (PBKDF2-SHA256 600,000 rounds → AES-256-GCM) and only then leave it. Devices merge field by field: edits to different fields of one item are both kept; if the same field was edited on both, the newest wins and the other value is saved under “Needs review”. Deletions propagate. Nothing is readable without the passphrase — not by GitHub, not by anyone who finds the file.' }),
      h('p', { class: 'hint', text: 'The sync passphrase is separate from your master password, so each device can have its own master password. Both the passphrase and the token are kept only inside your encrypted vault and are never part of exports or bundles.' }), status),
    panel('1 · Sync passphrase',
      field('Passphrase (the same on every device)', h('div', null, h('div', { class: 'pwwrap' }, pass), passM)),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: savePass } }, 'Save passphrase'), h('button', { class: 'btn', on: { click: () => { pass.type = 'text'; pass.value = generatePassphrase({ words: 6 }); pass.dispatchEvent(new Event('input')); } } }, '{{bolt}} Suggest one'), h('button', { class: 'btn ghost', on: { click: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; } } }, '{{eye}} Show')), passErr,
      h('p', { class: 'note warn', text: 'Write this passphrase down. If you lose it, synced data cannot be decrypted (your local vault is not affected).' })),
    panel('2a · Sync file (works anywhere, no account)',
      h('p', { class: 'hint', text: 'Export a .vmsync file, carry it however you like (USB stick, AirDrop, cloud drive, email), and import it on the other device. Importing merges; it never wipes what is already there.' }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: async () => {
        fileErr.textContent = ''; if (!needPass()) return;
        try { download(`vaultmanager-${stamp()}.vmsync`, await exportSyncFile(store, c.passphrase), 'text/plain'); toast('Sync file saved'); } catch (x) { fileErr.textContent = x.message; }
      } } }, '{{download}} Export sync file'), h('button', { class: 'btn', on: { click: () => fileIn.click() } }, '{{upload}} Import sync file'), fileIn), fileErr),
    panel('2b · Beam — device to device, no cloud, no account',
      h('p', { class: 'hint', text: 'Pair your PC and phone directly (QR code or copy / paste, same Wi-Fi) and merge both vaults over an end-to-end encrypted connection. Nothing is uploaded anywhere. This is the ulyOS Beam engine, built into VaultManager.' }),
      h('button', { class: 'btn primary', on: { click: () => ctx.go('beam') } }, '{{beam}} Open Beam sync')),
    panel('2c · Automatic sync through a secret GitHub gist',
      h('ol', { class: 'steps' },
        h('li', { text: 'On GitHub: Settings → Developer settings → Personal access tokens → create a token that has only the “gist” permission.' }),
        h('li', { text: 'Paste it below with your sync passphrase and press Sync now. The first device creates a secret gist and shows its ID.' }),
        h('li', { text: 'On your other devices: enter the same token (or another with gist access), the same passphrase and the gist ID, then Sync now.' })),
      field('GitHub token', h('div', { class: 'pwwrap' }, token), 'Sent only to api.github.com, over HTTPS. Stored only in your encrypted vault.'),
      field('Gist ID', gist, 'Created automatically on the first sync. Copy it to your other devices.'),
      chk('Sync automatically (when unlocking, every 10 minutes, and shortly after changes)', c.auto, (v) => { c.auto = v; store.log('settings', 'Automatic sync ' + (v ? 'on' : 'off')); persist(ctx); ctx.armSync(); }),
      chk('Include attachments (up to 20 MB in total)', c.attachments, (v) => { c.attachments = v; store.log('settings', 'Sync of attachments ' + (v ? 'on' : 'off')); persist(ctx); }),
      h('div', { class: 'row wrap' }, syncBtn, h('button', { class: 'btn danger', on: { click: async () => { if (await confirmDialog({ title: 'Disconnect gist sync?', text: 'Forgets the token and gist ID on this device. The gist itself stays on GitHub; delete it there if you no longer need it.', okLabel: 'Disconnect', danger: true })) { c.token = ''; c.gistId = ''; c.last = null; store.log('sync', 'Gist sync disconnected', 'warn'); await store.save(); ctx.armSync(); ctx.refresh(); } } } }, 'Disconnect')), gErr,
      h('p', { class: 'note', text: 'What GitHub can see: that you have a secret gist, its size, and when it changes (and your IP address). It cannot read the content. Same-field edits on two devices are never silently lost: the other value stays under “Needs review” and in the version history of the item.' })));
}

/* ======================= Audit trail ======================= */
function audit(ctx) {
  const { store } = ctx;
  let kind = 'all', q = '', warnOnly = false;
  const list = h('div');
  const KINDS = [['all', 'All events'], ['security', 'Security'], ['item', 'Items'], ['access', 'Copy / reveal'], ['data', 'Import / export'], ['sync', 'Sync'], ['settings', 'Settings']];
  const draw = () => {
    const all = store.auditLog();
    const rows = all.filter((e) => (kind === 'all' || e.k === kind) && (!warnOnly || e.l === 'warn') && (!q || e.m.toLowerCase().includes(q)));
    clear(list).append(h('p', { class: 'hint', text: `${rows.length} of ${all.length} event${all.length === 1 ? '' : 's'} (newest first; the last 1,000 are kept)` }),
      rows.slice(0, 300).map((e) => h('div', { class: 'hl' }, h('span', { class: 'chip ' + (e.l === 'warn' ? 'warn' : ''), text: e.k }), h('div', { class: 't' }, h('b', { text: e.m }), h('small', { class: 'mono', text: new Date(e.t).toLocaleString() })))),
      rows.length > 300 ? h('p', { class: 'hint', text: 'Showing the newest 300. Use the filters or export for the rest.' }) : null);
  };
  draw();
  return h('div', null,
    panel('Audit trail', h('p', { class: 'hint', text: 'A log of security-relevant events: sign-ins and failed attempts, item changes, copy / reveal / download, exports and imports, sync and settings changes. It is stored inside the encrypted vault, so it is unreadable without your master password. It never contains passwords or other secret values — only names and what happened. Anyone who knows your master password can clear it.' }),
      h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, sel('all', KINDS, (v) => { kind = v; draw(); })),
        h('div', { class: 'grow' }, h('input', { class: 'inp', type: 'search', placeholder: 'Filter text…', 'aria-label': 'Filter audit trail', on: { input: (e) => { q = e.target.value.toLowerCase(); draw(); } } }))),
      chk('Warnings only', false, (v) => { warnOnly = v; draw(); }), list,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => { download(`vaultmanager-audit-${stamp()}.json`, JSON.stringify(store.auditLog().map((e) => ({ time: new Date(e.t).toISOString(), kind: e.k, level: e.l, event: e.m })), null, 2), 'application/json'); store.log('data', 'Exported the audit trail'); } } }, '{{download}} Export log'),
        h('button', { class: 'btn danger', on: { click: async () => { if (await confirmDialog({ title: 'Clear the audit trail?', text: 'All recorded events will be deleted. A single entry noting the clearing is kept.', okLabel: 'Clear', danger: true })) { await store.clearAudit(); ctx.refresh(); } } } }, 'Clear log'))));
}

/* ======================= About / versioning ======================= */
function about(ctx) {
  const { store } = ctx;
  const storage = h('div', { class: 'kv' });
  (async () => {
    const st = await store.attachmentStats();
    let vaultBytes = 0; try { vaultBytes = (localStorage.getItem(KEY) || '').length; } catch { /* ignore */ }
    let quota = null, persisted = null;
    try { if (navigator.storage && navigator.storage.estimate) quota = await navigator.storage.estimate(); if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
    clear(storage).append(h('span', { text: 'Items' }), h('b', { text: `${store.active().length} active · ${store.trashed().length} in trash` }), h('span', { text: 'Vault record' }), h('b', { text: fmtSize(vaultBytes) }),
      h('span', { text: 'Attachments' }), h('b', { text: `${st.count} file${st.count === 1 ? '' : 's'} · ${fmtSize(st.bytes)} (stored in ${store.blobs.kind})` }),
      quota ? [h('span', { text: 'Browser storage' }), h('b', { text: `${fmtSize(quota.usage || 0)} used of ~${fmtSize(quota.quota || 0)}` })] : null,
      persisted !== null ? [h('span', { text: 'Eviction protection' }), h('b', { text: persisted ? 'granted — the browser will not clear this data automatically' : 'not granted — the browser may clear data if the disk is full (keep an exported profile as a backup)' })] : null);
  })();
  const sess = store.session;
  return h('div', null,
    panel(null, h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: '44', height: '44' }), h('div', null, h('h1', null, 'Vault', h('span', { text: 'Manager' })), h('p', { text: `Version ${APP_VERSION} · zero-knowledge · end-to-end encrypted · offline-first` }))),
      h('p', { class: 'hint', text: 'A password manager that runs entirely in your browser. No account, no server, no analytics. Built on the same core engine as ulyOS. Not independently audited — keep an encrypted backup.' }),
      h('div', { class: 'row wrap' }, h('a', { class: 'btn', href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, '⌥ Source code'), h('a', { class: 'btn', href: REPO_URL + '/blob/main/SECURITY.md', target: '_blank', rel: 'noopener noreferrer' }, '{{shield}} Security & threat model'),
        h('button', { class: 'btn', on: { click: () => ctx.tour.start() } }, '{{compass}} Guided tour'), h('button', { class: 'btn', on: { click: () => ctx.tour.welcome() } }, '{{wave}} Welcome screen'),
        h('button', { class: 'btn', on: { click: () => selfTest() } }, '{{check}} Run crypto self-test'))),
    panel('Version history', CHANGELOG.map((r, i) => h('div', { class: 'rel' }, h('div', { class: 'row wrap' }, h('b', { class: 'mono', text: 'v' + r.v }), h('span', { class: 'chip' + (i === 0 ? ' accent' : ''), text: i === 0 ? 'current' : r.date }), i === 0 ? h('span', { class: 'hint', text: r.date }) : null), h('ul', null, r.notes.map((n) => h('li', { text: n })))))),
    contactPanel(ctx),
    panel('Data formats', h('div', { class: 'kv' }, FORMATS.map(([k, v]) => [h('span', { text: k }), h('b', { text: v })]))),
    panel('This device', h('div', { class: 'kv' }, h('span', { text: 'Running as' }), h('b', { text: window.__TAURI__ ? 'Native app (Tauri)' : location.protocol === 'file:' ? 'Single-file offline copy v' + APP_VERSION : ctx.isStandalone() ? 'Installed web app (offline-capable)' : 'Web page in a browser' }), h('span', { text: 'Vault ID' }), h('b', { text: sess.id }), h('span', { text: 'Created' }), h('b', { text: fmtDate(store.data.created) }), h('span', { text: 'Key derivation' }), h('b', { text: fmtInt(sess.iterations()) + ' PBKDF2 rounds' }), h('span', { text: 'Recovery key' }), h('b', { text: sess.hasRecovery() ? 'set' : 'not set' }), h('span', { text: 'Sync' }), h('b', { text: store.settings.sync.token ? 'gist sync configured' + (store.settings.sync.last ? ' · last ' + new Date(store.settings.sync.last.at).toLocaleString() : '') : 'file only / off' })), storage,
      h('div', { class: 'row wrap' }, navigator.storage && navigator.storage.persist ? h('button', { class: 'btn', on: { click: async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Storage protected from automatic eviction' : 'The browser declined (installing the app or bookmarking often helps)'); ctx.refresh(); } } }, '{{shield}} Protect storage from eviction') : null,
        h('button', { class: 'btn', title: 'Re-download the app files and reload', on: { click: async () => { try { if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ } location.reload(); } } }, '⟳ Refresh app files'))),
    panel('Third-party code & licences', h('div', { class: 'kv' }, h('span', { text: 'qrcode-generator' }), h('b', { text: '2.0.4 · MIT · Kazuhiko Arase' }), h('span', { text: 'jsQR' }), h('b', { text: '1.4.0 · Apache-2.0 · Cosmo Wolfe' }), h('span', { text: 'EFF short wordlist' }), h('b', { text: 'CC BY 3.0 US · Electronic Frontier Foundation' }), h('span', { text: 'Cryptography' }), h('b', { text: 'browser WebCrypto only — no bundled crypto library' })),
      h('p', { class: 'hint', text: `${APP_NAME} contacts no server except api.github.com, and only when you turn on gist sync.` })));
}
