/* Tool pages: generator, health, QR tools, import / export, settings. */

import { h, clear, modal, toast, confirmDialog, askPassword, copyText, download, readFileText } from './dom.js';
import { generatePassword, generatePassphrase, generatePin, passwordEntropy, passphraseEntropy } from './generator.js';
import { estimate, crackTime } from './strength.js';
import { health, importAny, exportCSV, decryptBackup, newItem, sanitiseItem, OLD_DAYS } from './vault.js';
import { ITER_DEFAULT, sealText, openText, inspectSeal, available } from './crypto.js';
import { drawQR, decodeFile, startScanner, chunkPayload, ChunkAssembler, parseChunk } from './qr.js';
import { runSelfTest } from './selftest.js';
import { meter, avatar, printNodes, showRecoveryKit } from './views.js';
import { fmtDate, fmtInt, hostOf } from './util.js';

export const page = (title, sub, ...kids) => h('div', { class: 'page' }, h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, ...kids);
export const field = (label, control, hint) => h('div', { class: 'field' }, h('label', { text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null);
export const sel = (value, opts, onChange) => h('select', { class: 'sel', on: { change: (e) => onChange(e.target.value) } }, opts.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
export const persist = (ctx) => ctx.store.save().catch((e) => toast('Could not save: ' + e.message, 'err'));

/* ======================= Generator ======================= */
function colourise(pw) {
  const out = h('span');
  for (const ch of pw) out.append(h('span', { class: /\d/.test(ch) ? 'd' : /[A-Z]/.test(ch) ? 'u' : /[a-z]/.test(ch) ? '' : 's', text: ch }));
  return out;
}

export function renderGenerator(ctx) {
  const g = ctx.store.settings.gen;
  const out = h('div', { class: 'genout', 'aria-live': 'polite' }), info = h('div'), controls = h('div');
  let current = '';
  const gen = () => {
    try {
      if (g.mode === 'passphrase') current = generatePassphrase(g);
      else if (g.mode === 'pin') current = generatePin(Math.min(g.length, 24));
      else current = generatePassword(g);
    } catch (e) { current = ''; clear(out).append(h('span', { class: 'err', text: e.message })); clear(info); return; }
    clear(out).append(colourise(current));
    const bits = g.mode === 'passphrase' ? passphraseEntropy(g) : g.mode === 'pin' ? Math.min(g.length, 24) * Math.log2(10) : passwordEntropy(g);
    const e = estimate(current);
    clear(info).append(meter(current).el, h('p', { class: 'hint', text: `Generated with ${Math.round(bits)} bits of randomness (the strength meter is a cautious estimate). Brute force at 10 billion guesses/s: ${crackTime(bits)}.` }));
    void e;
  };
  const save = () => persist(ctx);
  const chk = (key, label) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: g[key], on: { change: (e) => { g[key] = e.target.checked; save(); gen(); } } }), label);
  const slider = (key, min, max, label) => {
    const val = h('b', { class: 'mono', text: String(g[key]) });
    return h('div', { class: 'field' }, h('label', null, label + ': ', val), h('input', { type: 'range', min, max, value: g[key], 'aria-label': label, on: { input: (e) => { g[key] = +e.target.value; val.textContent = e.target.value; gen(); }, change: save } }));
  };
  const drawControls = () => {
    clear(controls);
    if (g.mode === 'password') controls.append(slider('length', 8, 128, 'Length'), h('div', { class: 'checks' }, chk('lower', 'Lowercase a–z'), chk('upper', 'Uppercase A–Z'), chk('digits', 'Digits 0–9'), chk('symbols', 'Symbols !@#$'), chk('noAmbiguous', 'Avoid look-alikes (O 0 l 1 I)')));
    else if (g.mode === 'passphrase') controls.append(slider('words', 3, 12, 'Words'), field('Separator', sel(g.separator, [['-', 'hyphen  -'], [' ', 'space'], ['.', 'dot  .'], ['_', 'underscore  _'], ['', 'none']], (v) => { g.separator = v; save(); gen(); })), h('div', { class: 'checks' }, chk('capitalize', 'Capitalise words'), chk('number', 'Add a digit')),
      h('p', { class: 'hint', text: 'Words come from the EFF short wordlist (1,296 words, 10.3 bits each). Easy to type and remember.' }));
    else controls.append(slider('length', 4, 24, 'Digits'), h('p', { class: 'hint', text: 'PINs are weak by nature — use only where a site forces digits, and prefer a long password everywhere else.' }));
  };
  const seg = h('div', { class: 'seg', role: 'tablist' }, [['password', 'Password'], ['passphrase', 'Passphrase'], ['pin', 'PIN']].map(([k, l]) => h('button', { role: 'tab', class: g.mode === k ? 'on' : '', 'aria-selected': String(g.mode === k), on: { click: (e) => { g.mode = k; Array.from(seg.children).forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); save(); drawControls(); gen(); } } }, l)));
  drawControls(); gen();
  return page('Generator', 'Cryptographically random passwords — generated on this device, never sent anywhere.',
    h('div', { class: 'panel pad' }, seg, h('div', { class: 'field', style: null }), out, info,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: gen } }, '⟳ Regenerate'), h('button', { class: 'btn', on: { click: () => current && copyText(current, 'Copied', ctx.store.settings.clipboard) } }, '⧉ Copy')), h('hr', { class: 'sep' }), controls),
    h('div', { class: 'panel pad' }, h('h3', { text: 'Check a password' }), (() => {
      const i = h('input', { class: 'inp mono', type: 'text', placeholder: 'Type or paste to test (not stored)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Password to test' }), r = h('div');
      i.addEventListener('input', () => { const e = estimate(i.value); clear(r).append(meter(i.value).el, e.issues.length ? h('p', { class: 'hint', text: 'Weaknesses: ' + e.issues.join(', ') + '.' }) : null); });
      return h('div', null, i, r);
    })()));
}

