/* Beam sync — merge two devices directly, no cloud and no account. Ported from the ulyOS Beam app.

   Two devices connect with WebRTC (DTLS-encrypted, peer to peer) after swapping two short codes by QR or
   copy / paste — nothing goes through a server, and on the same Wi-Fi the data never leaves your network.
   Both screens then show the same 6-digit number (derived from both certificate fingerprints): if they
   match, nobody is in the middle. Only then does each device send its vault bundle — itself encrypted
   with the sync passphrase (the same VMS1 bundle as file / gist sync) — and merge the other's.

   This is the only file allowed to use WebRTC (the lint enforces it). "Also try over the internet" asks
   a public STUN server (Google's), which then learns your public IP address; it is off by default. */

import { h, clear, toast } from './dom.js';
import { drawQR, startScanner } from './qr.js';
import { sealBundle, openBundle, validateSyncPassphrase } from './sync.js';
import { estimate } from './strength.js';
import { APP_VERSION } from './version.js';
import { fmtSize } from './views.js';

const CHUNK = 32 * 1024, MAX_CODE = 24000, MAX_BUNDLE = 150 * 1048576, ATTACH_CAP = 60 * 1048576;
const enc = new TextEncoder(), dec = new TextDecoder();
export const supported = () => !!globalThis.RTCPeerConnection;

/* ---------- pairing codes ---------- */
const b64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (t) => { const b = atob(t.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const pipe = async (bytes, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());

export async function encode(type, sdp) {
  const raw = enc.encode(JSON.stringify({ t: type, s: sdp }));
  if (globalThis.CompressionStream) return 'BEAM1.' + b64u(await pipe(raw, CompressionStream));
  return 'BEAM0.' + b64u(raw);
}
export async function decode(code) {
  code = String(code || '').replace(/\s+/g, '');
  if (code.length > MAX_CODE || !/^BEAM[01]\.[\w-]+$/.test(code)) throw new Error('That is not a Beam code');
  let raw;
  try { raw = unb64u(code.slice(6)); } catch { throw new Error('That Beam code is damaged'); }
  if (code[4] === '1') {
    if (!globalThis.DecompressionStream) throw new Error('This browser cannot read compressed codes');
    try { raw = await pipe(raw, DecompressionStream); } catch { throw new Error('That Beam code is damaged'); }
  }
  let o; try { o = JSON.parse(dec.decode(raw)); } catch { throw new Error('That Beam code is damaged'); }
  if (!o || (o.t !== 'o' && o.t !== 'a') || typeof o.s !== 'string' || !o.s.startsWith('v=0') || o.s.length > 20000) throw new Error('That Beam code is damaged');
  return o;
}
const fingerprints = (sdp) => [...sdp.matchAll(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/g)].map((m) => m[1].toUpperCase());
/* The same 6 digits appear on both devices if (and only if) both saw the same two certificates. */
export async function verifyCode(a, b) {
  const f = [...fingerprints(a), ...fingerprints(b)].sort().join('|');
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('VaultManager-beam|' + f)));
  const n = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
  const s = String(n % 1000000).padStart(6, '0');
  return s.slice(0, 3) + ' ' + s.slice(3);
}

