/* Vault views: item list, detail panel, editor, QR share, recovery kit. */

import { h, clear, modal, toast, confirmDialog, copyText, download } from './dom.js';
import { newItem, TYPES, matches, totpValid, MAX_ATTACHMENT, MAX_ATTACHMENTS_PER_ITEM } from './vault.js';
import { estimate, crackTime } from './strength.js';
import { generatePassword, generatePassphrase } from './generator.js';
import { totpNow, parseTotp } from './totp.js';
import { sealText } from './crypto.js';
import { drawQR } from './qr.js';
import { fmtDate, hostOf, safeHref } from './util.js';

export const TYPE_ICON = { login: '🔑', note: '📝', card: '💳' };

export function avatar(name) {
  const n = (name || '?').trim() || '?';
  let hash = 0; for (const c of n) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  const a = h('div', { class: 'avatar', 'aria-hidden': 'true' }, Array.from(n)[0].toUpperCase());
  a.style.background = `hsl(${hash % 360} 52% 38%)`;
  return a;
}

export function meter(pw) {
  const e = estimate(pw);
  const bar = h('i', { class: 's' + e.score });
  bar.style.width = (pw ? Math.max(6, (e.score + 1) * 20) : 0) + '%';
  return { el: h('div', null, h('div', { class: 'meter', role: 'img', 'aria-label': 'Password strength: ' + e.label }, bar),
    h('div', { class: 'meter-label' }, h('span', { text: pw ? e.label : '' }), h('span', { text: pw ? `~${Math.round(e.bits)} bits · ${crackTime(e.bits)}` : '' }))), est: e };
}

