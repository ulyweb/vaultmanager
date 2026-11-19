/* Family recovery: everything that helps the people you trust get into the vault if you cannot help them.
   - Family guide: a plain-language, printable sheet (who to call, where the USB drive and the paper copies are, the steps, the crypto items by name). It never contains a secret.
   - Split a password: Shamir sharing (js/shamir.js). Any K of N people / places together can recover a password; nobody alone, and no single lost share locks everyone out.
   - Combine shares: type or scan the shares to get the password back.
   - Restore drill: a checklist and a reminder to prove, every few months, that your family can really do it. */

import { h, clear, toast, copyText } from './dom.js';
import { page, field, sel, persist } from './tools.js';
import { drawQR, decodeFile, startScanner } from './qr.js';
import { printNodes, purgeButton } from './views.js';
import { split, combine, shareInfo, MAX_SECRET_BYTES } from './shamir.js';
import { fmtDate, drillState } from './util.js';

const lines = (t) => String(t || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

/* the printable guide: no passwords, no seed words — only names, places and steps */
export function guideNodes(ctx) {
  const st = ctx.store.settings, f = st.family || {}, wallets = ctx.store.active().filter((i) => i.type === 'crypto');
  const blank = h('i', { text: '(not filled in yet)' });
  const para = (t) => (t && t.trim() ? lines(t).map((x) => h('p', { text: x })) : h('p', null, blank));
  return [
    h('h1', { text: 'Family recovery guide' }),
    h('p', { text: `Prepared ${fmtDate(Date.now())}${st.displayName ? ' for ' + st.displayName : ''}. This sheet has no passwords or secret words on it.` }),
    h('h2', { text: 'Read this first' }),
    h('p', { text: 'This is a private, encrypted vault (VaultManager) that holds important accounts and cryptocurrency information. It was set up so that you can get into it if I cannot help you. Take your time: nothing here is urgent. Never share any of it with anyone who contacts you offering to “help recover” it. That is how scams work.' }),
    h('h2', { text: 'Who to call first' }), ...[].concat(para(f.contact)),
    h('h2', { text: 'Where things are' }),
    h('p', null, h('b', { text: 'The vault (USB drive or file): ' }), f.usb && f.usb.trim() ? f.usb : blank),
    h('p', null, h('b', { text: 'Printed QR codes and paper copies: ' }), f.paper && f.paper.trim() ? f.paper : blank),
    h('p', null, h('b', { text: 'Who holds the password shares: ' }), f.holders && f.holders.trim() ? f.holders : blank),
    h('p', { text: 'The vault’s password is split into pieces held by different people or places. A set number of pieces together reveal it (the pieces say how many); one piece alone is useless. Collect them from the people named above.' }),
    h('h2', { text: 'Steps' }),
    h('ol', null,
      h('li', { text: 'Find the USB drive, or the file named VaultManager-offline… .html. Before you open it, turn off all browser extensions (or use a private window). Then double-click the file: it opens in your web browser. No internet is needed.' }),
      h('li', { text: 'In the left menu choose “Family recovery”, then “Combine shares”. Type each share (or scan its QR code). When enough are entered, the password appears.' }),
      h('li', { text: 'Sign in with the profile name and that password. If there are sealed QR codes or backup files, use QR tools → Open QR (or Import) with the same password.' }),
      h('li', { text: 'In the left menu open “Crypto”. Each wallet has “Instructions for my family”, where the hardware wallet is, and which app opens it.' }),
      h('li', { text: 'Do not rush and do not move any funds until you have read the instructions and asked someone you trust. Never type a seed phrase into a website or send it to anyone.' })),
    h('h2', { text: 'Crypto items in the vault' }),
    wallets.length ? h('ul', null, wallets.map((w) => h('li', { text: w.name || '(untitled)' }))) : h('p', null, h('i', { text: 'None recorded yet.' })),
    h('h2', { text: 'Anything else' }), ...[].concat(para(f.notes)),
  ];
}

/* ---------- Guide tab ---------- */
function guideTab(ctx) {
  const st = ctx.store.settings; st.family = { contact: '', usb: '', paper: '', holders: '', notes: '', ...(st.family || {}) };
  const wallets = ctx.store.active().filter((i) => i.type === 'crypto'), withNote = wallets.filter((w) => ((w.fields || {}).familynote || '').trim()).length, d = drillState(st);
  const prev = h('div', { class: 'guideprev' }, guideNodes(ctx));
  let timer = 0; const save = () => { clearTimeout(timer); timer = setTimeout(() => persist(ctx), 500); clear(prev).append(guideNodes(ctx)); };
  const bind = (key, rows, label, hint) => {
    const ta = h('textarea', { class: 'ta', rows: String(rows), 'aria-label': label, maxlength: '1500', spellcheck: 'false', on: { input: (e) => { st.family[key] = e.target.value; save(); } } }, st.family[key] || '');
    return field(label, ta, hint);
  };
  const row = (ok, text) => h('li', { class: ok ? 'ok' : 'todo' }, h('b', { text: ok ? '✓ ' : '○ ' }), text);
  return h('div', null,
    h('div', { class: 'panel pad' }, h('h3', { text: 'Is your family ready?' }),
      h('ul', { class: 'readiness' },
        row(wallets.length > 0, wallets.length ? `${wallets.length} crypto item${wallets.length === 1 ? '' : 's'} recorded (${withNote} with “Instructions for my family”)` : 'No crypto items recorded yet (add one from New → Crypto wallet)'),
        row(!!(st.family.contact || '').trim() && !!(st.family.usb || '').trim(), 'The guide below says who to call and where the USB drive is'),
        row(d.days !== null && !d.due, d.days === null ? 'Recovery has never been tested (Restore drill tab)' : d.due ? `Last test was ${d.days} days ago, so a new one is due` : `Tested ${d.days} day${d.days === 1 ? '' : 's'} ago`)),
      h('p', { class: 'hint', text: 'A good setup has three layers kept in different places: the sealed data (USB, QR codes, backup file), the password (split between people with “Split a password”), and this guide so they know what to do.' })),
    h('div', { class: 'panel pad' }, h('h3', { text: 'Write the guide' }),
      bind('contact', 3, 'Who to call first (names and phone numbers)'),
      bind('usb', 2, 'Where the USB drive or offline file is'),
      bind('paper', 2, 'Where the printed QR codes and paper copies are'),
      bind('holders', 2, 'Who holds the password shares (names only, never the shares themselves)'),
      bind('notes', 4, 'Anything else they should know', 'Saved automatically, encrypted inside your vault.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => printNodes(guideNodes(ctx)) } }, '{{print}} Print the family guide'),
        h('button', { class: 'btn', on: { click: () => { ctx.S.qrTab = 'backup'; ctx.go('qr'); } } }, '{{qr}} Make an encrypted QR backup'))),
    h('div', { class: 'panel pad' }, h('h3', { text: 'Preview' }), prev));
}

/* ---------- Split tab ---------- */
function splitTab(ctx) {
  const secret = h('textarea', { class: 'ta mono', rows: '3', 'aria-label': 'Password to split', spellcheck: 'false', autocomplete: 'off', placeholder: 'The password to protect, for example the one that opens your sealed QR codes or backup' });
  const nSel = sel(3, [2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [v, String(v)]), () => paintHolders());
  const kSel = sel(2, [2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [v, String(v)]), () => {});
  const holdersBox = h('div', { class: 'row wrap' }), out = h('div'), err = h('p', { class: 'err', role: 'alert' });
  let names = ['Spouse', 'Trusted relative', 'Safe / lockbox'];
  const paintHolders = () => { const n = +nSel.value; clear(holdersBox); for (let i = 0; i < n; i++) holdersBox.append(h('input', { class: 'inp', maxlength: '40', value: names[i] || '', placeholder: 'Holder ' + (i + 1), 'aria-label': 'Holder of share ' + (i + 1), on: { input: (e) => { names[i] = e.target.value; } } })); };
  paintHolders();
  const make = async () => {
    err.textContent = ''; clear(out);
    const k = +kSel.value, n = +nSel.value;
    if (k > n) { err.textContent = 'The number needed cannot be more than the number of shares.'; return; }
    if (!secret.value.trim()) { err.textContent = 'Enter the password to split.'; return; }
    try {
      const shares = split(secret.value, k, n);
      if (combine(shares.slice(0, k)) !== secret.value || combine(shares.slice(n - k)) !== secret.value) throw new Error('The check failed, so nothing was created. Try again.');   // proves it before showing it
      const cards = [], printables = [];
      for (let i = 0; i < n; i++) {
        const who = (names[i] || '').trim();
        const mk = async () => { const c = h('canvas', { role: 'img', 'aria-label': 'QR code of share ' + (i + 1) }); await drawQR(c, shares[i], { scale: 4 }); return c; };
        const canvas = await mk();
        cards.push(h('div', { class: 'sharecard' }, h('h4', { text: `Share ${i + 1} of ${n}${who ? ' — ' + who : ''}` }), h('div', { class: 'qrbox' }, canvas), h('code', { class: 'sharetext', text: shares[i] }),
          h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => copyText(shares[i], 'Share copied', 60) } }, '{{copy}} Copy'), h('button', { class: 'btn sm', on: { click: async () => printNodes([h('h1', { text: `VaultManager password share ${i + 1} of ${n}` }), h('p', { text: who ? 'Held by: ' + who : '' }), h('p', { text: `Any ${k} of the ${n} shares together open the password. One share alone is useless.` }), await mk(), h('p', { class: 'mono', text: shares[i] }), h('p', { text: 'Keep this paper apart from the other shares and from the vault. Anyone who gathers enough shares can open it.' })]) } }, '{{print}} Print this one'))));
        printables.push(async () => [h('h2', { text: `Share ${i + 1} of ${n}${who ? ' — ' + who : ''}` }), await mk(), h('p', { class: 'mono', text: shares[i] })]);
      }
      out.append(h('div', { class: 'note ok', role: 'status', text: `✓ Checked: any ${k} of these ${n} shares recover the password; fewer than ${k} reveal nothing.` }), h('div', { class: 'sharegrid' }, cards),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: async () => { const all = [h('h1', { text: 'VaultManager password shares' }), h('p', { text: `Any ${k} of ${n} open the password. Cut the page apart and give each share to a different person or place.` })]; for (const p of printables) all.push(...(await p())); printNodes(all); } } }, '{{print}} Print all shares'), purgeButton(ctx)),
        h('p', { class: 'hint', text: 'Give each share to a different person or put it in a different place. Then press Purge memory and clear this screen: the shares are not stored in the vault.' }));
    } catch (e) { err.textContent = e.message; }
  };
  return h('div', { class: 'panel pad' },
    h('p', { class: 'note warn', text: 'Splitting means no single person or place can open your vault password alone, yet your family can still open it together. Choose how many shares exist and how many are needed. 2 of 3 is a good start: one with your spouse, one with a trusted relative, one in a safe.' }),
    field('Password to split', secret, `Up to ${MAX_SECRET_BYTES} characters. It is not saved anywhere.`),
    h('div', { class: 'row wrap' }, field('Shares needed to open it', kSel), field('Total shares', nSel)),
    field('Who holds each share (optional, printed on the card)', holdersBox),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: make } }, '{{shieldlock}} Create the shares')), err, out);
}

