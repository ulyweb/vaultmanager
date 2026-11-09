# VaultManager

A **zero-knowledge, end-to-end encrypted password manager** that runs entirely in your browser — vanilla HTML, CSS and JavaScript, no framework, no build step, no server, no account.

It shares its core engine and look with [ulyOS](https://github.com/ulyweb/ulyOS) (wrapped master key, PBKDF2 → AES-256-GCM, the *dashboard-telemetry* design from QR Seal / System Vault / TrustVault) and takes feature inspiration from [KeePassXC](https://keepassxc.org/) and [Bitwarden](https://github.com/bitwarden).

## What it does
- **13 categories**: logins, secure notes, payment cards, **apps / software licences, Wi-Fi / network, computer accounts, shopping, insurance, locker combinations, travel, ID / identity, bank accounts, servers / API keys** — each with purpose-built fields — plus **custom fields** (optionally secret) on any item. Wi-Fi items make a guest-join QR; dated items (passports, licences, policies, renewals) feed an *expiring soon* report.
- **Encrypted vault**: tags, favourites, search, password history and a trash (retention configurable).
- **Attachments**: add images (with preview, or snap a photo on a phone) and documents to any login, note or card. Each file is encrypted separately (AES-256-GCM, 10 MB each) and kept in IndexedDB — never in readable form.
- **Beam sync (from ulyOS)**: pair two devices by QR or code and merge both vaults directly over an end-to-end encrypted WebRTC link — no cloud, no account, verified by a shared 6-digit number.
- **Encrypted sync**: merge your vault between devices with a `.vmsync` file (works anywhere, no account) or automatically through a *secret GitHub gist*. Only ciphertext leaves the device; the passphrase and token never leave the encrypted vault. Newest edit per item wins, deletions propagate.
- **Version history**: every edit keeps the previous version (last 10) with one-click restore, plus previous passwords.
- **Audit trail**: an encrypted log of sign-ins, failed attempts, edits, copy / reveal / download, exports and sync — never the secret values.
- **Settings area**: General, Security, Sync, Audit trail and About (version, changelog, data formats, storage use, licences).
- **Strong, unique passwords for every account**: cryptographically random password / passphrase (EFF wordlist) / PIN generator with entropy readout, plus a strength checker.
- **QR sealing**: seal any item or text into a password-protected QR code (AES-256-GCM, PBKDF2 600,000 rounds), scan it back with the camera or an image. The payload is **byte-compatible with QR Seal v2** from ulyOS.
- **Paper backup**: your whole vault as a set of QR codes (printable), restorable by scanning them in any order.
- **TOTP**: one-time codes (RFC 6238; SHA-1/256/512; 6–8 digits) from a base32 secret or `otpauth://` link.
- **Vault health**: weak, reused, old and `http://` passwords — computed locally; nothing is looked up online.
- **Import / export**: Bitwarden (JSON, CSV), KeePassXC / KeePass CSV, 1Password / LastPass / Chrome / Edge / Firefox CSV; encrypted `.vmvault` backups; plaintext CSV (with a re-authentication and warnings).
- **Passkey unlock**: fingerprint, face, Windows Hello, a phone or a security key (WebAuthn PRF) wraps the vault key; per device, master password stays as fallback.
- **Recovery key** (optional, printable "Emergency Kit"), auto-lock, clipboard auto-clear, escalating delay after wrong passwords, light/dark theme, installable offline PWA.

## Offline apps (PC and mobile)
Install it as an app (works with no internet), keep a single `VaultManager-offline.html` file, or build native installers for Windows, macOS, Linux, Android and iOS from the same code. See **[docs/OFFLINE-APPS.md](docs/OFFLINE-APPS.md)** — including exactly what is tested and what still needs a first run on real devices.

```bash
npm run build:offline     # offline/VaultManager-offline.html — one self-contained file
npm run build:web         # dist/web — the static app (host it anywhere / wrapped by the native apps)
```

## Run it
```bash
npm run serve        # python3 -m http.server 8080
```
Open <http://localhost:8080> in Chrome, Edge, Firefox or Safari. Use `localhost` or HTTPS — browsers disable WebCrypto on plain-HTTP origins. Host it anywhere static (GitHub Pages, a NAS, a USB stick with a local server).

## How the encryption works
```
master password ──PBKDF2-SHA256, 600k rounds, random salt──▶ KEK ─┐
recovery key (optional, 256-bit) ──HKDF-SHA256──────────────▶ KEK ─┤ AES-256-GCM unwrap
                                                                    ▼
                                random 256-bit master key M ──HKDF──▶ data key ──AES-256-GCM (fresh 96-bit IV per write)──▶ vault
```
- `M` is stored only *wrapped*. Changing the password re-wraps `M`; the data is not re-encrypted.
- Every ciphertext is authenticated (GCM) and bound to its purpose and vault via additional data, so tampering is detected rather than decrypted into garbage.
- QR / backup payload: `[2][iterations u32][salt 16][iv 12][AES-GCM ciphertext‖tag]`, base64, header authenticated. See `js/crypto.js`.
- No third-party crypto: only the browser's WebCrypto. Third-party code is limited to the QR encoder/decoder in `vendor/`.
- **Self-test**: Settings → *Run crypto self-test* checks your browser against published PBKDF2, HOTP and TOTP vectors and exercises tamper detection.

See [SECURITY.md](SECURITY.md) for the threat model and, importantly, what VaultManager does **not** protect against.

## Sync in two minutes
0. **Beam** (nothing uploaded): *Beam sync* in the sidebar → Start on one device, Join on the other, scan / paste the two codes, check the 6-digit numbers match, done.
1. **Settings → Sync → 1**: save a sync passphrase (5+ random words; the same on every device — write it down).
2. **File**: *Export sync file* on device A, *Import sync file* on device B. Repeat in either direction whenever you like; imports merge.
3. **Gist (automatic)**: create a GitHub token with only the `gist` permission, paste it, press *Sync now* — device A creates a secret gist and shows its ID. On device B enter the same passphrase, a token and that ID. Syncs on unlock, every 10 minutes and shortly after changes.

## Project layout
| Path | Purpose |
|---|---|
| `index.html`, `css/`, `js/app.js` | shell, lock screen, navigation, auto-lock |
| `js/views.js`, `js/tools.js`, `js/settings.js` | vault list / detail / editor / attachments; generator, health, QR, import-export; tabbed settings (sync, audit, about) |
| `js/icons.js` | the built-in SVG icon set (one look on every device) |
| `js/tour.js` | welcome splash, spotlight guided tour, help dialog |
| `js/look.js`, `js/settings-look.js`, `js/widgets.js`, `js/landscapes.js` | look & feel settings, Home widgets, offline wallpaper scenes (ported from ulyOS) |
| `js/templates.js`, `js/beam.js` | category definitions (data-driven), Wi-Fi QR / expiry helpers; Beam peer-to-peer sync (the only file allowed to use WebRTC) |
| `js/sync.js`, `js/passkey.js`, `js/blobs.js`, `js/version.js` | encrypted sync (file + gist), WebAuthn passkey glue, attachment storage, version & changelog |
| `js/crypto.js` | key hierarchy, vault record, QR Seal v2 payloads, recovery key |
| `js/vault.js` | store, items, import / export, health (DOM-free, unit-tested) |
| `js/generator.js`, `strength.js`, `totp.js`, `qr.js` | generator, strength estimate, TOTP, QR + multi-QR chunking |
| `vendor/` | `qrcode.js` (MIT, QR encoder) and `jsQR.js` (Apache-2.0, QR decoder) from ulyOS |
| `tests/`, `tools/lint.js` | unit tests, Playwright browser tests, static security lint |

## Tests
```bash
npm install
npx playwright install chromium
npm test        # lint + unit + browser end-to-end
```
The lint enforces the security posture: strict CSP whose `connect-src` may only be `'self'` and `https://api.github.com` (used solely by gist sync, in `js/sync.js` — the only file allowed to use network APIs), no inline scripts / styles / handlers, no `innerHTML`, no `eval`, no network APIs, a complete service-worker precache list, no committed secrets.

## Status
Version 0.10 — a complete tenth cut (this repo is the test bench for the stand-alone PC + mobile build — see [ROADMAP.md](ROADMAP.md)), **not yet independently audited**. Treat it accordingly and keep an encrypted backup. See [ROADMAP.md](ROADMAP.md).

## Licences
Code: see repository owner. EFF short wordlist: CC BY 3.0 US. `vendor/qrcode.js`: MIT (Kazuhiko Arase). `vendor/jsQR.js`: Apache-2.0 (`vendor/LICENSE-jsqr.txt`).

## Contact admin

Set `ADMIN_EMAIL` in `js/config.js` (or per device in Settings → About → Contact admin). A browser-only app has no server, so the "new profile" notice is an email that opens in the person's own mail app and contains only the profile name, version, date and platform. Automatic, server-side notification would need a mail service, which this app deliberately does not include.