/* ======================= Health ======================= */
export function renderHealth(ctx) {
  const rep = health(ctx.store.items);
  const color = rep.score >= 80 ? 'var(--accent)' : rep.score >= 50 ? 'var(--warn)' : 'var(--danger)';
  const ring = h('div', { class: 'ring' }, h('span', { text: String(rep.score) })); ring.style.setProperty('--p', rep.score); ring.style.setProperty('--c', color);
  const row = (it, sub) => h('div', { class: 'hl' }, avatar(it.name, it.type), h('div', { class: 't' }, h('b', { text: it.name }), h('small', { text: sub || it.username || hostOf(it.url) })), h('button', { class: 'btn sm', on: { click: () => { ctx.S.sel = it.id; ctx.go('all'); } } }, 'Open'));
  const section = (title, count, desc, rows) => h('div', { class: 'panel pad' }, h('h3', null, title + ' ', h('span', { class: 'chip ' + (count ? 'bad' : 'accent'), text: count ? String(count) : '✓ none' })), h('p', { class: 'hint', text: desc }), rows);
  return page('Vault health', 'Checked locally — passwords never leave this device. (No online breach lookup: that would send data off-device.)',
    h('div', { class: 'panel pad score' }, ring, h('div', null, h('b', { text: rep.total ? `${rep.total} login${rep.total > 1 ? 's' : ''} checked` : 'No logins to check yet' }), h('p', { class: 'hint', text: 'Fix weak and reused passwords first: swap each for a unique generated one.' }))),
    section('Expiring or expired', rep.expiring.length, 'Passports, licences, policies, renewals and subscriptions that end within 60 days (or already have).', rep.expiring.map((x) => row(x.item, x.label + ': ' + x.date + (x.days < 0 ? ' — expired' : ' — in ' + x.days + ' day' + (x.days === 1 ? '' : 's'))))),
    section('Weak passwords', rep.weak.length, 'Easy to guess or crack.', rep.weak.map(({ item, est }) => row(item, `${est.label} · ${est.issues[0] || '~' + Math.round(est.bits) + ' bits'}`))),
    section('Reused passwords', rep.reused.reduce((n, g) => n + g.length, 0), 'One breach exposes every account sharing the password.', rep.reused.map((gr, i) => h('div', null, h('p', { class: 'lbl', text: 'Group ' + (i + 1) }), gr.map((it) => row(it))))),
    section('Old passwords', rep.old.length, `Not changed in over ${OLD_DAYS} days.`, rep.old.map((it) => row(it, 'changed ' + fmtDate(it.pwChanged)))),
    section('Insecure sites', rep.insecure.length, 'Saved with an http:// address (no encryption in transit).', rep.insecure.map((it) => row(it, it.url))),
    rep.missing.length ? section('Missing password', rep.missing.length, 'Logins with an empty password field.', rep.missing.map((it) => row(it))) : null);
}

