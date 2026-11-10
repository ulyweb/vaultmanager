# Security

VaultManager runs entirely in the browser. There is no server, no account and no telemetry. The Content-Security-Policy (`default-src 'none'`) allows network connections only to its own origin and — solely for the optional gist sync — `https://api.github.com`; the lint check fails the build if that is loosened or if any file other than `js/sync.js` uses a network API.

## What is protected, and how
| Data | Protection |
|---|---|
| Vault (items, settings) | AES-256-GCM under a random 256-bit master key, fresh 96-bit IV on every write, authenticated with purpose-bound additional data |
| Master key | Stored only wrapped: by a PBKDF2-HMAC-SHA256 key (600,000+ rounds, random 16-byte salt) from your master password and, optionally, by a 256-bit recovery key (HKDF-SHA256) |
| Master password / recovery key | Never stored. A password is right only if it unwraps the master key *and* the vault then authenticates |
| Backups (`.vmvault`), QR codes | QR Seal v2 payload: PBKDF2-SHA256 (≥100,000, default 600,000) → AES-256-GCM, header authenticated |
| Passkeys | WebAuthn with the PRF extension: the authenticator returns a 256-bit secret for a per-passkey salt; HKDF-SHA256 turns it into a key that wraps the master key, bound to the credential id. The secret is never stored. User verification (biometric / PIN) is required. Adding or removing a passkey requires re-entering the master password; unlock attempts with a passkey are not throttled (the authenticator enforces its own limits) |
| Beam sync | WebRTC data channel (DTLS) between the two devices; a 6-digit number derived from both certificate fingerprints must be confirmed on both screens before any data is exchanged or applied (stops a man in the middle); the vault bundle is additionally sealed with the sync passphrase. No server is involved |
| Attachments | Each file is a separate AES-256-GCM message under the vault data key, bound to the vault and file id (swapping or tampering is detected); stored in IndexedDB as ciphertext only |
| Sync bundles (`.vmsync`, gist) | Encrypted on-device with a *sync passphrase* (PBKDF2-SHA256 600,000 → AES-256-GCM, header authenticated) before they leave it. The GitHub token and sync passphrase are stored only inside the encrypted vault and are never exported or synced |
| Audit trail | Stored inside the encrypted vault; records what happened, never passwords or other secret values |
| Memory | Raw master key is zeroed on lock; the data key is a non-extractable CryptoKey |
| Rendering | DOM built with `createElement` / `textContent` only — vault data cannot become markup |
| Clipboard | Cleared after a configurable delay (best effort — browsers may refuse in the background) |
| Unlock attempts | Escalating delay after repeated failures (a courtesy; real protection is the KDF cost) |

## Threat model — what it does NOT protect against
- **Beam network exposure.** WebRTC is not governed by the page's CSP. By default no STUN server is used (same-network pairing only); “Also try over the internet” contacts Google's public STUN server, which learns your public IP address. The pairing codes contain your device's network addresses — share them only with your own other device. WebRTC is allowed only in `js/beam.js` (lint-enforced).
- **A lost or compromised authenticator.** A passkey unlocks the vault for whoever can pass its user verification. Remove passkeys of lost devices in Settings → Security. Passkeys are per device and per web address and are not synced.
- **A weak sync passphrase.** A sync file or gist is a copy of your data that others may obtain; it is only as strong as that passphrase (≥12 characters and ≈50 bits are enforced). What GitHub can see for gist sync: that a secret gist exists, its size, change times and your IP — not its contents.
- **A stolen GitHub token.** It can read or delete the sync gist (ciphertext), not decrypt it. Use a token with only the `gist` permission and revoke it if a device is lost.
- **Sync conflicts.** Merging is per item, newest edit wins; two devices editing the same item within seconds can overwrite each other. Version history lets you restore the overwritten version.
- **The audit trail is not tamper-proof against you.** Anyone who knows the master password can clear it. Failed unlock attempts are noted in plaintext browser storage until the next successful unlock, so someone with disk access can also clear them.
- **A weak master password.** Anyone who copies the encrypted vault (from browser storage, a backup, or a QR) can guess offline; PBKDF2 slows that down but cannot save a guessable password. VaultManager enforces ≥12 characters and an estimated ≥50 bits, and offers a passphrase generator.
- **Malware, a compromised browser or a malicious extension on your device.** Once unlocked, secrets exist in page memory and can be read by anything with that access. Lock when you step away.
- **Shoulder-surfing, screenshots and screen recorders** while items are revealed.
- **Forgetting both the master password and the recovery key.** There is no reset; that is what zero-knowledge means. Keep an encrypted backup.
- **Same-origin neighbours.** Browser storage is per *origin*. On shared hosts such as `username.github.io`, every project under that origin shares it; the vault is encrypted, but prefer a dedicated origin (custom domain or localhost).
- **Framing / clickjacking.** `frame-ancestors` cannot be set from a `<meta>` CSP; serve the app with that header (`frame-ancestors 'none'`) if you host it yourself.
- **Browser storage eviction.** Clearing site data deletes the vault. Export an encrypted backup regularly.
- **Metadata** such as the vault's size and last-modified time is visible to whoever can read the storage.
- Plaintext **CSV exports** and imported source files are readable by anyone; delete them after use.
- The strength estimator is a heuristic, not a guarantee.
- This is **version 0.1 and has not been independently audited.**

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue.

