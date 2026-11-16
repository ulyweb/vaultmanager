/* Recovery-seed grid and per-field passcode lock: the editor controls and the detail-view pieces.
   The stored value stays one plain string (words joined by spaces; or the sealed "VMFL1:…" text from fieldlock.js), so sync, backups,
   QR codes and search need no special handling. */

import { h, clear, focusSoon, modal } from './dom.js';
import { isFieldLocked, fieldValue, openField, relockField, sealField, FIELD_CODE_MIN } from './fieldlock.js';
import { estimate } from './strength.js';

export const WORD_COUNTS = [12, 15, 18, 21, 24];
const MAX_WORDS = 48;

/* ---------- editor: numbered words, each hidden on its own ---------- */
export function seedEditor(initial, { id = 'seed' } = {}) {
  let vals = String(initial || '').split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  let count = WORD_COUNTS.find((c) => c >= vals.length) || vals.length;
  vals = Array.from({ length: count }, (_, i) => vals[i] || '');
  const cells = [], shown = new Set();
  const grid = h('div', { class: 'seedgrid', role: 'group', 'aria-label': 'Recovery seed phrase, one box per word' });
  const status = h('small', { class: 'hint', 'aria-live': 'polite' });
  const sel = h('select', { class: 'sel', id: id + '_count', 'aria-label': 'Number of words', on: { change: () => resize(Number(sel.value), true) } });
  const fillSelect = () => { clear(sel).append(...[...new Set([...WORD_COUNTS, count])].sort((a, b) => a - b).map((n) => h('option', { value: String(n), selected: n === count }, n + ' words'))); sel.value = String(count); };
  const filled = () => vals.filter((v) => v.trim()).length;
  const last = () => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i].trim()) return i; return -1; };
  const note = () => { status.textContent = filled() + ' of ' + count + ' words entered'; };
  const showAll = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': 'false', on: { click: () => { const on = showAll.getAttribute('aria-pressed') !== 'true'; for (let i = 0; i < count; i++) setShown(i, on); } } }, '{{eye}} Show all');
  const syncShowAll = () => { const all = count > 0 && shown.size === count; showAll.setAttribute('aria-pressed', String(all)); showAll.lastChild.textContent = all ? ' Hide all' : ' Show all'; };
  const setShown = (i, on) => {
    if (on) shown.add(i); else shown.delete(i);
    const c = cells[i]; if (!c) return;
    c.input.type = on ? 'text' : 'password'; c.eye.setAttribute('aria-pressed', String(on)); c.eye.setAttribute('aria-label', (on ? 'Hide' : 'Show') + ' word ' + (i + 1));
    syncShowAll();
  };
  const paint = () => { cells.forEach((c, i) => { c.input.value = vals[i] || ''; }); note(); };
  /* put several words into consecutive boxes, growing the grid when a longer phrase is pasted */
  const spread = (from, words) => {
    const need = from + words.length;
    if (need > count) { const next = WORD_COUNTS.find((c) => c >= need) || Math.min(need, MAX_WORDS); build(next); }
    words.forEach((w, k) => { if (from + k < count) vals[from + k] = w; });
    paint(); const target = Math.min(from + words.length, count - 1); if (cells[target]) cells[target].input.focus();
  };
  function build(n) {
    count = n; vals = Array.from({ length: n }, (_, i) => vals[i] || '');
    for (const i of [...shown]) if (i >= n) shown.delete(i);
    cells.length = 0; clear(grid); fillSelect();
    for (let i = 0; i < n; i++) {
      const input = h('input', { id: i === 0 ? id : null, type: shown.has(i) ? 'text' : 'password', class: 'inp mono', value: vals[i] || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Word ' + (i + 1), on: {
        input: (e) => { const t = e.target.value; if (/\s/.test(t)) { const w = t.split(/\s+/).filter(Boolean); if (!w.length) { e.target.value = vals[i] || ''; return; } spread(i, w); } else { vals[i] = t; note(); } },
        paste: (e) => { const t = (e.clipboardData && e.clipboardData.getData('text')) || ''; if (/\s/.test(t.trim())) { e.preventDefault(); spread(i, t.trim().split(/\s+/)); } },
        keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (cells[i + 1]) cells[i + 1].input.focus(); } },
      } });
      const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': (shown.has(i) ? 'Hide' : 'Show') + ' word ' + (i + 1), 'aria-pressed': String(shown.has(i)), on: { click: () => setShown(i, !shown.has(i)) } }, '{{eye}}');
      cells.push({ input, eye });
      grid.append(h('div', { class: 'seedcell' }, h('span', { class: 'n', 'aria-hidden': 'true', text: String(i + 1) }), input, eye));
    }
    note(); syncShowAll();
  }
  function resize(n, fromSelect) {
    if (n < count && vals.slice(n).some((v) => v.trim())) { if (fromSelect) { status.textContent = 'Clear words ' + (n + 1) + '–' + count + ' first, then choose ' + n + ' words.'; sel.value = String(count); } return; }
    build(n);
  }
  build(count);
  const clearAll = h('button', { type: 'button', class: 'btn sm', on: { click: () => { vals = vals.map(() => ''); paint(); if (cells[0]) cells[0].input.focus(); } } }, '{{close}} Clear');
  const el = h('div', { class: 'seededitor' }, h('div', { class: 'seedbar' }, h('label', { class: 'sublbl', for: id + '_count', text: 'Words' }), sel, showAll, clearAll), grid, status);
  return {
    el,
    get: () => vals.slice(0, last() + 1).map((v) => v.trim()).join(' '),
    set: (text) => { const w = String(text || '').split(/\s+/).filter(Boolean).slice(0, MAX_WORDS); vals = w.slice(); const n = WORD_COUNTS.find((c) => c >= w.length) || w.length || 12; shown.clear(); build(n); paint(); },
    problem: () => { const l = last(); for (let i = 0; i < l; i++) if (!vals[i].trim()) return 'word ' + (i + 1) + ' is empty. Fill every word up to word ' + (l + 1) + ', or move the later words up.'; return ''; },
  };
}

