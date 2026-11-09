/* Settings → Appearance, Effects, Layout (dock & menu bar) and Widgets. Mirrors the ulyOS Settings app. */

import { h, clear, modal, toast, confirmDialog } from './dom.js';
import { page, sel } from './tools.js';
import { HIDEABLE, ACCENTS, ICON_STYLES, ANIM_STYLES, NAV_MODES, WIDGET_DEFS, LOOK_DEFAULTS, normalizeLook, randomLook } from './look.js';
import { landscapes } from './landscapes.js';
import { TYPE_META, GROUPS } from './templates.js';
import { fmtTime } from './util.js';

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


/* Shrink a picked image to at most 1600px wide, JPEG — it is stored inside the encrypted profile. */
async function downscaleImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('That file is not an image.');
  if (file.size > 25 * 1048576) throw new Error('That image is over 25 MB.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This image format cannot be read here.'); });
  for (const [w, q] of [[1600, 0.82], [1280, 0.75], [1024, 0.7], [800, 0.65]]) {
    const k = Math.min(1, w / bmp.width), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q); if (url.length <= 780000) { bmp.close && bmp.close(); return url; }
  }
  throw new Error('That image is too detailed to store; try a smaller one.');
}

/* "All changes are saved automatically" + Undo changes + Save now. Undo goes back to how things were when this page was opened (or the last Save now). */
export function saveBar(ctx) {
  const snap = () => JSON.stringify({ look: ctx.look(), theme: ctx.store.settings.theme });
  let base = snap(), savedAt = Date.now();
  const status = h('span', { class: 'savestat', role: 'status' });
  const paint = () => { const dirty = snap() !== base; undo.disabled = !dirty; clear(status).append((dirty ? 'Changes since you opened this page · ' : '') + 'Saved automatically to “' + ((ctx.profile() || {}).name || 'this profile') + '” · ' + fmtTime(savedAt)); };
  const undo = h('button', { class: 'btn sm', type: 'button', on: { click: () => { const b = JSON.parse(base); ctx.setLook(b.look, { shell: true }); ctx.setTheme(b.theme); ctx.refresh(); toast('Changes undone'); } } }, '{{refresh}} Undo changes');
  const now = h('button', { class: 'btn sm primary', type: 'button', on: { click: async () => { try { await ctx.store.save(); base = snap(); savedAt = Date.now(); paint(); toast('Saved to this profile'); } catch (x) { toast(x.message, 'err'); } } } }, '{{check}} Save now');
  const bar = h('div', { class: 'savebar' }, status, h('div', { class: 'row' }, undo, now));
  paint(); const t = setInterval(() => { if (!bar.isConnected) clearInterval(t); else { savedAt = ctx.store.lastSaved || savedAt; paint(); } }, 1500);
  return bar;
}