/* ======================= QR tools ======================= */
export function renderQR(ctx) {
  const tabs = [['seal', 'Seal text'], ['open', 'Open QR'], ['backup', 'Backup to QR']];
  const body = h('div');
  const show = (k) => {
    ctx.S.qrTab = k; ctx.runCleanup();
    Array.from(bar.children).forEach((b, i) => b.classList.toggle('on', tabs[i][0] === k));
    clear(body).append(k === 'seal' ? sealTab(ctx) : k === 'open' ? openTab(ctx) : backupTab(ctx));
  };
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', on: { click: () => show(k) } }, l)));
  show(ctx.S.qrTab || 'seal');
  return page('QR tools', 'Seal secrets into password-protected QR codes (AES-256-GCM). Compatible with QR Seal v2 from ulyOS.', bar, body);
}

function passwordRow(label, input, withGen = true) {
  return h('div', { class: 'field' }, h('label', { text: label }), h('div', { class: 'row' }, h('div', { class: 'grow' }, input),
    withGen ? h('button', { class: 'btn sm', type: 'button', title: 'Generate a passphrase', on: { click: () => { input.value = generatePassphrase({ words: 5 }); input.dispatchEvent(new Event('input')); } } }, '⚡') : null));
}

function qrOutputs(canvas, name) {
  return h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => canvas.toBlob((b) => download(name + '.png', b, 'image/png')) } }, '⬇ PNG'),
    h('button', { class: 'btn sm', on: { click: () => { const c2 = h('canvas'); c2.width = canvas.width; c2.height = canvas.height; c2.getContext('2d').drawImage(canvas, 0, 0); printNodes([h('h1', { text: 'Password-protected QR code' }), h('div', { class: 'pq' }, c2), h('p', { text: 'Open with VaultManager (QR tools → Open QR) or QR Seal. The password is not on this page — keep it elsewhere.' })]); } } }, '🖨 Print'));
}

function sealTab(ctx) {
  const text = h('textarea', { class: 'ta', rows: '5', placeholder: 'A Wi-Fi password, a recovery code, a short note…', 'aria-label': 'Text to seal', spellcheck: 'false' });
  const pw = h('input', { class: 'inp mono', type: 'text', value: generatePassphrase({ words: 5 }), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'QR password' });
  const out = h('div'), err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', on: { click: async () => {
    err.textContent = ''; clear(out);
    if (!text.value) { err.textContent = 'Type something to seal.'; return; }
    if (pw.value.length < 8) { err.textContent = 'Use at least 8 characters for the password.'; return; }
    btn.disabled = true; const t0 = performance.now();
    try {
      const sealed = await sealText(text.value, pw.value);
      const c = h('canvas', { role: 'img', 'aria-label': 'Encrypted QR code' });
      const r = await drawQR(c, sealed, { scale: 6 });
      // round-trip proof, as QR Seal does
      if ((await openText(sealed, pw.value)) !== text.value) throw new Error('Round-trip check failed.');
      out.append(h('div', { class: 'qrbox' }, c), h('p', { class: 'hint', text: `QR version ${r.version} · ECC ${r.ecc} · ${sealed.length} characters · sealed in ${Math.round(performance.now() - t0)} ms · round-trip verified` }), qrOutputs(c, 'vaultmanager-qr'));
    } catch (e) { err.textContent = e.message; }
    btn.disabled = false;
  } } }, '▦ Seal into QR');
  return h('div', { class: 'panel pad' }, field('Secret text', text), passwordRow('Password', pw), h('div', { class: 'row' }, btn), err, out);
}