## Item passcode lock

Any item can have a secondary passcode. Its username, password, website, one-time-code secret, notes, card details, category fields and custom fields are sealed again (PBKDF2-SHA256 → AES-256-GCM, QR Seal format) inside the vault, together with a random 256-bit item key. Attached files are sealed under that item key (inside the normal per-file vault encryption) and their names and types live only inside the passcode seal. Name, tags and favourite stay readable so the item can be found. The passcode is never stored; a forgotten passcode cannot be recovered. Opened items are held in memory for 10 minutes or until the vault locks, and wrong passcodes are slowed down.

## Network use

VaultManager makes no network requests of its own except: (1) optional GitHub gist sync (`api.github.com`) when you set it up; (2) Contact admin / the new-profile notice to the administrator's relay (`script.google.com`), only on a deliberate action and without any vault data; (3) loading a background image from an address you typed. The single-file offline copy has no network permission at all.

## Security review (v0.21.0)

A review of all scripts (crypto, vault, sync, Beam, import / export, profiles, item lock, UI helpers, service worker, build and CI):

**Checked and fine:** no `innerHTML` / `eval` / inline script or style (lint-enforced); strict CSP on every build; secrets are only written to storage inside AES-256-GCM records (plus non-secret profile names, cosmetic look and failed-attempt counters); fresh random IV per encryption, key-wrapping bound to vault id; unbiased random generator (`getRandomValues` with rejection sampling), `Math.random` only for cosmetics; links are scheme-checked (`http(s)` only) and opened with `noopener noreferrer`; no-referrer policy; service worker caches same-origin GETs only; Beam pairing is confirmed with a 6-digit code derived from both DTLS fingerprints; 0 known vulnerabilities in the npm dependencies; CI workflow has read-only permissions.

**Fixed in 0.21.0:**
- A crafted backup (`.vmprofile`) could silently change settings — switch off auto-lock, stop logging reveals, or give the password generator absurd lengths. All imported settings are now type-checked and bounded; the sync token is never imported.
- Attachment names from imported files are cleaned of path characters.
- A crafted QR / backup could demand up to 10,000,000 PBKDF2 rounds and stall the page; the limit is now 5,000,000.
- The app refuses to run inside someone else's page (clickjacking; a `<meta>` CSP cannot set `frame-ancestors`).

**Known limits (by design or outside the app's control):**
- Anyone who can run JavaScript on the page (a malicious or over-privileged browser extension, a compromised device) can read an unlocked vault — as with any web page. Browsers do not let a website list your installed extensions, so VaultManager cannot name a bad one; instead Tools → Task manager → Security check looks for the traces extensions leave (injected elements and scripts, replaced browser functions), watches live while the app is open, shows a warning bar, and recommends what to do (clean browser profile or Private window, set extensions to “on click”, offline file / desktop app). A clean result is not a guarantee.
- Failed-attempt throttling and lockouts are client-side; someone with the encrypted file can try passwords offline at the speed of PBKDF2 (600,000 rounds). Use a long master password or passphrase.
- Everything you store is encrypted. The only things readable before you unlock are each profile’s name and picture (so the sign-in screen can show them), harmless appearance choices such as colours, and a failed-attempt counter — keep secrets out of profile names. Removing a profile from the sign-in screen needs its name typed, not its password (so a forgotten-password profile can be removed).
- Beam with "internet" enabled asks a public STUN server (Google) for your address; the default is same-Wi-Fi only.
- Contact admin / the new-profile notice send what is described on screen to the administrator's relay; the relay's own handling is outside this app.
- GitHub Actions in the native-build workflow are referenced by version tag, not commit hash (a supply-chain risk for the installers).