/* ======================= Appearance ======================= */
export function appearance(ctx) {
  const { sw, range, seg, select, set, L } = ctls(ctx);
  const themeSel = sel(ctx.store.settings.theme, [['auto', 'Match my device'], ['dark', 'Dark'], ['light', 'Light']], (v) => ctx.setTheme(v));
  const swatches = h('div', { class: 'swatches' });
  const paintSw = () => { clear(swatches).append(ACCENTS.map(([n, c]) => { const b = h('button', { class: 'swatch' + (L().accent === c ? ' on' : ''), title: n, 'aria-label': 'Accent ' + n, on: { click: () => { set('accent', c); paintSw(); } } }); b.style.background = c; b.style.color = c; return b; }),
    h('input', { type: 'color', value: L().accent, 'aria-label': 'Custom accent colour', on: { input: (e) => { set('accent', e.target.value, { live: true }); }, change: () => paintSw() } })); };
  paintSw();
  const walls = h('div', { class: 'walls-wrap' });
  const tile = (id, name, group) => {
    const on = L().wallpaper === id;
    const t = h('button', { class: 'wall' + (on ? ' on' : ''), title: name, 'aria-label': 'Wallpaper ' + name, 'aria-pressed': String(on), on: { click: () => { set('wallpaper', id); set('bg', 'wallpaper'); paintWalls(); } } }, h('span', { text: name }));
    t.style.backgroundImage = `url("${landscapes.url(id, L())}")`; t.dataset.group = group; return t;
  };
  const group = (title, note, items) => h('section', { class: 'wallgroup' }, h('h4', { text: title }), note ? h('p', { class: 'hint', text: note }) : null, h('div', { class: 'walls' }, items));
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', 'aria-label': 'Choose a background image from this computer', on: { change: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const url = await downscaleImage(f); set('wallImage', url); set('wallpaper', 'custom'); set('bg', 'wallpaper'); paintWalls(); toast('Background picture set'); } catch (x) { toast(x.message, 'err', 6000); }
  } } });
  const urlIn = h('input', { class: 'inp', type: 'url', placeholder: 'https://example.com/picture.jpg', 'aria-label': 'Background image URL', value: L().wallUrl || '', autocomplete: 'off' });
  const urlErr = h('p', { class: 'err', role: 'alert' });
  const useUrl = async () => {
    urlErr.textContent = ''; const v = urlIn.value.trim();
    if (!/^https:\/\/[^\s"'()<>\\]{3,1000}$/.test(v)) { urlErr.textContent = 'Enter a full https:// address of an image.'; return; }
    const ok = await new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.referrerPolicy = 'no-referrer'; im.src = v; });
    if (!ok) { urlErr.textContent = 'That address did not load as an image (it may be blocked, offline, or not an image).'; return; }
    set('wallUrl', v); set('wallpaper', 'remote'); set('bg', 'wallpaper'); paintWalls(); toast('Background picture set from the web');
  };
  const paintWalls = () => {
    const mine = [];
    if (L().wallImage) mine.push(tile('custom', 'My picture', 'mine'));
    if (L().wallUrl) mine.push(tile('remote', 'From web address', 'mine'));
    clear(walls).append(
      group('Real photos — NASA & public domain', 'Shipped inside the app, so they work offline.', landscapes.photos.map(([id, n]) => tile('photo:' + id, n, 'photo'))),
      group('Cities & lights', 'The Earth at night, photographed from orbit.', landscapes.cities.map(([id, n]) => tile('photo:' + id, n, 'city'))),
      group('Drawn landscapes', 'Painted by the app itself — tiny and offline.', landscapes.list.map(([id, n]) => tile(id, n, 'drawn'))),
      group('Colour themes', 'Smooth gradients.', landscapes.gradients.map(([id, n]) => tile('grad:' + id, n, 'grad'))),
      group('Your own picture', 'Pick an image from this computer (it is shrunk and stored encrypted in this profile), or paste a web address.',
        [...mine, h('div', { class: 'wallmine' },
          h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', on: { click: () => fileIn.click() } }, '{{folder}} Choose an image from this computer…'), fileIn,
            L().wallImage || L().wallUrl ? h('button', { class: 'btn', type: 'button', on: { click: () => { set('wallImage', ''); set('wallUrl', ''); if (['custom', 'remote'].includes(L().wallpaper)) set('wallpaper', 'forest'); paintWalls(); } } }, 'Remove my pictures') : null),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, urlIn), h('button', { class: 'btn', type: 'button', on: { click: useUrl } }, 'Use this address')), urlErr,
          h('p', { class: 'hint', text: 'A web address is loaded live from that site each time (not stored), so it needs the internet and that site learns your IP address. Download the picture and use “Choose an image” to keep it private and offline.' }))]));
  };
  paintWalls();
  const demo = h('div', { class: 'icon-demo', 'aria-hidden': 'true' }, Object.values(TYPE_META).slice(0, 9).map((m) => h('span', { class: 'icn', text: m.icon })));
  return h('div', null, saveBar(ctx),
    panel('Theme & colour',
      row('Theme', 'Dark, light, or follow your device', themeSel),
      row('Accent colour', 'Buttons, highlights, glow and the 3D look', swatches)),
    panel('Background',
      row('Style', 'Default aurora & grid, a calm plain colour, or a picture: real NASA photos, city lights, drawn landscapes or your own image', seg('bg', [['default', 'Aurora'], ['plain', 'Plain'], ['wallpaper', 'Wallpaper']], { redraw: true })),
      L().bg === 'wallpaper' ? row('Wallpaper dimming', 'Darken / lighten the picture so text stays readable', range('bgDim', 0, 90, 5, (v) => v + '%')) : null, walls),
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


const NAV_LABELS = { fav: 'Favorites', trash: 'Trash', health: 'Vault health', gen: 'Generator', qr: 'QR tools', beam: 'Beam sync', data: 'Import & export', tm: 'Task manager', cats: 'Categories (dock button)' };

/* Hide tools and categories you never use from the side bar, dock and menu. Nothing is deleted: hidden categories still show in All items and search. */
function visibilityPanel(ctx) {
  const L = () => ctx.look();
  const wrap = h('div');
  const put = (key, id, on) => { const cur = new Set(L()[key]); if (on) cur.delete(id); else cur.add(id); ctx.setLook({ [key]: [...cur] }, { nav: true }); paint(); };
  const tog = (key, id, label, icon) => {
    const on = !L()[key].includes(id);
    const b = h('button', { class: 'sw', role: 'switch', 'aria-checked': String(on), 'aria-label': 'Show ' + label, on: { click: () => put(key, id, !(b.getAttribute('aria-checked') === 'true')) } });
    return h('div', { class: 'setrow vis' }, h('div', { class: 'tx' }, h('b', { text: (icon ? icon + ' ' : '') + label })), h('div', { class: 'ctl' }, b));
  };
  const paint = () => {
    const cnt = (k) => ctx.store.active().filter((i) => i.type === k).length;
    clear(wrap).append(
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', on: { click: () => { ctx.setLook({ hiddenCats: [], hiddenNav: [] }, { nav: true }); paint(); toast('Everything is visible again'); } } }, 'Show everything'),
        h('button', { class: 'btn sm', on: { click: () => { const empty = Object.keys(TYPE_META).filter((k) => !cnt(k)); ctx.setLook({ hiddenCats: empty }, { nav: true }); paint(); toast(empty.length + ' empty categories hidden'); } } }, 'Hide empty categories')),
      h('h4', { text: 'Tools & shortcuts' }), HIDEABLE.map((id) => tog('hiddenNav', id, NAV_LABELS[id])),
      h('p', { class: 'hint', text: 'Home, All items and Settings always stay. On a phone the bottom bar keeps Home, Items, New, Generator and More; hiding applies to the menu behind More.' }),
      GROUPS.map(([g, keys]) => h('div', null, h('h4', { text: g }), keys.map((k) => tog('hiddenCats', k, TYPE_META[k].plural + ' · ' + cnt(k))))));
  };
  paint();
  return panel('Show or hide', h('p', { class: 'hint', text: 'Tidy the side bar, dock and menu. Nothing is deleted: hidden categories still appear in All items and in search, and you can still create items in them.' }), wrap);
}

