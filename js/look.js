/* Look & feel: appearance, effects, layout and home widgets (modelled on the ulyOS Settings app).
   Cosmetic settings are not secret, so a copy lives in plain localStorage — that is what lets the lock
   screen already look the way you set it. The authoritative copy is inside the encrypted vault.
   Everything is applied through CSS variables / data-attributes (no inline <style>, CSP-clean). */

export const ACCENTS = [['Teal', '#2fe6d0'], ['Mint', '#7dff9b'], ['Sky', '#59b4ff'], ['Violet', '#8b7dff'], ['Pink', '#ff7ad9'], ['Amber', '#ffb547'], ['Coral', '#ff6b6b'], ['Orange', '#ff8a4c'], ['Silver', '#d6e2ee']];
export const ICON_STYLES = [['vivid', 'Colourful & animated'], ['glass', 'Glass'], ['gradient', 'Gradient tile'], ['neon', 'Neon'], ['tint', 'Tinted (accent)'], ['flat', 'Flat (grey)']];
export const ANIM_STYLES = [['scale', 'Scale'], ['slide', 'Slide up'], ['fade', 'Fade'], ['zoom', 'Zoom'], ['bounce', 'Bounce'], ['blur', 'Blur in'], ['flip', 'Flip']];
export const NAV_MODES = [['sidebar', 'Side bar'], ['dock', 'Dock (bottom)']];

export const WIDGET_DEFS = [
  { id: 'clock', label: 'Clock & date', icon: '{{clock}}', size: 's' },
  { id: 'health', label: 'Vault health', icon: '{{pulse}}', size: 's' },
  { id: 'totp', label: 'One-time codes', icon: '{{locker}}', size: 'm' },
  { id: 'expiring', label: 'Expiring soon', icon: '{{hourglass}}', size: 's' },
  { id: 'favorites', label: 'Favorites', icon: '{{star}}', size: 's' },
  { id: 'recent', label: 'Recently changed', icon: '{{history}}', size: 's' },
  { id: 'generator', label: 'Quick generator', icon: '{{bolt}}', size: 's' },
  { id: 'stats', label: 'Categories', icon: '{{vault}}', size: 'm' },
  { id: 'sync', label: 'Sync status', icon: '{{sync}}', size: 's' },
  { id: 'conflicts', label: 'Needs review', icon: '{{alert}}', size: 's' },
  { id: 'tip', label: 'Security tip', icon: '{{bulb}}', size: 's' },
];

export const LOOK_DEFAULTS = {
  // appearance
  accent: '#2fe6d0', bg: 'default', wallpaper: 'forest', bgDim: 55, iconStyle: 'vivid', iconSize: 'medium', avatar: 'letter',
  uiScale: 100, density: 'comfortable', radius: 12, widgetStyle: 'vivid',
  // effects
  animations: true, animStyle: 'scale', animSpeed: 1, bootAnim: true, fxAnim: true, fxAurora: 65, fxTilt: 0, fxGlow: 35, fxScan: false, blur: 12, glassAlpha: 0.72,
  // layout (dock & menu bar)
  haptics: true, nav: 'sidebar', dockSize: 46, dockMagnify: true, dockLabels: false, dockAutoHide: false,
  clock: true, clock24: false, dateFmt: 'short', barLabels: true, startPage: 'home',
  widgets: WIDGET_DEFS.map((w) => ({ id: w.id, on: true, size: w.size })),
};

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

export const landscapeIds = [];   // filled lazily by the UI (avoids loading the scenes before they are needed)