/* ---------- Combine tab ---------- */
function combineTab(ctx) {
  const box = h('textarea', { class: 'ta mono', rows: '5', 'aria-label': 'Shares', spellcheck: 'false', autocomplete: 'off', placeholder: 'Type or paste one share per line (they start with VMS1-)' });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' }), err = h('p', { class: 'err', role: 'alert' }), out = h('div');
  const video = h('video', { muted: true, playsinline: true, 'aria-label': 'Camera preview' }), scanBox = h('div', { class: 'scanner', hidden: true }, video);
  let stop = null; const stopScan = () => { if (stop) { stop(); stop = null; } scanBox.hidden = true; }; ctx.cleanup.push(stopScan);
  const shareLines = () => box.value.split(/\n/).map((x) => x.trim()).filter(Boolean);
  const update = () => { try { const ls = shareLines(); if (!ls.length) { status.textContent = ''; return; } const i = shareInfo(ls[0]); status.textContent = `${new Set(ls).size} share${ls.length === 1 ? '' : 's'} entered. ${i.k} of ${i.n} are needed.`; } catch { status.textContent = ''; } };
  box.addEventListener('input', update);
  const addText = (t) => { if (!/VMS1/i.test(t)) { err.textContent = 'That QR code is not a VaultManager share.'; return; } err.textContent = ''; if (!shareLines().includes(t.trim())) box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + t.trim(); update(); };
  const scan = h('button', { class: 'btn', on: { click: async () => { err.textContent = ''; if (stop) { stopScan(); return; } if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { err.textContent = 'The camera is not available here. Use “Image file”, or type the share.'; return; } try { scanBox.hidden = false; stop = await startScanner(video, addText); } catch (e) { scanBox.hidden = true; err.textContent = 'Could not start the camera: ' + (e.message || e.name); } } } }, '{{camera}} Scan a QR');
  const file = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'Share QR image', on: { change: async (e) => { for (const f of Array.from(e.target.files || [])) { try { const t = await decodeFile(f); if (t) addText(t); else err.textContent = 'No QR code found in ' + f.name + '.'; } catch (x) { err.textContent = 'Could not read that image: ' + x.message; } } e.target.value = ''; } } });
  file.multiple = true;
  const go = () => {
    err.textContent = ''; clear(out);
    try {
      const pw = combine(shareLines());
      const field1 = h('input', { class: 'inp mono', type: 'password', readOnly: true, value: pw, 'aria-label': 'Recovered password' });
      const eye = h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Show or hide the password', on: { click: () => { field1.type = field1.type === 'password' ? 'text' : 'password'; } } }, '{{eye}}');
      out.append(h('div', { class: 'note ok', role: 'status', text: '✓ The shares fit together. This is the password:' }), h('div', { class: 'row' }, h('div', { class: 'grow' }, field1), eye, h('button', { class: 'btn sm', on: { click: () => copyText(pw, 'Password copied', 30) } }, '{{copy}} Copy')), h('p', { class: 'hint', text: 'Use it to sign in, or to open sealed QR codes and backups. Press Purge memory when you are done.' }), purgeButton(ctx));
    } catch (e) { err.textContent = e.message; }
  };
  return h('div', { class: 'panel pad' }, h('p', { class: 'hint', text: 'Enter enough shares to get a password back. Shares are checked for typing mistakes and for belonging together.' }), box, status,
    h('div', { class: 'row wrap' }, scan, h('button', { class: 'btn', on: { click: () => file.click() } }, '{{folder}} Image file…'), file, h('button', { class: 'btn primary', on: { click: go } }, '{{unlock}} Combine'), purgeButton(ctx)), scanBox, err, out);
}

