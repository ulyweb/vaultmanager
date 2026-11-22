/* "3D effects" on the sign-in / create / add-a-profile screens: a small button in the corner that opens a panel with the 3D switch and
   the thickness, tilt and float sliders, so the look can be tuned before you are even signed in. The values are kept in the
   cosmetic cache of this device straight away, and are copied into the profile's own settings when you unlock or create it
   (app.js: ctx.setGateLook / pendingLook). The panel is not a dialog: it sits beside the screen so you see the cards change live. */

import { h, clear } from './dom.js';
import { LOOK_DEFAULTS as D } from './look.js';

const CONTROLS = [
  ['fx3dThick', 'Card thickness', 0, 28, 1, (v) => v + ' px'],
  ['fxTilt', '3D tilt', 0, 12, 1, (v) => v + '°'],
  ['fx3dFloat', 'Card float', 0, 10, 1, (v) => String(v)],
];

export function gateFxControl(ctx) {
  const L = () => ctx.look();
  const panel = h('div', { class: 'gfx-panel', id: 'gfx-panel', role: 'group', 'aria-label': '3D effects', hidden: true });
  const button = h('button', { type: 'button', class: 'btn sm gfx-btn', 'aria-expanded': 'false', 'aria-controls': 'gfx-panel', title: 'Tune the 3D cards and windows', on: { click: () => toggle() } }, '{{sparkles}} 3D effects');
  const draw = () => {
    clear(panel);
    const on = h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(!!L().fx3d), 'aria-label': 'fx3d', on: { click: () => { ctx.setGateLook({ fx3d: !L().fx3d }); draw(); } } });
    panel.append(h('div', { class: 'gfx-head' }, h('b', { text: '3D effects' }), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close the 3D effects panel', on: { click: () => toggle(false) } }, '{{close}}')),
      h('div', { class: 'gfx-row' }, h('span', { text: '3D card space' }), on));
    for (const [key, label, lo, hi, step, fmt] of CONTROLS) {
      const val = h('span', { class: 'val', text: fmt(L()[key]) });
      const input = h('input', { type: 'range', min: String(lo), max: String(hi), step: String(step), value: String(L()[key]), 'aria-label': label, on: { input: (e) => { val.textContent = fmt(+e.target.value); ctx.setGateLook({ [key]: +e.target.value }); } } });
      panel.append(h('label', { class: 'gfx-row' }, h('span', { text: label }), input, val));
    }
    panel.append(h('p', { class: 'hint', text: 'These follow you into the vault: Settings → Effects has the same sliders.' }),
      h('button', { type: 'button', class: 'btn sm', on: { click: () => { ctx.setGateLook({ fx3d: D.fx3d, fx3dThick: D.fx3dThick, fxTilt: D.fxTilt, fx3dFloat: D.fx3dFloat }); draw(); } } }, 'Reset'));
  };
  function toggle(open) {
    const show = open === undefined ? panel.hidden : open;
    if (show) draw();
    panel.hidden = !show; button.setAttribute('aria-expanded', String(show));
  }
  return h('div', { class: 'gfx' }, button, panel);
}
