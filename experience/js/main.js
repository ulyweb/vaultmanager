/* VaultManager — the 3D tour. One live three.js scene behind a scrolling page:
   scrolling moves the camera and the clock, every new chapter sets off a powder burst, drag spins the vault,
   the colour chips repaint it, "Chart a new item" morphs the particle cloud into the next item category, and the screen is a playable game.
   The facts it shows come from the app's own modules (categories, generator, strength meter). */
import * as THREE from '../vendor/three.bundle.min.js';
import { buildDevice } from './device.js';
import { Screen } from './game.js';
import { makeBursts, makeDebris, makeCloud, makeStars } from './fx.js';
import { generateStrongPassphrase } from '../../js/generator.js';
import { estimate } from '../../js/strength.js';
import { TEMPLATES, TYPE_META, TYPE_KEYS } from '../../js/templates.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const root = document.documentElement, body = document.body, canvas = $('#stage');
const Q = new URLSearchParams(location.search);
const SHOT = Q.has('shot') ? Math.max(0, parseInt(Q.get('shot'), 10) || 0) : null;
const CALM = SHOT !== null || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

/* ---------- chapters: where the camera stands, where it looks, how the vault is turned, and what time it is ---------- */
const CH = [
  { id: 'hero',     cam: [0, 0.1, 9.6],     look: [0, 0.1, 0],     rot: [-0.1, 0.36, -0.13],  clock: 6,    screen: 'game' },
  { id: 'profile',  cam: [-2.2, 0.5, 8.4],  look: [1.3, 0, 0],     rot: [0.02, -0.42, 0.05],  clock: 8.5,  screen: 'profile' },
  { id: 'tour',     cam: [2.2, 0.8, 7.8],   look: [-1.25, 0, 0],   rot: [-0.04, 0.42, 0],     clock: 10.5, screen: 'welcome' },
  { id: 'items',    cam: [1.2, 0.3, 11.6],  look: [-0.7, 0, 0],    rot: [0, 0.34, 0.03],      clock: 12.5, screen: 'item' },
  { id: 'inside',   cam: [0.4, 0.9, 13.4],  look: [-1.7, 0, 0],    rot: [0.05, 1.08, 0],      clock: 15,   screen: 'lock', explode: 1 },
  { id: 'settings', cam: [-2, 0.4, 8.6],    look: [1.3, 0, 0],     rot: [0.03, -0.55, -0.05], clock: 17.5, screen: 'menu' },
  { id: 'tools',    cam: [2, 0.4, 8.2],     look: [-1.25, 0, 0],   rot: [-0.03, 0.3, 0.02],   clock: 19.5, screen: 'qr' },
  { id: 'play',     cam: [-0.6, 0.1, 7.5],  look: [1.05, 0, 0],    rot: [0, -0.1, 0],         clock: 21.5, screen: 'game' },
  { id: 'open',     cam: [2.2, 0.5, 8.4],   look: [-1.3, 0, 0],    rot: [-0.06, 0.4, -0.05],  clock: 23.5, screen: 'lock' },
];
const sections = $$('.ch');
let tops = [], narrow = false, f = 0, active = -1;

/* ---------- colours (the chips) and categories (the "Chart a new item" button) ---------- */
const FLAVOURS = [
  { name: 'Teal', hex: '#19c8b4', ink: '#06211d', two: '#a855f7' },
  { name: 'Bone', hex: '#f1ece0', ink: '#15171a', two: '#19c8b4' },
  { name: 'Amber', hex: '#f7c948', ink: '#231a02', two: '#ff7a59' },
  { name: 'Violet', hex: '#b06cf9', ink: '#170528', two: '#19c8b4' },
  { name: 'Steel', hex: '#8b93a1', ink: '#0b0d10', two: '#60a5fa' },
];
const CORE_FIELDS = { login: ['Username / email', 'Website', 'Password', 'One-time code'], note: ['Note'], card: ['Cardholder', 'Card number', 'Expiry', 'CVV', 'PIN'] };
const fieldsOf = (k) => CORE_FIELDS[k] || ((TEMPLATES[k] || {}).fields || []).map((x) => x.l);
const iconOf = (k) => (/\{\{([a-z0-9]+)\}\}/.exec(TYPE_META[k].icon || '') || [])[1] || k;
let flavour = 0, cat = 0;

