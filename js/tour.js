/* Welcome splash + spotlight guided tour (ported from ulyOS, rebuilt for VaultManager).
   • Welcome splash after the first unlock (or every unlock, if switched on).
   • Tour: highlights the real parts of the app — sidebar or dock, Home, search, tools, settings — and
     navigates for you as it goes.
   • Replay any time: Help (?) button, dock, Settings → General / About.
   "Seen" and the preferences live inside the encrypted vault settings. */

import { h, clear, modalOpen, modal } from './dom.js';
import { TYPE_META } from './templates.js';
import { APP_VERSION } from './version.js';

const visible = (el) => (el && el.getBoundingClientRect().width > 0 ? el : null);
const q = (sel) => visible(document.querySelector(sel));
const navItem = (label) => visible(Array.from(document.querySelectorAll('.side .nav, .dock-item')).find((e) => visible(e) && ((e.getAttribute('aria-label') || e.textContent) || '').includes(label)));
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function createTour(ctx) {
  const { store } = ctx;
  let active = null, welcomeEl = null;

  const markSeen = () => { if (store.unlocked && !store.settings.tourSeen) { store.settings.tourSeen = true; store.save().catch(() => {}); } };
  const go = (view, tab) => () => { if (tab) ctx.S.setTab = tab; ctx.go(view); };

  const STEPS = () => [
    { icon: '{{shieldlock}}', title: 'Welcome to VaultManager', text: 'A password manager that lives entirely in your browser. Your logins, notes, cards, documents and more sit behind one master password and are encrypted on this device — there is no account to create and no server that holds your data.' },
    { icon: '{{shield}}', title: 'Zero-knowledge, end-to-end encrypted', text: 'Everything is sealed with AES-256-GCM under a random key that only your master password (or a passkey, or your recovery key) can unlock. Nothing is sent anywhere unless you choose to sync, and then only encrypted data leaves. We could not read your vault even if we wanted to.' },
    { icon: '{{compass}}', target: () => q('.side') || q('.dock') || q('.mbar'), before: go('home'), title: 'Find your way around', text: 'Home, All items, Favorites and Trash, then '+ Object.keys(TYPE_META).length +' categories grouped by purpose — Everyday, Accounts & access, Home & devices, Money, IDs & documents, Health, Travel & vehicles, People & emergency (contacts, phones, lens and medical info, car, crypto, memberships and more) — and the tools. Click a group name to fold it. Switch between a side bar and a dock in Settings → Dock & menu bar.' },
    { icon: '{{home}}', target: () => q('.widgets'), before: go('home'), title: 'Your Home dashboard', text: 'Vault health, live one-time codes, what expires soon, favorites, recent changes, a quick password generator and sync status. Choose, resize and reorder widgets in Settings → Widgets.' },
    { icon: '{{search}}', target: () => q('.topbar .search'), title: 'Search everything', text: 'Type to search names, usernames, websites, tags and every non-secret field. Press / anywhere to jump here. Secret values are never searchable.' },
    { icon: '{{plus}}', target: () => q('.topbar .btn.primary') || q('.mbar-fab'), title: 'Add anything', text: 'New opens the category picker. Every item — in any category — can also carry attachments (photos, PDFs, documents), custom fields, tags, a favorite star, version history you can restore, and a place in the trash for 30 days.' },
    { icon: '{{bolt}}', target: () => q('.genout'), before: go('gen'), title: 'Password generator', text: 'Cryptographically random passwords, word passphrases or PINs, with a live strength check. Use a unique one for every account — that is the single best thing you can do for your security.' },
    { icon: '{{pulse}}', target: () => q('.ring'), before: go('health'), title: 'Vault health', text: 'Finds weak, reused and old passwords, insecure http:// links, and passports, licences and policies that are expired or about to be — all computed on this device.' },
    { icon: '{{qr}}', target: () => q('.page .tabs'), before: go('qr'), title: 'QR tools', text: 'Seal a secret into a password-protected QR code, scan one back with the camera, or print your whole vault as a set of QR codes for a paper backup.' },
    { icon: '{{beam}}', target: () => q('.beam .panel'), before: go('beam'), title: 'Beam sync', text: 'Pair your PC and phone directly: start on one, join on the other by scanning a QR code, check that both show the same 6-digit number. The vaults merge — no cloud, no account.' },
    { icon: '{{sync}}', target: () => q('.page .tabs'), before: go('settings', 'sync'), title: 'Sync and conflicts', text: 'Sync through an encrypted file, Beam, or a secret GitHub gist. Devices merge field by field; if the same field changed on two of them, the newest wins and the other value waits under “Needs review”.' },
    { icon: '{{palette}}', target: () => q('.page .tabs'), before: go('settings', 'appearance'), title: 'Make it yours', text: 'Appearance, Effects, Dock & menu bar and Widgets: accent colours, nature wallpapers, icon styles and sizes, animation styles, 3D tilt, CRT scanlines, glass blur and more.' },
    { icon: '{{shieldlock}}', target: () => q('.page .tabs'), before: go('settings', 'security'), title: 'Security you control', text: 'Change the master password, add a fingerprint / Windows Hello passkey, create a printable recovery key, tune the key-derivation strength — and set auto-lock and clipboard clearing in General.' },
    { icon: '{{scroll}}', target: () => q('.page .tabs'), before: go('settings', 'audit'), title: 'Audit trail & About', text: 'The audit trail records sign-ins, edits, copies, exports and syncs (never the secrets themselves). About shows the version history and data formats, and can run a self-test of your browser’s crypto.' },
    { icon: '{{lock}}', target: () => q('.topbar [title^="Lock"]'), before: go('home'), title: 'Lock when you leave', text: 'Press Lock (or Alt+L) to seal the vault instantly. It also locks by itself after a period of inactivity, and the clipboard is cleared shortly after you copy a password.' },
    { icon: '{{help}}', target: () => q('.topbar [aria-label="Help"]'), title: 'Help is one click away', text: 'The ? button replays this tour or the welcome screen and lists the keyboard shortcuts.' },
    { icon: '{{checkcircle}}', title: 'You are all set', text: 'Your vault, your data, your rules. Tip: start by adding a few logins on the Home page’s “＋ New”, then create a recovery key under Settings → Security.' },
  ];

  function stop() {
    if (!active) return;
    active.nodes.forEach((n) => n.remove());
    document.removeEventListener('keydown', active.key, true); window.removeEventListener('resize', active.place);
    active = null;
  }

  function start(from = 0) {
    stop(); closeWelcome();
    const steps = STEPS();
    const hole = h('div', { class: 'tour-hole' }), card = h('div', { class: 'tour-card', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Guided tour' }), shield = h('div', { class: 'tour-shield' });
    document.body.append(shield, hole, card);
    let i = clamp(from, 0, steps.length - 1);
    const st = { nodes: [shield, hole, card] };
    const place = () => {
      const s = steps[i], el = s.target ? s.target() : null, pad = 8;
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        Object.assign(hole.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
        const cw = Math.min(360, window.innerWidth - 24), ch = card.offsetHeight || 220;
        let x = r.right + 18, y = r.top + r.height / 2 - ch / 2;
        if (x + cw > window.innerWidth - 12) x = r.left - cw - 18;
        if (x < 12) { x = clamp(r.left + r.width / 2 - cw / 2, 12, window.innerWidth - cw - 12); y = r.bottom + 18; if (y + ch > window.innerHeight - 12) y = r.top - ch - 18; }
        card.style.left = clamp(x, 12, window.innerWidth - cw - 12) + 'px'; card.style.top = clamp(y, 12, Math.max(12, window.innerHeight - ch - 12)) + 'px'; card.style.transform = 'none';
      } else { hole.style.display = 'none'; card.style.left = '50%'; card.style.top = '50%'; card.style.transform = 'translate(-50%,-50%)'; }
    };
    const finish = () => { stop(); markSeen(); };
    const show = () => {
      const s = steps[i], last = i === steps.length - 1;
      try { if (s.before) s.before(); } catch { /* ignore */ }
      clear(card).append(
        h('div', { class: 'tour-head' }, h('span', { class: 'tour-ico', 'aria-hidden': 'true', text: s.icon || '{{info}}' }), h('b', { text: s.title }), h('span', { class: 'tour-n', text: i + 1 + ' / ' + steps.length })),
        h('p', { class: 'tour-text', text: s.text }),
        h('div', { class: 'tour-dots' }, steps.map((_, k) => h('i', { class: k === i ? 'on' : '', on: { click: () => { i = k; show(); } } }))),
        h('div', { class: 'tour-nav' }, h('button', { class: 'btn sm', on: { click: finish } }, 'Skip tour'), h('span', { class: 'grow' }),
          i > 0 ? h('button', { class: 'btn sm', on: { click: () => { i--; show(); } } }, '← Back') : null,
          h('button', { class: 'btn sm primary', on: { click: () => { if (last) finish(); else { i++; show(); } } } }, last ? 'Finish' : 'Next →')));
      setTimeout(() => { place(); const p = card.querySelector('.primary'); if (p) p.focus(); }, 90);   // wait a beat for the page we navigated to
    };
    st.key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (e.key === 'Enter' && e.target.closest && e.target.closest('.tour-card button:not(.primary)')) return; e.preventDefault(); if (i < steps.length - 1) { i++; show(); } else finish(); }
      else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); i--; show(); }
    };
    st.place = place; active = st;
    document.addEventListener('keydown', st.key, true); window.addEventListener('resize', place);
    show();
  }

  /* ---------- welcome splash ---------- */
  function closeWelcome() {
    if (!welcomeEl) return;
    document.removeEventListener('keydown', welcomeEl._key, true); welcomeEl.classList.add('out');
    const el = welcomeEl; welcomeEl = null; setTimeout(() => el.remove(), 260);
  }

  function welcome() {
    if (welcomeEl || active || !store.unlocked) return;
    const s = store.settings;
    const always = h('input', { type: 'checkbox', checked: !!s.welcomeAlways, on: { change: () => { s.welcomeAlways = always.checked; store.save().catch(() => {}); } } });
    const enter = () => { markSeen(); closeWelcome(); };
    const feat = (ico, c1, c2, t, d) => { const fi = h('div', { class: 'wl-fi', 'aria-hidden': 'true' }, h('span', { class: 'icn', text: ico })); fi.style.background = `linear-gradient(145deg,${c1},${c2})`; return h('div', { class: 'wl-feat' }, fi, h('div', null, h('b', { text: t }), h('p', { text: d }))); };
    const FLOAT = [['{{login}}', 8, 6, 0], ['{{network}}', 64, 4, 0.5], ['{{card}}', 34, 22, 1.1], ['{{travel}}', 6, 36, 0.3], ['{{bank}}', 66, 32, 0.8], ['{{shield}}', 36, 46, 1.4], ['{{identity}}', 78, 18, 0.2], ['{{app}}', 20, 12, 1.7]];
    const name = (s.displayName || '').trim();
    const hello = h('p', { class: 'wl-hello' }, 'Hello', name ? ', ' : '', name ? h('b', { text: name }) : null, '. Everything you keep here is locked behind your master password and stays on this device.');
    const hero = h('div', { class: 'wl-hero' }, h('div', { class: 'wl-orb o1' }), h('div', { class: 'wl-orb o2' }),
      h('div', { class: 'wl-float', 'aria-hidden': 'true' }, FLOAT.map(([e, x, y, d]) => { const sp = h('span', { class: 'wl-ico' }, h('span', { class: 'icn', text: e })); sp.style.left = x + '%'; sp.style.top = y + '%'; sp.style.animationDelay = d + 's'; return sp; })),
      h('div', { class: 'wl-brand' }, h('div', { class: 'wl-logo' }, h('img', { src: 'icons/icon.svg', alt: '', width: '46', height: '46' })), h('h1', null, 'Welcome to Vault', h('span', { text: 'Manager' })),
        h('p', { class: 'wl-tag', text: 'Your passwords, documents and secrets — private by design.' }), h('span', { class: 'wl-ver mono', text: 'v' + APP_VERSION + ' · ' + Object.keys(TYPE_META).length + ' categories' })));
    const el = h('div', { class: 'welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to VaultManager' },
      h('div', { class: 'wl-card' }, hero,
        h('div', { class: 'wl-side' }, hello,
          feat('{{shield}}', '#34d399', '#0ea5e9', 'Zero-knowledge', 'Encrypted on your device. No account, no server that can read your data.'),
          feat('{{internet}}', '#6366f1', '#a855f7', 'PC and phone', 'Works offline in any browser, and syncs between your devices.'),
          feat('{{clip}}', '#f59e0b', '#ef4444', 'More than passwords', 'Wi-Fi, insurance, travel, IDs, bank accounts — with photos and documents attached.'),
          h('div', { class: 'wl-stats' }, [['AES-256', 'encrypted'], ['0', 'accounts'], ['100%', 'on-device']].map(([a, b]) => h('div', null, h('b', { text: a }), h('span', { text: b })))),
          h('div', { class: 'wl-actions' },
            h('button', { class: 'btn primary wl-go welcome-go', on: { click: enter } }, 'Open my vault →'),
            h('button', { class: 'btn wl-tour', on: { click: () => { markSeen(); start(); } } }, '{{compass}} Take the tour'),
            h('button', { class: 'btn wl-ghost', on: { click: () => { enter(); ctx.S.setTab = 'appearance'; ctx.go('settings'); } } }, '{{palette}} Make it yours')),
          h('label', { class: 'chk' }, always, 'Show this welcome screen every time I unlock'),
          h('div', { class: 'hint', text: 'Press Enter to start · Esc to close · Help (?) replays the tour' }))));
    el._key = (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !(e.target.closest && e.target.closest('button,label,input')))) { e.preventDefault(); e.stopPropagation(); enter(); } };
    document.addEventListener('keydown', el._key, true);
    document.body.append(el); welcomeEl = el;
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { const g = el.querySelector('.welcome-go'); if (g) g.focus({ preventScroll: true }); }, 80);
  }

  /* show the welcome once the unlock animation and any "vault created" dialogs are finished */
  function maybeWelcome() {
    const s = store.settings;
    if (s.tourSeen && !s.welcomeAlways) return;
    let tries = 0;
    const wait = () => {
      if (!store.unlocked || welcomeEl || active) return;
      if ((modalOpen() || document.getElementById('boot')) && tries++ < 200) { setTimeout(wait, 300); return; }
      setTimeout(() => { if (store.unlocked && !modalOpen()) welcome(); }, 450);
    };
    setTimeout(wait, 300);
  }

  /* ---------- help ---------- */
  function help() {
    const row = (k, d) => h('div', { class: 'f' }, h('div', { class: 'k mono', text: k }), h('div', { class: 'v', text: d }));
    const m = modal({ title: 'Help', sub: 'VaultManager ' + APP_VERSION, wide: false, body: h('div', null,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => { m.close(); start(); } } }, '{{compass}} Guided tour'), h('button', { class: 'btn', on: { click: () => { m.close(); welcome(); } } }, '{{wave}} Welcome screen'),
        h('button', { class: 'btn', on: { click: () => { m.close(); ctx.S.setTab = 'about'; ctx.go('settings'); } } }, 'ⓘ About & versions')),
      h('h3', { class: 'lbl', text: 'Keyboard shortcuts' }),
      row('/', 'Jump to search'), row('Alt + L', 'Lock the vault now'), row('Esc', 'Close a dialog, the tour or this screen'), row('← →  Enter', 'Move through the tour'),
      h('p', { class: 'hint', text: 'Stuck? Settings → About runs a crypto self-test and shows the data formats; Settings → Audit trail shows what happened and when.' })), actions: [{ label: 'Close' }] });
  }

  return { welcome, start, stop: () => { stop(); closeWelcome(); }, maybeWelcome, help, isActive: () => !!(active || welcomeEl) };
}