/* ---------- one peer connection ---------- */
function createLink({ internet = false, onState, onMessage, onBinary }) {
  const pc = new RTCPeerConnection({ iceServers: internet ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] });
  const link = { pc, dc: null, open: false, localSdp: '', remoteSdp: '' };
  const wire = (dc) => {
    link.dc = dc; dc.binaryType = 'arraybuffer'; dc.bufferedAmountLowThreshold = 1 << 20;
    dc.onopen = () => { if (link.open) return; link.open = true; onState('open'); };
    dc.onclose = () => { link.open = false; onState('closed'); };
    if (dc.readyState === 'open') queueMicrotask(() => dc.onopen());
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && typeof m.t === 'string') onMessage(m); } else onBinary(e.data);
    };
  };
  pc.ondatachannel = (e) => wire(e.channel);
  pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) { link.open = false; onState(pc.connectionState === 'failed' ? 'failed' : 'closed'); } };
  const gathered = () => new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 5000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
  link.offer = async () => { wire(pc.createDataChannel('beam', { ordered: true })); await pc.setLocalDescription(await pc.createOffer()); await gathered(); link.localSdp = pc.localDescription.sdp; return encode('o', link.localSdp); };
  link.accept = async (o) => { link.remoteSdp = o.s; await pc.setRemoteDescription({ type: 'offer', sdp: o.s }); await pc.setLocalDescription(await pc.createAnswer()); await gathered(); link.localSdp = pc.localDescription.sdp; return encode('a', link.localSdp); };
  link.finish = async (o) => { link.remoteSdp = o.s; await pc.setRemoteDescription({ type: 'answer', sdp: o.s }); };
  link.send = (m) => link.dc.send(JSON.stringify(m));
  link.sendBin = async (buf) => { if (link.dc.bufferedAmount > 4 << 20) await new Promise((r) => link.dc.addEventListener('bufferedamountlow', r, { once: true })); link.dc.send(buf); };
  link.close = () => { try { if (link.dc) link.dc.close(); } catch { /* ignore */ } try { pc.close(); } catch { /* ignore */ } };
  return link;
}

