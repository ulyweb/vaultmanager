# Security

VaultManager runs entirely in the browser. There is no server, no account and no telemetry; the Content-Security-Policy (`default-src 'none'`, `connect-src 'self'`) stops the page from sending data anywhere, and the lint check fails the build if that is loosened.

## What is protected, and how
| Data | Protection |
|---|---|
| Vault (items, settings) | AES-256-GCM under a random 256-bit master key, fresh 96-bit IV on every write, authenticated with purpose-bound additional data |
| Master key | Stored only wrapped: by a PBKDF2-HMAC-SHA256 key (600,000+ rounds, random 16-byte salt) from your master password and, optionally, by a 256-bit recovery key (HKDF-SHA256) |
| Master password / recovery key | Never stored. A password is right only if it unwraps the master key *and* the vault then authenticates |
| Backups (`.vmvault`), QR codes | QR Seal v2 payload: PBKDF2-SHA256 (≥100,000, default 600,000) → AES-256-GCM, header authenticated |
| Memory | Raw master key is zeroed on lock; the data key is a non-extractable CryptoKey |
| Rendering | DOM built with `createElement` / `textContent` only — vault data cannot become markup |
| Clipboard | Cleared after a configurable delay (best effort — browsers may refuse in the background) |
| Unlock attempts | Escalating delay after repeated failures (a courtesy; real protection is the KDF cost) |

## Threat model — what it does NOT protect against
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
