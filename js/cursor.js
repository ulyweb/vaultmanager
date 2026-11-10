/* Custom mouse cursor (ported from ulyOS): SVG cursors in several styles, size and colour, plus an optional trailing ring.
   Only for mouse / pen pointers — touch screens keep their normal behaviour. */

export const CURSOR_STYLES = [['classic', 'Classic arrow'], ['dot', 'Dot'], ['cross', 'Crosshair'], ['neon', 'Neon arrow'], ['ring', 'Ring'], ['solid', 'Solid arrow'], ['target', 'Target'], ['system', 'System default']];
const HEX = /^#[0-9a-f]{6}$/i;
const ARROW = 'M6 4l15 8.2-6.6 1.9-2.9 6.4z';

/* the two cursor images (normal / over a clickable thing) for a style */
export function cursorImages(style, accent, color, size) {
  const ac = HEX.test(color) ? color : accent, fc = HEX.test(color) ? color : '#fff';
  const scale = Math.min(3, Math.max(0.5, (+size || 100) / 100)), px = Math.min(96, Math.round(28 * scale)), kk = px / 28;
  const svg = (body, hx, hy, fb) => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 28 28">' + body + '</svg>') + '") ' + Math.round(hx * kk) + ' ' + Math.round(hy * kk) + ', ' + fb;
  const SETS = {
    classic: [svg('<path d="' + ARROW + '" fill="' + fc + '" stroke="#000" stroke-opacity=".85" stroke-width="1.3" stroke-linejoin="round"/>', 6, 4, 'default'),
      svg('<circle cx="14" cy="14" r="7" fill="rgba(255,255,255,.14)" stroke="#fff" stroke-width="1.4"/><circle cx="14" cy="14" r="2" fill="' + fc + '"/>', 14, 14, 'pointer')],
    dot: [svg('<circle cx="14" cy="14" r="4.2" fill="' + fc + '" stroke="#000" stroke-opacity=".75" stroke-width="1.3"/>', 14, 14, 'default'),
      svg('<circle cx="14" cy="14" r="8" fill="none" stroke="' + ac + '" stroke-width="1.8"/><circle cx="14" cy="14" r="2.6" fill="' + ac + '"/>', 14, 14, 'pointer')],
    cross: [svg('<path d="M14 3v22M3 14h22" stroke="#000" stroke-opacity=".7" stroke-width="3.2"/><path d="M14 3v22M3 14h22" stroke="#fff" stroke-width="1.3"/>', 14, 14, 'crosshair'),
      svg('<circle cx="14" cy="14" r="6" fill="none" stroke="' + ac + '" stroke-width="1.6"/><path d="M14 2v6M14 20v6M2 14h6M20 14h6" stroke="' + ac + '" stroke-width="1.6"/>', 14, 14, 'pointer')],
    neon: [svg('<path d="' + ARROW + '" fill="rgba(0,0,0,.55)" stroke="' + ac + '" stroke-opacity=".35" stroke-width="4.5" stroke-linejoin="round"/><path d="' + ARROW + '" fill="rgba(0,0,0,.4)" stroke="' + ac + '" stroke-width="1.6" stroke-linejoin="round"/>', 6, 4, 'default'),
      svg('<circle cx="14" cy="14" r="8" fill="' + ac + '" fill-opacity=".18" stroke="' + ac + '" stroke-opacity=".4" stroke-width="4"/><circle cx="14" cy="14" r="8" fill="none" stroke="' + ac + '" stroke-width="1.6"/>', 14, 14, 'pointer')],
    solid: [svg('<path d="' + ARROW + '" fill="' + ac + '" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>', 6, 4, 'default'),
      svg('<path d="' + ARROW + '" fill="' + ac + '" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><circle cx="21" cy="21" r="4" fill="#fff" stroke="' + ac + '" stroke-width="1.6"/>', 6, 4, 'pointer')],
    target: [svg('<circle cx="14" cy="14" r="8.5" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3.4"/><circle cx="14" cy="14" r="8.5" fill="none" stroke="' + ac + '" stroke-width="1.8"/><path d="M14 2.5v6M14 19.5v6M2.5 14h6M19.5 14h6" stroke="' + ac + '" stroke-width="1.8"/><circle cx="14" cy="14" r="1.6" fill="' + ac + '"/>', 14, 14, 'crosshair'),
      svg('<circle cx="14" cy="14" r="8.5" fill="' + ac + '" fill-opacity=".3" stroke="' + ac + '" stroke-width="2"/><circle cx="14" cy="14" r="2.4" fill="#fff"/>', 14, 14, 'pointer')],
    ring: [svg('<circle cx="14" cy="14" r="7" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3.2"/><circle cx="14" cy="14" r="7" fill="none" stroke="#fff" stroke-width="1.5"/>', 14, 14, 'default'),
      svg('<circle cx="14" cy="14" r="7" fill="' + ac + '" stroke="#fff" stroke-width="1.5"/>', 14, 14, 'pointer')],
  };
  return SETS[style] || null;
}

/* write the cursor CSS variables / switches for the current look */
export function applyCursor(look, el = document.documentElement) {
  const on = !!look.cursor && look.cursorStyle !== 'system';
  const set = on ? cursorImages(look.cursorStyle, look.accent, look.cursorColor, look.cursorSize) : null;
  el.dataset.cursor = set ? 'on' : 'off';
  el.dataset.cursorring = set && look.cursorRing ? 'on' : 'off';
  el.style.setProperty('--cur-default', set ? set[0] : 'default');
  el.style.setProperty('--cur-pointer', set ? set[1] : 'pointer');
  el.style.setProperty('--ring-c', HEX.test(look.cursorColor) ? look.cursorColor : look.accent);
  el.style.setProperty('--ring-scale', String(Math.min(3, Math.max(0.5, (+look.cursorSize || 100) / 100)).toFixed(2)));
}

/* the trailing ring: one element, follows the mouse, grows over clickable things */
export function initCursor() {
  if (document.getElementById('cursor-ring')) return;
  const ring = document.createElement('div'); ring.id = 'cursor-ring'; ring.setAttribute('aria-hidden', 'true'); document.body.append(ring);
  let tx = -100, ty = -100, x = -100, y = -100, raf = 0, sc = 1;
  const loop = () => { x += (tx - x) * 0.22; y += (ty - y) * 0.22; ring.style.transform = 'translate3d(' + (x - 16) + 'px,' + (y - 16) + 'px,0) scale(' + sc + ')'; raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(loop) : 0; };
  const HOT = 'a,button,.nav,.dock-item,.item,.msheet-item,[role=tab],[role=switch],select,label,summary,.wall,.widget .wpin';
  document.addEventListener('pointermove', (e) => {
    if (document.documentElement.dataset.cursorring !== 'on' || e.pointerType === 'touch') return;
    tx = e.clientX; ty = e.clientY; const t = e.target; sc = parseFloat(document.documentElement.style.getPropertyValue('--ring-scale')) || 1;
    ring.classList.toggle('hot', !!(t && t.closest && t.closest(HOT))); ring.classList.toggle('down', e.buttons > 0); ring.classList.remove('hidden');
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  document.addEventListener('pointerdown', () => ring.classList.add('down'), true);
  document.addEventListener('pointerup', () => ring.classList.remove('down'), true);
  document.documentElement.addEventListener('mouseleave', () => ring.classList.add('hidden'));
}
