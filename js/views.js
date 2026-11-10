/* Vault views: item list, detail panel, editor, QR share, recovery kit. */

import { h, clear, modal, toast, confirmDialog, copyText, download } from './dom.js';
import { newItem, sanitiseItem, SENSITIVE, TYPES, matches, totpValid, MAX_ATTACHMENT, MAX_ATTACHMENTS_PER_ITEM, keyLabel, keyIsSecret, describeValue, currentValue } from './vault.js';
import { TYPE_META, TEMPLATES, GROUPS, isSecretField, MAX_CUSTOM, daysUntil, wifiQRString } from './templates.js';
import { estimate, crackTime } from './strength.js';
import { generatePassword, generatePassphrase } from './generator.js';
import { totpNow, parseTotp } from './totp.js';
import { sealText, openText } from './crypto.js';
import { drawQR } from './qr.js';
import { fmtDate, hostOf, safeHref, stamp } from './util.js';

export const TYPE_ICON = Object.fromEntries(Object.entries(TYPE_META).map(([k, m]) => [k, m.icon]));

export function avatar(name, type) {
  const n = (name || '?').trim() || '?';
  let hash = 0; for (const c of n) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  const useIcon = type && TYPE_ICON[type] && document.documentElement.dataset.avatar === 'icon';
  const a = h('div', { class: 'avatar', 'aria-hidden': 'true' }, useIcon ? h('span', { class: 'icn', text: TYPE_ICON[type] }) : Array.from(n)[0].toUpperCase());
  a.style.background = `hsl(${hash % 360} 52% 38%)`;
  return a;
}

export function meter(pw) {
  const e = estimate(pw);
  const bar = h('i', { class: 's' + e.score });
  bar.style.width = (pw ? Math.max(6, (e.score + 1) * 20) : 0) + '%';
  return { el: h('div', null, h('div', { class: 'meter', role: 'img', 'aria-label': 'Password strength: ' + e.label }, bar),
    h('div', { class: 'meter-label' }, h('span', { text: pw ? e.label : '' }), h('span', { text: pw ? `${[...pw].length} characters · ~${Math.round(e.bits)} bits entropy · ${crackTime(e.bits)}` : '' }))), est: e };
}

/* A live strength / length / entropy readout under any text input. */
export function liveMeter(input, { label = 'Length and entropy' } = {}) {
  const box = h('div', { class: 'livemeter', 'aria-label': label });
  const upd = () => clear(box).append(input.value ? meter(input.value).el : '');
  input.addEventListener('input', upd); upd();
  return box;
}

/* Compact "N characters · ~X bits" chip for a stored secret (detail view). */
export function statChip(value) {
  const e = estimate(value), n = [...value].length;
  return h('small', { class: 'sbits', title: 'Estimated strength: ' + e.label, text: `${n} characters · ~${Math.round(e.bits)} bits · ${e.label}` });
}


/* The sealed text behind a QR (Base64): view it, copy it, save it. Paste it into Open QR on any device instead of scanning. */
export function payloadBox(ctx, text, { label = 'Payload text (Base64)', file = 'vaultmanager-payload' } = {}) {
  const ta = h('textarea', { class: 'ta mono payload', rows: '3', readonly: true, spellcheck: 'false', 'aria-label': label }, text);
  return h('details', { class: 'how payloadbox', open: true }, h('summary', { text: label + ' — ' + text.length.toLocaleString('en-US') + ' characters' }),
    h('p', { class: 'hint', text: 'This is exactly what is inside the QR. Without the password it is unreadable. Paste it into Tools → QR tools → Open QR to restore without scanning.' }), ta,
    h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', type: 'button', on: { click: () => copyText(text, 'Payload text copied') } }, '{{copy}} Copy payload text'),
      h('button', { class: 'btn sm', type: 'button', on: { click: () => download(`${file}-${stamp()}.txt`, text, 'text/plain') } }, '{{download}} Save as .txt')));
}
export const purgeButton = (ctx) => h('button', { class: 'btn', type: 'button', title: 'Wipe revealed values, QR codes, passwords typed here, opened locked items and the clipboard from memory', on: { click: () => ctx.purgeMemory() } }, '{{trash}} Purge memory');

/* ---------- hidden password + confirm ---------- */
/* A hidden password field with a "confirm" field, a show / copy toggle and a generator. The generated passphrase fills both fields. */
export function passwordRow(label, input, withGen = true) {
  input.type = 'password'; input.autocomplete = 'new-password';
  const conf = h('input', { class: 'inp mono', type: 'password', autocomplete: 'new-password', spellcheck: 'false', 'aria-label': 'Confirm ' + (input.getAttribute('aria-label') || label) });
  if (input.value) conf.value = input.value;
  const show = (on) => { input.type = conf.type = on ? 'text' : 'password'; };
  const eye = h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Show or hide the password', title: 'Show / hide', 'aria-pressed': 'false', on: { click: () => { const on = input.type === 'password'; show(on); eye.setAttribute('aria-pressed', String(on)); } } }, '{{eye}}');
  const copy = h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Copy the password', title: 'Copy (clears itself)', on: { click: () => copyText(input.value, 'Password copied', 30) } }, '{{copy}}');
  const gen = withGen ? h('button', { class: 'btn sm', type: 'button', title: 'Generate a passphrase', 'aria-label': 'Generate a passphrase', on: { click: () => { input.value = conf.value = generatePassphrase({ words: 5 }); input.dispatchEvent(new Event('input')); show(true); eye.setAttribute('aria-pressed', 'true'); } } }, '{{bolt}}') : null;
  const f = h('div', { class: 'field' }, h('label', { text: label }), h('div', { class: 'row' }, h('div', { class: 'grow' }, input), eye, copy, gen),
    h('label', { class: 'sublbl', text: 'Confirm ' + label.toLowerCase() }), conf, liveMeter(input));
  f.match = () => input.value === conf.value;
  return f;
}

export function pwField(initial, { id, onInput, ctx, autocomplete = 'new-password' } = {}) {
  const input = h('input', { type: 'password', class: 'inp mono', value: initial || '', autocomplete, spellcheck: 'false', id, 'aria-label': 'Password' });
  const m = h('div');
  const upd = () => { const { el } = meter(input.value); clear(m).append(el); if (onInput) onInput(input.value); };
  input.addEventListener('input', upd);
  const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show or hide', title: 'Show / hide', on: { click: () => { input.type = input.type === 'password' ? 'text' : 'password'; } } }, '{{eye}}');
  const g = () => ctx.store.settings.gen;
  const fill = (v) => { input.value = v; input.type = 'text'; upd(); };
  const wrap = h('div', null,
    h('div', { class: 'pwwrap' }, input, eye),
    h('div', { class: 'row wrap', style: null }, h('button', { type: 'button', class: 'btn sm', on: { click: () => fill(generatePassword(g())) } }, '{{bolt}} Generate'),
      h('button', { type: 'button', class: 'btn sm', on: { click: () => fill(generatePassphrase({ words: g().words, separator: g().separator, capitalize: g().capitalize, number: g().number })) } }, '{{abc}} Passphrase'),
      h('span', { class: 'hint', text: `length ${g().length} · change in Generator` })),
    m);
  upd();
  return { el: wrap, input };
}

