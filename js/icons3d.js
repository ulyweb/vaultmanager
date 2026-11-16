/* 3D icons: real three.js models (tools/icons3d-scene.js) rendered to transparent pictures in icons3d/, one per category.
   They are used (1) as the objects on the "Choose a category" carousel cards and (2) for every category icon while
   Settings → Appearance → Icon style is "3D live animated". The pictures are bundled with the app, so they work offline
   (the single-file copy carries them inside the file, like the NASA wallpapers). */

export const ICONS3D = ['login', 'note', 'card', 'technical', 'social', 'shopping', 'app', 'server', 'computer', 'locker', 'network', 'internet', 'phone', 'serial', 'bank', 'crypto', 'insurance', 'identity', 'voter', 'photoid', 'library', 'membership', 'healthcard', 'prescription', 'lens', 'travel', 'car', 'contact', 'emergency', 'lock', 'star'];

let embedded = null;
const fromEmbed = (file) => {
  if (embedded === null) { embedded = {}; try { const el = document.getElementById('vm-embed'); if (el) embedded = JSON.parse(el.textContent) || {}; } catch { /* not the single-file build */ } }
  return embedded[file] || '';
};
export const has3d = (name) => ICONS3D.includes(name);
export const icon3dUrl = (name) => { const f = 'icons3d/' + name + '.webp'; return fromEmbed(f) || f; };

/* The category icons switch to the pictures with one adopted style sheet (no inline styles, so the strict content policy is happy). */
let sheet = null;
export function syncIcons3d(on) {
  if (typeof document === 'undefined' || !('adoptedStyleSheets' in document) || typeof CSSStyleSheet === 'undefined') return;
  if (!on) { if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); return; }
  if (!sheet) {
    sheet = new CSSStyleSheet();
    const list = ICONS3D.map((n) => `[data-n="${n}"]`).join(', ');
    const rules = [
      `html[data-icons="3d"] .ico.cat:is(${list}) { background-color: transparent !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 138% !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; overflow: visible !important; filter: drop-shadow(0 6px 4px rgba(0, 0, 0, .38)); transition: transform .25s ease; }`,
      `html[data-icons="3d"] .ico.cat:is(${list}) svg { opacity: 0; }`,
      `html[data-icons="3d"] .ico.cat:is(${list})::after { display: none; }`,
      `html[data-icons="3d"][data-fxanim=on] .ico.cat:is(${list}) { animation: vm-bob3d 4.8s ease-in-out infinite !important; animation-delay: var(--d, 0s) !important; }`,
      `html[data-icons="3d"] .ico.cat:is(${list}):hover { animation: none !important; transform: scale(1.22) rotate(-5deg) translateY(-2px) !important; }`,
      ...ICONS3D.map((n) => `html[data-icons="3d"] .ico.cat[data-n="${n}"] { background-image: url("${icon3dUrl(n)}") !important; }`),
    ];
    sheet.replaceSync(rules.join('\n'));
  }
  if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
