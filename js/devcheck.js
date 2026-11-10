/* Device & browser check — live signs that something on THIS device is watching or changing the page.

   What a web page can and cannot know: browsers deliberately do not let a website list your installed extensions (that would be
   a privacy leak in itself), so no website can honestly tell you "extension X is malicious". What a page CAN see are the traces
   extensions leave in it: elements and scripts they inject, and browser functions they replace to read what you type.
   This module looks for exactly those, watches for new ones while the app is open, and explains what to do. Nothing leaves the device. */

const EXT_URL = /^(chrome|moz|safari-web|ms-browser|edge)-extension:\/\//i;

/* well-known extensions that inject into pages (name, kind). A match means "this extension is active on this page". */
const KNOWN = [
  [/grammarly/i, 'Grammarly', 'writing assistant (reads text you type)'], [/lastpass|__lpform|data-lp/i, 'LastPass', 'password manager (autofill)'], [/bitwarden|data-bwautofill|com-bitwarden/i, 'Bitwarden', 'password manager (autofill)'],
  [/1password|com-1password|data-1p/i, '1Password', 'password manager (autofill)'], [/dashlane/i, 'Dashlane', 'password manager (autofill)'], [/keeper/i, 'Keeper', 'password manager (autofill)'], [/nordpass|data-np-/i, 'NordPass', 'password manager (autofill)'],
  [/honey|joinhoney/i, 'Honey', 'shopping assistant (reads pages)'], [/kaspersky|avast|avg-|norton|mcafee|bitdefender/i, 'Security suite', 'antivirus browser add-on'], [/translate|deepl|google-translate/i, 'Translator', 'page translator (reads page text)'],
  [/loom|screencastify|nimbus|lightshot/i, 'Screen capture', 'screen recorder / screenshot tool'], [/ublock|adblock|ghostery/i, 'Content blocker', 'ad / tracker blocker'],
];
const brand = (s) => { for (const [re, name, kind] of KNOWN) if (re.test(s)) return { name, kind }; return null; };

/* things the app itself puts in the page */
const OWN_SCRIPT = (el) => !el.src || el.id === 'vm-embed' || el.src.startsWith('blob:') || /\/js\/app\.js(\?|$)/.test(el.src);

/* classify one element (and its attributes) — returns a finding or null */
export function classifyNode(el) {
  if (!el || el.nodeType !== 1) return null;
  const tag = el.localName || '', id = el.id || '', cls = typeof el.className === 'string' ? el.className : '';
  const attrs = [...(el.attributes || [])].map((a) => a.name + '=' + a.value).join(' ');
  const sig = [tag, id, cls, attrs].join(' ');
  const urlAttr = el.getAttribute && (el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data') || '');
  if (urlAttr && EXT_URL.test(urlAttr)) return { level: 'high', key: 'ext-url:' + tag, title: 'A browser extension injected its own ' + tag + ' into this page', detail: 'Found <' + tag + '> loading from an extension address (' + urlAttr.split('/')[2].slice(0, 12) + '…). Extensions that run inside this page can read what you see and type.', advice: 'Use a browser profile or a Private / Incognito window with extensions turned off, or the desktop app.' };
  if (tag === 'iframe' || tag === 'frame' || tag === 'object' || tag === 'embed') return { level: 'high', key: 'frame', title: 'Something added a frame to this page', detail: 'VaultManager never uses frames; one was inserted by something running in your browser.', advice: 'Close this tab, turn off extensions for this site, and sign in again.' };
  if (tag === 'script' && !OWN_SCRIPT(el)) return { level: 'high', key: 'script:' + (el.src || 'inline').slice(0, 40), title: 'An unexpected script was added to this page', detail: 'A script that is not part of VaultManager was inserted (' + (el.src ? el.src.slice(0, 60) : 'inline') + ').', advice: 'Turn off extensions for this site; if it comes back, stop using this browser for your vault.' };
  const b = brand(sig);
  if (b && (tag.includes('-') || /(^|\s)(data-|__|com-|lp|bw|np)/i.test(sig))) return { level: 'warn', key: 'known:' + b.name, title: b.name + ' is active on this page', detail: b.kind + '. It can see this page, including what you type into it.', advice: b.kind.includes('password manager') ? 'Set the extension to “never autofill / run on this site” for VaultManager, so it cannot read your master password field.' : 'Turn it off for this site (or use a clean browser profile).' };
  if (tag.includes('-') && el.parentNode) return { level: 'warn', key: 'custom:' + tag, title: 'An unknown extension added an element (<' + tag + '>)', detail: 'VaultManager defines no custom elements, so this was inserted by something else in your browser.', advice: 'Open your browser’s extensions page, switch off extensions you do not recognise or no longer use, then reload.' };
  return null;
}

/* are key browser functions still the genuine built-in ones? (a replaced function can read passwords / keystrokes) */
const native = (f) => { try { return typeof f === 'function' && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(f)); } catch { return false; } };
export function checkNatives() {
  const out = [];
  if (!native(Function.prototype.toString)) out.push('Function.prototype.toString');
  const probes = [
    ['window.fetch', window.fetch], ['XMLHttpRequest.send', window.XMLHttpRequest && XMLHttpRequest.prototype.send], ['EventTarget.addEventListener', EventTarget.prototype.addEventListener],
    ['Document.createElement', Document.prototype.createElement], ['crypto.getRandomValues', crypto.getRandomValues], ['SubtleCrypto.deriveBits', window.SubtleCrypto && SubtleCrypto.prototype.deriveBits], ['SubtleCrypto.encrypt', window.SubtleCrypto && SubtleCrypto.prototype.encrypt],
    ['SubtleCrypto.decrypt', window.SubtleCrypto && SubtleCrypto.prototype.decrypt], ['Clipboard.writeText', window.Clipboard && Clipboard.prototype.writeText], ['JSON.stringify', JSON.stringify],
    ['HTMLInputElement value getter', (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || {}).get], ['HTMLInputElement value setter', (Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || {}).set],
  ];
  for (const [name, fn] of probes) if (fn && !native(fn)) out.push(name);
  return out;
}

