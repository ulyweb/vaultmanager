/* One built-in SVG icon set, so every icon looks identical on PC, iPhone and Android (emoji are drawn by
   each operating system and look different everywhere). Line icons on a 24×24 grid; category icons are
   shown as coloured tiles whose look follows Settings → Appearance → Icon style.

   Source strings use a leading token such as "{{lock}} Lock"; h() in dom.js turns a *leading* token into
   an icon (user text is never converted unless it literally starts with a token). */

const NS = 'http://www.w3.org/2000/svg';

/* name → [inner SVG, emoji it replaces (kept as the accessible name), optional tile gradient] */
const G = {
  // ---- categories ----
  login: ['<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>', '🔑', ['#2fe6d0', '#0ea5e9']],
  note: ['<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/>', '📝', ['#2fe6d0', '#0ea5e9']],
  card: ['<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>', '💳', ['#2fe6d0', '#0ea5e9']],
  technical: ['<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18M11 13v2h2v-2"/>', '🧰', ['#8b7dff', '#6366f1']],
  shopping: ['<path d="M3 4h3l2.5 11h10l2-8H7"/><circle cx="10" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>', '🛒', ['#8b7dff', '#6366f1']],
  app: ['<path d="M12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M3 7.5L12 12l9-4.5M12 12v9"/>', '📦', ['#8b7dff', '#6366f1']],
  server: ['<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>', '🖥️', ['#8b7dff', '#6366f1']],
  computer: ['<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2 19h20l-2-4H4z"/>', '💻', ['#8b7dff', '#6366f1']],
  locker: ['<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M12 10l1.5-1.5M8 17h8"/>', '🔢', ['#8b7dff', '#6366f1']],
  network: ['<path d="M2 9a15 15 0 0120 0M5 12.5a10.5 10.5 0 0114 0M8.5 16a5.5 5.5 0 017 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>', '📶', ['#38bdf8', '#2563eb']],
  internet: ['<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', '🌐', ['#38bdf8', '#2563eb']],
  phone: ['<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>', '📱', ['#38bdf8', '#2563eb']],
  serial: ['<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.3"/>', '🔖', ['#38bdf8', '#2563eb']],
  bank: ['<path d="M3 9l9-5 9 5zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', '🏦', ['#34d399', '#16a34a']],
  crypto: ['<circle cx="12" cy="12" r="9"/><path d="M9.5 7.5v9M9.5 8.5h4a1.8 1.8 0 010 3.5h-4m0 0h4.5a1.8 1.8 0 010 3.5H9.5M12 6v1.5M12 16.5V18"/>', '🪙', ['#fbbf24', '#f59e0b']],
  insurance: ['<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', '🛡️', ['#34d399', '#16a34a']],
  identity: ['<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.5 16c.5-2 2-3 3.5-3s3 1 3.5 3M14 10h4M14 14h4"/>', '🪪', ['#f59e0b', '#ef4444']],
  voter: ['<rect x="4" y="12" width="16" height="9" rx="2"/><path d="M8 15.5h8M9 3h6v6H9z"/><path d="M10.5 6l1 1 2-2"/>', '🗳️', ['#f59e0b', '#ef4444']],
  photoid: ['<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M3 17l5-4 4 3 3-2 6 4"/>', '🖼️', ['#f59e0b', '#ef4444']],
  library: ['<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 2 15-4 1z"/>', '📚', ['#f59e0b', '#ef4444']],
  membership: ['<path d="M3 8a2 2 0 002-2h14a2 2 0 002 2v2a2 2 0 000 4v2a2 2 0 00-2 2H5a2 2 0 00-2-2v-2a2 2 0 000-4z"/><path d="M14 6v12"/>', '🎟️', ['#f59e0b', '#ef4444']],
  healthcard: ['<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>', '🏥', ['#fb7185', '#e11d48']],
  prescription: ['<g transform="rotate(-35 12 12)"><rect x="2.5" y="8.5" width="19" height="7" rx="3.5"/><path d="M12 8.5v7"/></g>', '💊', ['#fb7185', '#e11d48']],
  lens: ['<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14h4M3 14L5 7M21 14l-2-7"/>', '👓', ['#fb7185', '#e11d48']],
  travel: ['<path d="M21 3L3 11l7 2.5L12.5 21l3-7z"/><path d="M10 13.5L21 3"/>', '✈️', ['#22d3ee', '#0891b2']],
  car: ['<path d="M3 17v-3l2-5a2 2 0 011.9-1.4h10.2A2 2 0 0119 9l2 5v3h-2M3 17h2M8 17h8"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/><path d="M5 13h14"/>', '🚗', ['#22d3ee', '#0891b2']],
  contact: ['<circle cx="12" cy="8" r="4"/><path d="M4 21c.5-4.5 4-7 8-7s7.5 2.5 8 7"/>', '👤', ['#a78bfa', '#ec4899']],
  emergency: ['<path d="M7 18v-6a5 5 0 0110 0v6M5 18h14v3H5zM12 3v2M4.5 6l1.5 1.5M19.5 6L18 7.5"/>', '🚨', ['#a78bfa', '#ec4899']],
  // ---- interface ----
  home: ['<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>', '🏠'],
  vault: ['<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M10 7h4M10 17h4"/>', '🗂'],
  star: ['<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" fill="currentColor"/>', '★'],
  starline: ['<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>', '☆'],
  trash: ['<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', '🗑'],
  alert: ['<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v5M12 17.5v.5"/>', '⚠'],
  pulse: ['<path d="M3 12h4l2-6 4 12 2-6h6"/>', '🩺'],
  bolt: ['<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>', '⚡'],
  qr: ['<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>', '▦'],
  beam: ['<circle cx="12" cy="12" r="2"/><path d="M7.5 7.5a6.4 6.4 0 000 9M16.5 7.5a6.4 6.4 0 010 9M4.5 4.5a10.6 10.6 0 000 15M19.5 4.5a10.6 10.6 0 010 15"/>', '📡'],
  gear: ['<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>', '⚙'],
  help: ['<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.8.6-1.5 1-1.5 2M12 17v.5"/>', '❓'],
  lock: ['<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3M12 15v2"/>', '🔒'],
  unlock: ['<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 017.5-2M12 15v2"/>', '🔓'],
  shieldlock: ['<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9.5a2 2 0 014 0V11"/>', '🔐'],
  shield: ['<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', '🛡'],
  eye: ['<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', '👁'],
  copy: ['<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>', '⧉'],
  dup: ['<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 012-2h10M14 11v6M11 14h6"/>', '⎘'],
  download: ['<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', '⬇'],
  upload: ['<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>', '⬆'],
  importfile: ['<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/><path d="M4 8V4h16v4"/>', '⇩'],
  exportfile: ['<path d="M12 16V5M7 9l5-5 5 5"/><path d="M4 14v6h16v-6"/>', '⇪'],
  sync: ['<path d="M20 8a8 8 0 00-14-2M4 4v4h4M4 16a8 8 0 0014 2M20 20v-4h-4"/>', '⇄'],
  swap: ['<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>', '⇅'],
  edit: ['<path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19z"/><path d="M14 7l3 3"/>', '✎'],
  clip: ['<path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7"/>', '📎'],
  camera: ['<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>', '📷'],
  print: ['<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>', '🖨'],
  palette: ['<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s-.5-2 1-2H17a4 4 0 004-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>', '🎨'],
  compass: ['<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>', '🧭'],
  wave: ['<circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 008 0M9 9.5v.5M15 9.5v.5"/>', '👋'],
  dice: ['<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>', '🎲'],
  sparkles: ['<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>', '✨'],
  party: ['<path d="M4 20l4-12 8 8zM14 6l1-3M17 9l3-1M12 4v.01M19 13v.01"/>', '🎉'],
  scroll: ['<path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6zM6 3v18M9 8h7M9 12h7M9 16h4"/>', '📜'],
  search: ['<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>', '🔎'],
  abc: ['<path d="M3 17l4-10 4 10M4.5 13h5M14 7v10M14 12h3a2.5 2.5 0 010 5h-3"/>', '🔤'],
  folder: ['<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>', '📂'],
  puzzle: ['<path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z"/>', '🧩'],
  plus: ['<path d="M12 5v14M5 12h14"/>', '＋'],
  close: ['<path d="M6 6l12 12M18 6L6 18"/>', '✕'],
  check: ['<path d="M5 12.5l4.5 4.5L19 7.5"/>', '✓'],
  checkcircle: ['<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>', '✅'],
  clock: ['<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', '🕒'],
  hourglass: ['<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>', '⏳'],
  history: ['<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.5M3 4v4h4M12 8v4l3 2"/>', '🕘'],
  bulb: ['<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 11c.7.6 1 1.3 1 2h5c0-.7.3-1.4 1-2A6 6 0 0012 3z"/>', '💡'],
  doc: ['<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>', '📄'],
  pdf: ['<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 16.5h3"/>', '📕'],
  archive: ['<path d="M6 3h12v18H6z"/><path d="M12 3v3M12 8v2M12 12v2M10 16h4v3h-4z"/>', '🗜'],
  undo: ['<path d="M4 9l5-5M4 9l5 5M4 9h10a6 6 0 010 12h-3"/>', '↩'],
  menu: ['<path d="M4 6h16M4 12h16M4 18h16"/>', '☰'],
  chevdown: ['<path d="M6 9l6 6 6-6"/>', ''],
  chevright: ['<path d="M9 6l6 6-6 6"/>', ''],
  chevleft: ['<path d="M15 6l-6 6 6 6"/>', ''],
  info: ['<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', 'ℹ'],
};