/* ---------- 3D scene (optional: without WebGL the page still reads, with the design board as a poster) ---------- */
const screen = new Screen();
let G = null;
try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.42;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x1a1c22, 0.32), key = new THREE.DirectionalLight(0xffffff, 2.0), rim = new THREE.PointLight(0xa855f7, 26, 30), fill = new THREE.PointLight(0x19c8b4, 14, 30);
  key.position.set(3.5, 4.5, 6); rim.position.set(4.5, 1.5, -3.5); fill.position.set(-5, -1, -2.5); scene.add(hemi, key, rim, fill);
  const device = buildDevice(screen.canvas); scene.add(device.group);
  G = { renderer, scene, camera, device, key, rim, fill, bursts: makeBursts(scene), debris: makeDebris(scene), cloud: makeCloud(scene), stars: makeStars(scene), ray: new THREE.Raycaster() };
} catch (e) {
  body.classList.add('nogl'); $('.poster').hidden = false;
}

/* ---------- sound: off until asked for ---------- */
let soundOn = false, ac = null, music = null;
function blip(kind) {
  if (!soundOn || !ac) return;
  const t = ac.currentTime, g = ac.createGain(); g.connect(ac.destination);
  if (kind === 'burst') {
    const n = ac.createBufferSource(), buf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(220, t + 0.45);
    n.buffer = buf; n.connect(lp); lp.connect(g); g.gain.setValueAtTime(0.22, t); n.start(t); return;
  }
  const o = ac.createOscillator(), [type, a, b, dur, vol] = { jump: ['square', 440, 880, 0.09, 0.05], slide: ['triangle', 320, 160, 0.12, 0.09], hit: ['sawtooth', 160, 70, 0.2, 0.08], click: ['sine', 620, 620, 0.05, 0.08] }[kind] || ['sine', 500, 500, 0.05, 0.05];
  o.type = type; o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); o.start(t); o.stop(t + dur + 0.02);
}
screen.onSound = blip;
$('#sound').addEventListener('click', (e) => {
  soundOn = !soundOn; e.currentTarget.textContent = soundOn ? 'Sound on' : 'Sound off'; e.currentTarget.setAttribute('aria-pressed', String(soundOn));
  if (soundOn) {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch { ac = null; }
    if (!music) { music = new Audio('media/loop.mp3'); music.loop = true; music.volume = 0.32; }
    music.play().catch(() => {}); blip('click');
  } else if (music) music.pause();
});

