/* Hover tooltips for icons and fields (one delegated listener, no per-element work).
   - icons: the name of the category or tool ("Crypto wallet", "Generate", "Lock")
   - buttons / anything with a title: the title, shown in the app's own style instead of the browser's plain one
   - fields in the editor and rows on the detail page: the label and any hint written under it
   - data-tip="…" on any element works too.
   Mouse and keyboard focus only (touch screens have no hover). Settings → Look & feel → Hover tooltips turns it off. */

import { TYPE_META } from './templates.js';

const NAMES = {
  login: 'Login', note: 'Secure note', card: 'Payment card', star: 'Favorite', starline: 'Favorite', bolt: 'Generate', lock: 'Lock', unlock: 'Unlock', eye: 'Show or hide', copy: 'Copy', edit: 'Edit', trash: 'Delete', plus: 'Add',
  close: 'Close', search: 'Search', settings: 'Settings', sync: 'Sync', refresh: 'Refresh', qr: 'QR code', home: 'Home', vault: 'All items', health: 'Vault health', pulse: 'Vault health', puzzle: 'Categories', shield: 'Security',
  shieldlock: 'Protected', bell: 'Alerts', camera: 'Take a photo', attach: 'Attach files', paperclip: 'Attach files', export: 'Export', exportfile: 'Import & export', sparkles: '3D effects', dice: 'Surprise me',
};
const pretty = (n) => String(n).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const iconName = (n) => (TYPE_META[n] && TYPE_META[n].label) || NAMES[n] || pretty(n);
const text = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

function tipFor(t) {
  if (t.closest('[data-tip]')) return { el: t.closest('[data-tip]'), tip: t.closest('[data-tip]').dataset.tip };
  const ico = t.closest('.ico');
  if (ico && ico.dataset.n) {
    const host = ico.closest('button, a, [role=button], .nav, .dock-item, .mbar-item, .msheet-item');
    if (!(host && host.matches('.nav, .dock-item, .mbar-item, .msheet-item, .btn') && text(host))) return { el: host || ico, tip: (host && (host.dataset.tipTitle || host.getAttribute('aria-label'))) || iconName(ico.dataset.n) };   // an icon next to its own text needs no tooltip
  }
  const ti = t.closest('[title]');
  if (ti && ti.getAttribute('title')) { ti.dataset.tipTitle = ti.getAttribute('title'); ti.removeAttribute('title'); return { el: ti, tip: ti.dataset.tipTitle }; }
  if (t.closest('[data-tip-title]')) { const e = t.closest('[data-tip-title]'); return { el: e, tip: e.dataset.tipTitle }; }
  const ctl = t.closest('.field input, .field select, .field textarea');
  if (ctl) {
    const f = ctl.closest('.field'), label = text(f.querySelector(':scope > label')), hint = text(f.querySelector('.hint'));
    return label ? { el: ctl, tip: label + (hint ? ' — ' + hint : '') } : null;
  }
  const row = t.closest('.f');
  if (row && row.querySelector('.k')) { const k = text(row.querySelector('.k')); return k ? { el: row, tip: k + (row.querySelector('[aria-label^="Copy"], .copy') ? ' — use Copy to copy it' : '') } : null; }
  return null;
}

export function initTooltips() {
  const tip = document.createElement('div'); tip.className = 'vm-tip'; tip.id = 'vm-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.append(tip);
  let timer = 0, cur = null;
  const on = () => document.documentElement.dataset.tips !== 'off';
  const hide = () => { clearTimeout(timer); timer = 0; tip.hidden = true; if (cur) { cur.removeAttribute('aria-describedby'); cur = null; } };
  const show = (el, msg) => {
    if (!msg || !el.isConnected) return;
    tip.textContent = msg; tip.hidden = false; cur = el; el.setAttribute('aria-describedby', 'vm-tip');
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8), y = r.bottom + 8;
    if (y + hh > innerHeight - 8) y = Math.max(8, r.top - hh - 8);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const arm = (t, delay) => {
    hide(); if (!on() || !(t instanceof Element)) return;
    const f = tipFor(t); if (!f || !f.tip) return;
    timer = setTimeout(() => show(f.el, f.tip), delay);
  };
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch') return; arm(e.target, 450); }, true);
  document.addEventListener('pointerout', hide, true);
  document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches(':focus-visible')) arm(e.target, 150); }, true);
  document.addEventListener('focusout', hide, true);
  document.addEventListener('keydown', hide, true); document.addEventListener('pointerdown', hide, true); window.addEventListener('scroll', hide, true);
}
