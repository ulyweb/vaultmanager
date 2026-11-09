/* Profile pictures, and the export / import dialogs for whole-profile backups (the entire database:
   items, attachments, settings, audit trail — encrypted with a backup password). */

import { h, clear, modal, toast, readFileText, download } from './dom.js';
import { decryptProfile } from './vault.js';
import { createProfileFromImport, sanitizeAvatar } from './profiles.js';
import { meter } from './views.js';
import { generatePassphrase } from './generator.js';
import { fmtDate, fmtInt } from './util.js';

const hue = (s) => { let x = 0; for (const c of String(s || '?')) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 360; };

/* A round picture: photo, emoji, or the first letter on a colour. */
export function profileAvatar(p, size = 56) {
  const a = sanitizeAvatar(p && p.avatar), el = h('div', { class: 'pav', 'aria-hidden': 'true' });
  el.style.width = el.style.height = size + 'px'; el.style.fontSize = Math.round(size * (a.type === 'emoji' ? 0.55 : 0.42)) + 'px';
  if (a.type === 'photo') { const img = h('img', { alt: '', src: a.value }); el.append(img); }
  else if (a.type === 'emoji') el.append(a.value);
  else { el.append(Array.from(String((p && p.name) || '?').trim() || '?')[0].toUpperCase()); el.style.background = `linear-gradient(145deg, hsl(${hue(p && p.name)} 62% 46%), hsl(${(hue(p && p.name) + 40) % 360} 62% 34%))`; }
  return el;
}

const EMOJIS = ['😀', '😎', '🤓', '🦊', '🐼', '🐱', '🐶', '🦉', '🐙', '🦄', '🌻', '🌊', '🔥', '⚡', '🚀', '🎧', '🎮', '🍀', '🍕', '☕', '🏔️', '🌙', '⭐', '🛡️'];

/* Centre-crop to a 192 px square JPEG (kept small: it is stored outside the vault, the sign-in screen shows it). */
export async function cropPhoto(file) {
  const bmp = await createImageBitmap(file);
  try {
    const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas'); c.width = c.height = 192;
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 192, 192);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { if (bmp.close) bmp.close(); }
}

/* get() → a sanitised avatar. nameOf() supplies the name for the letter preview. */
export function avatarPicker(initial, nameOf = () => '') {
  let state = sanitizeAvatar(initial);
  const prev = h('div', { class: 'avprev' }), grid = h('div', { class: 'emojigrid', hidden: true }), err = h('p', { class: 'err photo-err', role: 'alert' });
  const draw = () => clear(prev).append(profileAvatar({ name: nameOf(), avatar: state }, 72));
  const set = (a) => { state = sanitizeAvatar(a); draw(); };
  for (const e of EMOJIS) grid.append(h('button', { type: 'button', class: 'emo', 'aria-label': 'Emoji ' + e, on: { click: () => { set({ type: 'emoji', value: e }); grid.hidden = true; } } }, e));
  const file = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'Profile photo', on: { change: async (ev) => {
    err.textContent = ''; const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try { set({ type: 'photo', value: await cropPhoto(f) }); } catch { err.textContent = 'Could not read that picture.'; }
  } } });
  draw();
  const el = h('div', { class: 'avpick' }, prev, h('div', null, h('div', { class: 'row wrap' },
    h('button', { type: 'button', class: 'btn sm', on: { click: () => set({ type: 'letter' }) } }, 'Letter'),
    h('button', { type: 'button', class: 'btn sm', on: { click: () => { grid.hidden = !grid.hidden; } } }, 'Emoji'),
    h('button', { type: 'button', class: 'btn sm', on: { click: () => file.click() } }, '{{camera}} Photo…'), file), grid, err));
  return { el, get: () => state, refresh: draw };
}