/* ---------- colours and categories ---------- */
const chipsBox = $('#chips');
FLAVOURS.forEach((fl, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-label', fl.name); b.setAttribute('aria-pressed', 'false'); b.style.background = fl.hex; b.addEventListener('click', () => { setFlavour(i); fire(); blip('click'); }); chipsBox.append(b); });
function setFlavour(i) {
  flavour = (i + FLAVOURS.length) % FLAVOURS.length; const fl = FLAVOURS[flavour];
  root.style.setProperty('--accent', fl.hex); root.style.setProperty('--accent-ink', fl.ink); root.dataset.flavour = fl.name.toLowerCase();
  $$('.chip', chipsBox).forEach((b, k) => b.setAttribute('aria-pressed', String(k === flavour)));
  if (G) { G.device.setColor(fl.hex); G.bursts.setColors(fl.hex, fl.two); G.cloud.setColor(root.dataset.stage === 'light' && flavour === 1 ? '#15171a' : fl.hex); G.fill.color.set(fl.hex); G.rim.color.set(fl.two); }
}
function showCategory() {
  const k = TYPE_KEYS[cat], meta = TYPE_META[k], fields = fieldsOf(k), box = $('#catcard');
  box.textContent = '';
  const small = document.createElement('small'), name = document.createElement('b'), ul = document.createElement('ul');
  small.textContent = `${meta.group} · ${cat + 1} of ${TYPE_KEYS.length}`; name.textContent = meta.label;
  for (const l of fields.slice(0, 6)) { const li = document.createElement('li'); li.textContent = l; ul.append(li); }
  if (fields.length > 6) { const li = document.createElement('li'); li.textContent = '+ ' + (fields.length - 6) + ' more'; ul.append(li); }
  box.append(small, name, ul);
  screen.info.cat = meta.label;
  formCloud();
}
function formCloud() { if (!G) return; if (CH[active] && CH[active].id === 'items') G.cloud.form(iconOf(TYPE_KEYS[cat]), narrow ? 0 : 3.1, narrow ? 2.3 : 0.15, narrow ? -1 : 0.3, narrow ? 1.8 : 3.0); else G.cloud.form(null); }
$('#catcount').textContent = String(TYPE_KEYS.length);
$('#chart').addEventListener('click', () => { cat = (cat + 1) % TYPE_KEYS.length; setFlavour(flavour + 1); if (G && !CALM) G.cloud.scatter(0.7); showCategory(); fire(); });

/* stage: dark or light */
function setStage(s) {
  root.dataset.stage = s; $$('[data-stage-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stagePick === s)));
  if (G) { G.bursts.setLight(s === 'light'); G.cloud.setLight(s === 'light'); } setFlavour(flavour);
  const m = $('meta[name=theme-color]'); if (m) m.content = s === 'light' ? '#f1ece0' : '#0b0d10';
}
$$('[data-stage-pick]').forEach((b) => b.addEventListener('click', () => { setStage(b.dataset.stagePick); fire(); blip('click'); }));

/* the app's real generator */
$('#suggest').addEventListener('click', () => {
  const p = generateStrongPassphrase(), e = estimate(p);
  $('#phrase').textContent = p; $('#bits').textContent = `${p.split('-').length} words · ~${Math.round(e.bits)} bits of entropy · ${e.label}`; blip('click');
});

/* ---------- bursts ---------- */
function fire() { if (!G) return; G.bursts.fire(); if (!CALM) G.debris.kick(); blip('burst'); }

/* ---------- the tour pins and the part labels ---------- */
const PINS = [
  { a: 'screen', t: 'Welcome splash', p: 'The first thing you see after creating a profile. It can greet you at every sign-in, or only once.' },
  { a: 'label', t: 'Guided tour', p: 'A short walk through the vault, the tools and the settings. Replay it any time from the system menu.' },
  { a: 'dpad', t: 'System menu', p: 'About, shortcuts, the tour, Settings, Task manager, Lock, Purge memory, Switch profile and Restart.' },
  { a: 'buttons', t: 'Copy and reveal', p: 'Copy a secret and the clipboard clears itself. Reveals can be written to the audit trail.' },
  { a: 'speaker', t: 'Audit trail', p: 'A record of what happened in your vault, kept inside the encrypted vault. It never holds secret values.' },
];
const PARTS = [
  ['screen', 'Screen', 'Your vault is sealed with AES-256-GCM. Without the password it is noise.'],
  ['board', 'Mainboard', 'Your master password is stretched with PBKDF2-SHA256, 600,000 rounds.'],
  ['cell', 'Key cell', 'The key lives in memory only while the vault is unlocked. Lock it and the key is gone.'],
  ['front', 'Front shell', 'No account and no server. Everything stays on this device.'],
  ['back', 'Back shell', 'Works offline, even from one file on a USB stick.'],
  ['controls', 'Controls', 'Copying, revealing and exporting are yours alone. Nothing is tracked.'],
  ['screws', 'Four screws', 'Zero-knowledge: nobody else can open it, and nobody can reset it.'],
];
const LABEL_Y = { screen: 1.5, front: 2.2, controls: -1.75, board: 1.85, cell: -1.35, back: 1.95, screws: -1.95 };
const pinsBox = $('#pins'), card = $('#card');
const pinEls = PINS.map((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pin'; b.textContent = String(i + 1); b.setAttribute('aria-label', p.t); b.hidden = true; b.addEventListener('click', () => { $('b', card).textContent = p.t; $('p', card).textContent = p.p; card.hidden = false; blip('click'); }); pinsBox.append(b); return b; });
const labelEls = PARTS.map(([, name]) => { const s = document.createElement('span'); s.className = 'pin label'; s.textContent = name; s.hidden = true; pinsBox.append(s); return s; });
$('.x', card).addEventListener('click', () => { card.hidden = true; });
for (const [, name, text] of PARTS) { const li = document.createElement('li'), b = document.createElement('b'); b.textContent = name; li.append(b, text); $('#parts').append(li); }
const v3 = G ? new THREE.Vector3() : null;
function place(el, world) {
  v3.copy(world).project(G.camera);
  el.style.transform = `translate(${((v3.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-v3.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px)`;
}

/* ---------- layout and scroll ---------- */
function measure() {
  narrow = innerWidth < 860; tops = sections.map((s) => s.offsetTop);
  if (G) { G.renderer.setSize(innerWidth, innerHeight, false); G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix(); }
}
function readScroll() {
  const y = window.scrollY, n = tops.length; let v = n - 1;
  for (let i = 0; i < n - 1; i++) if (y < tops[i + 1]) { v = i + clamp((y - tops[i]) / (tops[i + 1] - tops[i]), 0, 1); break; }
  f = v;
  const a = clamp(Math.round(f), 0, CH.length - 1);
  if (a !== active) {
    const first = active < 0; active = a; const c = CH[a];
    body.dataset.ch = c.id; screen.mode = c.screen; card.hidden = true;
    $$('.nav nav a').forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#c-' + c.id));
    formCloud(); if (!first) fire();
  }
}
/* the pose for a fractional chapter position */
function pose(v) {
  const i = clamp(Math.floor(v), 0, CH.length - 2), t = clamp(v - i, 0, 1), u = t * t * (3 - 2 * t), a = CH[i], b = CH[i + 1];
  const p = { cam: mix(a.cam, b.cam, u), look: mix(a.look, b.look, u), rot: mix(a.rot, b.rot, u), explode: lerp(a.explode || 0, b.explode || 0, u), clock: lerp(a.clock, b.clock, t) };
  if (narrow) { const far = innerWidth < 500 ? 1.9 : 1.45; p.cam = [p.cam[0] * 0.25, p.cam[1], p.cam[2] * far]; p.look = [0, -1.5 * far / 1.75, 0]; p.rot = [p.rot[0], p.rot[1] * (1 - 0.35 * p.explode), p.rot[2]]; }
  return p;
}
const cur = pose(0);
const hours = [[6, [255, 138, 76], 82, 0xffe2c4, 1.9], [12, [255, 236, 200], 30, 0xffffff, 2.1], [18, [208, 96, 220], 74, 0xffc4a8, 1.8], [24, [72, 112, 255], 18, 0xc4d4ff, 1.5]];
const colA = G ? new THREE.Color() : null, colB = G ? new THREE.Color() : null;
function setClock(h) {
  let i = 0; while (i < hours.length - 2 && h > hours[i + 1][0]) i++;
  const a = hours[i], b = hours[i + 1], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  root.style.setProperty('--glow', mix(a[1], b[1], t).map(Math.round).join(', ')); root.style.setProperty('--glow-y', lerp(a[2], b[2], t).toFixed(1) + '%');
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60 / 5) * 5, text = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  $('#clock').textContent = text; $('#dot').style.top = clamp((h - 6) / 18, 0, 1) * 100 + '%'; screen.info.time = text;
  if (G) { G.key.color.copy(colA.set(a[3])).lerp(colB.set(b[3]), t); G.key.intensity = lerp(a[4], b[4], t); G.stars.set(root.dataset.stage === 'light' ? 0 : clamp((h - 18.5) / 4, 0, 1) * 0.9); }
}

/* ---------- drag to spin, click the 3D buttons ---------- */
const drag = { on: false, moved: false, x: 0, y: 0, yaw: 0, pitch: 0, vy: 0, vp: 0 };
if (G) {
  const ndc = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => { drag.on = true; drag.moved = false; drag.x = e.clientX; drag.y = e.clientY; drag.sx = e.clientX; drag.sy = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag.on) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) { drag.moved = true; canvas.classList.add('dragging'); }
    if (drag.moved) { drag.vy = dx * 0.55; drag.vp = dy * 0.3; drag.yaw += dx * 0.011; drag.pitch = clamp(drag.pitch + dy * 0.006, -0.9, 0.9); }
  });
  const end = (e) => {
    if (!drag.on) return; drag.on = false; canvas.classList.remove('dragging');
    if (drag.moved || e.type === 'pointercancel') return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); G.ray.setFromCamera(ndc, G.camera);
    const hit = G.ray.intersectObjects(G.device.hits, false)[0];
    if (hit) { const act = hit.object.userData.act; G.device.press(hit.object); screen.input(act === 'slide' ? 'slide' : 'jump'); blip('click'); }
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
}
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), act = k === 'z' ? 'jump' : k === 'x' ? 'slide' : null;
  if (act) { screen.input(act); if (G) G.device.press(act === 'jump' ? G.device.buttons.btnA : G.device.buttons.btnB); }
});
$$('[data-act]').forEach((b) => b.addEventListener('click', () => { screen.input(b.dataset.act); if (G) G.device.press(b.dataset.act === 'jump' ? G.device.buttons.btnA : G.device.buttons.btnB); }));

