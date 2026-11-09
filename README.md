# VaultManager

A **zero-knowledge, end-to-end encrypted password manager** that runs entirely in your browser — vanilla HTML, CSS and JavaScript, no framework, no build step, no server, no account.

It shares its core engine and look with [ulyOS](https://github.com/ulyweb/ulyOS) (wrapped master key, PBKDF2 → AES-256-GCM, the *dashboard-telemetry* design from QR Seal / System Vault / TrustVault) and takes feature inspiration from [KeePassXC](https://keepassxc.org/) and [Bitwarden](https://github.com/bitwarden).

## What it does
- **Encrypted vault**: logins, secure notes and payment cards, with tags, favourites, search, password history and a 30-day trash.
- **Strong, unique passwords for every account**: cryptographically random password / passphrase (EFF wordlist) / PIN generator with entropy readout, plus a strength checker.
- **QR sealing**: seal any item or text into a password-protected QR code (AES-256-GCM, PBKDF2 600,000 rounds), scan it back with the camera or an image. The payload is **byte-compatible with QR Seal v2** from ulyOS.
- **Paper backup**: your whole vault as a set of QR codes (printable), restorable by scanning them in any order.
- **TOTP**: one-time codes (RFC 6238; SHA-1/256/512; 6–8 digits) from a base32 secret or `otpauth://` link.
- **Vault health**: weak, reused, old and `http://` passwords — computed locally; nothing is looked up online.
- **Import / export**: Bitwarden (JSON, CSV), KeePassXC / KeePass CSV, 1Password / LastPass / Chrome / Edge / Firefox CSV; encrypted `.vmvault` backups; plaintext CSV (with a re-authentication and warnings).
- **Recovery key** (optional, printable "Emergency Kit"), auto-lock, clipboard auto-clear, escalating delay after wrong passwords, light/dark theme, installable offline PWA.

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

## Project layout
| Path | Purpose |
|---|---|
| `index.html`, `css/`, `js/app.js` | shell, lock screen, navigation, auto-lock |
| `js/views.js`, `js/tools.js` | vault list / detail / editor; generator, health, QR, import-export, settings |
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
The lint enforces the security posture: strict CSP with `connect-src 'self'` (the app cannot phone home), no inline scripts / styles / handlers, no `innerHTML`, no `eval`, no network APIs, a complete service-worker precache list, no committed secrets.

## Status
Version 0.1 — a complete first cut, **not yet independently audited**. Treat it accordingly and keep an encrypted backup. Roadmap ideas: encrypted sync (file / gist, as in ulyOS), passkey (WebAuthn PRF) unlock, a browser-extension autofill, attachments, shared vaults.

## Licences
Code: see repository owner. EFF short wordlist: CC BY 3.0 US. `vendor/qrcode.js`: MIT (Kazuhiko Arase). `vendor/jsQR.js`: Apache-2.0 (`vendor/LICENSE-jsqr.txt`).