/* ---------- list ---------- */
export function filterItems(ctx) {
  const { store, S } = ctx;
  let items = S.view === 'trash' ? store.trashed() : store.active();
  const v = S.view;
  if (v === 'fav') items = items.filter((i) => i.favorite);
  else if (v === 'conflicts') items = items.filter((i) => (i.conflicts || []).length);
  else if (v in TYPE_META) items = items.filter((i) => i.type === v);
  else if (v.startsWith('tag:')) items = items.filter((i) => (i.tags || []).includes(v.slice(4)));
  if (S.q) items = items.filter((i) => matches(i, S.q));
  return items.sort((a, b) => (b.favorite - a.favorite) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

const TITLES = { all: 'All items', fav: 'Favorites', trash: 'Trash', conflicts: 'Needs review', ...Object.fromEntries(Object.entries(TYPE_META).map(([k, m]) => [k, m.plural])) };

export function renderVaultView(ctx) {
  const { S, store } = ctx;
  const items = filterItems(ctx);
  if (S.sel && !items.find((i) => i.id === S.sel)) S.sel = null;
  const sel = S.sel ? store.get(S.sel) : null;

  const list = h('div', { class: 'panel list' },
    h('div', { class: 'list-head' }, h('span', { text: S.view.startsWith('tag:') ? '#' + S.view.slice(4) : TITLES[S.view] || 'Items' }), h('span', { text: String(items.length), style: null }),
      S.view === 'trash' && items.length ? h('button', { class: 'btn sm danger', style: null, on: { click: async () => { if (await confirmDialog({ title: 'Empty trash?', text: 'These items will be permanently deleted.', okLabel: 'Delete forever', danger: true })) { await store.emptyTrash(); ctx.refresh(); } } } }, 'Empty') : null),
    h('div', { class: 'items', role: 'listbox', 'aria-label': 'Items' }, items.length ? items.map((it) => itemRow(ctx, it)) : emptyState(ctx, items)));
  const detail = h('div', { class: 'panel detail', 'aria-live': 'polite' }, sel ? detailPanel(ctx, sel) : h('div', { class: 'empty' }, h('div', { class: 'big', text: '{{shieldlock}}' }), h('p', { text: 'Select an item to view it.' })));
  return h('div', { class: 'split' + (sel ? ' has-sel' : '') }, list, detail);
}

function emptyState(ctx, items) {
  const { S, store } = ctx;
  if (S.q) return h('div', { class: 'empty' }, h('div', { class: 'big', text: '{{search}}' }), h('p', { text: 'Nothing matches “' + S.q + '”.' }));
  if (S.view === 'trash') return h('div', { class: 'empty' }, h('div', { class: 'big', text: '{{trash}}' }), h('p', { text: 'Trash is empty. Deleted items stay here for 30 days.' }));
  if (!store.active().length) return h('div', { class: 'empty' }, h('div', { class: 'big', text: '{{shield}}' }), h('p', { text: 'Your vault is empty.' }),
    h('div', { class: 'row', style: null }, h('button', { class: 'btn primary', on: { click: () => editItem(ctx, null, 'login') } }, '{{plus}} Add your first login'),
      h('button', { class: 'btn', on: { click: () => ctx.go('data') } }, '{{exportfile}} Import')));
  return h('div', { class: 'empty' }, h('p', { text: 'No items here yet.' }));
}

function itemRow(ctx, it) {
  const sub = it.type === 'login' ? (it.username || hostOf(it.url)) : it.type === 'card' ? '•••• ' + (it.card.number || '').replace(/\D/g, '').slice(-4) : TEMPLATES[it.type] ? ((it.fields || {})[TEMPLATES[it.type].sub] || (it.notes || '').split('\n')[0].slice(0, 60)) : (it.notes || '').split('\n')[0].slice(0, 60);
  return h('button', { class: 'item' + (ctx.S.sel === it.id ? ' on' : ''), role: 'option', 'aria-selected': String(ctx.S.sel === it.id), on: { click: () => { ctx.S.sel = it.id; ctx.refresh(); } } },
    avatar(it.name, it.type), h('div', { class: 't' }, h('b', { text: it.name || '(untitled)' }), h('small', { text: it.lock ? '🔒 Locked — passcode required' : sub })), (it.attachments || []).length ? h('span', { class: 'clip', text: '{{clip}}', title: it.attachments.length + ' attachment(s)' }) : null, it.favorite ? h('span', { class: 'star', text: '{{star}}', 'aria-label': 'Favorite' }) : null, h('span', { class: 'disc', 'aria-hidden': 'true', text: '{{chevright}}' }));
}

/* ---------- detail ---------- */
let currentItem = null;   // set while a detail panel is being built, so field() can audit copy / reveal events
/* Categories that always show how long and how strong their secret text is. */
const STATS_TYPES = new Set(['bank', 'crypto', 'emergency', 'note']);

function field(label, value, { secret, copy, ctx, pre, link, extra, stats } = {}) {
  const item = currentItem;
  if (!value && !extra) return null;
  let shown = !secret;
  const v = h('div', { class: 'v' + (secret ? ' secret' : '') + (pre ? ' pre' : '') });
  const set = () => { clear(v); if (link && safeHref(value)) v.append(h('a', { href: safeHref(value), target: '_blank', rel: 'noopener noreferrer nofollow' }, value)); else v.append(shown ? value : '•'.repeat(Math.min(16, Math.max(8, value.length)))); };
  if (value) set();
  const acts = h('div', { class: 'acts' });
  if (secret) acts.append(h('button', { class: 'icon-btn', 'aria-label': 'Show or hide ' + label, title: 'Show / hide', on: { click: () => { shown = !shown; set(); if (shown && item && ctx.store.settings.logReveal) ctx.store.log('access', 'Revealed ' + label.toLowerCase() + ' of “' + item.name + '”'); } } }, '{{eye}}'));
  if (value && item && !item.deleted && (secret || stats) && STATS_TYPES.has(item.type)) acts.append(h('button', { class: 'icon-btn', 'aria-label': 'Seal ' + label + ' as QR', title: 'Seal just this as an encrypted QR', on: { click: () => shareItem(ctx, item, { label, value }) } }, '{{qr}}'));
  if (copy) acts.append(h('button', { class: 'icon-btn', 'aria-label': 'Copy ' + label, title: 'Copy', on: { click: () => ctx.copySecret(value, label + ' copied', item, label) } }, '{{copy}}'));
  return h('div', { class: 'f' }, h('div', { class: 'k', text: label }), extra ? h('div', { class: 'v' }, extra) : h('div', { class: 'vwrap' }, v, value && (secret || stats) ? statChip(value) : null), acts);
}

function totpField(ctx, it) {
  if (!it.totp) return null;
  const code = h('span', { class: 'totp-code', text: '------' }), bar = h('i'), wrap = h('div', null, code, h('div', { class: 'totp-bar' }, bar));
  let cfg; try { cfg = parseTotp(it.totp); } catch { return field('One-time code', 'Invalid TOTP secret — edit this item to fix it.'); }
  let last = '';
  const tick = async () => {
    const r = await totpNow(cfg); last = r.code;
    code.textContent = r.code.slice(0, r.code.length / 2) + ' ' + r.code.slice(r.code.length / 2);
    bar.style.width = (r.remaining / r.period * 100) + '%';
  };
  tick(); const t = setInterval(tick, 1000); ctx.cleanup.push(() => clearInterval(t));
  const f = h('div', { class: 'f' }, h('div', { class: 'k', text: 'One-time code' }), h('div', { class: 'v' }, wrap),
    h('div', { class: 'acts' }, h('button', { class: 'icon-btn', 'aria-label': 'Copy one-time code', on: { click: () => ctx.copySecret(last, 'Code copied', it, 'one-time code') } }, '{{copy}}')));
  return f;
}


/* The whole item as a read-only card (used to preview a scanned QR before adding it, and to prove what a QR contains). */
export function itemCard(ctx, it) {
  currentItem = null;
  const rows = [];
  if (it.type === 'login') {
    rows.push(field('Username', it.username, { copy: true, ctx }), field('Password', it.password, { secret: true, copy: true, ctx }), field('Website', it.url, { link: true, copy: true, ctx }));
    if (it.totp) rows.push(field('One-time code secret', it.totp, { secret: true, copy: true, ctx }));
  } else if (it.type === 'card') {
    const c = it.card || {};
    rows.push(field('Cardholder', c.holder, { copy: true, ctx }), field('Number', c.number, { secret: true, copy: true, ctx }), field('Expiry', c.expiry, { copy: true, ctx }), field('CVV', c.cvv, { secret: true, copy: true, ctx }), field('PIN', c.pin, { secret: true, copy: true, ctx }));
  } else if (TEMPLATES[it.type]) {
    for (const f of TEMPLATES[it.type].fields) rows.push(templateRow(ctx, it, f));
  }
  rows.push(field('Notes', it.notes, { pre: true, copy: it.type === 'note', ctx, stats: STATS_TYPES.has(it.type) }));
  for (const c of it.custom || []) rows.push(field(c.label || 'Custom field', c.value, { secret: c.secret, copy: true, ctx, pre: true }));
  if ((it.tags || []).length) rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'Tags' }), h('div', { class: 'v' }, h('div', { class: 'tags' }, it.tags.map((t) => h('span', { class: 'chip', text: '#' + t }))))));
  return h('div', { class: 'itemcard' }, h('div', { class: 'detail-head' }, avatar(it.name, it.type), h('div', null, h('h2', { text: it.name || '(untitled)' }), h('span', { class: 'chip' }, h('span', { class: 'icn', text: TYPE_ICON[it.type] || '' }), ' ' + (TYPES[it.type] || it.type)))), h('div', { class: 'fields' }, rows));
}