export function normalizeLook(o = {}, wallIds = null) {
  const D = LOOK_DEFAULTS;
  const widgets = [];
  for (const w of Array.isArray(o.widgets) ? o.widgets : []) if (w && WIDGET_DEFS.some((d) => d.id === w.id) && !widgets.some((x) => x.id === w.id)) widgets.push({ id: w.id, on: bool(w.on, true), size: oneOf(w.size, ['s', 'm', 'l'], WIDGET_DEFS.find((d) => d.id === w.id).size) });
  for (const d of WIDGET_DEFS) if (!widgets.some((x) => x.id === d.id)) widgets.push({ id: d.id, on: true, size: d.size });
  return {
    accent: /^#[0-9a-fA-F]{6}$/.test(o.accent) ? o.accent.toLowerCase() : D.accent,
    bg: oneOf(o.bg, ['default', 'plain', 'wallpaper'], D.bg),
    wallpaper: typeof o.wallpaper === 'string' && (!wallIds || wallIds.includes(o.wallpaper)) ? o.wallpaper : D.wallpaper,
    bgDim: num(o.bgDim, 0, 90, D.bgDim),
    iconStyle: oneOf(o.iconStyle, ICON_STYLES.map((x) => x[0]), D.iconStyle), iconSize: oneOf(o.iconSize, ['small', 'medium', 'large'], D.iconSize), avatar: oneOf(o.avatar, ['letter', 'icon'], D.avatar),
    uiScale: num(o.uiScale, 85, 130, D.uiScale), density: oneOf(o.density, ['comfortable', 'compact'], D.density), radius: num(o.radius, 4, 24, D.radius), widgetStyle: oneOf(o.widgetStyle, ['vivid', 'glass'], D.widgetStyle),
    animations: bool(o.animations, D.animations), animStyle: oneOf(o.animStyle, [...ANIM_STYLES.map((x) => x[0]), 'random'], D.animStyle), animSpeed: num(o.animSpeed, 0.5, 2, D.animSpeed), bootAnim: bool(o.bootAnim, D.bootAnim), fxAnim: bool(o.fxAnim, D.fxAnim),
    fxAurora: num(o.fxAurora, 0, 100, D.fxAurora), fxTilt: num(o.fxTilt, 0, 10, D.fxTilt), fxGlow: num(o.fxGlow, 0, 100, D.fxGlow), fxScan: bool(o.fxScan, D.fxScan), blur: num(o.blur, 0, 40, D.blur), glassAlpha: num(o.glassAlpha, 0.4, 0.98, D.glassAlpha),
    haptics: bool(o.haptics, D.haptics), nav: oneOf(o.nav, NAV_MODES.map((x) => x[0]), D.nav), dockSize: num(o.dockSize, 32, 72, D.dockSize), dockMagnify: bool(o.dockMagnify, D.dockMagnify), dockLabels: bool(o.dockLabels, D.dockLabels), dockAutoHide: bool(o.dockAutoHide, D.dockAutoHide),
    clock: bool(o.clock, D.clock), clock24: bool(o.clock24, D.clock24), dateFmt: oneOf(o.dateFmt, ['none', 'short', 'long'], D.dateFmt), barLabels: bool(o.barLabels, D.barLabels), startPage: oneOf(o.startPage, ['all', 'home'], D.startPage),
    widgets,
  };
}

