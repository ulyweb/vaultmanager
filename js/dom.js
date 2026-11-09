import { splitToken } from './icons.js';

/* Tiny DOM toolkit. Everything is built with createElement / textContent — never innerHTML — so
   vault contents (names, notes, imported data) can never be interpreted as markup. */

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  /* Elements built here get a forgiving append(): arrays are flattened, null / false are skipped and
     strings become text nodes (the native method would print "null" and "[object HTMLElement]"). */
  el.append = (...k) => { append(el, k); };
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') setText(el, v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}
function setText(el, v) {
  const t = splitToken(v);
  if (!t) { el.textContent = v; return; }
  el.textContent = ''; el.appendChild(t[0]); if (t[1]) el.appendChild(document.createTextNode(t[1]));
}
export const setLabel = (el, v) => setText(el, v);
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    if (k instanceof Node) { el.appendChild(k); continue; }
    const t = splitToken(k);   // a leading {{icon}} token becomes an icon
    if (t) { el.appendChild(t[0]); if (t[1]) el.appendChild(document.createTextNode(t[1])); } else el.appendChild(document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- toasts ---------- */
export function toast(msg, kind = 'ok', ms = 3200) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }, msg);
  while (box.children.length >= 2) box.firstChild.remove();   // never pile up: keep the two newest
  box.append(t);
  t.addEventListener('click', () => t.remove());
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}

/* ---------- haptics (Android; harmless elsewhere) ---------- */
export const buzz = (ms = 8) => { try { if (document.documentElement.dataset.haptics === '1' && navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } };

/* ---------- modal ---------- */
const stack = [];
export function modal({ title, sub, body, actions = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const close = () => {
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    overlay.remove();
    if (prev && prev.focus && document.contains(prev)) prev.focus();
    if (onClose) onClose();
  };
  const grabber = h('div', { class: 'grabber', 'aria-hidden': 'true' }, h('i'));
  const head = h('div', { class: 'modal-header' },
    h('div', null, h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null),
    h('button', { class: 'modal-close', 'aria-label': 'Close', on: { click: close } }, '✕'));
  const foot = actions.length ? h('div', { class: 'modal-footer' }, actions.map((a) => h('button', {
    class: 'btn ' + (a.kind || ''), disabled: a.disabled, on: { click: async (e) => { if (a.onClick) { const r = await a.onClick(e, api); if (r !== false && a.close !== false) close(); } else close(); } },
  }, a.label))) : null;
  const sheet = h('div', { class: 'modal-sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, grabber, head, h('div', { class: 'modal-body' }, body), foot);
  const styles = ['scale', 'slide', 'fade', 'zoom', 'bounce', 'blur', 'flip'], cur = document.documentElement.dataset.anim || 'scale';
  sheet.dataset.anim = cur === 'random' ? styles[Math.floor(Math.random() * styles.length)] : cur;
  const overlay = h('div', { class: 'modal-overlay', on: { mousedown: (e) => { if (e.target === overlay) close(); } } }, sheet);
  /* phone layout: drag the handle / header down to dismiss, like a native bottom sheet */
  const sheetMode = () => window.matchMedia('(max-width: 699px)').matches;
  let drag = null;
  const down = (e) => { if (!sheetMode() || e.target.closest('.modal-close')) return; drag = { y: e.clientY, dy: 0 }; try { grabber.setPointerCapture(e.pointerId); head.setPointerCapture(e.pointerId); } catch { /* ignore */ } sheet.style.transition = 'none'; };
  const move = (e) => { if (!drag) return; drag.dy = Math.max(0, e.clientY - drag.y); sheet.style.transform = `translateY(${drag.dy}px)`; };
  const up = () => { if (!drag) return; const d = drag.dy; drag = null; sheet.style.transition = 'transform .2s ease'; if (d > 90) { sheet.style.transform = 'translateY(100%)'; setTimeout(close, 160); } else sheet.style.transform = ''; };
  for (const el of [grabber, head]) { el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); }
  const api = { close, el: sheet, overlay };
  stack.push(api);
  document.body.append(overlay);
  const f = sheet.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select');
  (f || sheet.querySelector('.btn') || sheet).focus();
  return api;
}
export const closeTopModal = () => { const m = stack[stack.length - 1]; if (m) { m.close(); return true; } return false; };
export const closeAllModals = () => { while (stack.length) stack[stack.length - 1].close(); };
export const modalOpen = () => stack.length > 0;

export function confirmDialog({ title, text, okLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    modal({ title, body: h('p', { text }), onClose: () => fin(false), actions: [{ label: 'Cancel' }, { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { fin(true); } }] });
  });
}

/* Ask for the master password again before a sensitive action. Resolves to the password or null. */
export function askPassword({ title, text, okLabel = 'Continue', verify }) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const input = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Master password', class: 'inp mono' });
    const err = h('p', { class: 'err', role: 'alert' });
    const go = async () => {
      if (!(await verify(input.value))) { err.textContent = 'That is not your master password.'; input.select(); return false; }
      fin(input.value);
    };
    input.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { if ((await go()) !== false) api.close(); } });
    const api = modal({ title, body: h('div', null, h('p', { text }), input, err), onClose: () => fin(null), actions: [{ label: 'Cancel' }, { label: okLabel, kind: 'primary', onClick: go }] });
  });
}

/* ---------- clipboard with auto-clear ---------- */
let clipTimer = null;
export async function copyText(text, label, clearSecs) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { class: 'offscreen', 'aria-hidden': 'true' }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
    if (!ok) { toast('Copy failed — select the text and copy it manually.', 'err'); return false; }
  }
  clearTimeout(clipTimer);
  if (clearSecs > 0) {
    clipTimer = setTimeout(async () => { try { await navigator.clipboard.writeText(''); } catch { /* not permitted in background */ } }, clearSecs * 1000);
    toast((label || 'Copied') + ' — clipboard clears in ' + clearSecs + 's');
  } else toast((label || 'Copied'));
  return true;
}
export function clearClipboardNow() { clearTimeout(clipTimer); try { navigator.clipboard.writeText(''); } catch { /* ignore */ } }

export function download(filename, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: filename, class: 'offscreen' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsText(file); });
}