/* Plain-language list of what an item QR holds (and what it cannot). */
export function describeContents(it) {
  const t = TEMPLATES[it.type], filled = t ? t.fields.filter((f) => (it.fields || {})[f.k]) : [];
  const secrets = filled.filter((f) => isSecretField(f)).length + (it.password ? 1 : 0) + (it.card && (it.card.number || it.card.cvv || it.card.pin) ? 1 : 0) + (it.custom || []).filter((c) => c.secret && c.value).length;
  const parts = [];
  if (filled.length) parts.push(filled.length + ' filled field' + (filled.length === 1 ? '' : 's') + (secrets ? ' (' + secrets + ' secret)' : ''));
  if (it.username || it.password || it.url || it.totp) parts.push('login details');
  if (it.card && (it.card.number || it.card.holder)) parts.push('card details');
  if (it.notes) parts.push('notes');
  if ((it.custom || []).length) parts.push(it.custom.length + ' custom field' + (it.custom.length === 1 ? '' : 's'));
  if ((it.tags || []).length) parts.push(it.tags.length + ' tag' + (it.tags.length === 1 ? '' : 's'));
  return { included: parts.length ? parts.join(', ') : 'the name only (this item has no other details filled in)', attachments: (it.attachments || []).length };
}

function detailPanel(ctx, it0) {
  const { store } = ctx;
  const it = store.reveal(it0);
  const lockedClosed = !!it.lock && !it._open;
  currentItem = it;
  const trashed = !!it.deleted;
  const actions = h('div', { class: 'detail-actions' },
    h('button', { class: 'btn back sm', on: { click: () => { ctx.S.sel = null; ctx.refresh(); } } }, '{{chevleft}} Back'),
    trashed ? [h('button', { class: 'btn primary sm', on: { click: async () => { await store.restore(it.id); toast('Restored'); ctx.refresh(); } } }, '{{undo}} Restore'),
      h('button', { class: 'btn danger sm', on: { click: async () => { if (await confirmDialog({ title: 'Delete forever?', text: `“${it.name}” will be permanently deleted.`, okLabel: 'Delete forever', danger: true })) { await store.purge(it.id); ctx.S.sel = null; ctx.refresh(); } } } }, '{{close}} Delete forever')] :
      lockedClosed ? [h('button', { class: 'btn primary sm', on: { click: () => unlockItemDialog(ctx, it) } }, '{{lock}} Unlock this item'),
        h('button', { class: 'btn danger sm', on: { click: async () => { await store.trash(it.id); ctx.S.sel = null; toast('Moved to trash'); ctx.refresh(); } } }, '{{trash}} Delete')] :
      [h('button', { class: 'btn sm act-edit', on: { click: () => editItem(ctx, it) } }, '{{edit}} Edit'),
        h('button', { class: 'btn sm' + (it.favorite ? ' primary' : ''), 'aria-pressed': String(it.favorite), on: { click: async () => { await store.update(it.id, { favorite: !it.favorite }); ctx.refresh(); } } }, it.favorite ? '{{star}} Favorite' : '{{starline}} Favorite'),
        it.type === 'network' && (it.fields || {}).ssid ? h('button', { class: 'btn sm', on: { click: () => wifiModal(ctx, it) } }, '{{network}} Wi-Fi QR') : null,
        h('button', { class: 'btn sm', on: { click: () => shareItem(ctx, it) } }, '{{qr}} Seal as QR'),
        it.lock ? null : h('button', { class: 'btn sm', on: { click: async () => { const c = newItem(it.type, { ...structuredClone(it), id: undefined, name: it.name + ' (copy)', history: [], created: Date.now(), updated: Date.now() }); c.id = newItem().id; await store.add(c); ctx.showItem(c.id); toast('Duplicated'); } } }, '{{dup}} Duplicate'),
        it.lock ? h('button', { class: 'btn sm', on: { click: () => { store.relock(it.id); ctx.refresh(); toast('Locked again'); } } }, '{{lock}} Lock now') : h('button', { class: 'btn sm', on: { click: () => lockDialog(ctx, it) } }, '{{lock}} Add passcode lock'),
        h('button', { class: 'btn danger sm', on: { click: async () => { await store.trash(it.id); ctx.S.sel = null; toast('Moved to trash'); ctx.refresh(); } } }, '{{trash}} Delete')]);

  const backTo = TITLES[ctx.S.view] || (ctx.S.view.startsWith('tag:') ? '#' + ctx.S.view.slice(4) : 'Items');
  const navbar = h('div', { class: 'detail-nav' },
    h('button', { class: 'navback', 'aria-label': 'Back', on: { click: () => { ctx.S.sel = null; ctx.refresh(); } } }, '{{chevleft}}', h('span', { text: backTo })),
    h('span', { class: 'navtitle', text: it.name || '' }),
    trashed ? h('span') : lockedClosed ? h('button', { class: 'navedit', on: { click: () => unlockItemDialog(ctx, it) } }, 'Unlock') : h('button', { class: 'navedit', on: { click: () => editItem(ctx, it) } }, 'Edit'));
  const rows = [];
  if ((it.conflicts || []).length && !trashed) rows.push(h('div', { class: 'note warn conflict-banner', role: 'alert' }, '{{alert}} Edited on two devices: ' + it.conflicts.length + ' value' + (it.conflicts.length > 1 ? 's' : '') + ' differ. The newest was kept and the other is saved. ', h('button', { class: 'linkbtn', on: { click: () => conflictModal(ctx, it) } }, 'Review')));
  if (it.type === 'login') {
    rows.push(field('Username', it.username, { copy: true, ctx }));
    rows.push(field('Password', it.password, { secret: true, copy: true, ctx, extra: undefined }));
    if (it.password) { const e = estimate(it.password); rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'Strength' }), h('div', { class: 'v' }, h('span', { class: 'chip ' + (e.score >= 3 ? 'accent' : e.score === 2 ? 'warn' : 'bad'), text: `${e.label} · ~${Math.round(e.bits)} bits` }), e.issues.length ? h('span', { class: 'hint', text: ' ' + e.issues.join(', ') }) : null))); }
    rows.push(totpField(ctx, it));
    rows.push(field('Website', it.url, { link: true, copy: true, ctx }));
  } else if (it.type === 'card') {
    const c = it.card;
    rows.push(field('Cardholder', c.holder, { copy: true, ctx }));
    rows.push(field('Number', c.number, { secret: true, copy: true, ctx }));
    rows.push(field('Expiry', c.expiry, { copy: true, ctx }));
    rows.push(field('CVV', c.cvv, { secret: true, copy: true, ctx }));
    rows.push(field('PIN', c.pin, { secret: true, copy: true, ctx }));
  } else if (TEMPLATES[it.type]) {
    for (const f of TEMPLATES[it.type].fields) rows.push(templateRow(ctx, it, f));
  }
  rows.push(field('Notes', it.notes, { pre: true, copy: it.type === 'note', ctx, stats: STATS_TYPES.has(it.type) }));
  for (const c of it.custom || []) rows.push(field(c.label || 'Custom field', c.value, { secret: c.secret, copy: true, ctx, pre: true }));
  rows.push(attachmentsField(ctx, it));
  if ((it.tags || []).length) rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'Tags' }), h('div', { class: 'v' }, h('div', { class: 'tags' }, it.tags.map((t) => h('button', { class: 'chip', on: { click: () => ctx.go('tag:' + t) } }, '#' + t))))));
  const nrev = (it.revisions || []).length, nhist = (it.history || []).length;
  if ((nrev || nhist) && !it.lock) rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'History' }), h('div', { class: 'v' }, h('button', { class: 'linkbtn', on: { click: () => historyModal(ctx, it) } }, [nrev ? `${nrev} earlier version${nrev > 1 ? 's' : ''}` : null, nhist ? `${nhist} previous password${nhist > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')))));
  if (lockedClosed) {
    rows.length = 0;
    rows.push(h('div', { class: 'note lockbox', role: 'status' }, h('b', { text: '{{lock}} This item is locked with its own passcode' }), h('p', { text: 'Its details (fields, notes and attached files) stay hidden until you enter the item’s secondary passcode — even though your vault is unlocked.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', on: { click: () => unlockItemDialog(ctx, it) } }, '{{lock}} Enter passcode…'))));
  } else if (it.lock) {
    rows.unshift(h('div', { class: 'note ok lockbox', role: 'status' }, h('b', { text: 'Unlocked with the item passcode' }), h('small', { text: ' — it locks again in 10 minutes, or when the vault locks.' }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => lockDialog(ctx, it, { change: true }) } }, 'Change passcode'),
        h('button', { class: 'btn sm danger', on: { click: async () => { if (await confirmDialog({ title: 'Remove the passcode lock?', text: 'The details go back to being protected by your master password only.', okLabel: 'Remove lock', danger: true })) { try { await store.removeItemLock(it.id, store.itemKeys.get(it.id).code); toast('Lock removed'); ctx.refresh(); } catch (e) { toast(e.message, 'err'); } } } } }, 'Remove lock'))));
  }
  rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'Updated' }), h('div', { class: 'v hint', text: `${fmtDate(it.updated)} · created ${fmtDate(it.created)}${it.type === 'login' && it.password ? ' · password changed ' + fmtDate(it.pwChanged) : ''}` })));

  const out = h('div', null, navbar, h('div', { class: 'detail-head' }, avatar(it.name, it.type), h('div', null, h('h2', { text: it.name || '(untitled)' }), h('span', { class: 'chip' }, h('span', { class: 'icn', text: TYPE_ICON[it.type] }), ' ' + TYPES[it.type]))), actions, h('div', { class: 'fgroup' }, rows));
  currentItem = null;
  return out;
}

export function conflictModal(ctx, it0) {
  const body = h('div');
  const draw = () => {
    const it = ctx.store.get(it0.id);
    if (!it || !(it.conflicts || []).length) { closeConflict(); return; }
    clear(body).append(h('p', { class: 'hint', text: 'This item was changed on two devices. VaultManager kept the newest value of each field; the other value is shown here so nothing is lost.' }),
      it.conflicts.map((c) => {
        const secret = keyIsSecret(it, c.key); let shown = !secret;
        const mk = (text) => { const v = h('div', { class: 'cval mono', text: shown ? text : '••••••••' }); return v; };
        const cur = describeValue(currentValue(it, c.key)), oth = describeValue(c.value);
        const curEl = mk(cur), othEl = mk(oth);
        const eye = secret ? h('button', { class: 'btn sm ghost', on: { click: () => { shown = !shown; curEl.textContent = shown ? cur : '••••••••'; othEl.textContent = shown ? oth : '••••••••'; } } }, '{{eye}} Show / hide') : null;
        return h('div', { class: 'conf' }, h('div', { class: 'row wrap' }, h('b', { text: keyLabel(it, c.key) }), eye),
          h('div', { class: 'grid2' }, h('div', null, h('p', { class: 'lbl', text: 'Kept (newest)' }), curEl), h('div', null, h('p', { class: 'lbl', text: 'Other version · ' + fmtDate(c.at) }), othEl)),
          h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: async () => { await ctx.store.resolveConflict(it.id, c.id, 'keep'); ctx.refresh(); draw(); } } }, '{{check}} Keep current'),
            h('button', { class: 'btn sm primary', on: { click: async () => { await ctx.store.resolveConflict(it.id, c.id, 'other'); ctx.refresh(); draw(); } } }, '{{undo}} Use the other version')));
      }));
  };
  let closeConflict = () => {};
  const m = modal({ title: 'Review conflicts', sub: it0.name, wide: true, body, actions: [{ label: 'Close' }] });
  closeConflict = m.close;
  draw();
}

function templateRow(ctx, it, f) {
  const value = (it.fields || {})[f.k];
  if (!value) return null;
  if (f.kind === 'date' && f.expiry) {
    const d = daysUntil(value), chip = d === null ? null : d < 0 ? h('span', { class: 'chip bad', text: 'expired ' + -d + ' day' + (d === -1 ? '' : 's') + ' ago' }) : d <= 60 ? h('span', { class: 'chip warn', text: 'in ' + d + ' day' + (d === 1 ? '' : 's') }) : null;
    return field(f.l, value, { copy: true, ctx, extra: h('span', null, value + ' ', chip) });
  }
  return field(f.l, value, { secret: isSecretField(f), copy: true, ctx, link: f.kind === 'url', pre: f.kind === 'multiline', stats: STATS_TYPES.has(it.type) && (isSecretField(f) || f.kind === 'multiline') });
}

function wifiModal(ctx, it) {
  const f = it.fields, canvas = h('canvas', { role: 'img', 'aria-label': 'Wi-Fi join QR code' });
  const pw = f.wifipw || '';
  drawQR(canvas, wifiQRString(f.ssid, pw, f.security || 'WPA2'), { scale: 6 }).catch(() => {});
  if (ctx.store.settings.logReveal) ctx.store.log('access', 'Showed the Wi-Fi join QR of “' + it.name + '”');
  modal({ title: 'Join “' + f.ssid + '”', sub: 'Guests scan this with their phone camera', body: h('div', null,
    h('div', { class: 'qrbox' }, canvas),
    h('p', { class: 'note warn', text: 'This QR is NOT encrypted: anyone who sees it can join your network. Show it only to people you trust and close it afterwards. (For a protected code, use “Seal as QR”.)' })), actions: [{ label: 'Close' }] });
}

/* ---------- attachments ---------- */
const IMG = /^image\/(png|jpeg|gif|webp|bmp|avif)$/;
export const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const attIcon = (t) => (IMG.test(t) ? '{{photoid}}' : t === 'application/pdf' ? '{{pdf}}' : /^text\//.test(t) ? '{{doc}}' : /zip|compressed|tar/.test(t) ? '{{archive}}' : '{{clip}}');

function attachmentsField(ctx, it) {
  const canAdd = !it.deleted;
  if (!(it.attachments || []).length && !canAdd) return null;
  const list = h('div', { class: 'atts' });
  for (const a of it.attachments) {
    const row = h('div', { class: 'att' });
    const thumb = h('div', { class: 'thumb' });
    const dl = h('button', { class: 'icon-btn', 'aria-label': 'Download ' + a.name, title: 'Download', on: { click: async () => {
      try { const { bytes } = await ctx.store.readAttachment(it.id, a.id); download(a.name, bytes, 'application/octet-stream'); if (ctx.store.settings.logReveal) ctx.store.log('access', `Downloaded attachment “${a.name}” of “${it.name}”`); } catch (e) { toast(e.message, 'err', 6000); }
    } } }, '{{download}}');
    row.append(thumb, h('div', { class: 'meta' }, h('b', { text: a.name }), h('small', { text: fmtSize(a.size) + ' · ' + (a.type || 'file') })), dl);
    thumb.append(h('span', { text: attIcon(a.type) }));
    if (IMG.test(a.type)) {
      ctx.store.readAttachment(it.id, a.id).then(({ bytes }) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: a.type })); ctx.cleanup.push(() => URL.revokeObjectURL(url));
        const img = h('img', { src: url, alt: a.name, loading: 'lazy' });
        img.addEventListener('click', () => { if (ctx.store.settings.logReveal) ctx.store.log('access', `Viewed image “${a.name}” of “${it.name}”`); modal({ title: a.name, sub: fmtSize(a.size), wide: true, body: h('div', { class: 'qrbox' }, h('img', { src: url, alt: a.name, class: 'bigimg' })), actions: [{ label: 'Close' }] }); });
        clear(thumb).append(img); thumb.classList.add('img');
      }).catch(() => { thumb.append(h('span', { class: 'chip warn', text: 'unavailable' })); });
    } else ctx.store.hasBlob(a.id).then((ok) => { if (!ok) { dl.disabled = true; row.append(h('span', { class: 'chip warn', text: 'not on this device' })); } });
    list.append(row);
  }
  const quick = (capture) => h('input', { type: 'file', class: 'offscreen', multiple: !capture, accept: capture ? 'image/*' : null, capture: capture ? 'environment' : null, 'aria-label': capture ? 'Take a photo for this item' : 'Attach files to this item', on: { change: async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    let n = 0;
    for (const f of files) {
      try { await ctx.store.addAttachment(it.id, { name: f.name || 'photo.jpg', type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }); n++; } catch (x) { toast(x.message, 'err', 6000); }
    }
    if (n) { toast(n + ' attachment' + (n > 1 ? 's' : '') + ' added (encrypted)'); ctx.refresh(); }
  } } });
  const fi = quick(false), ci = quick(true);
  const adder = canAdd ? h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => fi.click() } }, '{{clip}} Add images / documents'), h('button', { class: 'btn sm', on: { click: () => ci.click() } }, '{{camera}} Take photo'), fi, ci) : null;
  return h('div', { class: 'f' }, h('div', { class: 'k', text: 'Attachments' }), h('div', { class: 'v' }, list, (it.attachments || []).length ? null : h('p', { class: 'hint', text: 'No attachments yet. Add pictures (ID, receipts, photos) or documents (PDF, Word…) — they are encrypted.' }), adder), h('div', { class: 'acts' }));
}

function historyModal(ctx, it) {
  const trashed = !!it.deleted;
  const secretFields = new Set(['password', 'totp', 'card']);
  const revs = (it.revisions || []).map((r, idx) => h('div', { class: 'hl' }, h('div', { class: 't' }, h('b', { text: fmtDate(r.at) + ' — before this edit' }),
    h('small', { text: 'changed: ' + r.changed.join(', ') + (r.changed.some((c) => secretFields.has(c)) ? ' (secret values are not shown here)' : '') })),
    trashed ? null : h('button', { class: 'btn sm', on: { click: async () => { await ctx.store.restoreRevision(it.id, idx); toast('Earlier version restored'); ctx.closeModals(); ctx.refresh(); } } }, '{{undo}} Restore')));
  const pws = (it.history || []).map((x) => h('div', { class: 'f' }, h('div', { class: 'k', text: fmtDate(x.at) }), h('div', { class: 'v secret', text: x.pw }),
    h('div', { class: 'acts' }, h('button', { class: 'icon-btn', 'aria-label': 'Copy', on: { click: () => ctx.copySecret(x.pw, 'Old password copied', it, 'previous password') } }, '{{copy}}'))));
  modal({ title: 'Version history', sub: it.name, body: h('div', null,
    revs.length ? [h('p', { class: 'lbl', text: 'Earlier versions (last 10 edits)' }), revs] : null,
    pws.length ? [h('p', { class: 'lbl', text: 'Previous passwords' }), h('p', { class: 'hint', text: 'Shown in readable form. Opening this list is recorded in the audit trail.' }), pws] : null),
    actions: [{ label: 'Close' }] });
  if (pws.length && ctx.store.settings.logReveal) ctx.store.log('access', 'Viewed previous passwords of “' + it.name + '”');
}

/* ---------- editor ---------- */
export function editItem(ctx, item, type = 'login') {
  const { store } = ctx;
  if (item && item.lock && !store.isOpen(item)) { unlockItemDialog(ctx, item); return; }
  if (item) item = store.reveal(item);
  const isNew = !item;
  const it = item ? structuredClone(item) : newItem(type, ctx.S.view.startsWith('tag:') ? { tags: [ctx.S.view.slice(4)] } : {});
  const inp = (key, label, opts = {}) => h('div', { class: 'field' }, h('label', { for: 'f_' + key, text: label }),
    h('input', { id: 'f_' + key, class: 'inp' + (opts.mono ? ' mono' : ''), value: opts.get ? opts.get() : it[key] || '', autocomplete: 'off', spellcheck: 'false', inputmode: opts.inputmode, placeholder: opts.ph, on: { input: (e) => { opts.set ? opts.set(e.target.value) : (it[key] = e.target.value); } } }));
  const err = h('p', { class: 'err', role: 'alert' });

  const body = [];
  body.push(h('div', { class: 'field' }, h('label', { for: 'f_name', text: 'Name' }), h('input', { id: 'f_name', class: 'inp', value: it.name, autofocus: true, autocomplete: 'off', placeholder: ({ card: 'e.g. Visa ending 4242', note: 'e.g. Safe-deposit notes', network: 'e.g. Home Wi-Fi', app: 'e.g. Adobe Creative Cloud', computer: 'e.g. Work laptop', shopping: 'e.g. Amazon', insurance: 'e.g. Car insurance', locker: 'e.g. Gym locker', travel: 'e.g. Passport — Alex', identity: 'e.g. Driver licence', bank: 'e.g. Checking account', server: 'e.g. Production API', contact: 'e.g. Dr. Rivera', phone: 'e.g. My mobile', technical: 'e.g. AWS production', crypto: 'e.g. Ledger Nano', emergency: 'e.g. ICE — Sam', lens: 'e.g. Glasses 2026', membership: 'e.g. City Gym', internet: 'e.g. Home fibre', prescription: 'e.g. Amoxicillin', serial: 'e.g. MacBook Pro', voter: 'e.g. Voter card', photoid: 'e.g. Student ID', library: 'e.g. Central Library', health: 'e.g. Health insurance', car: 'e.g. Honda Civic' })[it.type] || 'e.g. GitHub', on: { input: (e) => { it.name = e.target.value; } } })));
  if (it.type === 'login') {
    body.push(h('div', { class: 'grid2' }, inp('username', 'Username / email'), inp('url', 'Website', { ph: 'https://' })));
    const pf = pwField(it.password, { ctx, onInput: (v) => { it.password = v; } });
    body.push(h('div', { class: 'field' }, h('label', { for: 'f_pw', text: 'Password' }), pf.el));
    body.push(inp('totp', 'One-time code secret (optional)', { mono: true, ph: 'Base32 secret or otpauth:// link' }));
  } else if (it.type === 'card') {
    const c = it.card;
    body.push(h('div', { class: 'grid2' }, inp('holder', 'Cardholder', { get: () => c.holder, set: (v) => { c.holder = v; } }), inp('number', 'Card number', { mono: true, inputmode: 'numeric', get: () => c.number, set: (v) => { c.number = v; } }),
      inp('expiry', 'Expiry (MM/YY)', { mono: true, get: () => c.expiry, set: (v) => { c.expiry = v; } }), inp('cvv', 'CVV', { mono: true, inputmode: 'numeric', get: () => c.cvv, set: (v) => { c.cvv = v; } }),
      inp('pin', 'PIN', { mono: true, inputmode: 'numeric', get: () => c.pin, set: (v) => { c.pin = v; } })));
  } else if (TEMPLATES[it.type]) {
    if (TEMPLATES[it.type].tip) body.push(h('p', { class: 'note', text: TEMPLATES[it.type].tip }));
    body.push(h('div', { class: 'grid2' }, TEMPLATES[it.type].fields.map((f) => tplInput(ctx, it, f))));
  }
  /* custom fields: any extra label / value (optionally secret) on any item */
  const customBox = h('div', { class: 'customs' });
  const drawCustom = () => {
    clear(customBox);
    (it.custom = it.custom || []).forEach((c, i) => customBox.append(h('div', { class: 'cf' },
      h('input', { class: 'inp', value: c.label, placeholder: 'Label', maxlength: '60', 'aria-label': 'Custom field label', on: { input: (e) => { c.label = e.target.value; } } }),
      h('input', { class: 'inp mono', type: c.secret ? 'password' : 'text', value: c.value, placeholder: 'Value', autocomplete: 'off', 'aria-label': 'Custom field value', on: { input: (e) => { c.value = e.target.value; } } }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: c.secret, on: { change: (e) => { c.secret = e.target.checked; drawCustom(); } } }), 'secret'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove custom field', title: 'Remove', on: { click: () => { it.custom.splice(i, 1); drawCustom(); } } }, '{{close}}'))));
  };
  drawCustom();
  body.push(h('div', { class: 'field' }, h('label', { text: 'Custom fields' }), customBox, h('button', { type: 'button', class: 'btn sm', on: { click: () => { if (it.custom.length < MAX_CUSTOM) { it.custom.push({ label: '', value: '', secret: false }); drawCustom(); } } } }, '{{plus}} Add a field')));
  /* attachments are staged here and applied on Save, so Cancel discards them */
  const staged = [], removed = new Set(), existing = (it.attachments || []).map((a) => ({ ...a }));
  const attList = h('div', { class: 'atts' }), attErr = h('p', { class: 'err', role: 'alert' });
  const drawAtt = () => {
    clear(attList);
    for (const a of existing) if (!removed.has(a.id)) attList.append(h('div', { class: 'att' }, h('div', { class: 'thumb' }, h('span', { text: attIcon(a.type) })), h('div', { class: 'meta' }, h('b', { text: a.name }), h('small', { text: fmtSize(a.size) })), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + a.name, title: 'Remove', on: { click: () => { removed.add(a.id); drawAtt(); } } }, '{{close}}')));
    for (const a of staged) attList.append(h('div', { class: 'att' }, h('div', { class: 'thumb' }, h('span', { text: attIcon(a.type) })), h('div', { class: 'meta' }, h('b', { text: a.name }), h('small', { text: fmtSize(a.bytes.length) + ' · will be added on save' })), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + a.name, title: 'Remove', on: { click: () => { staged.splice(staged.indexOf(a), 1); drawAtt(); } } }, '{{close}}')));
  };
  const pick = (capture) => h('input', { type: 'file', class: 'offscreen', multiple: !capture, accept: capture ? 'image/*' : null, capture: capture ? 'environment' : null, 'aria-label': capture ? 'Take a photo' : 'Choose files', on: { change: async (e) => {
    attErr.textContent = '';
    for (const f of Array.from(e.target.files || [])) {
      if (f.size > MAX_ATTACHMENT) { attErr.textContent = `“${f.name}” is ${fmtSize(f.size)}; the limit is ${fmtSize(MAX_ATTACHMENT)} per file.`; continue; }
      if (existing.length - removed.size + staged.length >= MAX_ATTACHMENTS_PER_ITEM) { attErr.textContent = 'At most ' + MAX_ATTACHMENTS_PER_ITEM + ' attachments per item.'; break; }
      staged.push({ name: f.name || 'photo.jpg', type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    e.target.value = ''; drawAtt();
  } } });
  const fileIn = pick(false), camIn = pick(true);
  drawAtt();
  body.push(h('div', { class: 'field' }, h('label', { text: 'Attachments (images, documents — encrypted, up to ' + fmtSize(MAX_ATTACHMENT) + ' each)' }), attList,
    h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn sm', on: { click: () => fileIn.click() } }, '{{clip}} Add files'), h('button', { type: 'button', class: 'btn sm', on: { click: () => camIn.click() } }, '{{camera}} Take photo'), fileIn, camIn), attErr));
  body.push(h('div', { class: 'field' }, h('label', { for: 'f_notes', text: it.type === 'note' ? 'Note' : 'Notes' }), h('textarea', { id: 'f_notes', class: 'ta', rows: it.type === 'note' ? '10' : '4', on: { input: (e) => { it.notes = e.target.value; } } }, it.notes)));
  body.push(inp('tags', 'Tags (comma separated)', { get: () => (it.tags || []).join(', '), set: (v) => { it.tags = v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 30); }, ph: 'work, finance' }));
  body.push(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: it.favorite, on: { change: (e) => { it.favorite = e.target.checked; } } }), 'Favorite'));
  /* optional secondary passcode (new items; existing ones use the Lock button on the detail page) */
  const lockOn = h('input', { type: 'checkbox', id: 'f_lockon' }), lp1 = h('input', { type: 'password', class: 'inp mono', id: 'f_lock1', autocomplete: 'new-password', 'aria-label': 'Item passcode' }), lp2 = h('input', { type: 'password', class: 'inp mono', id: 'f_lock2', autocomplete: 'new-password', 'aria-label': 'Repeat item passcode' });
  const lockBox = h('div', { class: 'field lockfields', hidden: true }, h('label', { for: 'f_lock1', text: 'Item passcode' }), lp1, liveMeter(lp1), h('label', { for: 'f_lock2', text: 'Repeat passcode' }), lp2,
    h('p', { class: 'hint', text: 'Encrypts this item’s details again with this passcode. If you forget it, nobody can recover them.' }));
  lockOn.addEventListener('change', () => { lockBox.hidden = !lockOn.checked; if (lockOn.checked) lp1.focus(); });
  if (isNew) body.push(h('label', { class: 'chk', for: 'f_lockon' }, lockOn, '{{lock}} Protect this item with a secondary passcode'), lockBox);
  body.push(err);

  const save = async () => {
    if (!it.name.trim()) { err.textContent = 'Please give this item a name.'; document.getElementById('f_name').focus(); return false; }
    if (it.type === 'login' && it.totp.trim() && !totpValid(it.totp.trim())) { err.textContent = 'That one-time code secret is not valid (expected base32 or an otpauth://totp link).'; return false; }
    if (isNew && lockOn.checked) { if (lp1.value !== lp2.value) { err.textContent = 'The two item passcodes do not match.'; return false; } if (lp1.value.length < 6) { err.textContent = 'Use at least 6 characters for the item passcode.'; return false; } }
    it.name = it.name.trim(); it.totp = it.totp.trim();
    it.custom = (it.custom || []).filter((c) => c.label.trim() || c.value).map((c) => ({ label: c.label.trim(), value: c.value, secret: !!c.secret }));
    for (const k of Object.keys(it.fields || {})) if (!it.fields[k]) delete it.fields[k];
    if (isNew) { it.created = it.updated = it.pwChanged = Date.now(); it.attachments = []; await store.add(it); }
    else if (it.lock) { const meta = { name: it.name, tags: it.tags, favorite: it.favorite }; await store.saveLocked(it.id, meta, it); }
    else { const { id, history, created, pwChanged, attachments, revisions, deleted, lock, _open, ...patch } = it; await store.update(id, patch); }
    try {
      for (const id of removed) await store.removeAttachment(it.id, id);
      for (const a of staged) await store.addAttachment(it.id, a);
    } catch (e) { toast(e.message, 'err', 7000); }
    if (isNew && lockOn.checked) { try { await store.lockItem(it.id, lp1.value); } catch (e) { toast(e.message, 'err', 7000); } }   // after the files are attached, so they are sealed too
    ctx.showItem(it.id); toast(isNew ? 'Saved to your vault' : 'Changes saved');
  };
  modal({ title: (isNew ? 'New ' : 'Edit ') + TYPES[it.type].toLowerCase(), body: h('div', null, body), actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: save }], wide: false });
}

function tplInput(ctx, it, f) {
  const set = (v) => { if (v) it.fields[f.k] = v; else delete it.fields[f.k]; };
  const val = (it.fields || {})[f.k] || '';
  const id = 'tf_' + f.k;
  const full = f.kind === 'multiline' || (isSecretField(f) && f.gen);
  let control;
  if (f.kind === 'select') control = h('select', { id, class: 'sel', on: { change: (e) => set(e.target.value) } }, h('option', { value: '', text: '— choose —' }), f.options.map((o) => h('option', { value: o, selected: o === val }, o)));
  else if (f.kind === 'multiline') control = h('textarea', { id, class: 'ta', rows: '4', spellcheck: 'false', on: { input: (e) => set(e.target.value) } }, val);
  else if (isSecretField(f) && f.gen) control = pwField(val, { ctx, onInput: set }).el;
  else if (isSecretField(f)) { const i = h('input', { id, type: 'password', class: 'inp mono', value: val, autocomplete: 'off', spellcheck: 'false', on: { input: (e) => set(e.target.value) } }); control = h('div', { class: 'pwwrap' }, i, h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show or hide ' + f.l, on: { click: () => { i.type = i.type === 'password' ? 'text' : 'password'; } } }, '{{eye}}')); }
  else control = h('input', { id, class: 'inp' + (f.mono ? ' mono' : ''), type: f.kind === 'date' ? 'date' : 'text', value: val, autocomplete: 'off', spellcheck: 'false', placeholder: f.kind === 'url' ? 'https://' : null, on: { input: (e) => set(e.target.value) } });
  return h('div', { class: 'field' + (full ? ' full' : '') }, h('label', { for: id, text: f.l }), control);
}

export function newItemMenu(ctx) {
  const pick = (k) => h('button', { class: 'btn', on: { click: () => { ctx.closeModals(); editItem(ctx, null, k); } } }, h('span', { class: 'icn', text: TYPE_ICON[k] }), ' ' + TYPES[k]);
  modal({ title: 'Choose a category', sub: Object.keys(TYPES).length + ' categories. Every one can also hold attachments, notes, tags and custom fields', wide: true,
    body: h('div', null, GROUPS.map(([g, keys]) => h('div', { class: 'catgroup' }, h('p', { class: 'lbl', text: g }), h('div', { class: 'checks cats' }, keys.map(pick))))), actions: [{ label: 'Cancel' }] });
}


/* ---------- secondary passcode lock (per item) ---------- */
export function unlockItemDialog(ctx, it) {
  const input = h('input', { type: 'password', class: 'inp mono', autocomplete: 'off', 'aria-label': 'Item passcode' }), err = h('p', { class: 'err', role: 'alert' });
  let m;
  const go = async () => {
    err.textContent = ''; const b = m && m.el && m.el.querySelector('.btn.primary'); if (b) b.disabled = true;
    try { await ctx.store.openItem(it.id, input.value); m.close(); ctx.refresh(); } catch (e) { err.textContent = e.message === 'bad-passcode' ? 'That is not the passcode for this item.' : e.message; input.select(); if (b) b.disabled = false; }
    return false;
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  m = modal({ title: 'Unlock “' + it.name + '”', sub: 'Secondary passcode', body: h('div', null, h('p', { text: 'This item has its own passcode on top of your master password.' }), input, err),
    actions: [{ label: 'Cancel' }, { label: 'Unlock', kind: 'primary', onClick: go, close: false }] });
  setTimeout(() => input.focus(), 50);
}

export function lockDialog(ctx, it, { change = false } = {}) {
  const store = ctx.store;
  const cur = h('input', { type: 'password', class: 'inp mono', autocomplete: 'off', 'aria-label': 'Current item passcode' });
  const p1 = h('input', { type: 'password', class: 'inp mono', autocomplete: 'new-password', 'aria-label': 'New item passcode' }), p2 = h('input', { type: 'password', class: 'inp mono', autocomplete: 'new-password', 'aria-label': 'Repeat item passcode' });
  const err = h('p', { class: 'err', role: 'alert' });
  const go = async () => {
    err.textContent = '';
    if (p1.value !== p2.value) { err.textContent = 'The two passcodes do not match.'; return false; }
    if (p1.value.length < 6) { err.textContent = 'Use at least 6 characters.'; return false; }
    try {
      if (change) await store.changeItemCode(it.id, cur.value, p1.value); else await store.lockItem(it.id, p1.value);
      toast(change ? 'Passcode changed' : 'Item locked'); ctx.refresh(); return true;
    } catch (e) { err.textContent = e.message === 'bad-passcode' ? 'The current passcode is wrong.' : e.message; return false; }
  };
  modal({ title: change ? 'Change item passcode' : 'Lock “' + it.name + '”', sub: 'Secondary passcode',
    body: h('div', null, h('p', { class: 'note warn', text: 'Its details are encrypted again with this passcode. If you forget it, nobody can recover them — not even with your master password or recovery key. Attached files are sealed with the passcode too, and their names are hidden.' }),
      change ? h('div', { class: 'field' }, h('label', { text: 'Current passcode' }), cur) : null,
      h('div', { class: 'field' }, h('label', { text: 'New passcode' }), p1, liveMeter(p1)), h('div', { class: 'field' }, h('label', { text: 'Repeat passcode' }), p2), err),
    actions: [{ label: 'Cancel' }, { label: change ? 'Change passcode' : 'Lock item', kind: 'primary', onClick: go }] });
}

/* ---------- print helper ---------- */
export function printNodes(nodes) {
  const area = document.getElementById('printArea');
  clear(area).append(...nodes);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); clear(area); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
  setTimeout(done, 120000);
}

/* ---------- QR share (QR Seal v2 compatible) ---------- */
export function shareItem(ctx, it, only = null) {
  const pwBox = h('input', { class: 'inp mono', value: generatePassphrase({ words: 4 }), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'QR password' });
  const pwRow = passwordRow('QR password', pwBox);
  const out = h('div'), err = h('p', { class: 'err', role: 'alert' });
  let canvas = null;
  const make = async () => {
    err.textContent = ''; clear(out);
    if (!pwRow.match()) { err.textContent = 'The two QR passwords do not match.'; return false; }
    if (pwBox.value.length < 8) { err.textContent = 'Use at least 8 characters for the QR password.'; return false; }
    const payload = only ? { vm: 1, name: it.name, field: { label: only.label, value: only.value } } : { vm: 1, item: { type: it.type, name: it.name, username: it.username, password: it.password, url: it.url, totp: it.totp, notes: it.notes, tags: it.tags, card: it.card, fields: it.fields, custom: it.custom } };
    try {
      out.append(h('p', { class: 'hint', text: 'Deriving the key (600,000 rounds) and sealing…' }));
      const sealed = await sealText(JSON.stringify(payload), pwBox.value);
      canvas = h('canvas', { role: 'img', 'aria-label': 'Encrypted QR code' });
      const r = await drawQR(canvas, sealed, { scale: 6 });
      const back = JSON.parse(await openText(sealed, pwBox.value));   // prove it opens again, exactly like the Open QR tab will
      const verified = only ? back.field && back.field.value === only.value : back.item && back.item.name === it.name && JSON.stringify(back.item.fields || {}) === JSON.stringify(it.fields || {}) && back.item.notes === it.notes && back.item.password === it.password;
      if (!verified) throw new Error('The QR did not read back correctly — nothing was changed. Try again.');
      const dc = only ? null : describeContents(it);
      clear(out).append(h('div', { class: 'qrbox' }, canvas), payloadBox(ctx, sealed, { file: 'vaultmanager-' + (it.name.replace(/\W+/g, '-').toLowerCase() || 'item') + '-payload' }), h('div', { class: 'note ok', role: 'status' }, h('b', { text: '✓ Checked: this QR opens again with the password. ' }), only ? 'It holds this single value.' : ['It holds the WHOLE item: ', h('b', { text: dc.included }), '.', dc.attachments ? ` Not included: ${dc.attachments} attached file${dc.attachments === 1 ? '' : 's'} (QR codes are far too small for files — they stay in your vault; a whole-profile backup includes them).` : ' This item has no attached files.'], it.lock ? h('p', { class: 'hint', text: 'This item has a secondary passcode in your vault. The QR is protected by the QR password only — whoever has the picture and that password can read it.' }) : null,
        only ? null : h('div', { class: 'row' }, h('button', { class: 'btn sm', on: { click: () => modal({ title: 'What a scan restores', sub: 'Exactly what “Open QR” will show', wide: true, body: itemCard(ctx, sanitiseItem(back.item)), actions: [{ label: 'Close' }] }) } }, '{{search}} Preview what a scan restores'))), h('p', { class: 'hint', text: `QR version ${r.version} · ECC ${r.ecc} · AES-256-GCM · PBKDF2-SHA256 600,000 rounds. The password is NOT in the code — share it by a different channel.` }),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => canvas.toBlob((b) => download(`vaultmanager-${it.name.replace(/\W+/g, '-').toLowerCase() || 'item'}-${stamp()}.png`, b, 'image/png')) } }, '{{download}} PNG'),
          h('button', { class: 'btn sm', on: { click: () => { const c2 = h('canvas'); c2.width = canvas.width; c2.height = canvas.height; c2.getContext('2d').drawImage(canvas, 0, 0); printNodes([h('h1', { text: 'VaultManager — encrypted QR' }), h('div', { class: 'pq' }, c2, h('div', { text: it.name })), h('p', { text: 'Scan in VaultManager (QR tools → Open) or QR Seal and enter the password. The password is not on this page.' })]); } } }, '{{print}} Print')));
    } catch (e) { clear(out); err.textContent = /too (long|large|big)|capacity|data/i.test(e.message) ? 'This item is too large for one QR code. Remove long notes or use QR tools → Backup to QR, which splits big data over several codes.' : e.message; }
    return false;
  };
  modal({ title: only ? 'Seal “' + only.label + '” as QR' : 'Seal as QR code', sub: it.name, wide: true,
    body: h('div', null, h('p', { class: 'note warn', text: 'Anyone with the QR image AND this password can read the item. Pick a password you can tell the recipient separately.' }),
      h('details', { class: 'how' }, h('summary', { text: 'How does this work?' }), h('ol', null, h('li', { text: only ? 'Only this one value is encrypted (AES-256-GCM) into the QR.' : 'The WHOLE item — every field, notes, custom fields and tags — is encrypted (AES-256-GCM) into the QR with the password below.' }), h('li', { text: only ? 'Attached files can never go into a QR.' : 'Attached files are NOT included, and this cannot be changed: a QR code holds at most about 2–3 KB (roughly 2,900 bytes) once encrypted, while even a small photo or PDF is hundreds of KB to several MB — a thousand times too big. Splitting a file over many QR codes would mean scanning hundreds of them, so it is not offered. The files stay safely in your vault. To move them, use Export profile (an encrypted .vmprofile file that includes attachments).' }), h('li', { text: 'Save, print or show the picture. It is useless without the password, so give the password through a different channel.' }), h('li', { text: 'To restore: Tools → QR tools → Open QR → scan it (or choose the image) → enter the password. You see the full card and press “Add to my vault”.' }))),
      pwRow, err, out),
    actions: [{ label: 'Close' }, { label: 'Purge memory', onClick: () => ctx.purgeMemory() }, { label: 'Create QR', kind: 'primary', onClick: make, close: false }] });
}

/* ---------- emergency kit ---------- */
export function showRecoveryKit(ctx, key, { onDone } = {}) {
  const qrCanvas = h('canvas', { role: 'img', 'aria-label': 'Recovery key QR code' });
  drawQR(qrCanvas, key, { scale: 4 }).catch(() => {});
  const ack = h('input', { type: 'checkbox' });
  const body = h('div', null,
    h('p', { class: 'note warn', text: 'This key can unlock your vault if you forget your master password. It is shown only once and is not stored anywhere in readable form. Print it or write it down and keep it somewhere safe — not on this device.' }),
    h('div', { class: 'recovery', text: key }),
    h('div', { class: 'qrbox' }, qrCanvas),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => copyText(key, 'Recovery key copied', 60) } }, '{{copy}} Copy'),
      h('button', { class: 'btn sm', on: { click: () => { const c2 = h('canvas'); c2.width = qrCanvas.width; c2.height = qrCanvas.height; c2.getContext('2d').drawImage(qrCanvas, 0, 0); printNodes([h('h1', { text: 'VaultManager — Emergency Kit' }), h('p', { text: 'Created ' + fmtDate(Date.now()) + '. Keep this page somewhere safe (a safe, a lockbox). Anyone holding it can unlock your vault’s data file if they also obtain that file.' }), h('div', { class: 'rk', text: key }), h('div', { class: 'pq' }, c2, h('div', { text: 'Recovery key QR' })), h('p', { text: 'To use it: VaultManager → lock screen → “Use recovery key”.' })]); } } }, '{{print}} Print Emergency Kit')),
    h('label', { class: 'chk', style: null }, ack, 'I have stored my recovery key safely'));
  const m = modal({ title: 'Your recovery key', sub: 'Optional, but strongly recommended', body, wide: false, onClose: () => { if (onDone) onDone(); },
    actions: [{ label: 'Done', kind: 'primary', onClick: async () => { if (!ack.checked && !(await confirmDialog({ title: 'Skip saving it?', text: 'Without the recovery key AND without your master password, your data cannot be recovered by anyone — including us. Close anyway?', okLabel: 'Close anyway', danger: true }))) return false; } }] });
  return m;
}