/* a single hidden value with a show / hide button (the 25th word) */
function secretInput(initial, { id, label }) {
  const input = h('input', { id, type: 'password', class: 'inp mono', value: initial || '', autocomplete: 'off', spellcheck: 'false' });
  const eye = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show or hide ' + label, on: { click: () => { input.type = input.type === 'password' ? 'text' : 'password'; } } }, '{{eye}}');
  return { el: h('div', { class: 'pwwrap' }, input, eye), get: () => input.value, set: (v) => { input.value = v || ''; }, problem: () => '' };
}

const bitsText = (v) => { if (!v) return ''; const e = estimate(v); return [...v].length + ' characters · ~' + Math.round(e.bits) + ' bits · ' + e.label; };

/* ---------- editor wrapper: a field that can carry a passcode of its own ---------- */
export function lockableField(ctx, it, f) {
  const id = 'tf_' + f.k, stored = (it.fields || {})[f.k] || '';
  const sealed0 = isFieldLocked(stored) ? stored : null;
  const state = { unlocked: !sealed0, code: null };
  const inner = f.words ? seedEditor(sealed0 ? '' : stored, { id }) : secretInput(sealed0 ? '' : stored, { id, label: f.l });
  const editor = h('div'), lockedBox = h('div');
  const lockOn = h('input', { type: 'checkbox', id: 'lk_' + f.k, checked: !!sealed0 });
  const p1 = h('input', { type: 'password', class: 'inp mono', id: 'lk1_' + f.k, autocomplete: 'new-password', 'aria-label': 'Passcode for ' + f.l }), p2 = h('input', { type: 'password', class: 'inp mono', id: 'lk2_' + f.k, autocomplete: 'new-password', 'aria-label': 'Repeat passcode for ' + f.l });
  const meterLine = h('small', { class: 'sbits', 'aria-live': 'polite' });
  p1.addEventListener('input', () => { meterLine.textContent = bitsText(p1.value); });
  const codeBox = h('div', { class: 'lockfields', hidden: !sealed0 });
  const drawCodeBox = () => {
    clear(codeBox).append(h('label', { class: 'sublbl', for: p1.id, text: sealed0 ? 'New passcode (leave both empty to keep the current one)' : 'Passcode for ' + f.l.toLowerCase() }), p1, meterLine,
      h('label', { class: 'sublbl', for: p2.id, text: 'Repeat passcode' }), p2,
      h('p', { class: 'hint', text: 'This ' + f.l.toLowerCase() + ' is encrypted again with this passcode (at least ' + FIELD_CODE_MIN + ' characters; longer is better). If you forget it nobody can recover it, not even with your master password or recovery key.' }));
  };
  drawCodeBox();
  lockOn.addEventListener('change', () => { codeBox.hidden = !lockOn.checked; if (lockOn.checked && !state.code) p1.focus(); });
  const lockRow = h('label', { class: 'chk', for: lockOn.id }, lockOn, '{{lock}} Lock with its own passcode');
  const showEditor = () => { clear(lockedBox); clear(editor).append(inner.el, lockRow, codeBox); };
  if (sealed0) {
    clear(lockedBox).append(h('div', { class: 'note lockbox', role: 'status' }, h('b', { text: '{{lock}} Locked with its own passcode' }), h('p', { class: 'hint', text: 'Leave it alone and it is saved exactly as it is. To change it, unlock it first.' }),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', on: { click: () => unlockFieldDialog(ctx, sealed0, f.l, { item: it, then: (value, code) => { state.unlocked = true; state.code = code; inner.set(value); showEditor(); } }) } }, '{{lock}} Unlock to edit…'))));
  } else showEditor();
  const el = h('div', { class: 'field full lockablefield' }, h('label', { for: id, text: f.l }), lockedBox, editor);
  return {
    key: f.k, el,
    check() {
      if (!state.unlocked) return '';
      const pr = inner.problem(); if (pr) return f.l + ': ' + pr;
      if (!lockOn.checked || !inner.get()) return '';
      const code = p1.value || state.code;
      if (!code) return 'Choose a passcode for the ' + f.l.toLowerCase() + ', or untick “Lock with its own passcode”.';
      if (p1.value !== p2.value) return 'The two passcodes for the ' + f.l.toLowerCase() + ' do not match.';
      if (code.length < FIELD_CODE_MIN) return 'Use at least ' + FIELD_CODE_MIN + ' characters for the ' + f.l.toLowerCase() + ' passcode.';
      return '';
    },
    /* the value to store: the sealed text, the plain text, or '' to remove the field */
    async resolve() {
      if (!state.unlocked) return sealed0;
      const value = inner.get(); if (!value) return '';
      if (!lockOn.checked) return value;
      return sealField(value, p1.value || state.code);
    },
  };
}

/* ---------- unlock dialog (works from the sealed text alone, so it also serves a scanned-QR preview) ---------- */
export function unlockFieldDialog(ctx, sealed, label, { item = null, then = null } = {}) {
  const input = h('input', { type: 'password', class: 'inp mono', autocomplete: 'off', 'aria-label': 'Passcode for ' + label }), err = h('p', { class: 'err', role: 'alert' });
  let m;
  const go = async () => {
    err.textContent = ''; const b = m && m.el && m.el.querySelector('.btn.primary'); if (b) b.disabled = true;
    try {
      const code = input.value, value = await openField(sealed, code);
      if (item && ctx.store.log) ctx.store.log('access', 'Opened the passcode-locked ' + label.toLowerCase() + ' of “' + item.name + '”');
      m.close(); if (then) then(value, code); else ctx.refresh();
    } catch (e) { err.textContent = e.message === 'bad-passcode' ? 'That is not the passcode for this ' + label.toLowerCase() + '.' : e.message; input.select(); if (b) b.disabled = false; }
    return false;
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  m = modal({ title: 'Unlock the ' + label.toLowerCase(), sub: item ? item.name : 'Passcode', body: h('div', null, h('p', { text: 'This value has a passcode of its own, on top of your master password. It stays readable for 10 minutes, or until the vault locks.' }), input, err),
    actions: [{ label: 'Cancel' }, { label: 'Unlock', kind: 'primary', onClick: go, close: false }] });
  focusSoon(input, 50);
  return m;
}

/* ---------- detail view ---------- */
export function lockedFieldRow(ctx, it, label, sealed) {
  return h('div', { class: 'f' }, h('div', { class: 'k', text: label }),
    h('div', { class: 'v' }, h('span', { class: 'chip warn', text: '{{lock}} Locked with its own passcode' }), h('small', { class: 'hint', text: ' Its value is encrypted again and hidden until you enter that passcode.' })),
    h('div', { class: 'acts' }, h('button', { class: 'btn sm', 'aria-label': 'Unlock ' + label, on: { click: () => unlockFieldDialog(ctx, sealed, label, { item: it }) } }, '{{lock}} Unlock')));
}
export const relockButton = (ctx, sealed, label) => h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Lock ' + label + ' again', title: 'Lock again now', on: { click: () => { relockField(sealed); ctx.refresh(); } } }, '{{lock}} Lock');

/* the numbered words of a seed phrase, each hidden until you tap it */
export function seedView(ctx, it, label, phrase) {
  const words = String(phrase).split(/\s+/).filter(Boolean), shown = new Set(), btns = [];
  let logged = false;
  const grid = h('div', { class: 'seedgrid view', role: 'group', 'aria-label': label + ', one tile per word' });
  const all = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': 'false', on: { click: () => { const on = all.getAttribute('aria-pressed') !== 'true'; words.forEach((_, i) => set(i, on)); } } }, '{{eye}} Show all');
  const set = (i, on) => {
    if (on && !logged && it && ctx.store.settings.logReveal) { logged = true; ctx.store.log('access', 'Revealed words of the ' + label.toLowerCase() + ' of “' + it.name + '”'); }
    if (on) shown.add(i); else shown.delete(i);
    const b = btns[i]; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', (on ? 'Hide' : 'Show') + ' word ' + (i + 1));
    b.lastChild.textContent = on ? words[i] : '••••••';
    const every = shown.size === words.length; all.setAttribute('aria-pressed', String(every)); all.lastChild.textContent = every ? ' Hide all' : ' Show all';
  };
  words.forEach((w, i) => { const b = h('button', { type: 'button', class: 'seedcell tile mono', 'aria-pressed': 'false', 'aria-label': 'Show word ' + (i + 1), on: { click: () => set(i, !shown.has(i)) } }, h('span', { class: 'n', 'aria-hidden': 'true', text: String(i + 1) }), h('span', { class: 'w', text: '••••••' })); btns.push(b); grid.append(b); });
  return h('div', { class: 'seedview' }, grid, h('div', { class: 'row wrap' }, all, h('small', { class: 'hint', text: words.length + ' words. Tap a word to show it; the others stay hidden.' })));
}

/* "plain, or open?" for a stored value: the readable text, or null while it is locked */
export function readable(value) { return isFieldLocked(value) ? fieldValue(value) : value; }
