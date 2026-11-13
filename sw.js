/* Offline cache. Same-origin GETs only; nothing else is ever fetched. Bump VERSION on every release. */
const VERSION = 'vm-0.25.1';
const ASSETS = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'js/app.js', 'js/compat.js', 'js/dom.js', 'js/util.js', 'js/crypto.js', 'js/generator.js', 'js/strength.js', 'js/totp.js', 'js/vault.js', 'js/qr.js',
  'js/wordlist.js', 'js/selftest.js', 'js/views.js', 'js/tools.js', 'js/settings.js', 'js/sync.js', 'js/passkey.js', 'js/templates.js', 'js/beam.js', 'js/landscapes.js', 'js/tour.js', 'js/icons.js', 'js/offline.js', 'js/config.js', 'js/cursor.js', 'js/devcheck.js', 'js/admin.js', 'js/taskman.js', 'wallpapers/andromeda.jpg', 'wallpapers/aurora.jpg', 'wallpapers/cairo.jpg', 'wallpapers/carina.jpg', 'wallpapers/earth.jpg', 'wallpapers/earthrise.jpg', 'wallpapers/earthset.jpg', 'wallpapers/night1.jpg', 'wallpapers/night2.jpg', 'wallpapers/night3.jpg', 'wallpapers/night4.jpg', 'wallpapers/nyc.jpg', 'wallpapers/pillars.jpg', 'wallpapers/saturn.jpg', 'wallpapers/turin.jpg', 'wallpapers/vegas.jpg', 'js/profiles.js', 'js/profile-ui.js', 'offline/VaultManager-offline.html', 'offline/VaultManager-offline.html.sha256', 'js/look.js', 'js/widgets.js', 'js/settings-look.js', 'js/blobs.js', 'js/version.js', 'vendor/qrcode.js', 'vendor/jsQR.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
