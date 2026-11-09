/* Settings → Appearance, Effects, Layout (dock & menu bar) and Widgets. Mirrors the ulyOS Settings app. */

import { h, clear, modal, toast, confirmDialog } from './dom.js';
import { page, sel } from './tools.js';
import { ACCENTS, ICON_STYLES, ANIM_STYLES, NAV_MODES, WIDGET_DEFS, LOOK_DEFAULTS, normalizeLook, randomLook } from './look.js';
import { landscapes } from './landscapes.js';
import { TYPE_META } from './templates.js';

const panel = (title, ...kids) => h('div', { class: 'panel pad' }, title ? h('h3', { text: title }) : null, ...kids);
const row = (title, desc, ...ctl) => h('div', { class: 'setrow' }, h('div', { class: 'tx' }, h('b', { text: title }), desc ? h('small', { text: desc }) : null), h('div', { class: 'ctl' }, ...ctl));

function ctls(ctx) {
  const L = () => ctx.look();
  const set = (k, v, o) => ctx.setLook({ [k]: v }, o);
  const sw = (key, o = {}) => {
    const b = h('button', { class: 'sw', role: 'switch', 'aria-checked': String(!!L()[key]), 'aria-label': key, on: { click: () => { const v = !(b.getAttribute('aria-checked') === 'true'); b.setAttribute('aria-checked', String(v)); set(key, v, o); } } });
    return b;
  };
  const range = (key, lo, hi, step, fmt = (v) => v, o = {}) => {
    const val = h('span', { class: 'val', text: String(fmt(L()[key])) });
    const i = h('input', { type: 'range', min: lo, max: hi, step, value: L()[key], 'aria-label': key, on: { input: (e) => { val.textContent = String(fmt(+e.target.value)); set(key, +e.target.value, { live: true, ...o }); }, change: (e) => set(key, +e.target.value, o) } });
    return [i, val];
  };
  const seg = (key, opts, o = {}) => { const d = h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: L()[key] === v ? 'on' : '', on: { click: (e) => { Array.from(d.children).forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); set(key, v, o); } } }, l))); return d; };
  const select = (key, opts, o = {}) => sel(L()[key], opts, (v) => set(key, isNaN(+v) || typeof L()[key] === 'string' ? v : +v, o));
  return { sw, range, seg, select, set, L };
}