function openTab(ctx) {
  const payload = h('textarea', { class: 'ta', rows: '4', placeholder: 'Scan a QR, choose an image, or paste the sealed text (base64 or VMX1:…)', 'aria-label': 'Sealed payload', spellcheck: 'false' });
  const pw = h('input', { class: 'inp mono', type: 'password', autocomplete: 'off', 'aria-label': 'Password' });
  const out = h('div'), err = h('p', { class: 'err', role: 'alert' }), status = h('p', { class: 'hint', 'aria-live': 'polite' });
  const prog = h('div', { class: 'progress', hidden: true }, h('i'));
  const video = h('video', { muted: true, playsinline: true, 'aria-label': 'Camera preview' });
  const scanBox = h('div', { class: 'scanner', hidden: true }, video);
  const asm = new ChunkAssembler();
  let stop = null;
  const stopScan = () => { if (stop) { stop(); stop = null; } scanBox.hidden = true; };
  ctx.cleanup.push(stopScan);

  const onText = (t) => {
    if (parseChunk(t)) {
      const r = asm.add(t);
      prog.hidden = false; prog.firstChild.style.width = (r.have / r.count * 100) + '%';
      status.textContent = r.status === 'other-set' ? 'That QR belongs to a different backup — keep scanning the same set.' : `Scanned ${r.have} of ${r.count} codes` + (r.done ? '' : ` — still missing: ${asm.missing().slice(0, 12).join(', ')}${asm.missing().length > 12 ? '…' : ''}`);
      if (r.done) { payload.value = asm.payload(); stopScan(); status.textContent = 'All ' + r.count + ' codes scanned. Enter the backup password and press Open.'; }
    } else { payload.value = t; stopScan(); status.textContent = 'QR code read.'; }
  };
  const scan = h('button', { class: 'btn', on: { click: async () => {
    err.textContent = '';
    if (stop) { stopScan(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { err.textContent = 'Camera access is unavailable here (it needs https:// or localhost). Use “Image file” instead.'; return; }
    try { scanBox.hidden = false; stop = await startScanner(video, onText); } catch (e) { scanBox.hidden = true; err.textContent = 'Could not start the camera: ' + (e.message || e.name); }
  } } }, '📷 Scan with camera');
  const file = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'QR image file', on: { change: async (e) => {
    err.textContent = '';
    for (const f of Array.from(e.target.files || [])) {
      try { const t = await decodeFile(f); if (t) onText(t); else err.textContent = 'No QR code found in ' + f.name + '.'; } catch (x) { err.textContent = 'Could not read that image: ' + x.message; }
    }
    e.target.value = '';
  } } });
  file.multiple = true;

  const doOpen = async () => {
    err.textContent = ''; clear(out);
    const p = payload.value.trim();
    if (!p) { err.textContent = 'Nothing to open yet.'; return; }
    if (!pw.value) { err.textContent = 'Enter the password.'; return; }
    open.disabled = true; status.textContent = 'Deriving the key…';
    try {
      if (p.startsWith('VMX1:')) {
        const { items, attachments } = await decryptBackup(p, pw.value);
        out.append(h('div', { class: 'note', text: `Backup opened: ${items.length} item${items.length === 1 ? '' : 's'}.` }), h('button', { class: 'btn primary', on: { click: async () => { const r = ctx.store.mergeItems(items, attachments); await r.save; toast(`Imported ${r.added}, skipped ${r.skipped} duplicates`); ctx.refresh(); } } }, `⇪ Import into my vault`));
      } else {
        const info = inspectSeal(p);
        if (!info.ok) throw new Error(info.why);
        const text = await openText(p, pw.value);
        let item = null;
        try { const j = JSON.parse(text); if (j && j.vm === 1 && j.item) item = sanitiseItem(j.item); } catch { /* plain text */ }
        if (item) {
          out.append(h('div', { class: 'note', text: 'Opened a VaultManager item.' }), h('div', { class: 'kv' }, h('span', { text: 'Name' }), h('b', { text: item.name }), h('span', { text: 'Type' }), h('b', { text: item.type }), item.username ? [h('span', { text: 'Username' }), h('b', { text: item.username })] : null, item.url ? [h('span', { text: 'Website' }), h('b', { text: item.url })] : null),
            h('div', { class: 'row wrap', style: null }, h('button', { class: 'btn primary', on: { click: async () => { await ctx.store.add(item); ctx.showItem(item.id); toast('Added to your vault'); } } }, '＋ Add to my vault')));
        } else {
          const pre = h('div', { class: 'genout', text: text });
          out.append(h('div', { class: 'note', text: `Opened (v${info.version}, ${fmtInt(info.iterations)} rounds).` }), pre, h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => copyText(text, 'Copied', ctx.store.settings.clipboard) } }, '⧉ Copy'), h('button', { class: 'btn sm', on: { click: () => { clear(out); payload.value = ''; pw.value = ''; } } }, 'Purge from screen')));
        }
      }
      status.textContent = '';
    } catch (e) { err.textContent = e.message; status.textContent = ''; }
    open.disabled = false;
  };
  const open = h('button', { class: 'btn primary', on: { click: doOpen } }, '🔓 Open');
  return h('div', { class: 'panel pad' }, h('div', { class: 'row wrap' }, scan, h('button', { class: 'btn', on: { click: () => file.click() } }, '🖼 Image file(s)'), file), scanBox, prog, status,
    field('Sealed payload', payload), field('Password', pw), h('div', { class: 'row' }, open), err, out);
}

