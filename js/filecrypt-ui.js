/* Encrypt a photo or file: a standalone tool on Import & export. Pick any picture or file, choose a password, and save one encrypted
   .vmenc file; later, open it here (in any copy of VaultManager, including the offline file) with the same password to get the original back. */

import { h, clear, toast, download } from './dom.js';
import { sealFile, openFile, isSealedFile, MAX_SEAL_FILE } from './crypto.js';
import { passwordRow, purgeButton } from './views.js';
import { generateStrongPassphrase } from './generator.js';
import { estimate } from './strength.js';

const kb = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

export const FILE_CAN = [
  'Encrypt any photo or file up to 100 MB into one .vmenc file, with AES-256-GCM and a password stretched 600,000 times.',
  'Open it again here, in any copy of VaultManager (also the offline file, with no internet), and get the original back with its name.',
  'Everything happens on this device: the picture is never uploaded.',
];
export const FILE_CANNOT = [
  'There is no password reset: if the password is lost, nobody can open the file. Write it down or keep it in your vault.',
  'Your original photo is not changed or deleted. Delete it yourself if you only want to keep the encrypted copy.',
  'Other apps cannot open a .vmenc file (that is the point); share the password separately from the file.',
];

export function fileCryptPanel(ctx) {
  const ul = (items, cls) => h('ul', { class: 'cio-list ' + cls }, items.map((t) => h('li', { text: t })));
  /* encrypt */
  let picked = null, prevUrl = '';
  const encOut = h('div'), encErr = h('p', { class: 'err', role: 'alert' }), info = h('p', { class: 'hint', 'aria-live': 'polite' }), prev = h('div', { class: 'fileprev' });
  const pw = h('input', { class: 'inp mono', type: 'text', value: generateStrongPassphrase(), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'File password' });
  const pwRow = passwordRow('Password', pw);
  const showPrev = (el, file) => { if (prevUrl) URL.revokeObjectURL(prevUrl); prevUrl = ''; clear(el); if (file && /^image\//.test(file.type)) { prevUrl = URL.createObjectURL(file); el.append(h('img', { src: prevUrl, alt: 'Preview of ' + file.name })); } };
  ctx.cleanup.push(() => { if (prevUrl) URL.revokeObjectURL(prevUrl); });
  const fileIn = h('input', { type: 'file', class: 'offscreen', 'aria-label': 'Photo or file to encrypt', on: { change: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; encErr.textContent = ''; clear(encOut); if (!f) return; if (f.size > MAX_SEAL_FILE) { encErr.textContent = `That file is larger than ${MAX_SEAL_FILE / 1048576} MB.`; return; } picked = f; info.textContent = `${f.name} · ${kb(f.size)}`; showPrev(prev, f); } } });
  const encBtn = h('button', { class: 'btn primary', on: { click: async () => {
    encErr.textContent = ''; clear(encOut);
    if (!picked) { encErr.textContent = 'Choose a photo or file first.'; return; }
    if (!pwRow.match()) { encErr.textContent = 'The two passwords do not match.'; return; }
    if (pw.value.length < 10 || estimate(pw.value).bits < 50) { encErr.textContent = 'Use a stronger password: at least 10 characters (a passphrase of 6+ random words is best, or press the lightning button).'; return; }
    encBtn.disabled = true; encBtn.textContent = 'Encrypting…';
    try {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      const sealed = await sealFile(bytes, { name: picked.name, type: picked.type }, pw.value);
      const back = await openFile(sealed, pw.value);   // read it back exactly as opening it later would
      if (back.bytes.length !== bytes.length || back.bytes.some((b, i) => b !== bytes[i])) throw new Error('The check failed, so nothing was saved. Try again.');
      const name = picked.name + '.vmenc';
      download(name, sealed, 'application/octet-stream');
      ctx.store.log('export', `Encrypted a file (${kb(bytes.length)}) to ${name}`); ctx.store.save().catch(() => {});
      encOut.append(h('div', { class: 'note ok', role: 'status', text: `✓ Saved ${name} (${kb(sealed.length)}). Checked: it opens again with this password. Keep the password safe: without it nobody can open the file.` }));
    } catch (e) { encErr.textContent = e.message; }
    encBtn.disabled = false; encBtn.textContent = 'Encrypt and save';
  } } }, 'Encrypt and save');
  /* decrypt */
  let sealedPicked = null, outUrl = '';
  const decOut = h('div'), decErr = h('p', { class: 'err', role: 'alert' }), decInfo = h('p', { class: 'hint', 'aria-live': 'polite' });
  const dpw = h('input', { class: 'inp mono', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Password of the encrypted file' });
  ctx.cleanup.push(() => { if (outUrl) URL.revokeObjectURL(outUrl); });
  const decIn = h('input', { type: 'file', accept: '.vmenc,application/octet-stream', class: 'offscreen', 'aria-label': 'Encrypted file to open', on: { change: async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; decErr.textContent = ''; clear(decOut); if (!f) return; const u8 = new Uint8Array(await f.arrayBuffer()); if (!isSealedFile(u8)) { decErr.textContent = 'That is not a VaultManager encrypted file (.vmenc).'; sealedPicked = null; decInfo.textContent = ''; return; } sealedPicked = u8; decInfo.textContent = `${f.name} · ${kb(f.size)}`; } } });
  const decBtn = h('button', { class: 'btn primary', on: { click: async () => {
    decErr.textContent = ''; clear(decOut); if (outUrl) { URL.revokeObjectURL(outUrl); outUrl = ''; }
    if (!sealedPicked) { decErr.textContent = 'Choose a .vmenc file first.'; return; }
    if (!dpw.value) { decErr.textContent = 'Enter the password.'; return; }
    decBtn.disabled = true; decBtn.textContent = 'Opening…';
    try {
      const r = await openFile(sealedPicked, dpw.value);
      outUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.type }));
      decOut.append(h('div', { class: 'note ok', role: 'status', text: `✓ Opened: ${r.name} (${kb(r.bytes.length)}).` }),
        /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(r.type) ? h('div', { class: 'fileprev' }, h('img', { src: outUrl, alt: r.name })) : null,
        h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => download(r.name, r.bytes, r.type) } }, '{{download}} Save the original'), purgeButton(ctx)),
        h('p', { class: 'hint', text: 'The opened copy is only in memory until you save it. Press Purge memory when you are done.' }));
    } catch (e) { decErr.textContent = e.message; }
    decBtn.disabled = false; decBtn.textContent = 'Open';
  } } }, 'Open');
  return h('div', { class: 'panel pad filecrypt' },
    h('h3', { text: 'Encrypt a photo or file' }),
    h('div', { class: 'ccols' }, h('div', { class: 'ccan' }, h('h4', { text: '✓ What it can do' }), ul(FILE_CAN, 'can')), h('div', { class: 'ccant' }, h('h4', { text: '✗ What it cannot do' }), ul(FILE_CANNOT, 'cannot'))),
    h('div', { class: 'ccols' },
      h('div', null, h('h4', { text: 'Encrypt' }), h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => fileIn.click() } }, '{{camera}} Choose a photo or file…'), fileIn), info, prev, pwRow, h('div', { class: 'row wrap' }, encBtn), encErr, encOut),
      h('div', null, h('h4', { text: 'Open an encrypted file' }), h('div', { class: 'row wrap' }, h('button', { class: 'btn', on: { click: () => decIn.click() } }, '{{folder}} Choose a .vmenc file…'), decIn), decInfo,
        h('div', { class: 'field' }, h('label', { text: 'Password' }), dpw), h('div', { class: 'row wrap' }, decBtn), decErr, decOut)));
}