const slug = (s) => String(s || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'profile';

/* ---------- export the whole profile ---------- */
export function exportProfileDialog(ctx) {
  const { store } = ctx, prof = ctx.profile();
  const pw = h('input', { class: 'inp mono', type: 'text', value: generatePassphrase({ words: 6 }), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Backup password' });
  const att = h('input', { type: 'checkbox', checked: true }), err = h('p', { class: 'err', role: 'alert' });
  (async () => { const st = await store.attachmentStats(); note.textContent = `${store.items.length} item${store.items.length === 1 ? '' : 's'} · ${st.count} attachment${st.count === 1 ? '' : 's'} (${(st.bytes / 1048576).toFixed(1)} MB)`; })();
  const note = h('p', { class: 'hint' });
  const m = modal({ title: 'Export this profile', sub: prof ? prof.name : '', wide: false,
    body: h('div', null,
      h('p', { class: 'hint', text: 'One encrypted file with your whole profile: every item (including the trash and version history), all attachments, your settings and look, and the audit trail. Import it on any device, from the first screen, to get everything back.' }), note,
      h('div', { class: 'field' }, h('label', { text: 'Backup password' }), h('div', { class: 'row' }, h('div', { class: 'grow' }, pw), h('button', { class: 'btn sm', type: 'button', title: 'Generate a passphrase', on: { click: () => { pw.value = generatePassphrase({ words: 6 }); } } }, '{{bolt}}')), h('p', { class: 'hint', text: 'You need this password to import the file. It is not stored anywhere — write it down.' })),
      h('label', { class: 'chk' }, att, 'Include attachments (pictures and documents)'),
      h('p', { class: 'note', text: 'Not included, on purpose: your GitHub token and sync passphrase (set sync up again on the new device) and passkeys (they belong to one device).' }), err),
    actions: [{ label: 'Cancel' }, { label: 'Download backup', kind: 'primary', close: false, onClick: async (e) => {
      err.textContent = '';
      if (pw.value.length < 10) { err.textContent = 'Use at least 10 characters for the backup password.'; return false; }
      e.target.disabled = true;
      try { const text = await store.exportProfile(pw.value, { profile: { name: prof && prof.name, avatar: prof && prof.avatar && prof.avatar.type === 'photo' ? null : prof && prof.avatar }, attachments: att.checked }); download(`vaultmanager-profile-${slug(prof && prof.name)}-${fmtDate(Date.now())}.vmprofile`, text, 'text/plain'); toast('Profile backup saved — keep the password safe!', 'ok', 6000); m.close(); }
      catch (x) { err.textContent = x.message; e.target.disabled = false; }
      return false;
    } }] });
}

/* ---------- import a backup as a NEW profile (also used on the very first screen) ---------- */
export function importProfileDialog(ctx, { onDone } = {}) {
  let text = '', data = null;
  const file = h('input', { type: 'file', accept: '.vmprofile,.vmvault,.txt', class: 'offscreen', 'aria-label': 'Backup file', on: { change: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { text = (await readFileText(f)).trim(); fname.textContent = f.name; } } } });
  const fname = h('span', { class: 'hint', text: 'No file chosen' });
  const paste = h('textarea', { class: 'ta', rows: '2', placeholder: 'Or paste the backup text here (starts with VMP1: or VMX1:)', 'aria-label': 'Backup text', spellcheck: 'false' });
  const bpw = h('input', { class: 'inp mono', type: 'password', autocomplete: 'off', 'aria-label': 'Backup password' });
  const err1 = h('p', { class: 'err', role: 'alert' }), step1 = h('div'), step2 = h('div', { hidden: true });
  const openBtn = h('button', { class: 'btn primary', type: 'button' }, 'Open backup');
  step1.append(h('p', { class: 'hint', text: 'Bring a profile back from an encrypted backup (.vmprofile from “Export profile”, or a .vmvault backup). The whole database — items, attachments, settings — is restored into a new profile with a master password you choose now.' }),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', on: { click: () => file.click() } }, '{{folder}} Choose backup file'), file, fname), paste,
    h('div', { class: 'field' }, h('label', { text: 'Backup password' }), bpw), err1, h('div', { class: 'row' }, openBtn));

  const name = h('input', { class: 'inp', maxlength: '40', 'aria-label': 'Profile name', autocomplete: 'off' });
  const p1 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', 'aria-label': 'New master password' }), p2 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', 'aria-label': 'Repeat new master password' });
  const meterBox = h('div'), ack = h('input', { type: 'checkbox' }), err2 = h('p', { class: 'err', role: 'alert' }), summary = h('div', { class: 'kv' });
  p1.addEventListener('input', () => clear(meterBox).append(meter(p1.value).el));
  let picker = avatarPicker(null, () => name.value);
  name.addEventListener('input', () => picker.refresh());
  const createBtn = h('button', { class: 'btn primary', type: 'button' }, 'Create profile');
  step2.append(summary, h('div', { class: 'field' }, h('label', { text: 'Profile name' }), name), picker.el,
    h('div', { class: 'field' }, h('label', { text: 'New master password for this profile' }), p1, meterBox, h('p', { class: 'hint', text: '12+ characters. It can be different from the one the backup came from.' })),
    h('div', { class: 'field' }, h('label', { text: 'Repeat master password' }), p2),
    h('button', { class: 'btn sm', type: 'button', on: { click: () => { const pw = generatePassphrase({ words: 6 }); p1.value = p2.value = pw; p1.type = p2.type = 'text'; p1.dispatchEvent(new Event('input')); } } }, '{{bolt}} Suggest a passphrase'),
    h('label', { class: 'chk' }, ack, 'I understand that if I forget this master password, nobody can recover this profile.'), err2, h('div', { class: 'row' }, createBtn));

  const m = modal({ title: 'Import a profile', sub: 'Restore everything from an encrypted backup', wide: false, body: h('div', null, step1, step2), actions: [{ label: 'Cancel' }] });

  openBtn.addEventListener('click', async () => {
    err1.textContent = ''; const t = (text || paste.value).trim();
    if (!t) { err1.textContent = 'Choose a backup file or paste its text.'; return; }
    if (!bpw.value) { err1.textContent = 'Enter the backup password.'; return; }
    openBtn.disabled = true; openBtn.textContent = 'Deriving the key…';
    try {
      data = await decryptProfile(t, bpw.value);
      const atts = Object.keys(data.attachments || {}).length;
      clear(summary).append(h('span', { text: 'Backup type' }), h('b', { text: data.kind === 'profile' ? 'Whole profile (VMP1)' : 'Items only (VMX1)' }), h('span', { text: 'Items' }), h('b', { text: fmtInt(data.items.length) }), h('span', { text: 'Attachments' }), h('b', { text: fmtInt(atts) }),
        data.exported ? [h('span', { text: 'Exported' }), h('b', { text: fmtDate(data.exported) })] : null, data.kind === 'profile' ? [h('span', { text: 'Includes' }), h('b', { text: 'settings & look · audit trail · version history' })] : null);
      name.value = data.name || 'Imported profile'; picker = replacePicker(picker, data.avatar, () => name.value);
      step1.hidden = true; step2.hidden = false; setTimeout(() => p1.focus(), 30);
    } catch (e) { err1.textContent = e.message; }
    openBtn.disabled = false; openBtn.textContent = 'Open backup';
  });
  const replacePicker = (old, avatar, nameOf) => { const np = avatarPicker(avatar, nameOf); old.el.replaceWith(np.el); return np; };

  createBtn.addEventListener('click', async () => {
    err2.textContent = '';
    if (!name.value.trim()) { err2.textContent = 'Give the profile a name.'; return; }
    if (p1.value !== p2.value) { err2.textContent = 'The two passwords do not match.'; return; }
    const pol = ctx.passwordPolicy(p1.value); if (pol) { err2.textContent = pol; return; }
    if (!ack.checked) { err2.textContent = 'Please confirm that you understand there is no password recovery.'; return; }
    createBtn.disabled = true; createBtn.textContent = 'Restoring everything…';
    try {
      const r = await createProfileFromImport(ctx.env, data, { name: name.value.trim(), avatar: picker.get(), masterPassword: p1.value });
      const pw = p1.value; p1.value = p2.value = bpw.value = ''; m.close();
      toast(`Profile “${r.profile.name}” restored: ${r.items} item${r.items === 1 ? '' : 's'}, ${r.attachments} attachment${r.attachments === 1 ? '' : 's'}`, 'ok', 6000);
      if (onDone) await onDone(r.profile, pw);
    } catch (e) { err2.textContent = e.message; createBtn.disabled = false; createBtn.textContent = 'Create profile'; }
  });
  return m;
}