/* ---------- the page ---------- */
export function renderBeam(ctx) {
  const { store } = ctx, cfg = store.settings.sync;
  const root = h('div', { class: 'page beam' });
  let link = null, internet = false, verify = '', peerName = 'the other device', stopScan = null;
  const st = { confirmed: false, peerReady: false, sent: false, incoming: null, got: 0, expect: 0, applied: false, peerResult: null, mine: null };

  const show = (...n) => { clear(root).append(h('h2', { text: 'Beam sync' }), ...n); };
  const cleanup = () => { if (stopScan) { stopScan(); stopScan = null; } if (link) { link.close(); link = null; } Object.assign(st, { confirmed: false, peerReady: false, sent: false, incoming: null, got: 0, expect: 0, applied: false, peerResult: null, mine: null }); verify = ''; };
  ctx.cleanup.push(cleanup);

  const copyBtn = (get) => h('button', { class: 'btn sm', on: { click: async () => { try { await navigator.clipboard.writeText(get()); toast('Code copied'); } catch { toast('Select the code and copy it manually', 'err'); } } } }, 'Copy code');
  const qrFor = (code) => { const c = h('canvas', { class: 'beamqr', role: 'img', 'aria-label': 'Beam code QR' }); drawQR(c, code, { scale: 3 }).catch(() => c.replaceWith(h('p', { class: 'hint', text: 'The code is too long for a QR — copy it instead.' }))); return c; };

  const scanInto = (target, after) => h('button', { class: 'btn', on: { click: async (e) => {
    if (stopScan) { stopScan(); stopScan = null; box.remove(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('The camera needs HTTPS or localhost — paste the code instead.', 'err', 5000); return; }
    const video = h('video', { muted: true, playsinline: true, 'aria-label': 'Camera preview' }); const box = h('div', { class: 'scanner' }, video, h('p', { class: 'hint', text: 'Point the camera at the QR code on the other device' }));
    e.target.after(box);
    try { stopScan = await startScanner(video, (t) => { target.value = t; stopScan(); stopScan = null; box.remove(); after(); }); } catch (x) { box.remove(); toast('Camera unavailable: ' + (x.message || x.name), 'err', 5000); }
  } } }, '📷 Scan QR');

  async function onState(s) {
    if (s === 'open') {
      verify = await verifyCode(link.localSdp, link.remoteSdp).catch(() => '');
      store.log('sync', 'Beam: peer connected');
      link.send({ t: 'hello', name: 'VaultManager ' + APP_VERSION });
      verifyScreen();
    } else if ((s === 'closed' || s === 'failed') && root.isConnected && !(st.mine && st.peerResult)) {
      cleanup();
      home(s === 'failed' ? 'The connection could not be made. Both devices must be on the same Wi-Fi (not a guest network that isolates devices), or tick “Also try over the internet”.' : 'The other device disconnected before the sync finished.');
    }
  }
  function newLink() {   // events from a link we already dropped are ignored, so a late "closed" cannot overwrite a newer screen
    cleanup();
    const mine = createLink({ internet, onState: (x) => { if (link === mine) onState(x); }, onMessage: (m) => { if (link === mine) onMessage(m); }, onBinary: (b) => { if (link === mine) onBinary(b); } });
    link = mine; return mine;
  }

  /* ----- screens ----- */
  function home(message) {
    const needPass = !cfg.passphrase;
    const pass = h('input', { class: 'inp mono', type: 'password', placeholder: 'Sync passphrase (the same on both devices)', autocomplete: 'off', 'aria-label': 'Sync passphrase' }), perr = h('p', { class: 'err', role: 'alert' });
    show(h('p', { class: 'sub', text: 'Merge this vault with another of your devices directly — no cloud, no account, nothing uploaded. End-to-end encrypted.' }),
      message ? h('div', { class: 'note danger', role: 'alert', text: message }) : null,
      !supported() ? h('div', { class: 'note danger', text: 'This browser has no WebRTC, so Beam cannot connect.' }) : null,
      needPass ? h('div', { class: 'panel pad' }, h('h3', { text: 'First, a sync passphrase' }), h('p', { class: 'hint', text: 'Beam sends your vault sealed with the sync passphrase (as well as the encrypted connection). Use the same passphrase on both devices — it is also used by file and gist sync.' }), pass, perr,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', on: { click: () => { const e = validateSyncPassphrase(pass.value, estimate); if (e) { perr.textContent = e; return; } cfg.passphrase = pass.value; store.log('sync', 'Sync passphrase set', 'warn'); store.save(); ctx.refresh(); } } }, 'Save passphrase')))
        : h('div', { class: 'panel pad' },
          h('div', { class: 'choice' },
            h('button', { class: 'btn primary', disabled: !supported(), on: { click: hostStart } }, h('b', { text: 'Start' }), h('small', { text: 'This device shows the first code' })),
            h('button', { class: 'btn', disabled: !supported(), on: { click: () => joinStart() } }, h('b', { text: 'Join' }), h('small', { text: 'I have a code from the other device' }))),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: internet, on: { change: (e) => { internet = e.target.checked; } } }), 'Also try over the internet (asks a public STUN server — Google’s — which then learns your public IP address)')),
      h('div', { class: 'panel pad' }, h('h3', { text: 'How it works' }), h('ol', { class: 'steps' },
        h('li', { text: 'Open VaultManager on both devices and unlock it. Be on the same Wi-Fi.' }),
        h('li', { text: 'Device 1: Start — a code and QR appear. Device 2: Join — scan the QR or paste the code.' }),
        h('li', { text: 'Device 2 now shows a reply code. On device 1 scan or paste it and press Connect.' }),
        h('li', { text: 'Both screens show the same 6-digit number. If they match, press “Numbers match”. Both vaults then merge — newest edit per item wins, deletions carry over, attachments travel too.' })),
        h('p', { class: 'hint', text: 'Some Wi-Fi networks (guest networks, “client isolation”) block device-to-device traffic; Beam will say it could not connect.' })));
  }

  async function hostStart() {
    show(h('p', { class: 'hint', text: 'Creating your code…' }));
    let code; try { code = await newLink().offer(); } catch (e) { home('Could not start: ' + e.message); return; }
    const box = h('textarea', { class: 'ta', readonly: true, rows: '3', 'aria-label': 'Your code', value: code });
    const reply = h('textarea', { class: 'ta', rows: '3', placeholder: 'Paste the reply code from the other device here', 'aria-label': 'Reply code', spellcheck: 'false' });
    const err = h('p', { class: 'err', role: 'alert' });
    const connect = async () => {
      err.textContent = '';
      try { const o = await decode(reply.value); if (o.t !== 'a') throw new Error('That is a first code — paste the reply code from the other device'); await link.finish(o); err.textContent = 'Connecting…'; } catch (e) { err.textContent = e.message; }
    };
    show(h('div', { class: 'panel pad' }, h('h3', { text: '1 · Show this to the other device' }), h('p', { class: 'hint', text: 'On the other device open Beam → Join, then scan this QR or paste the code.' }), h('div', { class: 'qrbox' }, qrFor(code)), box, h('div', { class: 'row' }, copyBtn(() => code))),
      h('div', { class: 'panel pad' }, h('h3', { text: '2 · Enter its reply' }), reply, err, h('div', { class: 'row wrap' }, scanInto(reply, connect), h('button', { class: 'btn primary', on: { click: connect } }, 'Connect'), h('button', { class: 'btn', on: { click: () => { cleanup(); home(); } } }, 'Cancel'))));
  }

  function joinStart(message) {
    const input = h('textarea', { class: 'ta', rows: '3', placeholder: 'Paste the code shown on the other device here', 'aria-label': 'Code from the other device', spellcheck: 'false' });
    const err = h('p', { class: 'err', role: 'alert', text: message || '' });
    const go = async () => {
      err.textContent = '';
      try {
        const o = await decode(input.value);
        if (o.t !== 'o') throw new Error('That is a reply code — on this device paste the first code from the device that pressed Start');
        show(h('p', { class: 'hint', text: 'Creating the reply…' }));
        const code = await newLink().accept(o);
        show(h('div', { class: 'panel pad' }, h('h3', { text: 'Show this reply to the other device' }), h('p', { class: 'hint', text: 'On the other device scan this QR (or paste the code) and press Connect. This screen changes by itself when you are connected.' }),
          h('div', { class: 'qrbox' }, qrFor(code)), h('textarea', { class: 'ta', readonly: true, rows: '3', value: code, 'aria-label': 'Reply code' }), h('div', { class: 'row wrap' }, copyBtn(() => code), h('button', { class: 'btn', on: { click: () => { cleanup(); home(); } } }, 'Cancel'))));
      } catch (e) { cleanup(); joinStart(e.message); }
    };
    show(h('div', { class: 'panel pad' }, h('h3', { text: 'Join: enter the other device’s code' }), h('p', { class: 'hint', text: 'On the other device open Beam and press Start. Then scan its QR here, or paste the code.' }), input, err,
      h('div', { class: 'row wrap' }, scanInto(input, go), h('button', { class: 'btn primary', on: { click: go } }, 'Continue'), h('button', { class: 'btn', on: { click: () => home() } }, 'Back'))));
  }

  function verifyScreen() {
    show(h('div', { class: 'panel pad' }, h('div', { class: 'note', text: '✓ Connected — encrypted, peer to peer.' }),
      h('p', { class: 'lbl', text: 'Check that this number is identical on both screens' }), h('div', { class: 'bverify mono', 'aria-label': 'Verification number', text: verify }),
      h('p', { class: 'hint', text: 'If the numbers differ, someone may be intercepting the connection: press “Don’t match” and start again.' }),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: confirmMatch } }, '✓ Numbers match — sync now'), h('button', { class: 'btn danger', on: { click: () => { cleanup(); home('Cancelled: the verification numbers did not match.'); store.log('sync', 'Beam cancelled — verification numbers did not match', 'warn'); } } }, '✕ They don’t match'))));
  }

  /* ----- sync protocol ----- */
  async function confirmMatch() {
    st.confirmed = true;
    progress('Waiting for the other device to confirm…');
    link.send({ t: 'ready' });
    await maybeSend(); await maybeApply();
  }
  const progress = (text, frac) => show(h('div', { class: 'panel pad' }, h('p', { class: 'hint', 'aria-live': 'polite', text }), frac === undefined ? null : h('div', { class: 'progress' }, (() => { const i = h('i'); i.style.width = Math.round(frac * 100) + '%'; return i; })())));

  async function maybeSend() {
    if (st.sent || !st.confirmed || !st.peerReady || !link || !link.open) return;
    st.sent = true;
    try {
      progress('Sealing your vault…');
      const bundle = await store.buildBundle({ withAttachments: cfg.attachments, maxAttachmentBytes: ATTACH_CAP });
      const payload = enc.encode(await sealBundle(bundle, cfg.passphrase, { maxPayload: MAX_BUNDLE }));
      link.send({ t: 'bundle', bytes: payload.length });
      for (let o = 0; o < payload.length; o += CHUNK) { await link.sendBin(payload.slice(o, o + CHUNK).buffer); if ((o / CHUNK) % 16 === 0) progress(`Sending your vault… ${fmtSize(o)} of ${fmtSize(payload.length)}`, o / payload.length); }
      progress('Sent. Waiting for the other device…');
    } catch (e) { fail(e.message); }
  }

  function onMessage(m) {
    if (m.t === 'hello') peerName = String(m.name || '').slice(0, 60) || peerName;
    else if (m.t === 'ready') { st.peerReady = true; maybeSend(); }
    else if (m.t === 'bundle') {
      if (!Number.isFinite(m.bytes) || m.bytes < 1 || m.bytes > MAX_BUNDLE) { fail('The other device sent an invalid or oversized bundle.'); return; }
      st.expect = m.bytes; st.got = 0; st.incoming = [];
    } else if (m.t === 'result') { st.peerResult = m; finish(); }
  }
  function onBinary(buf) {
    if (!st.incoming) return;
    st.incoming.push(new Uint8Array(buf)); st.got += buf.byteLength;
    if (st.got > st.expect) { fail('The other device sent more data than announced.'); return; }
    if (st.got === st.expect) maybeApply();
  }

  async function maybeApply() {
    if (st.applied || !st.confirmed || !st.incoming || st.got !== st.expect) return;   // data from an unverified peer is never touched
    st.applied = true;
    try {
      progress('Opening and merging…');
      const all = new Uint8Array(st.expect); let o = 0; for (const p of st.incoming) { all.set(p, o); o += p.length; }
      st.incoming = null;
      const bundle = await openBundle(dec.decode(all), cfg.passphrase);
      const res = await store.applyRemote(bundle);
      st.mine = res;
      store.log('sync', `Beam sync completed — ${res.added} added, ${res.updated} updated, ${res.removed} removed, ${res.attachments} attachment(s) (code ${verify})`);
      link.send({ t: 'result', ok: true, msg: `${res.added} added, ${res.updated} updated, ${res.removed} removed` });
      finish();
    } catch (e) { try { link.send({ t: 'result', ok: false, msg: e.message }); } catch { /* closed */ } fail(e.message); }
  }

  function fail(msg) { store.log('sync', 'Beam sync failed — ' + msg, 'warn'); const dead = link; link = null; if (dead) dead.close(); cleanupState(); home(msg); }
  const cleanupState = () => { Object.assign(st, { confirmed: false, peerReady: false, sent: false, incoming: null, got: 0, expect: 0, applied: false, peerResult: null, mine: null }); };

  function finish() {
    if (!st.mine || !st.peerResult) { if (st.mine) progress('Merged. Waiting for the other device to finish…'); return; }
    const r = st.mine, p = st.peerResult;
    cfg.last = { at: Date.now(), ok: true, msg: 'Beam: ' + `${r.added} added, ${r.updated} updated, ${r.removed} removed` }; store.save();
    show(h('div', { class: 'panel pad' }, h('div', { class: 'note', text: '✓ Sync complete — both vaults now match.' }), r.conflicts ? h('div', { class: 'note warn', text: '⚠ ' + r.conflicts + ' value(s) were edited on both devices. The newest was kept; review the other versions under “Needs review”.' }) : null,
      h('div', { class: 'kv' }, h('span', { text: 'Received here' }), h('b', { text: `${r.added} added · ${r.updated} updated · ${r.removed} removed · ${r.attachments} attachment(s)` }), h('span', { text: 'On the other device' }), h('b', { text: p.ok ? p.msg : 'failed: ' + p.msg })),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => { const l = link; link = null; if (l) l.close(); ctx.go('all'); } } }, 'Done'), h('button', { class: 'btn', on: { click: () => { const l = link; link = null; if (l) l.close(); cleanupState(); home(); } } }, 'Beam again'))));
  }

  home();
  return root;
}