export function pwField(initial, { id, onInput, ctx, autocomplete = 'new-password' } = {}) {
  const input = h('input', { type: 'password', class: 'inp mono', value: initial || '', autocomplete, spellcheck: 'false', id, 'aria-label': 'Password' });
  const m = h('div');
  const upd = () => { const { el } = meter(input.value); clear(m).append(el); if (onInput) onInput(input.value); };
  input.addEventListener('input', upd);
  const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show or hide', title: 'Show / hide', on: { click: () => { input.type = input.type === 'password' ? 'text' : 'password'; } } }, '👁');
  const g = () => ctx.store.settings.gen;
  const fill = (v) => { input.value = v; input.type = 'text'; upd(); };
  const wrap = h('div', null,
    h('div', { class: 'pwwrap' }, input, eye),
    h('div', { class: 'row wrap', style: null }, h('button', { type: 'button', class: 'btn sm', on: { click: () => fill(generatePassword(g())) } }, '⚡ Generate'),
      h('button', { type: 'button', class: 'btn sm', on: { click: () => fill(generatePassphrase({ words: g().words, separator: g().separator, capitalize: g().capitalize, number: g().number })) } }, '🔤 Passphrase'),
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
  else if (['login', 'note', 'card'].includes(v)) items = items.filter((i) => i.type === v);
  else if (v.startsWith('tag:')) items = items.filter((i) => (i.tags || []).includes(v.slice(4)));
  if (S.q) items = items.filter((i) => matches(i, S.q));
  return items.sort((a, b) => (b.favorite - a.favorite) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

const TITLES = { all: 'All items', fav: 'Favorites', login: 'Logins', note: 'Secure notes', card: 'Payment cards', trash: 'Trash' };

export function renderVaultView(ctx) {
  const { S, store } = ctx;
  const items = filterItems(ctx);
  if (S.sel && !items.find((i) => i.id === S.sel)) S.sel = null;
  const sel = S.sel ? store.get(S.sel) : null;

  const list = h('div', { class: 'panel list' },
    h('div', { class: 'list-head' }, h('span', { text: S.view.startsWith('tag:') ? '#' + S.view.slice(4) : TITLES[S.view] || 'Items' }), h('span', { text: String(items.length), style: null }),
      S.view === 'trash' && items.length ? h('button', { class: 'btn sm danger', style: null, on: { click: async () => { if (await confirmDialog({ title: 'Empty trash?', text: 'These items will be permanently deleted.', okLabel: 'Delete forever', danger: true })) { await store.emptyTrash(); ctx.refresh(); } } } }, 'Empty') : null),
    h('div', { class: 'items', role: 'listbox', 'aria-label': 'Items' }, items.length ? items.map((it) => itemRow(ctx, it)) : emptyState(ctx, items)));
  const detail = h('div', { class: 'panel detail', 'aria-live': 'polite' }, sel ? detailPanel(ctx, sel) : h('div', { class: 'empty' }, h('div', { class: 'big', text: '🔐' }), h('p', { text: 'Select an item to view it.' })));
  return h('div', { class: 'split' + (sel ? ' has-sel' : '') }, list, detail);
}

function emptyState(ctx, items) {
  const { S, store } = ctx;
  if (S.q) return h('div', { class: 'empty' }, h('div', { class: 'big', text: '🔎' }), h('p', { text: 'Nothing matches “' + S.q + '”.' }));
  if (S.view === 'trash') return h('div', { class: 'empty' }, h('div', { class: 'big', text: '🗑' }), h('p', { text: 'Trash is empty. Deleted items stay here for 30 days.' }));
  if (!store.active().length) return h('div', { class: 'empty' }, h('div', { class: 'big', text: '🛡' }), h('p', { text: 'Your vault is empty.' }),
    h('div', { class: 'row', style: null }, h('button', { class: 'btn primary', on: { click: () => editItem(ctx, null, 'login') } }, '＋ Add your first login'),
      h('button', { class: 'btn', on: { click: () => ctx.go('data') } }, '⇪ Import')));
  return h('div', { class: 'empty' }, h('p', { text: 'No items here yet.' }));
}

function itemRow(ctx, it) {
  const sub = it.type === 'login' ? (it.username || hostOf(it.url)) : it.type === 'card' ? '•••• ' + (it.card.number || '').replace(/\D/g, '').slice(-4) : (it.notes || '').split('\n')[0].slice(0, 60);
  return h('button', { class: 'item' + (ctx.S.sel === it.id ? ' on' : ''), role: 'option', 'aria-selected': String(ctx.S.sel === it.id), on: { click: () => { ctx.S.sel = it.id; ctx.refresh(); } } },
    avatar(it.name), h('div', { class: 't' }, h('b', { text: it.name || '(untitled)' }), h('small', { text: sub })), (it.attachments || []).length ? h('span', { class: 'clip', text: '📎', title: it.attachments.length + ' attachment(s)' }) : null, it.favorite ? h('span', { class: 'star', text: '★', 'aria-label': 'Favorite' }) : null);
}

/* ---------- detail ---------- */
let currentItem = null;   // set while a detail panel is being built, so field() can audit copy / reveal events
function field(label, value, { secret, copy, ctx, pre, link, extra } = {}) {
  const item = currentItem;
  if (!value && !extra) return null;
  let shown = !secret;
  const v = h('div', { class: 'v' + (secret ? ' secret' : '') + (pre ? ' pre' : '') });
  const set = () => { clear(v); if (link && safeHref(value)) v.append(h('a', { href: safeHref(value), target: '_blank', rel: 'noopener noreferrer nofollow' }, value)); else v.append(shown ? value : '•'.repeat(Math.min(16, Math.max(8, value.length)))); };
  if (value) set();
  const acts = h('div', { class: 'acts' });
  if (secret) acts.append(h('button', { class: 'icon-btn', 'aria-label': 'Show or hide ' + label, title: 'Show / hide', on: { click: () => { shown = !shown; set(); if (shown && item && ctx.store.settings.logReveal) ctx.store.log('access', 'Revealed ' + label.toLowerCase() + ' of “' + item.name + '”'); } } }, '👁'));
  if (copy) acts.append(h('button', { class: 'icon-btn', 'aria-label': 'Copy ' + label, title: 'Copy', on: { click: () => ctx.copySecret(value, label + ' copied', item, label) } }, '⧉'));
  return h('div', { class: 'f' }, h('div', { class: 'k', text: label }), extra ? h('div', { class: 'v' }, extra) : v, acts);
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
    h('div', { class: 'acts' }, h('button', { class: 'icon-btn', 'aria-label': 'Copy one-time code', on: { click: () => ctx.copySecret(last, 'Code copied', it, 'one-time code') } }, '⧉')));
  return f;
}

function detailPanel(ctx, it) {
  const { store } = ctx;
  currentItem = it;
  const trashed = !!it.deleted;
  const actions = h('div', { class: 'detail-actions' },
    h('button', { class: 'btn back sm', on: { click: () => { ctx.S.sel = null; ctx.refresh(); } } }, '← Back'),
    trashed ? [h('button', { class: 'btn primary sm', on: { click: async () => { await store.restore(it.id); toast('Restored'); ctx.refresh(); } } }, '↩ Restore'),
      h('button', { class: 'btn danger sm', on: { click: async () => { if (await confirmDialog({ title: 'Delete forever?', text: `“${it.name}” will be permanently deleted.`, okLabel: 'Delete forever', danger: true })) { await store.purge(it.id); ctx.S.sel = null; ctx.refresh(); } } } }, '✕ Delete forever')] :
      [h('button', { class: 'btn sm', on: { click: () => editItem(ctx, it) } }, '✎ Edit'),
        h('button', { class: 'btn sm' + (it.favorite ? ' primary' : ''), 'aria-pressed': String(it.favorite), on: { click: async () => { await store.update(it.id, { favorite: !it.favorite }); ctx.refresh(); } } }, it.favorite ? '★ Favorite' : '☆ Favorite'),
        h('button', { class: 'btn sm', on: { click: () => shareItem(ctx, it) } }, '▦ Seal as QR'),
        h('button', { class: 'btn sm', on: { click: async () => { const c = newItem(it.type, { ...structuredClone(it), id: undefined, name: it.name + ' (copy)', history: [], created: Date.now(), updated: Date.now() }); c.id = newItem().id; await store.add(c); ctx.S.sel = c.id; toast('Duplicated'); ctx.refresh(); } } }, '⎘ Duplicate'),
        h('button', { class: 'btn danger sm', on: { click: async () => { await store.trash(it.id); ctx.S.sel = null; toast('Moved to trash'); ctx.refresh(); } } }, '🗑 Delete')]);

  const rows = [];
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
  }
  rows.push(field('Notes', it.notes, { pre: true, copy: it.type === 'note', ctx }));
  rows.push(attachmentsField(ctx, it));
  if ((it.tags || []).length) rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'Tags' }), h('div', { class: 'v' }, h('div', { class: 'tags' }, it.tags.map((t) => h('button', { class: 'chip', on: { click: () => ctx.go('tag:' + t) } }, '#' + t))))));
  const nrev = (it.revisions || []).length, nhist = (it.history || []).length;
  if (nrev || nhist) rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'History' }), h('div', { class: 'v' }, h('button', { class: 'linkbtn', on: { click: () => historyModal(ctx, it) } }, [nrev ? `${nrev} earlier version${nrev > 1 ? 's' : ''}` : null, nhist ? `${nhist} previous password${nhist > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ')))));
  rows.push(h('div', { class: 'f' }, h('div', { class: 'k', text: 'Updated' }), h('div', { class: 'v hint', text: `${fmtDate(it.updated)} · created ${fmtDate(it.created)}${it.type === 'login' && it.password ? ' · password changed ' + fmtDate(it.pwChanged) : ''}` })));

  const out = h('div', null, h('div', { class: 'detail-head' }, avatar(it.name), h('div', null, h('h2', { text: it.name || '(untitled)' }), h('span', { class: 'chip', text: TYPE_ICON[it.type] + ' ' + TYPES[it.type] }))), actions, rows);
  currentItem = null;
  return out;
}

/* ---------- attachments ---------- */
const IMG = /^image\/(png|jpeg|gif|webp|bmp|avif)$/;
export const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const attIcon = (t) => (IMG.test(t) ? '🖼' : t === 'application/pdf' ? '📕' : /^text\//.test(t) ? '📄' : /zip|compressed|tar/.test(t) ? '🗜' : '📎');

function attachmentsField(ctx, it) {
  if (!(it.attachments || []).length) return null;
  const list = h('div', { class: 'atts' });
  for (const a of it.attachments) {
    const row = h('div', { class: 'att' });
    const thumb = h('div', { class: 'thumb' });
    const dl = h('button', { class: 'icon-btn', 'aria-label': 'Download ' + a.name, title: 'Download', on: { click: async () => {
      try { const { bytes } = await ctx.store.readAttachment(it.id, a.id); download(a.name, bytes, 'application/octet-stream'); if (ctx.store.settings.logReveal) ctx.store.log('access', `Downloaded attachment “${a.name}” of “${it.name}”`); } catch (e) { toast(e.message, 'err', 6000); }
    } } }, '⬇');
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
  return h('div', { class: 'f' }, h('div', { class: 'k', text: 'Attachments' }), h('div', { class: 'v' }, list), h('div', { class: 'acts' }));
}

function historyModal(ctx, it) {
  const trashed = !!it.deleted;
  const secretFields = new Set(['password', 'totp', 'card']);
  const revs = (it.revisions || []).map((r, idx) => h('div', { class: 'hl' }, h('div', { class: 't' }, h('b', { text: fmtDate(r.at) + ' — before this edit' }),
    h('small', { text: 'changed: ' + r.changed.join(', ') + (r.changed.some((c) => secretFields.has(c)) ? ' (secret values are not shown here)' : '') })),
    trashed ? null : h('button', { class: 'btn sm', on: { click: async () => { await ctx.store.restoreRevision(it.id, idx); toast('Earlier version restored'); ctx.closeModals(); ctx.refresh(); } } }, '↩ Restore')));
  const pws = (it.history || []).map((x) => h('div', { class: 'f' }, h('div', { class: 'k', text: fmtDate(x.at) }), h('div', { class: 'v secret', text: x.pw }),
    h('div', { class: 'acts' }, h('button', { class: 'icon-btn', 'aria-label': 'Copy', on: { click: () => ctx.copySecret(x.pw, 'Old password copied', it, 'previous password') } }, '⧉'))));
  modal({ title: 'Version history', sub: it.name, body: h('div', null,
    revs.length ? [h('p', { class: 'lbl', text: 'Earlier versions (last 10 edits)' }), revs] : null,
    pws.length ? [h('p', { class: 'lbl', text: 'Previous passwords' }), h('p', { class: 'hint', text: 'Shown in readable form. Opening this list is recorded in the audit trail.' }), pws] : null),
    actions: [{ label: 'Close' }] });
  if (pws.length && ctx.store.settings.logReveal) ctx.store.log('access', 'Viewed previous passwords of “' + it.name + '”');
}

/* ---------- editor ---------- */
export function editItem(ctx, item, type = 'login') {
  const { store } = ctx;
  const isNew = !item;
  const it = item ? structuredClone(item) : newItem(type, ctx.S.view.startsWith('tag:') ? { tags: [ctx.S.view.slice(4)] } : {});
  const inp = (key, label, opts = {}) => h('div', { class: 'field' }, h('label', { for: 'f_' + key, text: label }),
    h('input', { id: 'f_' + key, class: 'inp' + (opts.mono ? ' mono' : ''), value: opts.get ? opts.get() : it[key] || '', autocomplete: 'off', spellcheck: 'false', inputmode: opts.inputmode, placeholder: opts.ph, on: { input: (e) => { opts.set ? opts.set(e.target.value) : (it[key] = e.target.value); } } }));
  const err = h('p', { class: 'err', role: 'alert' });

  const body = [];
  body.push(h('div', { class: 'field' }, h('label', { for: 'f_name', text: 'Name' }), h('input', { id: 'f_name', class: 'inp', value: it.name, autofocus: true, autocomplete: 'off', placeholder: it.type === 'card' ? 'e.g. Visa ending 4242' : it.type === 'note' ? 'e.g. Wi-Fi at the cabin' : 'e.g. GitHub', on: { input: (e) => { it.name = e.target.value; } } })));
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
  }
  /* attachments are staged here and applied on Save, so Cancel discards them */
  const staged = [], removed = new Set(), existing = (it.attachments || []).map((a) => ({ ...a }));
  const attList = h('div', { class: 'atts' }), attErr = h('p', { class: 'err', role: 'alert' });
  const drawAtt = () => {
    clear(attList);
    for (const a of existing) if (!removed.has(a.id)) attList.append(h('div', { class: 'att' }, h('div', { class: 'thumb' }, h('span', { text: attIcon(a.type) })), h('div', { class: 'meta' }, h('b', { text: a.name }), h('small', { text: fmtSize(a.size) })), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + a.name, title: 'Remove', on: { click: () => { removed.add(a.id); drawAtt(); } } }, '✕')));
    for (const a of staged) attList.append(h('div', { class: 'att' }, h('div', { class: 'thumb' }, h('span', { text: attIcon(a.type) })), h('div', { class: 'meta' }, h('b', { text: a.name }), h('small', { text: fmtSize(a.bytes.length) + ' · will be added on save' })), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + a.name, title: 'Remove', on: { click: () => { staged.splice(staged.indexOf(a), 1); drawAtt(); } } }, '✕')));
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
    h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn sm', on: { click: () => fileIn.click() } }, '📎 Add files'), h('button', { type: 'button', class: 'btn sm', on: { click: () => camIn.click() } }, '📷 Take photo'), fileIn, camIn), attErr));
  body.push(h('div', { class: 'field' }, h('label', { for: 'f_notes', text: it.type === 'note' ? 'Note' : 'Notes' }), h('textarea', { id: 'f_notes', class: 'ta', rows: it.type === 'note' ? '10' : '4', on: { input: (e) => { it.notes = e.target.value; } } }, it.notes)));
  body.push(inp('tags', 'Tags (comma separated)', { get: () => (it.tags || []).join(', '), set: (v) => { it.tags = v.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 30); }, ph: 'work, finance' }));
  body.push(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: it.favorite, on: { change: (e) => { it.favorite = e.target.checked; } } }), 'Favorite'));
  body.push(err);

  const save = async () => {
    if (!it.name.trim()) { err.textContent = 'Please give this item a name.'; document.getElementById('f_name').focus(); return false; }
    if (it.type === 'login' && it.totp.trim() && !totpValid(it.totp.trim())) { err.textContent = 'That one-time code secret is not valid (expected base32 or an otpauth://totp link).'; return false; }
    it.name = it.name.trim(); it.totp = it.totp.trim();
    if (isNew) { it.created = it.updated = it.pwChanged = Date.now(); it.attachments = []; await store.add(it); }
    else { const { id, history, created, pwChanged, attachments, revisions, deleted, ...patch } = it; await store.update(id, patch); }
    try {
      for (const id of removed) await store.removeAttachment(it.id, id);
      for (const a of staged) await store.addAttachment(it.id, a);
    } catch (e) { toast(e.message, 'err', 7000); }
    ctx.S.sel = it.id; toast(isNew ? 'Saved to your vault' : 'Changes saved'); ctx.refresh();
  };
  modal({ title: (isNew ? 'New ' : 'Edit ') + TYPES[it.type].toLowerCase(), body: h('div', null, body), actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: save }], wide: false });
}

export function newItemMenu(ctx) {
  modal({ title: 'Add to your vault', body: h('div', { class: 'checks' }, Object.entries(TYPES).map(([k, label]) => h('button', { class: 'btn', style: null, on: { click: () => { ctx.closeModals(); editItem(ctx, null, k); } } }, TYPE_ICON[k] + ' ' + label))), actions: [{ label: 'Cancel' }] });
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
export function shareItem(ctx, it) {
  const pwBox = h('input', { class: 'inp mono', value: generatePassphrase({ words: 4 }), autocomplete: 'off', spellcheck: 'false', 'aria-label': 'QR password' });
  const out = h('div'), err = h('p', { class: 'err', role: 'alert' });
  let canvas = null;
  const make = async () => {
    err.textContent = ''; clear(out);
    if (pwBox.value.length < 8) { err.textContent = 'Use at least 8 characters for the QR password.'; return false; }
    const payload = { vm: 1, item: { type: it.type, name: it.name, username: it.username, password: it.password, url: it.url, totp: it.totp, notes: it.notes, tags: it.tags, card: it.card } };
    try {
      out.append(h('p', { class: 'hint', text: 'Deriving the key (600,000 rounds) and sealing…' }));
      const sealed = await sealText(JSON.stringify(payload), pwBox.value);
      canvas = h('canvas', { role: 'img', 'aria-label': 'Encrypted QR code' });
      const r = await drawQR(canvas, sealed, { scale: 6 });
      clear(out).append(h('div', { class: 'qrbox' }, canvas), h('p', { class: 'hint', text: `QR version ${r.version} · ECC ${r.ecc} · AES-256-GCM · PBKDF2-SHA256 600,000 rounds. The password is NOT in the code — share it by a different channel.` }),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => canvas.toBlob((b) => download(`vaultmanager-${it.name.replace(/\W+/g, '-').toLowerCase() || 'item'}.png`, b, 'image/png')) } }, '⬇ PNG'),
          h('button', { class: 'btn sm', on: { click: () => { const c2 = h('canvas'); c2.width = canvas.width; c2.height = canvas.height; c2.getContext('2d').drawImage(canvas, 0, 0); printNodes([h('h1', { text: 'VaultManager — encrypted QR' }), h('div', { class: 'pq' }, c2, h('div', { text: it.name })), h('p', { text: 'Scan in VaultManager (QR tools → Open) or QR Seal and enter the password. The password is not on this page.' })]); } } }, '🖨 Print')));
    } catch (e) { clear(out); err.textContent = e.message; }
    return false;
  };
  modal({ title: 'Seal as QR code', sub: it.name, wide: true,
    body: h('div', null, h('p', { class: 'note warn', text: 'Anyone with the QR image AND this password can read the item. Pick a password you can tell the recipient separately.' }),
      h('div', { class: 'field' }, h('label', { text: 'QR password' }), h('div', { class: 'row' }, h('div', { class: 'grow' }, pwBox), h('button', { class: 'btn sm', on: { click: () => { pwBox.value = generatePassphrase({ words: 4 }); } } }, '⚡'))), err, out),
    actions: [{ label: 'Close' }, { label: 'Create QR', kind: 'primary', onClick: make, close: false }] });
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
    h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', on: { click: () => copyText(key, 'Recovery key copied', 60) } }, '⧉ Copy'),
      h('button', { class: 'btn sm', on: { click: () => { const c2 = h('canvas'); c2.width = qrCanvas.width; c2.height = qrCanvas.height; c2.getContext('2d').drawImage(qrCanvas, 0, 0); printNodes([h('h1', { text: 'VaultManager — Emergency Kit' }), h('p', { text: 'Created ' + fmtDate(Date.now()) + '. Keep this page somewhere safe (a safe, a lockbox). Anyone holding it can unlock your vault’s data file if they also obtain that file.' }), h('div', { class: 'rk', text: key }), h('div', { class: 'pq' }, c2, h('div', { text: 'Recovery key QR' })), h('p', { text: 'To use it: VaultManager → lock screen → “Use recovery key”.' })]); } } }, '🖨 Print Emergency Kit')),
    h('label', { class: 'chk', style: null }, ack, 'I have stored my recovery key safely'));
  const m = modal({ title: 'Your recovery key', sub: 'Optional, but strongly recommended', body, wide: false, onClose: () => { if (onDone) onDone(); },
    actions: [{ label: 'Done', kind: 'primary', onClick: async () => { if (!ack.checked && !(await confirmDialog({ title: 'Skip saving it?', text: 'Without the recovery key AND without your master password, your data cannot be recovered by anyone — including us. Close anyway?', okLabel: 'Close anyway', danger: true }))) return false; } }] });
  return m;
}