/* ---- live watch: remember foreign nodes that appear while the app is open ---- */
const seen = new Map();   // key → finding (+ first seen)
let observer = null, listeners = new Set();
const record = (f) => { if (f && !seen.has(f.key)) { seen.set(f.key, { ...f, at: Date.now() }); for (const l of listeners) { try { l(f); } catch { /* ignore */ } } } };
export function onFinding(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function sweep(root) {
  record(classifyNode(root));
  if (root.querySelectorAll) for (const el of root.querySelectorAll('*')) record(classifyNode(el));
}
export function startWatch() {
  if (observer || typeof MutationObserver === 'undefined') return;
  const html = document.documentElement;
  if (html.dataset.cursor !== undefined) { /* app styled the root; fine */ }
  sweep(html);
  observer = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) sweep(n); });
  observer.observe(document, { childList: true, subtree: true });
}

/* the full report shown to the user */
export function runCheck() {
  startWatch();
  sweep(document.documentElement);
  const findings = [...seen.values()];
  const tampered = checkNatives();
  if (tampered.length) findings.push({ level: window.__TAURI__ ? 'warn' : 'high', key: 'natives', title: 'Browser functions have been replaced', detail: 'These built-in functions are not the genuine ones any more: ' + tampered.join(', ') + '. Something running in your browser (an extension or injected script) is intercepting them, which is how keyloggers and password stealers work. Some developer tools and monitoring add-ons also do this.', advice: 'Turn off extensions for this site or use a clean browser profile / Private window, then run this check again. If it stays, do not enter your master password on this browser.' });
  if (!window.isSecureContext) findings.push({ level: 'high', key: 'insecure', title: 'This page is not a secure context', detail: 'Encryption needs https:// (or localhost / a local file). Anything on the network could read an http:// page.', advice: 'Open VaultManager over https:// or use the offline file.' });
  if (navigator.webdriver) findings.push({ level: 'warn', key: 'webdriver', title: 'The browser reports it is remote-controlled', detail: 'navigator.webdriver is on, which means automation software is driving this browser.', advice: 'Only continue if you started that automation yourself.' });
  const order = { high: 0, warn: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { findings, at: Date.now(), clean: !findings.some((f) => f.level === 'high' || f.level === 'warn') };
}
export const highCount = () => [...seen.values()].filter((f) => f.level === 'high').length + (!window.__TAURI__ && checkNatives().length ? 1 : 0);

export const ADVICE = [
  ['Use a clean browser profile for your vault', 'Create a separate Chrome / Edge / Firefox profile with no extensions, or open VaultManager in a Private / Incognito window (extensions are off there unless you allow them).'],
  ['Review your extensions', 'Open your browser’s extensions page (Chrome / Edge: type chrome:// or edge:// then “extensions” in the address bar; Firefox: about:addons). Remove anything you do not recognise or no longer use. Be most careful with extensions that can “read and change all your data on all websites”.'],
  ['Set extensions to “on click” or “this site only”', 'In the extension’s Details, change “Site access” from “On all sites” to “On click” so it cannot see the vault page unless you allow it.'],
  ['Turn off password-manager autofill here', 'If you use another password manager, tell it not to run on this site, so it cannot read your master password field.'],
  ['Prefer the offline file or the desktop app', 'VaultManager-offline.html (kept on a USB stick) and the installable apps run outside normal web pages; a clean browser profile or the installed app avoids most extension risk.'],
  ['Keep your browser and system updated', 'Updates fix the holes malware uses to get into browsers. Never unlock a vault on a shared or public computer.'],
];
