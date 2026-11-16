/* The "Choose a category" carousel: every category is a card on a 3D ring that flows around the visitor.
   Pure CSS 3D transforms driven by one requestAnimationFrame loop (no WebGL, no library, nothing to load):
   cards pop out of the centre one after another, drift up and down in a slow wave, the one in front grows and tilts toward the pointer,
   the ones behind turn to face you again (so every card stays readable) and fade back.
   Drag / swipe / scroll / arrow keys to spin, click a card to bring it to the front, click the front card (or press Enter) to create.
   With "reduce motion" or animations off it still works, just without the idle drifting and the pop-in. */

import { h, clear } from './dom.js';
import { has3d, icon3dUrl } from './icons3d.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mod = (a, n) => ((a % n) + n) % n;
const wrap = (d, n) => { d = mod(d, n); return d > n / 2 ? d - n : d; };       // shortest signed distance on a ring of n
const backOut = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

/* cards: [{ key, label, icon, group, fields: [labels], count }], groups: [[name, [keys]]], onPick(key) */
export function categoryCarousel({ cards, groups, onPick, still = false, start = 0 }) {
  const n = cards.length, step = TAU / n;
  let pos = start, tpos = start, vel = 0, front = -1, alive = true, raf = 0, last = performance.now(), t0 = last, idleAt = last, hover = false, focusIn = false, touched = false;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

  const ring = h('div', { class: 'c3-ring' });
  const els = cards.map((c, i) => {
    const b = h('button', { type: 'button', class: 'c3-card', 'data-key': c.key, tabindex: '-1', 'aria-label': `${c.label}, ${c.group}, ${c.count} field${c.count === 1 ? '' : 's'}`, on: {
      click: () => { if (drag.moved) return; if (i === front) onPick(c.key); else go(pos + wrap(i - pos, n)); },
      focus: () => { if (i !== front) go(pos + wrap(i - pos, n)); },
    } }, has3d(c.key) ? h('img', { class: 'c3-obj', src: icon3dUrl(c.key), alt: '', draggable: 'false', decoding: 'async' }) : h('span', { class: 'c3-ico' }, h('span', { class: 'icn', text: c.icon })), h('b', { text: c.label }), h('small', { text: c.group }), h('i', { class: 'c3-shine', 'aria-hidden': 'true' }));
    b.style.setProperty('--hue', String(groups.findIndex(([, keys]) => keys.includes(c.key)) * 47 + 160));
    ring.append(b); return b;
  });

  const name = h('b', { class: 'c3-name', 'aria-live': 'polite' }), meta = h('small', { class: 'c3-meta' }), chips = h('div', { class: 'c3-fields' });
  const create = h('button', { type: 'button', class: 'btn primary c3-create', on: { click: () => onPick(cards[front].key) } });
  const groupBtns = groups.map(([g, keys]) => h('button', { type: 'button', class: 'c3-group', 'aria-pressed': 'false', on: { click: () => go(pos + wrap(cards.findIndex((c) => c.key === keys[0]) - pos, n)) } }, g));
  const stage = h('div', { class: 'c3-stage', role: 'group', autofocus: true, 'aria-roledescription': 'carousel', 'aria-label': 'Item categories. Use the left and right arrow keys to browse, Enter to create.', tabindex: '0' }, ring);
  const caption = h('div', { class: 'c3-caption' }, name, meta, create, chips);
  const el = h('div', { class: 'c3' + (still ? ' still' : '') }, h('div', { class: 'c3-groups', role: 'group', 'aria-label': 'Jump to a group' }, groupBtns), stage, caption,
    h('p', { class: 'hint c3-hint', text: 'Drag, scroll or use the arrow keys to spin the ring. Click the card in front, or press Enter, to create that kind of item.' }));

  const go = (p) => { touched = true; tpos = Math.round(p); idleAt = performance.now(); if (still) { pos = tpos; paint(performance.now(), 0.016); } };
  const setFront = (i) => {
    if (i === front) return; front = i; const c = cards[i];
    name.textContent = c.label; meta.textContent = `${c.group} · ${i + 1} of ${n}`;
    clear(chips).append(...c.fields.slice(0, 4).map((f) => h('span', { text: f })), c.fields.length > 4 ? h('span', { text: '+ ' + (c.fields.length - 4) + ' more' }) : null);
    create.textContent = 'Create ' + c.label.toLowerCase();
    els.forEach((b, k) => { b.tabIndex = k === i ? 0 : -1; b.classList.toggle('front', k === i); });
    groupBtns.forEach((b, k) => { const on = groups[k][1].includes(c.key); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); });
  };

  /* ---- input ---- */
  const drag = { on: false, moved: false, x: 0, sx: 0, last: 0, id: null };
  const unit = () => Math.max(46, stage.clientWidth / 11);                       // pixels of drag that move the ring by one card
  el.addEventListener('pointerdown', () => { touched = true; });   // once anyone has touched it, it never turns by itself again
  stage.addEventListener('pointerdown', (e) => { if (e.button) return; drag.on = true; drag.moved = false; drag.x = drag.sx = e.clientX; drag.last = performance.now(); vel = 0; idleAt = drag.last; });
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect(); tilt.tx = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1); tilt.ty = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
    if (!drag.on) return; const dx = e.clientX - drag.x; drag.x = e.clientX;
    if (!drag.moved && Math.abs(e.clientX - drag.sx) > 6) { drag.moved = true; stage.classList.add('dragging'); try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    if (drag.moved) { const now = performance.now(), dt = Math.max(1, now - drag.last) / 1000; drag.last = now; const dp = -dx / unit(); pos += dp; tpos = pos; vel = 0.7 * vel + 0.3 * (dp / dt); if (still) paint(now, dt); }
  });
  const release = () => { if (!drag.on) return; drag.on = false; stage.classList.remove('dragging'); if (drag.moved) { tpos = Math.round(pos + clamp(vel * 0.18, -4, 4)); if (still) { pos = tpos; paint(performance.now(), 0.016); } setTimeout(() => { drag.moved = false; }, 0); } idleAt = performance.now(); };
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', () => { tilt.tx = tilt.ty = 0; });
  /* the ring drifts on its own only until the first touch, click or key press, and never while the pointer is over it:
     it can never move under a click on "Create" */
  el.addEventListener('pointerenter', () => { hover = true; }); el.addEventListener('pointerleave', () => { hover = false; idleAt = performance.now(); });
  el.addEventListener('focusin', () => { focusIn = true; }); el.addEventListener('focusout', () => { focusIn = false; idleAt = performance.now(); });
  let wheelAt = 0;
  stage.addEventListener('wheel', (e) => { const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (!d) return; e.preventDefault(); const now = performance.now(); if (now - wheelAt < 110) return; wheelAt = now; go(tpos + (d > 0 ? 1 : -1)); }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const k = e.key; touched = true;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); go(tpos + 1); els[mod(tpos, n)].focus({ preventScroll: true }); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); go(tpos - 1); els[mod(tpos, n)].focus({ preventScroll: true }); }
    else if (k === 'Home') { e.preventDefault(); go(tpos + wrap(0 - tpos, n)); }
    else if (k === 'End') { e.preventDefault(); go(tpos + wrap(n - 1 - tpos, n)); }
    else if ((k === 'Enter' || k === ' ') && e.target === stage) { e.preventDefault(); onPick(cards[front].key); }
  });

  /* ---- the frame loop ---- */
  const paint = (now, dt) => {
    const w = stage.clientWidth || 600, narrow = w < 560;
    const R = clamp(w * (narrow ? 0.7 : 0.8), 200, 560), cw = narrow ? 118 : 150, ch = narrow ? 150 : 186, t = now / 1000;
    tilt.x += (tilt.tx - tilt.x) * Math.min(1, dt * 6); tilt.y += (tilt.ty - tilt.y) * Math.min(1, dt * 6);
    const near = Math.round(pos);
    if (!still && !drag.on) { pos += (tpos - pos) * (1 - Math.exp(-dt * 8.5)); if (Math.abs(tpos - pos) < 0.0008) pos = tpos; }
    for (let i = 0; i < n; i++) {
      const d = wrap(i - pos, n), th = d * step, c = Math.cos(th), s = Math.sin(th);
      const pop = still ? 1 : backOut(clamp((now - t0 - i * 24) / 760, 0, 1));          // cards pop out of the centre, one after another
      const r = R * pop, depth = (c + 1) / 2, fr = Math.max(0, 1 - Math.abs(d) / 1.15);
      const y = still ? 0 : Math.sin(t * 1.1 + i * 0.62) * 6 + Math.sin(th * 2 + t * 0.7) * 11 * (1 - fr * 0.8);
      const faceBack = Math.abs(th) > Math.PI / 2, ry = (faceBack ? th + Math.PI : th) * 57.2958;
      const sc = (0.56 + 0.44 * depth) * (1 + 0.16 * fr) * Math.max(0.001, still ? 1 : pop);
      const tx = fr > 0 ? ` rotateX(${(-tilt.y * 7 * fr).toFixed(2)}deg) rotateY(${(tilt.x * 9 * fr).toFixed(2)}deg)` : '';
      const b = els[i];
      b.style.transform = `translate3d(${(s * r).toFixed(1)}px, ${y.toFixed(1)}px, ${((c - 1) * r * 0.9 + fr * 90).toFixed(1)}px) translate(-50%, -50%) rotateY(${ry.toFixed(2)}deg)${tx} scale(${sc.toFixed(3)})`;
      b.style.opacity = (still ? 1 : clamp(pop, 0, 1)) * (faceBack ? 0.22 + 0.5 * depth : 0.55 + 0.45 * depth ** 0.6);
      b.style.zIndex = String(Math.round(c * 500) + 500);
      b.style.width = cw + 'px'; b.style.height = ch + 'px';
    }
    stage.style.setProperty('--ch', ch + 'px');
    setFront(mod(near, n));
    const rest = !drag.on && Math.abs(tpos - pos) < 0.002 ? '1' : '0'; if (stage.dataset.rest !== rest) stage.dataset.rest = rest;   // "the ring has stopped": for tests and assistive tech
  };
  const frame = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!still && !touched && !drag.on && !hover && !focusIn && !document.hidden && now - idleAt > 3200) { tpos += 1; idleAt = now - 3200 + 2600; }   // slow flow when nobody is touching it
    paint(now, dt);
  };
  paint(performance.now(), 0.016);
  if (!still) raf = requestAnimationFrame(frame);
  const onResize = () => paint(performance.now(), 0.016);
  window.addEventListener('resize', onResize);

  return {
    el, stage,
    focus() { stage.focus({ preventScroll: true }); },
    destroy() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); },
    get front() { return cards[front] && cards[front].key; },
  };
}
