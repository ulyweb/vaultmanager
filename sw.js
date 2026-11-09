/* Offline cache. Same-origin GETs only; nothing else is ever fetched. Bump VERSION on every release. */
const VERSION = 'vm-0.4.0';
const ASSETS = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/dom.js', 'js/util.js', 'js/crypto.js', 'js/generator.js', 'js/strength.js', 'js/totp.js', 'js/vault.js', 'js/qr.js',
  'js/wordlist.js', 'js/selftest.js', 'js/views.js', 'js/tools.js', 'js/settings.js', 'js/sync.js', 'js/passkey.js', 'js/templates.js', 'js/beam.js', 'js/blobs.js', 'js/version.js', 'vendor/qrcode.js', 'vendor/jsQR.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
