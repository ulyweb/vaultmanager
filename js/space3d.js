/* The 3D card space: item cards that flow around the page in real 3D (CSS perspective, no WebGL).
   Each card sits on its own circular orbit around the centre of the screen, at its own radius, height and speed, and keeps facing you as it
   goes, so the cards sweep past at the sides, drift away behind the sign-in card or the widgets, and swoop in close again.
   The pointer shifts the whole space a little, like leaning to look around. Everything is decorative (aria-hidden): the cards show only
   category names and blurred placeholder bars, never anything from your vault.

   How it moves: one requestAnimationFrame loop writes one transform per card per frame (and one for its slight sway). It deliberately does NOT use
   nested CSS animations: stacks of animated 3D layers with thick slabs behind them can be depth-sorted wrongly by a browser's compositor (a card's
   face partly hidden behind its own edge), while plain per-frame transforms render the same way everywhere. Users who ask for reduced motion
   (or turn off 3D in Settings → Look & feel) get a still scatter or nothing; the loop only runs while the space is on screen. */

import { h } from './dom.js';

/* name, icon token, hue */
const CARDS = [
  ['Login', '{{login}}', 172], ['Payment card', '{{card}}', 262], ['Secure note', '{{note}}', 38], ['Wi-Fi', '{{network}}', 200], ['Crypto wallet', '{{crypto}}', 30],
  ['Bank account', '{{bank}}', 150], ['ID / identity', '{{identity}}', 330], ['Passport', '{{travel}}', 210], ['Server / API key', '{{server}}', 280], ['Insurance', '{{insurance}}', 120],
  ['Car', '{{car}}', 355], ['Locker code', '{{locker}}', 55], ['Contact', '{{contact}}', 300], ['Health', '{{healthcard}}', 0], ['Membership', '{{membership}}', 240], ['Recovery key', '{{lock}}', 175],
];
/* a fixed, hand-balanced spread (so the layout never looks random-clumpy): orbit radius, height, start angle (deg), tilt, period (s), size */
const SPREAD = [
  [560, -150, 0, 6, 96, 1], [700, 120, 52, -8, 118, 1.1], [480, 200, 104, 10, 84, 0.9], [760, -40, 156, -5, 132, 1.15], [520, -230, 208, 8, 104, 0.95], [640, 60, 260, -10, 90, 1],
  [430, 250, 312, 5, 112, 0.85], [820, 220, 24, -6, 140, 1.2], [600, -260, 78, 9, 100, 0.9], [540, 150, 130, -7, 126, 1], [720, -190, 182, 7, 94, 1.1], [460, 20, 234, -9, 108, 0.85],
  [660, 270, 286, 6, 122, 1], [780, -90, 338, -4, 88, 1.15], [500, -60, 40, 8, 114, 0.9], [610, 190, 200, -6, 98, 1],
];
const RAD = Math.PI / 180;

export function mountSpace() {
  const ring = h('div', { class: 's3-ring' });
  const cards = CARDS.map(([name, icon, hue], i) => {
    const [r, y, ang, rz, dur, size] = SPREAD[i];
    /* ONE layer per card: the face. Its thickness is a solid edge drawn from the face toward the middle of the screen (css: a stack of hard shadows sized by
       Settings → Card thickness), which is how a slab in perspective shows its side wall. Extra 3D layers behind the face were depth-sorted wrongly by some browsers. */
    const el = h('div', { class: 's3-card' }, h('div', { class: 's3-inner' },
      h('div', { class: 's3-top' }, h('span', { class: 's3-ico' }, h('span', { class: 'icn', text: icon })), h('b', { text: name })),
      h('i', { class: 's3-bar w1' }), h('i', { class: 's3-bar w2' }), h('i', { class: 's3-bar w3' })));
    el.style.setProperty('--s', String(size)); el.style.setProperty('--h', String(hue));
    ring.append(el);
    return { el, r, y, ang, rz, dur, rx: (i % 3 - 1) * 11, ph: i * 0.9 };
  });
  const root = h('div', { class: 's3', 'aria-hidden': 'true' }, ring);
  root.id = 'space3d';
  document.body.insertBefore(root, document.getElementById('app'));

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rs = () => (innerWidth <= 700 ? 0.55 : 0.9);   // orbit radius scale: the nearest card always stays well in front of the camera (perspective 1150 vs radius <= 820 x .9)
  const place = (t) => {
    const k = rs();
    for (const c of cards) {
      const th = (c.ang + (t * 360) / c.dur) * RAD, r = c.r * k;
      const x = Math.sin(th) * r, z = Math.cos(th) * r, bob = Math.sin(t / 1.1 + c.ph) * 12, sway = Math.sin(t / 1.7 + c.ph) * 3.2;
      c.el.style.transform = `translate3d(${x.toFixed(1)}px, ${(c.y + bob).toFixed(1)}px, ${z.toFixed(1)}px) rotateX(${c.rx}deg) rotateZ(${c.rz}deg) rotate3d(1, .4, 0, ${sway.toFixed(2)}deg)`;
      /* which way the thick edge shows: toward the middle of the screen (we see the side wall that faces the centre) */
      c.el.style.setProperty('--ex', Math.max(-1, Math.min(1, 0.2 - x / 640)).toFixed(2)); c.el.style.setProperty('--ey', Math.max(-1, Math.min(1, 0.38 - (c.y + bob) / 480)).toFixed(2));
    }
  };
  place(0);

  /* the loop runs only while the space is on screen, and never for reduced motion */
  const visible = () => document.documentElement.dataset.fx3d === 'on' && ['gate', 'home'].includes(document.body.dataset.space) && !(document.body.dataset.modal && document.body.dataset.space === 'home');
  let raf = 0;
  const t0 = performance.now();
  const loop = (now) => {
    raf = 0;
    if (!visible() || document.hidden) return;
    if (reduced()) { place(0); return; }
    place((now - t0) / 1000);
    raf = requestAnimationFrame(loop);
  };
  const wake = () => { if (!raf) raf = requestAnimationFrame(loop); };
  new MutationObserver(wake).observe(document.body, { attributes: true, attributeFilter: ['data-space', 'data-modal'] });
  new MutationObserver(wake).observe(document.documentElement, { attributes: true, attributeFilter: ['data-fx3d'] });
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', () => { place((performance.now() - t0) / 1000); wake(); });
  wake();

  /* lean toward the pointer (cheap: one transform on the whole ring, only while the pointer is moving) */
  let tx = 0, ty = 0, cx = 0, cy = 0, lean = 0;
  const leanLoop = () => {
    cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
    ring.style.setProperty('--lx', cx.toFixed(2) + 'deg'); ring.style.setProperty('--ly', cy.toFixed(2) + 'deg');
    lean = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.02 ? requestAnimationFrame(leanLoop) : 0;
  };
  window.addEventListener('pointermove', (e) => {
    if (!visible() || reduced()) return;
    tx = ((e.clientX / innerWidth) - 0.5) * 12; ty = -((e.clientY / innerHeight) - 0.5) * 7;
    if (!lean) lean = requestAnimationFrame(leanLoop);
  }, { passive: true });

  let timer = 0;
  return {
    root,
    /* 'gate' (sign-in, create, import), 'home' (the widgets page, quieter) or 'off' */
    set(mode) { if (document.body.dataset.space !== mode) document.body.dataset.space = mode; },
    /* the whole space is pushed toward you for a moment: something important just happened (unlock, create, backup opened) */
    surge() { root.classList.add('surge'); clearTimeout(timer); timer = setTimeout(() => root.classList.remove('surge'), 1500); },
  };
}
