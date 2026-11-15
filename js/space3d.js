/* The 3D card space: item cards that flow around the page in real 3D (CSS perspective, no WebGL).
   Each card sits on its own circular orbit around the centre of the screen, at its own radius, height and speed, and turns to face you
   as it goes, so the cards sweep past at the sides, drift away behind the sign-in card or the widgets, and swoop in close again.
   The pointer shifts the whole space a little, like leaning to look around. Everything is decorative (aria-hidden): the cards show only
   category names and blurred placeholder bars, never anything from your vault. All motion is CSS; users who ask for reduced motion
   (or turn off 3D in Settings → Look & feel) get a still scatter or nothing. */

import { h } from './dom.js';

/* name, icon token, hue */
const CARDS = [
  ['Login', '{{login}}', 172], ['Payment card', '{{card}}', 262], ['Secure note', '{{note}}', 38], ['Wi-Fi', '{{network}}', 200], ['Crypto wallet', '{{crypto}}', 30],
  ['Bank account', '{{bank}}', 150], ['ID / identity', '{{identity}}', 330], ['Passport', '{{travel}}', 210], ['Server / API key', '{{server}}', 280], ['Insurance', '{{insurance}}', 120],
  ['Car', '{{car}}', 355], ['Locker code', '{{locker}}', 55], ['Contact', '{{contact}}', 300], ['Health', '{{healthcard}}', 0], ['Membership', '{{membership}}', 240], ['Recovery key', '{{lock}}', 175],
];
/* a fixed, hand-balanced spread (so the layout never looks random-clumpy): orbit radius, height, angle, tilt, period (s), size */
const SPREAD = [
  [560, -150, 0, 6, 96, 1], [700, 120, 52, -8, 118, 1.1], [480, 200, 104, 10, 84, 0.9], [760, -40, 156, -5, 132, 1.15], [520, -230, 208, 8, 104, 0.95], [640, 60, 260, -10, 90, 1],
  [430, 250, 312, 5, 112, 0.85], [820, 220, 24, -6, 140, 1.2], [600, -260, 78, 9, 100, 0.9], [540, 150, 130, -7, 126, 1], [720, -190, 182, 7, 94, 1.1], [460, 20, 234, -9, 108, 0.85],
  [660, 270, 286, 6, 122, 1], [780, -90, 338, -4, 88, 1.15], [500, -60, 40, 8, 114, 0.9], [610, 190, 200, -6, 98, 1],
];

export function mountSpace() {
  const ring = h('div', { class: 's3-ring' });
  CARDS.forEach(([name, icon, hue], i) => {
    const [r, y, ang, rz, dur, size] = SPREAD[i];
    /* a real slab: the face in front, and a stack of slices behind it (their depth follows Settings → Card thickness), so the card has an edge you see as it turns */
    const slices = Array.from({ length: 6 }, (_, k) => { const s = h('i', { class: 's3-slice' }); s.style.setProperty('--k', String(k + 1)); return s; });
    const card = h('div', { class: 's3-card' }, h('div', { class: 's3-slab' }, ...slices, h('div', { class: 's3-inner' },
      h('div', { class: 's3-top' }, h('span', { class: 's3-ico' }, h('span', { class: 'icn', text: icon })), h('b', { text: name })),
      h('i', { class: 's3-bar w1' }), h('i', { class: 's3-bar w2' }), h('i', { class: 's3-bar w3' }))));
    const orbit = h('div', { class: 's3-orbit' }, card);
    orbit.style.cssText = `--ang:${ang};--r:${r}px;--y:${y}px;--rz:${rz}deg;--rx:${(i % 3 - 1) * 11}deg;--dur:${dur}s;--s:${size};--h:${hue};--bob:${(i % 5) * -1.1 - 2}s`;
    ring.append(orbit);
  });
  const root = h('div', { id: 'space3d', class: 's3', 'aria-hidden': 'true' }, ring);
  document.body.insertBefore(root, document.getElementById('app'));

  /* lean toward the pointer (cheap: one transform on the whole ring, only while the pointer is moving) */
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const loop = () => {
    cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
    ring.style.setProperty('--lx', cx.toFixed(2) + 'deg'); ring.style.setProperty('--ly', cy.toFixed(2) + 'deg');
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.02 ? requestAnimationFrame(loop) : 0;
  };
  window.addEventListener('pointermove', (e) => {
    if (document.body.dataset.space === 'off' || document.documentElement.dataset.fx3d !== 'on') return;
    tx = ((e.clientX / innerWidth) - 0.5) * 12; ty = -((e.clientY / innerHeight) - 0.5) * 7;
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });

  let timer = 0;
  return {
    root,
    /* 'gate' (sign-in, create, import), 'home' (the widgets page, quieter) or 'off' */
    set(mode) { if (document.body.dataset.space !== mode) document.body.dataset.space = mode; },
    /* the whole space swells toward you for a moment: something important just happened (unlock, create, backup opened) */
    surge() { root.classList.add('surge'); clearTimeout(timer); timer = setTimeout(() => root.classList.remove('surge'), 1500); },
  };
}
