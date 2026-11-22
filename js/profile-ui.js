/* Profile pictures, and the export / import dialogs for whole-profile backups (the entire database:
   items, attachments, settings, audit trail — encrypted with a backup password). */

import { h, clear, focusSoon, modal, toast, readFileText, download, setLabel } from './dom.js';
import { decryptProfile } from './vault.js';
import { decodeFile, startScanner, ChunkAssembler, parseChunk } from './qr.js';
import { createProfileFromImport, sanitizeAvatar } from './profiles.js';
import { meter, passwordRow } from './views.js';
import { generateStrongPassphrase } from './generator.js';
import { fmtDate, fmtInt, stamp } from './util.js';

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
export function avatarPicker(initial, nameOf = () => '', onChange = null) {
  let state = sanitizeAvatar(initial);
  const prev = h('div', { class: 'avprev' }), grid = h('div', { class: 'emojigrid', hidden: true }), err = h('p', { class: 'err photo-err', role: 'alert' });
  const kinds = {}, mark = () => { for (const [k, b] of Object.entries(kinds)) { b.setAttribute('aria-pressed', String(state.type === k)); b.classList.toggle('on', state.type === k); } };
  const draw = () => { clear(prev).append(profileAvatar({ name: nameOf(), avatar: state }, 72)); mark(); };
  const pop = () => { prev.classList.remove('pop'); void prev.offsetWidth; prev.classList.add('pop'); };   // a little bounce whenever the picture changes
  const set = (a) => { state = sanitizeAvatar(a); draw(); pop(); if (onChange) onChange(state); };
  EMOJIS.forEach((e, i) => { const b = h('button', { type: 'button', class: 'emo', 'aria-label': 'Emoji ' + e, on: { click: () => { set({ type: 'emoji', value: e }); grid.hidden = true; } } }, e); b.style.setProperty('--i', String(i)); grid.append(b); });
  const file = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'Profile photo', on: { change: async (ev) => {
    err.textContent = ''; const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try { set({ type: 'photo', value: await cropPhoto(f) }); } catch { err.textContent = 'Could not read that picture.'; }
  } } });
  draw();
  const el = h('div', { class: 'avpick' }, prev, h('div', null, h('div', { class: 'row wrap' },
    kinds.letter = h('button', { type: 'button', class: 'btn sm avbtn', 'aria-pressed': 'false', on: { click: () => { grid.hidden = true; set({ type: 'letter' }); } } }, '{{letter}} Letter'),
    kinds.emoji = h('button', { type: 'button', class: 'btn sm avbtn', 'aria-pressed': 'false', on: { click: () => { grid.hidden = !grid.hidden; } } }, '{{smile}} Emoji'),
    kinds.photo = h('button', { type: 'button', class: 'btn sm avbtn', 'aria-pressed': 'false', on: { click: () => file.click() } }, '{{camera}} Photo…'), file), grid, err));
  draw();
  return { el, get: () => state, refresh: () => { clear(prev).append(profileAvatar({ name: nameOf(), avatar: state }, 72)); } };
}