/* ======================= Appearance ======================= */
export function appearance(ctx) {
  const { sw, range, seg, select, set, L } = ctls(ctx);
  const themeSel = sel(ctx.store.settings.theme, [['auto', 'Match my device'], ['dark', 'Dark'], ['light', 'Light']], (v) => ctx.setTheme(v));
  const swatches = h('div', { class: 'swatches' });
  const paintSw = () => { clear(swatches).append(ACCENTS.map(([n, c]) => { const b = h('button', { class: 'swatch' + (L().accent === c ? ' on' : ''), title: n, 'aria-label': 'Accent ' + n, on: { click: () => { set('accent', c); paintSw(); } } }); b.style.background = c; b.style.color = c; return b; }),
    h('input', { type: 'color', value: L().accent, 'aria-label': 'Custom accent colour', on: { input: (e) => { set('accent', e.target.value, { live: true }); }, change: () => paintSw() } })); };
  paintSw();
  const walls = h('div', { class: 'walls' });
  const paintWalls = () => {
    clear(walls).append(landscapes.list.map(([id, name]) => { const t = h('button', { class: 'wall' + (L().wallpaper === id ? ' on' : ''), title: name, 'aria-label': 'Wallpaper ' + name, on: { click: () => { set('wallpaper', id); set('bg', 'wallpaper'); paintWalls(); } } }, h('span', { text: name })); t.style.backgroundImage = `url("${landscapes.url(id)}")`; return t; }));
  };
  paintWalls();
  const demo = h('div', { class: 'icon-demo', 'aria-hidden': 'true' }, Object.values(TYPE_META).slice(0, 9).map((m) => h('span', { class: 'icn', text: m.icon })));
  return h('div', null,
    panel('Theme & colour',
      row('Theme', 'Dark, light, or follow your device', themeSel),
      row('Accent colour', 'Buttons, highlights, glow and the 3D look', swatches)),
    panel('Background',
      row('Style', 'Default aurora & grid, a calm plain colour, or a drawn nature wallpaper (works offline)', seg('bg', [['default', 'Aurora'], ['plain', 'Plain'], ['wallpaper', 'Wallpaper']], { redraw: true })),
      L().bg === 'wallpaper' ? [row('Wallpaper dimming', 'Darken / lighten the picture so text stays readable', range('bgDim', 0, 90, 5, (v) => v + '%')), walls] : null),
    panel('Icons',
      row('Icon style', 'How the category and tool icons look', select('iconStyle', ICON_STYLES, { icons: true })),
      demo,
      row('Icon size', null, seg('iconSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])),
      row('Item avatars', 'Show the first letter of the name, or the category icon', seg('avatar', [['letter', 'Letter'], ['icon', 'Category icon']], { redraw: true }))),
    panel('Layout & feel',
      row('UI size', 'Scales text and controls', range('uiScale', 85, 130, 5, (v) => v + '%')),
      row('Density', 'Compact fits more on screen', seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])),
      row('Corner radius', 'From sharp to very round', range('radius', 4, 24, 1, (v) => v + 'px')),
      row('Widget style', 'Vivid gives every widget its own colour and glow; Glass keeps them neutral', select('widgetStyle', [['vivid', 'Vivid (colourful)'], ['glass', 'Glass (neutral)']]))),
    panel(null, h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', on: { click: () => { ctx.setLook(randomLook(L(), landscapes.list.map((x) => x[0])), { redraw: true }); toast('{{dice}} New look: ' + L().iconStyle + ' icons, ' + L().animStyle + ' dialogs'); } } }, '{{dice}} Surprise me'),
      h('button', { class: 'btn', on: { click: async () => { if (await confirmDialog({ title: 'Reset appearance?', text: 'Accent, background, icons and sizes go back to the defaults. Effects, layout and widgets are not touched.', okLabel: 'Reset' })) { const D = LOOK_DEFAULTS; ctx.setLook({ accent: D.accent, bg: D.bg, wallpaper: D.wallpaper, bgDim: D.bgDim, iconStyle: D.iconStyle, iconSize: D.iconSize, avatar: D.avatar, uiScale: D.uiScale, density: D.density, radius: D.radius, widgetStyle: D.widgetStyle }, { redraw: true }); } } } }, 'Reset appearance'))));
}

/* ======================= Effects ======================= */
export function effects(ctx) {
  const { sw, range, select, L } = ctls(ctx);
  return h('div', null,
    panel('Animations',
      row('UI animations', 'Dialog open / close, boot sequence, ambient motion', sw('animations', { redraw: false })),
      row('Window animation', 'How dialogs appear — “Random” picks a style for every dialog', select('animStyle', [...ANIM_STYLES, ['random', 'Random per window']]), h('button', { class: 'btn sm', on: { click: () => modal({ title: 'Window animation', body: h('p', { text: 'This is how dialogs open with your current style and speed.' }), actions: [{ label: 'Nice' }] }) } }, 'Try')),
      row('Animation speed', 'Slower ← → faster', range('animSpeed', 0.5, 2, 0.25, (v) => v + '×')),
      row('Boot animation', 'Show the unlock log when you sign in (click or press a key to skip)', sw('bootAnim'))),
    panel('Telemetry FX',
      row('Aurora intensity', 'Soft animated glow floating behind everything', range('fxAurora', 0, 100, 1)),
      row('3D tilt', 'Widgets and the sign-in card lean toward the pointer', range('fxTilt', 0, 10, 1, (v) => v + '°')),
      row('FX animation', 'Ambient motion: aurora drift and icon wiggle on hover', sw('fxAnim')),
      row('Toolbar glow', 'Accent glow around the top bar, side bar and dock', range('fxGlow', 0, 100, 1)),
      row('CRT scanlines', 'Retro scanline overlay across the whole screen', sw('fxScan')),
      row('Glass blur', 'Backdrop blur behind panels, dialogs and the dock', range('blur', 0, 40, 2, (v) => v + 'px')),
      row('Panel fill', 'Panel opacity — lower reveals more of the background', range('glassAlpha', 0.4, 0.98, 0.02, (v) => Math.round(v * 100) + '%'))),
    panel(null, h('p', { class: 'hint', text: 'If you have “reduce motion” turned on in your device settings, animations are turned off automatically.' }),
      h('button', { class: 'btn', on: { click: () => { const D = LOOK_DEFAULTS; ctx.setLook({ animations: D.animations, animStyle: D.animStyle, animSpeed: D.animSpeed, bootAnim: D.bootAnim, fxAnim: D.fxAnim, fxAurora: D.fxAurora, fxTilt: D.fxTilt, fxGlow: D.fxGlow, fxScan: D.fxScan, blur: D.blur, glassAlpha: D.glassAlpha }, { redraw: true }); } } }, 'Reset effects')));
}