/* ---------- Drill tab ---------- */
export const DRILL_STEPS = [
  'On a different computer (not your usual one), I opened the offline file or the sealed QR.',
  'Someone other than me combined the password shares and got the password back.',
  'With that password we opened the sealed QR code or the backup and saw the items.',
  'A family member did the steps from the printed guide, without my help.',
  'We wrote down anything that was confusing and fixed it in the guide.',
];
function drillTab(ctx) {
  const st = ctx.store.settings, d = drillState(st), boxes = DRILL_STEPS.map((t, i) => h('label', { class: 'chk', for: 'drill' + i }, h('input', { type: 'checkbox', id: 'drill' + i }), t));
  const statusLine = d.days === null ? 'You have never run a restore drill.' : `Last drill: ${fmtDate(st.drillAt)} (${d.days} day${d.days === 1 ? '' : 's'} ago).`;
  return h('div', { class: 'panel pad' },
    h('p', { class: d.due ? 'note warn' : 'note ok', role: 'status', text: statusLine + (d.due ? ' A new drill is due.' : ' Not due yet.') }),
    h('p', { class: 'hint', text: 'A recovery plan that has never been tried usually fails the first time it is needed. Do this every few months, with the person who would really have to do it.' }),
    h('div', { class: 'drill' }, boxes),
    field('Remind me every', sel(st.drillDays || 90, [[30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '12 months']], (v) => { st.drillDays = +v; persist(ctx); })),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: async () => {
      const done = boxes.filter((b) => b.querySelector('input').checked).length;
      if (done < DRILL_STEPS.length) { toast(`Tick all ${DRILL_STEPS.length} steps first. Anything you skip is a place where recovery could fail.`, 'warn', 5000); return; }
      st.drillAt = Date.now(); ctx.store.log('settings', 'Family recovery drill completed'); await persist(ctx); toast('Recorded: recovery tested today'); ctx.refresh();
    } } }, '{{check}} We tested it today')));
}

export function renderFamily(ctx) {
  const tabs = [['guide', 'Family guide'], ['split', 'Split a password'], ['combine', 'Combine shares'], ['drill', 'Restore drill']];
  const body = h('div');
  const show = (k) => {
    ctx.S.famTab = k; ctx.runCleanup();
    Array.from(bar.children).forEach((b, i) => { b.classList.toggle('on', tabs[i][0] === k); b.setAttribute('aria-selected', String(tabs[i][0] === k)); });
    clear(body).append(k === 'guide' ? guideTab(ctx) : k === 'split' ? splitTab(ctx) : k === 'combine' ? combineTab(ctx) : drillTab(ctx));
  };
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', on: { click: () => show(k) } }, l)));
  show(ctx.S.famTab || 'guide');
  return page('Family recovery', 'Make sure the people you trust can open the vault if you cannot help: a guide they can follow, a password only they can rebuild together, and a drill to prove it works.', bar, body);
}