/* ---------- the frame loop ---------- */
const target = G ? new THREE.Vector3() : null, world = G ? new THREE.Vector3() : null;
let last = performance.now(), bestShown = -1;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  readScroll();
  const goal = pose(f), k = CALM ? 1 : 1 - Math.exp(-dt * 5.5);
  for (const key of ['cam', 'look', 'rot']) for (let i = 0; i < 3; i++) cur[key][i] = lerp(cur[key][i], goal[key][i], k);
  cur.explode = lerp(cur.explode, goal.explode, k); cur.clock = lerp(cur.clock, goal.clock, k);
  setClock(cur.clock);
  root.style.setProperty('--word', clamp(1 - f * 1.5, root.dataset.stage === 'light' ? 0.09 : 0.06, 1).toFixed(3));
  screen.advance(dt);
  if (screen.best !== bestShown) { bestShown = screen.best; $('#best').textContent = String(bestShown); }
  if (!G) return;
  const t = now / 1000, d = G.device;
  if (!drag.on) { drag.yaw += drag.vy * dt; drag.vy *= Math.exp(-dt * 2.6); drag.vp *= Math.exp(-dt * 6); const home = Math.exp(-dt * 0.7); drag.yaw = Math.atan2(Math.sin(drag.yaw), Math.cos(drag.yaw)) * home; drag.pitch *= home; }
  const bob = CALM ? 0 : 1;
  d.group.rotation.set(cur.rot[0] + drag.pitch + bob * Math.sin(t * 0.7) * 0.025, cur.rot[1] + drag.yaw + bob * Math.sin(t * 0.45) * 0.07, cur.rot[2]);
  d.group.position.y = bob * Math.sin(t * 0.9) * 0.06;
  d.setExplode(cur.explode, narrow ? 0.62 : 1); d.update(dt); d.texture.needsUpdate = true;
  G.camera.position.set(cur.cam[0], cur.cam[1], cur.cam[2]); target.set(cur.look[0], cur.look[1], cur.look[2]); G.camera.lookAt(target);
  G.bursts.update(dt, G.camera, d.group.position, CALM && SHOT === null); G.debris.update(dt, CALM); G.cloud.update(dt, CALM);
  d.group.updateMatrixWorld(true); G.camera.updateMatrixWorld(true);
  const tour = CH[active].id === 'tour' && Math.abs(f - active) < 0.3, inside = !narrow && CH[active].id === 'inside' && cur.explode > 0.75;   // on a phone the list under the model names the parts
  pinEls.forEach((el, i) => { el.hidden = !tour; if (tour) place(el, d.group.localToWorld(world.fromArray(d.anchors[PINS[i].a]))); });
  labelEls.forEach((el, i) => { el.hidden = !inside; if (inside) { d.parts[PARTS[i][0]].getWorldPosition(world); world.y += LABEL_Y[PARTS[i][0]]; place(el, world); } });
  G.renderer.render(G.scene, G.camera);
}

/* ---------- start ---------- */
window.addEventListener('resize', measure);
measure(); setFlavour(Q.has('flavour') ? parseInt(Q.get('flavour'), 10) || 0 : 0); if (Q.get('stage') === 'light') setStage('light');
if (Q.has('cat')) cat = clamp(parseInt(Q.get('cat'), 10) || 0, 0, TYPE_KEYS.length - 1);
if (SHOT !== null) { root.style.scrollBehavior = 'auto'; window.scrollTo(0, tops[clamp(SHOT, 0, tops.length - 1)] + (Q.has('off') ? parseFloat(Q.get('off')) * innerHeight : 0)); }
readScroll(); Object.assign(cur, pose(f)); showCategory();
if (G && SHOT !== null) G.bursts.fire();
window.__vm3d = { ready: true, gl: !!G, screen, chapter: () => CH[active].id, fire, flavours: FLAVOURS.length, categories: TYPE_KEYS.length };
requestAnimationFrame(frame);