function backupTab(ctx) {
  const pw = h('input', { class: 'inp mono', type: 'text', value: generatePassphrase({ words: 6 }), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Backup password' });
  const out = h('div'), err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', on: { click: async () => {
    err.textContent = ''; clear(out);
    if (pw.value.length < 10) { err.textContent = 'Use at least 10 characters for the backup password.'; return; }
    btn.disabled = true;
    try {
      const blob = await ctx.store.exportEncrypted(pw.value);
      const chunks = chunkPayload(blob, 700);
      if (chunks.length > 120) throw new Error('This vault is too large for QR backup — use an encrypted backup file instead.');
      const canvases = [];
      const grid = h('div', { class: 'qrgrid' });
      for (let i = 0; i < chunks.length; i++) { const c = h('canvas', { role: 'img', 'aria-label': `Backup QR ${i + 1} of ${chunks.length}` }); await drawQR(c, chunks[i], { scale: 4 }); canvases.push(c); grid.append(h('figure', null, c, h('figcaption', { text: `${i + 1} / ${chunks.length}` }))); }
      out.append(h('div', { class: 'note', text: `${ctx.store.active().length} items → ${chunks.length} QR code${chunks.length > 1 ? 's' : ''}. Scan all of them (any order) in QR tools → Open QR on the new device. The backup password is NOT in the codes.` }), grid,
        h('div', { class: 'row wrap', style: null }, h('button', { class: 'btn sm', on: { click: () => printNodes([h('h1', { text: 'VaultManager — encrypted QR backup' }), h('p', { text: `${fmtDate(Date.now())} · ${chunks.length} codes · AES-256-GCM, PBKDF2 600,000 rounds. Keep the backup password separately.` }), ...canvases.map((c, i) => { const c2 = h('canvas'); c2.width = c.width; c2.height = c.height; c2.getContext('2d').drawImage(c, 0, 0); return h('div', { class: 'pq' }, c2, h('div', { text: `${i + 1} / ${chunks.length}` })); })]) } }, '🖨 Print all'),
          h('button', { class: 'btn sm', on: { click: () => download('vaultmanager-backup.vmvault', blob, 'text/plain') } }, '⬇ Also save as file')));
    } catch (e) { err.textContent = e.message; }
    btn.disabled = false;
  } } }, '▦ Create QR backup');
  return h('div', { class: 'panel pad' }, h('p', { class: 'note warn', text: 'A paper QR backup (without attachments) lets you rebuild your vault with nothing but a camera. Whoever holds the codes AND the backup password can read everything — store them apart.' }), passwordRow('Backup password', pw), h('div', { class: 'row' }, btn), err, out);
}