export const ICON_NAMES = Object.keys(G);
export const hasIcon = (n) => !!G[n];
export const tileColors = (n) => (G[n] && G[n][2]) || null;
const EMOJI_OF = Object.fromEntries(Object.entries(G).map(([n, v]) => [n, v[1]]));
export const emojiOf = (n) => EMOJI_OF[n] || '';

const cache = new Map();
function parse(n) {
  if (cache.has(n)) return cache.get(n);
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${G[n][0]}</svg>`, 'image/svg+xml');
  cache.set(n, doc.documentElement); return doc.documentElement;
}

/* An icon element. Category icons (those with tile colours) get gradient variables for the tile styles. */
export function ic(name, { label = true } = {}) {
  const span = document.createElement('span');
  span.className = 'ico' + (tileColors(name) ? ' cat' : '');
  span.dataset.n = name;
  if (!G[name]) return span;
  const svg = document.importNode(parse(name), true);
  svg.setAttribute('focusable', 'false');
  if (label && EMOJI_OF[name]) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', EMOJI_OF[name]); } else svg.setAttribute('aria-hidden', 'true');
  span.append(svg);
  const t = tileColors(name);
  if (t) { span.style.setProperty('--i1', t[0]); span.style.setProperty('--i2', t[1]); }
  return span;
}

/* "{{name}} rest" → [icon, " rest"]; anything else → null. Only a LEADING token counts. */
const TOKEN = /^\{\{([a-z0-9]+)\}\}/;
export function splitToken(str) {
  const m = typeof str === 'string' ? TOKEN.exec(str) : null;
  if (!m || !G[m[1]]) return null;
  return [ic(m[1]), str.slice(m[0].length)];
}
