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