/* ======================= Layout: dock & menu bar ======================= */
export function layout(ctx) {
  const { sw, range, seg, select, L } = ctls(ctx);
  return h('div', null,
    panel('Navigation',
      row('Navigation style', 'A side bar (default) or a macOS-style dock at the bottom of the screen', select('nav', NAV_MODES, { shell: true })),
      row('Start page', 'What you see right after unlocking', select('startPage', [['all', 'All items'], ['home', 'Home (widgets)']]))),
    panel('Dock',
      h('p', { class: 'hint', text: 'Only used when Navigation style is “Dock”.' }),
      row('Dock icon size', null, range('dockSize', 32, 72, 2, (v) => v + 'px')),
      row('Magnify on hover', 'Icons grow as the pointer passes over them', sw('dockMagnify')),
      row('Show labels', 'Names under the icons', sw('dockLabels', { shell: true })),
      row('Auto-hide', 'Slide the dock away until the pointer reaches the bottom edge', sw('dockAutoHide'))),
    panel('Menu bar (top bar)',
      row('Show clock', 'Time and date at the top right', sw('clock', { shell: true })),
      row('24-hour time', null, sw('clock24', { shell: true })),
      row('Date', 'Format shown next to the time', select('dateFmt', [['none', 'Hidden'], ['short', 'Short (Mon 9 Nov)'], ['long', 'Long (Monday 9 November 2026)']], { shell: true })),
      row('Button labels', 'Show the words next to “New” and “Lock” (off = icons only)', sw('barLabels'))));
}

/* ======================= Widgets ======================= */
export function widgetsTab(ctx) {
  const list = h('div', { class: 'wset' });
  const draw = () => {
    const ws = ctx.look().widgets;
    clear(list).append(ws.map((w, i) => {
      const def = WIDGET_DEFS.find((d) => d.id === w.id);
      const move = (d) => { const a = ctx.look().widgets.map((x) => ({ ...x })); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; ctx.setLook({ widgets: a }); draw(); };
      const on = h('button', { class: 'sw', role: 'switch', 'aria-checked': String(w.on), 'aria-label': 'Show ' + def.label, on: { click: () => { const a = ctx.look().widgets.map((x) => ({ ...x })); a[i].on = !a[i].on; ctx.setLook({ widgets: a }); draw(); } } });
      const size = h('div', { class: 'seg' }, [['s', 'S'], ['m', 'M'], ['l', 'L']].map(([v, l]) => h('button', { class: w.size === v ? 'on' : '', title: { s: 'Small', m: 'Medium (2 columns)', l: 'Full width' }[v], on: { click: () => { const a = ctx.look().widgets.map((x) => ({ ...x })); a[i].size = v; ctx.setLook({ widgets: a }); draw(); } } }, l)));
      return h('div', { class: 'hl' }, h('span', { class: 'icn', text: def.icon }), h('div', { class: 't' }, h('b', { text: def.label })), size,
        h('button', { class: 'icon-btn', 'aria-label': 'Move up ' + def.label, disabled: i === 0, on: { click: () => move(-1) } }, '↑'), h('button', { class: 'icon-btn', 'aria-label': 'Move down ' + def.label, disabled: i === ws.length - 1, on: { click: () => move(1) } }, '↓'), on);
    }));
  };
  draw();
  return h('div', null,
    panel('Home widgets', h('p', { class: 'hint', text: 'Choose what appears on the Home page, in what order and how big. Widgets only show information from your unlocked vault.' }), list,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => ctx.go('home') } }, '{{home}} Open Home'), h('button', { class: 'btn', on: { click: () => { ctx.setLook({ widgets: LOOK_DEFAULTS.widgets }); draw(); } } }, 'Reset widgets'))));
}
void page; void normalizeLook;
