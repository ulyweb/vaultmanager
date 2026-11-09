/* Home dashboard widgets (the VaultManager take on the ulyOS desktop widgets). Every widget is read-only
   metadata about the unlocked vault; secrets (one-time codes, the quick-generator output) appear only
   while the vault is open, and copying them follows the clipboard-clear setting. */

import { h, clear } from './dom.js';
import { health } from './vault.js';
import { totpNow, parseTotp } from './totp.js';
import { generatePassword } from './generator.js';
import { TYPE_META } from './templates.js';
import { WIDGET_DEFS, TIPS } from './look.js';
import { fmtDate, hostOf } from './util.js';

const HUES = ['#2fe6d0', '#59b4ff', '#8b7dff', '#ff7ad9', '#ffb547', '#7dff9b', '#ff6b6b', '#ff8a4c', '#d6e2ee', '#4fd1c5', '#f6ad55'];
const greeting = (name) => { const hr = new Date().getHours(), n = (name || '').trim(); return hr < 5 ? (n ? 'Still up, ' + n + '?' : 'Still up?') : (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + (n ? ', ' + n : ''); };

const wrap = (ctx, def, size, idx, body, extra) => {
  const el = h('section', { class: 'panel widget ' + size, 'aria-label': def.label }, h('div', { class: 'whead' }, h('span', { class: 'icn', text: def.icon }), h('span', { text: def.label }), extra ? h('span', { class: 'spacer' }, extra) : null), body);
  el.style.setProperty('--wc', HUES[idx % HUES.length]);
  return el;
};
const rowBtn = (ctx, it, sub) => h('button', { class: 'wrow', on: { click: () => ctx.showItem(it.id) } }, h('span', { class: 'icn', text: (TYPE_META[it.type] || {}).icon || '🔑' }), h('span', { class: 't' }, it.name || '(untitled)', sub ? h('small', { text: '  ' + sub }) : null));
const empty = (t) => h('p', { class: 'wsub', text: t });

const BUILD = {
  clock(ctx) {
    const L = ctx.look(), t = h('div', { class: 'wbig', 'aria-live': 'off' }), d = h('div', { class: 'wsub' });
    const tick = () => { const n = new Date(); t.textContent = n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !L.clock24 }); d.textContent = n.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); };
    tick(); const i = setInterval(tick, 1000); ctx.cleanup.push(() => clearInterval(i));
    return h('div', null, t, d);
  },
  health(ctx) {
    const rep = health(ctx.store.items), col = rep.score >= 80 ? 'var(--accent)' : rep.score >= 50 ? 'var(--warn)' : 'var(--danger)';
    const ring = h('div', { class: 'ring wring' }, h('span', { text: String(rep.score) })); ring.style.setProperty('--p', rep.score); ring.style.setProperty('--c', col);
    return h('div', { class: 'row' }, ring, h('div', null, h('div', { class: 'wsub', text: `${rep.weak.length} weak · ${rep.reused.reduce((n, g) => n + g.length, 0)} reused · ${rep.old.length} old` }), h('button', { class: 'btn sm', on: { click: () => ctx.go('health') } }, 'Open health')));
  },
  totp(ctx) {
    const items = ctx.store.active().filter((i) => i.type === 'login' && i.totp).slice(0, 8);
    if (!items.length) return empty('No one-time codes yet. Add a 2FA secret to a login and its live code appears here.');
    const box = h('div', { class: 'totps' }), tiles = [];
    for (const it of items) {
      let cfg; try { cfg = parseTotp(it.totp); } catch { continue; }
      const code = h('div', { class: 'wcode', text: '------' }), left = h('small', { text: '' });
      const tile = h('button', { class: 'totp-tile', title: 'Click to copy', on: { click: () => ctx.copySecret(tile.dataset.code || '', 'Code copied', it, 'one-time code') } }, h('b', { text: it.name }), code, left);
      tiles.push({ cfg, code, left, tile }); box.append(tile);
    }
    const tick = async () => { for (const t of tiles) { try { const r = await totpNow(t.cfg); t.tile.dataset.code = r.code; t.code.textContent = r.code.slice(0, r.code.length / 2) + ' ' + r.code.slice(r.code.length / 2); t.left.textContent = r.remaining + 's'; } catch { /* ignore */ } } };
    tick(); const i = setInterval(tick, 1000); ctx.cleanup.push(() => clearInterval(i));
    return box;
  },
  expiring(ctx) {
    const rep = health(ctx.store.items).expiring.slice(0, 5);
    return rep.length ? h('div', { class: 'wlist' }, rep.map((x) => rowBtn(ctx, x.item, x.days < 0 ? 'expired' : 'in ' + x.days + 'd'))) : empty('Nothing expires in the next 60 days.');
  },
  favorites(ctx) {
    const f = ctx.store.active().filter((i) => i.favorite).slice(0, 6);
    return f.length ? h('div', { class: 'wlist' }, f.map((i) => rowBtn(ctx, i, i.username || hostOf(i.url)))) : empty('Star an item (☆ Favorite) to pin it here.');
  },
  recent(ctx) {
    const r = [...ctx.store.active()].sort((a, b) => b.updated - a.updated).slice(0, 5);
    return r.length ? h('div', { class: 'wlist' }, r.map((i) => rowBtn(ctx, i, fmtDate(i.updated)))) : empty('Your vault is empty.');
  },
  generator(ctx) {
    const out = h('div', { class: 'wcode', style: null }), gen = () => { try { out.textContent = generatePassword(ctx.store.settings.gen); } catch { out.textContent = generatePassword({}); } };
    gen();
    return h('div', null, out, h('div', { class: 'row wrap', style: null }, h('button', { class: 'btn sm', on: { click: gen } }, '⟳'), h('button', { class: 'btn sm', on: { click: () => ctx.copySecret(out.textContent, 'Password copied') } }, '⧉ Copy'), h('button', { class: 'btn sm ghost', on: { click: () => ctx.go('gen') } }, 'Options')));
  },
  stats(ctx) {
    const a = ctx.store.active(), used = Object.entries(TYPE_META).filter(([k]) => a.some((i) => i.type === k));
    return h('div', null, used.length ? h('div', { class: 'wgrid' }, used.map(([k, m]) => h('button', { class: 'btn sm', on: { click: () => ctx.go(k) } }, h('span', { class: 'icn', text: m.icon }), ` ${m.plural} · ${a.filter((i) => i.type === k).length}`))) : empty('No items yet — your categories show up here as you add things.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm ghost', on: { click: () => ctx.newItem() } }, `＋ Browse all ${Object.keys(TYPE_META).length} categories`)));
  },
  sync(ctx) {
    const c = ctx.store.settings.sync;
    return h('div', null, h('p', { class: 'wsub', text: c.last ? (c.last.ok ? '✓ ' : '✕ ') + new Date(c.last.at).toLocaleString() + ' — ' + c.last.msg : 'Not synced yet.' }),
      h('div', { class: 'row wrap' }, c.token ? h('button', { class: 'btn sm', on: { click: async (e) => { e.target.disabled = true; const r = await ctx.syncNow(true); e.target.disabled = false; if (r.ok) ctx.refresh(); } } }, '⇄ Sync now') : null, h('button', { class: 'btn sm', on: { click: () => ctx.go('beam') } }, '📡 Beam'), h('button', { class: 'btn sm ghost', on: { click: () => { ctx.S.setTab = 'sync'; ctx.go('settings'); } } }, 'Settings')));
  },
  conflicts(ctx) {
    const n = ctx.store.conflictCount();
    return n ? h('div', null, h('p', { class: 'wsub', text: `${n} value${n > 1 ? 's were' : ' was'} edited on two devices.` }), h('button', { class: 'btn sm primary', on: { click: () => ctx.go('conflicts') } }, 'Review now')) : empty('✓ No sync conflicts.');
  },
  tip() { return h('p', { text: TIPS[Math.floor(Date.now() / 864e5) % TIPS.length] }); },
};

export function renderHome(ctx) {
  const L = ctx.look(), n = ctx.store.active().length;
  const list = L.widgets.filter((w) => w.on);
  const grid = h('div', { class: 'widgets' });
  list.forEach((w, i) => { const def = WIDGET_DEFS.find((d) => d.id === w.id); grid.append(wrap(ctx, def, w.size, i, BUILD[w.id](ctx))); });
  return h('div', { class: 'page home', style: null }, h('h2', { text: greeting(ctx.store.settings.displayName) }), h('p', { class: 'sub', text: n ? `${n} item${n === 1 ? '' : 's'} in your vault. Customise this page in Settings → Widgets.` : 'Your vault is empty — press “＋ New” to add your first item.' }),
    list.length ? grid : h('div', { class: 'panel pad' }, h('p', { text: 'All widgets are hidden. Turn some on in Settings → Widgets.' }), h('button', { class: 'btn', on: { click: () => { ctx.S.setTab = 'widgets'; ctx.go('settings'); } } }, 'Open widget settings')));
}
void clear;