/* ======================= Effects ======================= */
export function effects(ctx) {
  const { sw, range, select, L } = ctls(ctx);
  return h('div', null, saveBar(ctx),
    panel('Animations',
      row('UI animations', 'Dialog open / close, boot sequence, ambient motion', sw('animations', { redraw: false })),
      row('Window animation', 'How dialogs appear — “Random” picks a style for every dialog', select('animStyle', [...ANIM_STYLES, ['random', 'Random per window']]), h('button', { class: 'btn sm', on: { click: () => modal({ title: 'Window animation', body: h('p', { text: 'This is how dialogs open with your current style and speed.' }), actions: [{ label: 'Nice' }] }) } }, 'Try')),
      row('Animation speed', 'Slower ← → faster', range('animSpeed', 0.5, 2, 0.25, (v) => v + '×')),
      row('Boot animation', 'Show the unlock log when you sign in (click or press a key to skip)', sw('bootAnim')),
      row('Haptic feedback', 'A tiny vibration on taps in the phone layout (Android; iPhone Safari does not allow it)', sw('haptics'))),
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
  return h('div', null, saveBar(ctx),
    panel('Navigation',
      row('Navigation style', 'A side bar (default) or a macOS-style dock at the bottom of the screen', select('nav', NAV_MODES, { shell: true })),
      row('Start page', 'What you see right after unlocking', select('startPage', [['all', 'All items'], ['home', 'Home (widgets)']]))),
    visibilityPanel(ctx),
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
  return h('div', null, saveBar(ctx),
    panel('Home widgets', h('p', { class: 'hint', text: 'Choose what appears on the Home page, in what order and how big. Widgets only show information from your unlocked vault.' }), list,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => ctx.go('home') } }, '{{home}} Open Home'), h('button', { class: 'btn', on: { click: () => { ctx.setLook({ widgets: LOOK_DEFAULTS.widgets }); draw(); } } }, 'Reset widgets'))));
}
void page; void normalizeLook;