const slug = (s) => String(s || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'profile';

/* ---------- export the whole profile ---------- */
export function exportProfileDialog(ctx) {
  const { store } = ctx, prof = ctx.profile();
  const pw = h('input', { class: 'inp mono', type: 'password', value: '', autocomplete: 'new-password', spellcheck: 'false', 'aria-label': 'Backup password' });
  const pwRow = passwordRow('Backup password', pw);
  const att = h('input', { type: 'checkbox', checked: true }), err = h('p', { class: 'err', role: 'alert' });
  (async () => { const st = await store.attachmentStats(); note.textContent = `${store.items.length} item${store.items.length === 1 ? '' : 's'} · ${st.count} attachment${st.count === 1 ? '' : 's'} (${(st.bytes / 1048576).toFixed(1)} MB)`; })();
  const note = h('p', { class: 'hint' });
  const m = modal({ title: 'Export this profile', sub: prof ? prof.name : '', wide: false,
    body: h('div', null,
      h('p', { class: 'hint', text: 'One encrypted file with your whole profile: every item (including the trash and version history), all attachments, your settings and look, and the audit trail. Import it on any device, from the first screen, to get everything back.' }), note,
      pwRow, h('p', { class: 'hint', text: 'Type your own password (twice) or press the lightning button to generate one. You need it to import the file; it is not stored anywhere — write it down.' }),
      h('label', { class: 'chk' }, att, 'Include attachments (pictures and documents)'),
      h('p', { class: 'note', text: 'Not included, on purpose: your GitHub token and sync passphrase (set sync up again on the new device) and passkeys (they belong to one device).' }), err),
    actions: [{ label: 'Cancel' }, { label: 'Download backup', kind: 'primary', close: false, onClick: async (e) => {
      err.textContent = '';
      if (!pwRow.match()) { err.textContent = 'The two backup passwords do not match.'; return false; }
      if (pw.value.length < 10) { err.textContent = 'Use at least 10 characters for the backup password.'; return false; }
      e.target.disabled = true;
      try { const text = await store.exportProfile(pw.value, { profile: { name: prof && prof.name, avatar: prof && prof.avatar }, attachments: att.checked }); download(`vaultmanager-profile-${slug(prof && prof.name)}-${stamp()}.vmprofile`, text, 'text/plain'); toast('Profile backup saved — keep the password safe!', 'ok', 6000); m.close(); }
      catch (x) { err.textContent = x.message; e.target.disabled = false; }
      return false;
    } }] });
}

/* ---------- import a backup as a NEW profile (also used on the very first screen) ---------- */
export function importProfileDialog(ctx, { onDone } = {}) {
  let text = '', data = null;
  const file = h('input', { type: 'file', accept: '.vmprofile,.vmvault,.txt', class: 'offscreen', 'aria-label': 'Backup file', on: { change: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { resetQR(); text = (await readFileText(f)).trim(); fname.textContent = f.name; } } } });

  /* QR backup (Tools → QR tools → Backup to QR): scan its codes in any order with the camera, or choose photos / screenshots of them.
     The codes only rebuild the encrypted backup text; opening it still needs the backup password, exactly like a file. Decoded on this device. */
  let asm = new ChunkAssembler(), stopCam = null;
  const qrStatus = h('p', { class: 'hint', role: 'status' }), qrBar = h('div', { class: 'progress', hidden: true }, h('i'));
  const video = h('video', { muted: true, playsinline: true, 'aria-label': 'Camera preview for the QR backup' }), camBox = h('div', { class: 'scanner', hidden: true }, video);
  const stopScan = () => { if (stopCam) { stopCam(); stopCam = null; } camBox.hidden = true; setLabel(camBtn, '{{camera}} Scan QR backup'); };
  const resetQR = () => { stopScan(); asm = new ChunkAssembler(); qrStatus.textContent = ''; qrBar.hidden = true; restartBtn.hidden = true; };
  const onQR = (t) => {
    err1.textContent = '';
    if (parseChunk(t)) {
      const r = asm.add(t); restartBtn.hidden = false;
      if (r.status === 'other-set') { qrStatus.textContent = `That code belongs to a different QR backup. Keep scanning the same set (${r.have} of ${r.count} so far), or press Start over if the first code was the wrong one.`; return; }
      qrBar.hidden = false; qrBar.firstChild.style.width = (r.have / r.count * 100) + '%';
      if (r.done) {
        text = asm.payload(); paste.value = ''; fname.textContent = `QR backup: all ${r.count} code${r.count === 1 ? '' : 's'} scanned`; stopScan();
        qrStatus.textContent = `✓ All ${r.count} code${r.count === 1 ? '' : 's'} scanned. Enter the backup password and press Open backup.`; bpw.focus();
      } else { const miss = asm.missing(); qrStatus.textContent = `Scanned ${r.have} of ${r.count} codes. Still missing: ${miss.slice(0, 12).join(', ')}${miss.length > 12 ? '…' : ''}.`; }
    } else if (/^VM[PX]1:/.test(String(t).trim())) { resetQR(); text = String(t).trim(); fname.textContent = 'QR backup: 1 code scanned'; qrStatus.textContent = '✓ Backup read from the QR code. Enter the backup password and press Open backup.'; bpw.focus(); }
    else qrStatus.textContent = 'That QR code is not part of a VaultManager backup. Use the codes made with QR tools → Backup to QR. (A single sealed item opens inside a vault: QR tools → Open QR.)';
  };
  const camBtn = h('button', { class: 'btn', type: 'button', on: { click: async () => {
    err1.textContent = '';
    if (stopCam) { stopScan(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { err1.textContent = 'Camera access is unavailable here (it needs https:// or localhost). Choose photos or screenshots of the codes instead.'; return; }
    try { camBox.hidden = false; setLabel(camBtn, '{{close}} Stop camera'); stopCam = await startScanner(video, onQR); qrStatus.textContent = 'Point the camera at each code of the QR backup, in any order.'; }
    catch (e) { stopScan(); err1.textContent = 'Could not start the camera: ' + (e.message || e.name); }
  } } }, '{{camera}} Scan QR backup');
  /* the first code decides which backup is being collected: a stray code from an older backup must not lock the dialog */
  const restartBtn = h('button', { class: 'btn sm', type: 'button', hidden: true, on: { click: () => { resetQR(); text = ''; fname.textContent = 'No file chosen'; qrStatus.textContent = 'Cleared. Scan the codes of one QR backup.'; } } }, '{{refresh}} Start over');
  const qrFiles = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'offscreen', 'aria-label': 'QR backup images', on: { change: async (e) => {
    err1.textContent = ''; const list = Array.from(e.target.files || []); e.target.value = '';
    for (const f of list) { try { const t = await decodeFile(f); if (t) onQR(t); else qrStatus.textContent = 'No QR code found in ' + (f.name || 'an image') + '.'; } catch (x) { qrStatus.textContent = 'Could not read ' + (f.name || 'an image') + ': ' + x.message; } }
  } } });
  const fname = h('span', { class: 'hint', text: 'No file chosen' });
  const paste = h('textarea', { class: 'ta', rows: '2', placeholder: 'Or paste the backup text here (starts with VMP1: or VMX1:)', 'aria-label': 'Backup text', spellcheck: 'false' });
  const bpw = h('input', { class: 'inp mono', type: 'password', autocomplete: 'off', 'aria-label': 'Backup password' });
  const err1 = h('p', { class: 'err', role: 'alert' }), step1 = h('div'), step2 = h('div', { class: 'impcenter', hidden: true });
  const openBtn = h('button', { class: 'btn primary', type: 'button' }, 'Open backup');
  step1.append(h('p', { class: 'hint', text: 'Bring a profile back from an encrypted backup (.vmprofile from “Export profile”, or a .vmvault backup). The whole database — items, attachments, settings — is restored into a new profile with a master password you choose now.' }),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', on: { click: () => file.click() } }, '{{folder}} Choose backup file'), file, fname), paste,
    h('div', { class: 'qrimport' }, h('p', { class: 'lbl', text: 'Or from a QR backup' }),
      h('div', { class: 'row wrap' }, camBtn, h('button', { class: 'btn', type: 'button', on: { click: () => qrFiles.click() } }, '{{photoid}} QR images / screenshots'), qrFiles, restartBtn),
      camBox, qrBar, qrStatus,
      h('p', { class: 'hint', text: 'A QR backup (QR tools → Backup to QR) holds every item, but not attached files or photos, settings or the look. For everything, use a .vmprofile file.' })),
    h('div', { class: 'field' }, h('label', { text: 'Backup password' }), bpw), err1, h('div', { class: 'row' }, openBtn));

  const name = h('input', { class: 'inp', maxlength: '40', 'aria-label': 'Profile name', autocomplete: 'off' });
  const p1 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', 'aria-label': 'New master password' }), p2 = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', 'aria-label': 'Repeat new master password' });
  const meterBox = h('div'), ack = h('input', { type: 'checkbox' }), err2 = h('p', { class: 'err', role: 'alert' }), summary = h('div', { class: 'kv' });
  p1.addEventListener('input', () => clear(meterBox).append(meter(p1.value).el));
  let picker = avatarPicker(null, () => name.value);
  name.addEventListener('input', () => picker.refresh());
  const createBtn = h('button', { class: 'btn primary', type: 'button' }, 'Create profile');
  /* optional: reuse the backup password (just typed in step 1) as this profile's master password — the backup file never contains the master password itself */
  const same = h('input', { type: 'checkbox', id: 'f_samepw' });
  const own = h('div', { class: 'own' },
    h('div', { class: 'field' }, h('label', { text: 'New master password for this profile' }), p1, meterBox, h('p', { class: 'hint', text: '12+ characters. It can be different from the one the backup came from.' })),
    h('div', { class: 'field' }, h('label', { text: 'Repeat master password' }), p2),
    h('button', { class: 'btn sm', type: 'button', title: 'Ten random words: about 103 bits of entropy', on: { click: () => { const pw = generateStrongPassphrase(); p1.value = p2.value = pw; p1.type = p2.type = 'text'; p1.dispatchEvent(new Event('input')); } } }, '{{bolt}} Suggest a passphrase'));
  const sameNote = h('p', { class: 'hint', hidden: true, text: 'This profile will open with the same password you just typed to open the backup. Handy, but it means the backup file and the profile share one password, so keep that password strong.' });
  same.addEventListener('change', () => { own.hidden = same.checked; sameNote.hidden = !same.checked; });
  step2.append(summary, h('div', { class: 'field' }, h('label', { text: 'Profile name' }), name), picker.el,
    h('label', { class: 'chk', for: 'f_samepw' }, same, '{{lock}} Use the backup password as this profile’s master password'), sameNote, own,
    h('label', { class: 'chk' }, ack, 'I understand that if I forget this master password, nobody can recover this profile.'), err2, h('div', { class: 'row' }, createBtn));

  const m = modal({ title: 'Import a profile', sub: 'Restore everything from an encrypted backup', wide: false, body: h('div', null, step1, step2), actions: [{ label: 'Cancel' }], onClose: () => stopScan() });
  m.el.classList.add('m3d');   // leans toward the pointer over the 3D card space

  openBtn.addEventListener('click', async () => {
    err1.textContent = ''; const t = (text || paste.value).trim();
    if (!t && asm.count) { const miss = asm.missing(); err1.textContent = `Scan the remaining QR code${miss.length === 1 ? '' : 's'} first: ${miss.slice(0, 12).join(', ')}${miss.length > 12 ? '…' : ''}.`; return; }
    if (!t) { err1.textContent = 'Choose a backup file, paste its text, or scan a QR backup.'; return; }
    stopScan();
    if (!bpw.value) { err1.textContent = 'Enter the backup password.'; return; }
    openBtn.disabled = true; openBtn.textContent = 'Deriving the key…'; ctx.surge();
    try {
      data = await decryptProfile(t, bpw.value);
      const atts = Object.keys(data.attachments || {}).length;
      clear(summary).append(h('span', { text: 'Backup type' }), h('b', { text: data.kind === 'profile' ? 'Whole profile (VMP1)' : 'Items only (VMX1)' }), h('span', { text: 'Items' }), h('b', { text: fmtInt(data.items.length) }), h('span', { text: 'Attachments' }), h('b', { text: fmtInt(atts) }),
        data.exported ? [h('span', { text: 'Exported' }), h('b', { text: fmtDate(data.exported) })] : null, data.kind === 'profile' ? [h('span', { text: 'Includes' }), h('b', { text: 'settings & look · audit trail · version history' })] : null);
      name.value = data.name || 'Imported profile'; picker = replacePicker(picker, data.avatar, () => name.value);
      step1.hidden = true; step2.hidden = false; focusSoon(p1, 30);
    } catch (e) { err1.textContent = e.message; }
    openBtn.disabled = false; openBtn.textContent = 'Open backup';
  });
  const replacePicker = (old, avatar, nameOf) => { const np = avatarPicker(avatar, nameOf); old.el.replaceWith(np.el); return np; };

  createBtn.addEventListener('click', async () => {
    err2.textContent = '';
    if (!name.value.trim()) { err2.textContent = 'Give the profile a name.'; return; }
    const master = same.checked ? bpw.value : p1.value;
    if (!same.checked && p1.value !== p2.value) { err2.textContent = 'The two passwords do not match.'; return; }
    const pol = ctx.passwordPolicy(master); if (pol) { err2.textContent = same.checked ? 'The backup password cannot be used as a master password: ' + pol + ' Untick the box and choose a new master password.' : pol; return; }
    if (!ack.checked) { err2.textContent = 'Please confirm that you understand there is no password recovery.'; return; }
    createBtn.disabled = true; createBtn.textContent = 'Restoring everything…'; ctx.surge();
    try {
      const r = await createProfileFromImport(ctx.env, data, { name: name.value.trim(), avatar: picker.get(), masterPassword: master });
      const pw = master; p1.value = p2.value = bpw.value = ''; m.close();
      toast(`Profile “${r.profile.name}” restored: ${r.items} item${r.items === 1 ? '' : 's'}, ${r.attachments} attachment${r.attachments === 1 ? '' : 's'}`, 'ok', 6000);
      if (onDone) await onDone(r.profile, pw);
    } catch (e) { err2.textContent = e.message; createBtn.disabled = false; createBtn.textContent = 'Create profile'; }
  });
  return m;
}
