/* Task Manager — what VaultManager is doing right now: its "processes", memory, storage and device. (Like the ulyOS Task Manager.)
   Everything shown is read locally; nothing leaves the device. */

import { h, clear, toast, confirmDialog } from './dom.js';
import { page } from './tools.js';
import { APP_NAME, APP_VERSION } from './version.js';
import { fmtDate } from './util.js';

const fmtB = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : Math.round(n) + ' B');
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), hr = Math.floor(m / 60); return hr ? `${hr}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`; };
const bar = (frac, cls = '') => { const i = h('i'); i.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%'; return h('div', { class: 'tmbar ' + cls }, i); };

export function renderTaskManager(ctx) {
  const { store } = ctx;
  const tabs = [['proc', 'Processes'], ['perf', 'Performance'], ['disk', 'Storage'], ['sys', 'This device']];
  let tab = ctx.S.tmTab || 'proc', fps = 0, async = {}, timer = null;
  const body = h('div', { class: 'tm' }), bar0 = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), class: k === tab ? 'on' : '', on: { click: () => { tab = k; ctx.S.tmTab = k; paint(); } } }, l)));

  /* frame-rate probe (about once per second while this page is open) */
  let frames = 0, last = performance.now(), raf = 0;
  const loop = (t) => { frames++; if (t - last >= 1000) { fps = Math.round((frames * 1000) / (t - last)); frames = 0; last = t; } raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  const gather = async () => {
    const o = {};
    try { if (navigator.storage && navigator.storage.estimate) o.est = await navigator.storage.estimate(); } catch { /* ignore */ }
    try { if (navigator.storage && navigator.storage.persisted) o.persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
    try { o.att = await store.attachmentStats(); } catch { o.att = { count: 0, bytes: 0 }; }
    try { if (navigator.getBattery) { const b = await navigator.getBattery(); o.battery = { level: b.level, charging: b.charging }; } } catch { /* ignore */ }
    try { if ('serviceWorker' in navigator) { const r = await navigator.serviceWorker.getRegistration(); o.sw = r ? (navigator.serviceWorker.controller ? 'active — controlling this page' : 'registered') : 'not registered'; } else o.sw = 'unsupported'; } catch { o.sw = 'unknown'; }
    async = o;
  };

  const row = (name, status, detail, action) => h('tr', null, h('td', null, h('b', { text: name })), h('td', null, h('span', { class: 'chip ' + (status === 'running' ? 'accent' : status === 'idle' ? '' : 'warn'), text: status })), h('td', { class: 'tmdetail', text: detail }), h('td', null, action || ''));
  const kv = (rows) => h('div', { class: 'kv' }, rows.map(([k, v]) => [h('span', { text: k }), h('b', { text: String(v) })]));

  const procs = () => {
    const s = store.settings, open = store.itemKeys ? store.itemKeys.size : 0, c = s.sync || {};
    const lockedItems = store.items.filter((i) => i.lock).length;
    const lastAudit = store.data.audit[0];
    return h('div', { class: 'panel pad' },
      h('table', { class: 'tmtable' }, h('thead', null, h('tr', null, ['Process', 'State', 'Details', ''].map((t) => h('th', { text: t })))), h('tbody', null,
        row('Vault session', 'running', `${store.active().length} items in memory, unlocked ${fmtDur(Date.now() - (ctx.S.since || Date.now()))} ago`, h('button', { class: 'btn sm', on: { click: () => ctx.lock(false) } }, '{{lock}} Lock')),
        row('Auto-lock timer', s.autolock ? 'running' : 'off', s.autolock ? `locks after ${s.autolock} min of inactivity${s.lockOnHide ? ' or when the tab is hidden' : ''}` : 'never locks by itself'),
        row('Clipboard guard', s.clipboard ? 'running' : 'off', s.clipboard ? `clears copied secrets after ${s.clipboard}s` : 'copied secrets stay on the clipboard'),
        row('Opened locked items', open ? 'running' : 'idle', `${open} open of ${lockedItems} passcode-locked (they re-lock after 10 min)`, open ? h('button', { class: 'btn sm', on: { click: () => ctx.purgeMemory() } }, 'Close all') : ''),
        row('Auto-sync', c.auto ? 'running' : 'off', c.gistId ? 'GitHub gist sync is set up' : 'no gist sync set up'),
        row('Offline cache (service worker)', /active/.test(async.sw || '') ? 'running' : 'idle', async.sw || 'checking…'),
        row('Encrypted attachments', 'idle', async.att ? `${async.att.count} file(s), ${fmtB(async.att.bytes)} (each sealed separately)` : '…'),
        row('Audit logger', 'running', `${store.data.audit.length} entries${lastAudit ? '; last: ' + lastAudit.m.slice(0, 60) : ''}`),
        row('Look & effects', 'running', `animations ${ctx.look().animations ? 'on' : 'off'}, icons “${ctx.look().iconStyle}”, background “${ctx.look().bg}”`))),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', title: 'Wipe revealed values, opened locked items, QR fields, previews and the clipboard from memory', on: { click: () => ctx.purgeMemory() } }, '{{trash}} Purge memory'),
        h('span', { class: 'hint', text: 'Stored data is never touched — this only forgets what is held in memory.' })));
  };

  const perf = () => {
    const m = performance.memory, nodes = document.getElementsByTagName('*').length;
    return h('div', { class: 'panel pad' },
      h('div', { class: 'tmgrid' },
        h('div', { class: 'tmcard' }, h('small', { text: 'JS memory' }), h('b', { text: m ? fmtB(m.usedJSHeapSize) : 'n/a' }), m ? bar(m.usedJSHeapSize / m.jsHeapSizeLimit) : h('small', { text: 'This browser does not report it' }), m ? h('small', { text: 'of ' + fmtB(m.jsHeapSizeLimit) + ' limit' }) : null),
        h('div', { class: 'tmcard' }, h('small', { text: 'Frame rate' }), h('b', { text: fps ? fps + ' fps' : '…' }), bar(fps / 60, fps && fps < 24 ? 'warn' : '')),
        h('div', { class: 'tmcard' }, h('small', { text: 'Screen elements' }), h('b', { text: nodes.toLocaleString('en-US') }), bar(nodes / 6000, nodes > 5000 ? 'warn' : '')),
        h('div', { class: 'tmcard' }, h('small', { text: 'Opened locked items' }), h('b', { text: String(store.itemKeys ? store.itemKeys.size : 0) }), h('small', { text: 'held in memory only' }))),
      kv([['App', APP_NAME + ' ' + APP_VERSION], ['Session started', ctx.S.since ? new Date(ctx.S.since).toLocaleTimeString() : '—'], ['Network', navigator.onLine ? 'online' : 'offline (the app works fully offline)'],
        ['Connection', (navigator.connection && (navigator.connection.effectiveType + (navigator.connection.saveData ? ', data saver' : ''))) || 'unknown'], ['Battery', async.battery ? Math.round(async.battery.level * 100) + '%' + (async.battery.charging ? ' (charging)' : '') : 'not reported']]));
  };

  const disk = () => {
    let used = 0, keys = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('vaultmanager.')) { keys++; used += (k.length + (localStorage.getItem(k) || '').length) * 2; } } } catch { /* ignore */ }
    const est = async.est;
    return h('div', { class: 'panel pad' },
      h('div', { class: 'tmgrid' },
        h('div', { class: 'tmcard' }, h('small', { text: 'App storage on this device' }), h('b', { text: est ? fmtB(est.usage) : 'n/a' }), est && est.quota ? bar(est.usage / est.quota) : null, est && est.quota ? h('small', { text: 'of ' + fmtB(est.quota) + ' available' }) : null),
        h('div', { class: 'tmcard' }, h('small', { text: 'Vault records (all profiles)' }), h('b', { text: fmtB(used) }), h('small', { text: keys + ' stored entries, all encrypted' })),
        h('div', { class: 'tmcard' }, h('small', { text: 'Attachments' }), h('b', { text: async.att ? fmtB(async.att.bytes) : '…' }), h('small', { text: (async.att ? async.att.count : 0) + ' file(s) in this profile' }))),
      kv([['Profiles on this device', ctx.env.profiles.list().length], ['Items', store.active().length + ' (+ ' + store.trashed().length + ' in trash)'], ['Storage kept when the browser is low on space', async.persisted === undefined ? 'unknown' : async.persisted ? 'yes (persistent)' : 'not guaranteed'],
        ['Last saved', store.lastSaved ? new Date(store.lastSaved).toLocaleTimeString() : 'this session: not yet']]),
      h('p', { class: 'hint', text: 'Everything above is stored encrypted. Export a whole-profile backup regularly (Settings → General) — browser storage can be cleared by the browser.' }));
  };

  const sys = () => kv([['Platform', (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'unknown'], ['Browser', (navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/) || ['unknown'])[0]],
    ['CPU threads', navigator.hardwareConcurrency || 'unknown'], ['Device memory', navigator.deviceMemory ? '≥ ' + navigator.deviceMemory + ' GB' : 'not reported'], ['Screen', `${screen.width}×${screen.height} @ ${window.devicePixelRatio}×`],
    ['Touch', navigator.maxTouchPoints ? navigator.maxTouchPoints + ' points' : 'no'], ['Secure context', window.isSecureContext ? 'yes (WebCrypto available)' : 'NO — encryption unavailable'], ['Running from', location.protocol === 'file:' ? 'a file (single-file offline copy)' : window.__TAURI__ ? 'the native app' : location.origin],
    ['Language', navigator.language], ['Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone]]);

  const paint = () => {
    Array.from(bar0.children).forEach((b, i) => { b.classList.toggle('on', tabs[i][0] === tab); b.setAttribute('aria-selected', String(tabs[i][0] === tab)); });
    clear(body).append(tab === 'proc' ? procs() : tab === 'perf' ? perf() : tab === 'disk' ? disk() : h('div', { class: 'panel pad' }, sys()));
  };
  gather().then(paint);
  timer = setInterval(() => { if (!body.isConnected) return; if (tab === 'perf' || tab === 'proc') { paint(); } }, 1000);
  const slow = setInterval(() => { if (body.isConnected) gather(); }, 5000);
  ctx.cleanup.push(() => { clearInterval(timer); clearInterval(slow); cancelAnimationFrame(raf); });
  paint();
  return page('Task manager', 'What VaultManager is holding in memory and on disk, right now. Everything is read on this device only.', bar0, body);
}