/* ---------- colour maths ---------- */
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
export const luminance = (hex) => { const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

export function accentTokens(hex, theme) {
  const base = theme === 'light' ? mix(hex, '#000000', 0.32) : hex;
  const two = theme === 'light' ? mix(base, '#000000', 0.12) : mix(hex, '#ffffff', 0.4);
  const [r, g, b] = hexToRgb(base);
  return { accent: base, accent2: two, ink: luminance(base) > 0.4 ? '#06201d' : '#ffffff', rgb: r + ',' + g + ',' + b };
}

export function resolveTheme(setting, prefersLight) { return setting === 'dark' ? 'dark' : setting === 'light' ? 'light' : prefersLight ? 'light' : 'dark'; }

/* ---------- apply ---------- */
export function applyLook(look, theme, landscapes = null) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement, set = (k, v) => el.style.setProperty(k, v);
  const t = accentTokens(look.accent, theme);
  set('--accent', t.accent); set('--accent-2', t.accent2); set('--accent-ink', t.ink); set('--accent-rgb', t.rgb);
  set('--grid', `rgba(${t.rgb},${theme === 'light' ? 0.08 : 0.06})`); set('--glow', `0 0 24px rgba(${t.rgb},${theme === 'light' ? 0.18 : 0.25})`);
  set('--r', look.radius + 'px'); set('--blur', look.blur + 'px');
  set('--glass', theme === 'light' ? `rgba(255,255,255,${look.glassAlpha})` : `rgba(12,22,34,${look.glassAlpha})`);
  set('--fx-aurora', String(look.fxAurora)); set('--fx-glow', String(look.fxGlow)); set('--speed', String(look.animSpeed)); set('--ui-scale', String(look.uiScale / 100));
  set('--tilt', look.fxTilt + 'deg'); set('--dock', look.dockSize + 'px'); set('--wall-dim', String(look.bgDim / 100));
  set('--wall-dim-rgb', theme === 'light' ? '238,242,246' : '2,6,12');
  const d = el.dataset;
  d.theme = theme; d.icons = look.iconStyle; d.iconsize = look.iconSize; d.density = look.density; d.avatar = look.avatar;
  d.motion = look.animations ? 'on' : 'off'; d.fxanim = look.fxAnim && look.animations ? 'on' : 'off'; d.anim = look.animStyle; d.scan = look.fxScan ? 'on' : 'off';
  d.bg = look.bg === 'wallpaper' && landscapes ? 'wallpaper' : look.bg === 'plain' ? 'plain' : 'default'; d.wstyle = look.widgetStyle; d.nav = look.nav; d.dockautohide = look.dockAutoHide ? '1' : '0'; d.dockmagnify = look.dockMagnify ? '1' : '0'; d.barlabels = look.barLabels ? '1' : '0'; d.haptics = look.haptics ? '1' : '0';
  if (landscapes && look.bg === 'wallpaper') { const u = landscapes.url(look.wallpaper) || landscapes.url('forest'); set('--wall', `url("${u}")`); } else el.style.removeProperty('--wall');
}

/* a copy of the (non-secret) cosmetic settings, so the lock screen is styled before the vault is opened */
const KEY = 'vaultmanager.look';
export function loadCosmetic(storage, key = KEY) {
  try { const j = JSON.parse(storage.getItem(key)); return j && typeof j === 'object' ? j : null; } catch { return null; }
}
export function saveCosmetic(storage, theme, look, key = KEY) { try { storage.setItem(key, JSON.stringify({ theme, look })); } catch { /* ignore */ } }

export function randomLook(prev, wallIds = []) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const hue = Math.floor(Math.random() * 360), c = (h, s, l) => { const a = s * Math.min(l, 1 - l); const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return toHex(f(0) * 255, f(8) * 255, f(4) * 255); };
  return normalizeLook({ ...prev, accent: c(hue, 0.78, 0.62), iconStyle: pick(ICON_STYLES)[0], animStyle: pick(ANIM_STYLES)[0], bg: wallIds.length ? 'wallpaper' : prev.bg, wallpaper: wallIds.length ? pick(wallIds) : prev.wallpaper });
}

export const TIPS = [
  'Use a unique password for every account — a breach at one site then cannot open the others.',
  'A passphrase of 5+ random words beats a short “complex” password and is easier to type.',
  'Turn on one-time codes (2FA) for email, banking and your password manager’s own accounts.',
  'Keep an encrypted backup somewhere other than this device — and test restoring it once.',
  'Print the recovery key and store it with your important papers, not on this computer.',
  'Be suspicious of urgent messages asking you to log in: type the address yourself or use the saved link.',
  'Lock your vault when you step away; set auto-lock to 5 minutes or less on shared computers.',
  'Review “Vault health” once a month: fix weak and reused passwords first.',
  'Check expiry dates: passports, licences and insurance renewals are easy to miss.',
  'Sync only through a passphrase you have written down — without it, synced data cannot be opened.',
];