/* ======================= Import / export ======================= */
export function renderData(ctx) {
  const { store } = ctx;
  const importOut = h('div'), importErr = h('p', { class: 'err', role: 'alert' });
  const paste = h('textarea', { class: 'ta', rows: '4', placeholder: 'Or paste CSV / JSON here', 'aria-label': 'Import text', spellcheck: 'false' });
  const runImport = (text, name) => {
    importErr.textContent = ''; clear(importOut);
    try {
      const items = importAny(text, name);
      if (!items.length) throw new Error('No usable entries found.');
      importOut.append(h('div', { class: 'note', text: `Found ${items.length} entr${items.length === 1 ? 'y' : 'ies'} (${items.filter((i) => i.type === 'login').length} logins). Duplicates are skipped.` }),
        h('button', { class: 'btn primary', on: { click: async () => { const r = store.mergeItems(items, {}); await r.save; toast(`Imported ${r.added}, skipped ${r.skipped}`); paste.value = ''; clear(importOut).append(h('div', { class: 'note', text: `Done: ${r.added} added, ${r.skipped} duplicates skipped. Now delete the plaintext file you imported from.` })); } } }, `⇪ Import ${items.length}`));
    } catch (e) { importErr.textContent = e.message; }
  };
  const fileIn = h('input', { type: 'file', accept: '.csv,.json,.txt,text/csv,application/json', class: 'offscreen', 'aria-label': 'Import file', on: { change: async (e) => { const f = e.target.files[0]; if (f) runImport(await readFileText(f), f.name); e.target.value = ''; } } });

  const bkPw = h('input', { class: 'inp mono', type: 'text', value: generatePassphrase({ words: 5 }), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Backup password' });
  const bkErr = h('p', { class: 'err', role: 'alert' });
  const bkAtt = h('input', { type: 'checkbox', checked: true });
  const restoreOut = h('div'), rPw = h('input', { class: 'inp mono', type: 'password', autocomplete: 'off', 'aria-label': 'Backup password to open' }), rErr = h('p', { class: 'err', role: 'alert' });
  let restoreText = '';
  const rFile = h('input', { type: 'file', accept: '.vmvault,.txt', class: 'offscreen', 'aria-label': 'Backup file', on: { change: async (e) => { const f = e.target.files[0]; if (f) { restoreText = (await readFileText(f)).trim(); rLabel.textContent = f.name; } e.target.value = ''; } } });
  const rLabel = h('span', { class: 'hint', text: 'No file chosen' });

  return page('Import & export', 'Move data in and out. Encrypted backups are the safe way; plaintext files are for migrating only.',
    h('div', { class: 'panel pad' }, h('h3', { text: 'Import from another manager' }),
      h('p', { class: 'hint', text: 'Works with Bitwarden (JSON or CSV), KeePassXC / KeePass CSV, 1Password / LastPass CSV, and Chrome / Edge / Firefox password exports.' }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => fileIn.click() } }, '📂 Choose file'), fileIn, h('button', { class: 'btn', on: { click: () => paste.value && runImport(paste.value, '') } }, 'Read pasted text')), paste, importErr, importOut,
      h('p', { class: 'note warn', text: 'Those exports are readable by anyone. Delete the file (and empty the recycle bin) as soon as the import has finished.' })),
    h('div', { class: 'panel pad' }, h('h3', { text: 'Encrypted backup file' }),
      h('p', { class: 'hint', text: 'AES-256-GCM, key from your backup password (PBKDF2-SHA256, 600,000 rounds). The file is useless without that password. Tip: for syncing between devices, see Settings → Sync.' }),
      passwordRow('Backup password', bkPw), h('label', { class: 'chk' }, bkAtt, 'Include attachments'), h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: async () => { bkErr.textContent = ''; if (bkPw.value.length < 10) { bkErr.textContent = 'Use at least 10 characters.'; return; } try { download(`vaultmanager-${fmtDate(Date.now())}.vmvault`, await store.exportEncrypted(bkPw.value, { attachments: bkAtt.checked }), 'text/plain'); toast('Backup saved — remember the password!'); } catch (e) { bkErr.textContent = e.message; } } } }, '⬇ Download encrypted backup')), bkErr,
      h('hr', { class: 'sep' }), h('h3', { text: 'Restore from backup' }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => rFile.click() } }, '📂 Choose .vmvault file'), rFile, rLabel), field('Backup password', rPw),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', on: { click: async () => { rErr.textContent = ''; clear(restoreOut); if (!restoreText) { rErr.textContent = 'Choose a backup file first.'; return; } try { const { items, attachments } = await decryptBackup(restoreText, rPw.value); const r = store.mergeItems(items, attachments); await r.save; toast(`Restored ${r.added}, skipped ${r.skipped} duplicates`); ctx.refresh(); } catch (e) { rErr.textContent = e.message; } } } }, '⇩ Restore')), rErr, restoreOut),
    h('div', { class: 'panel pad' }, h('h3', { text: 'Export plaintext CSV' }),
      h('p', { class: 'note danger', text: 'Unencrypted: every password in readable text. Only for moving to another manager. Delete the file right after.' }),
      h('button', { class: 'btn danger', on: { click: async () => {
        const ok = await askPassword({ title: 'Export unencrypted CSV', text: 'Enter your master password to confirm.', okLabel: 'Export', verify: (p) => store.session.verifyPassword(p) });
        if (ok) { download(`vaultmanager-plaintext-${fmtDate(Date.now())}.csv`, exportCSV(store.active()), 'text/csv'); toast('Exported — delete the file after use', 'err', 6000); }
      } } }, '⚠ Export CSV…')));
}

/* ======================= Self-test ======================= */
export function selfTest() {
  const list = h('div'), bar = h('div', { class: 'progress' }, h('i'));
  const summary = h('p', { class: 'hint', text: 'Running…' });
  modal({ title: 'Crypto self-test', sub: 'Known-answer tests run in your own browser', body: h('div', null, bar, summary, list), actions: [{ label: 'Close' }] });
  runSelfTest((p, name, ok) => { bar.firstChild.style.width = (p * 100) + '%'; list.append(h('div', { class: 'hl' }, h('span', { class: 'chip ' + (ok ? 'accent' : 'bad'), text: ok ? 'PASS' : 'FAIL' }), h('div', { class: 't', text: name }))); })
    .then((r) => { const bad = r.filter((x) => !x.ok).length; summary.textContent = bad ? `${bad} test(s) FAILED — do not rely on this browser for encryption.` : `All ${r.length} tests passed. ${available() ? '' : ''}`; if (bad) summary.className = 'err'; });
}

export { ITER_DEFAULT, newItem };
