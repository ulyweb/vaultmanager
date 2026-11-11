/* Browser check. A plain (non-module) script written in old-style JavaScript on purpose, so even a very old browser can run it:
   if the browser lacks something VaultManager cannot work without, say so instead of showing a blank page. */
(function () {
  var missing = [];
  function has(test) { try { return !!test(); } catch (e) { return false; } }
  if (!has(function () { return 'noModule' in HTMLScriptElement.prototype; })) missing.push('modern JavaScript modules');
  if (!has(function () { return window.crypto && window.crypto.subtle; })) missing.push(window.isSecureContext === false ? 'encryption (open the page over https:// or at localhost)' : 'encryption (WebCrypto)');
  if (!has(function () { return window.indexedDB; })) missing.push('local storage (IndexedDB) — a private window may block it');
  if (!has(function () { return window.TextEncoder && window.Promise; })) missing.push('text encoding');
  if (!has(function () { return typeof window.structuredClone === 'function'; })) missing.push('structured cloning');
  if (!has(function () { return window.CSS && CSS.supports('color: color-mix(in srgb, red, blue)'); })) missing.push('modern colour handling (CSS color-mix)');
  if (!missing.length) return;
  window.__vmUnsupported = missing;
  function show() {
    var box = document.getElementById('app') || document.body;
    var p = document.createElement('p'); p.className = 'noscript'; p.setAttribute('role', 'alert');
    p.textContent = 'VaultManager needs a newer browser. Please update Chrome, Edge, Brave, Firefox or Safari (or open it in one of them). Missing in this browser: ' + missing.join('; ') + '.';
    box.appendChild(p);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
