# Roadmap

## Where this is going
This repository is the **test bench**. Every feature is being proven here, in the browser, before the **final stand-alone build** for **PC and mobile** — secure, offline-capable and able to **sync between the two**. The web code is written so the same core (crypto, vault, sync, UI) can move into that build unchanged.

## Technology decision: HTML/JS or Rust?
**Recommendation: keep the UI in HTML/CSS/JS, ship it in a Rust shell (Tauri 2), and move the security core into Rust step by step.** Not "all Rust", and not "HTML forever".

| Layer | Choice | Why |
|---|---|---|
| **UI** (screens, forms, QR, settings) | HTML / CSS / JS — what we have | One codebase for Windows, macOS, Linux, Android, iOS and the browser. Rust UI toolkits (egui, Slint, Dioxus) are not yet as polished on phones, and a rewrite would cost months for no security gain. Tauri 2 runs this exact UI in the system WebView on desktop **and** mobile. |
| **App shell** | **Tauri 2 (Rust)** | Small installers (~10 MB, not Electron's ~150 MB), native file access for sync folders, OS keystore / biometrics, auto-update, signed builds. |
| **Security core** (crypto, vault, merge, sync bundle) | **Rust crate**, used natively by Tauri and compiled to WASM for the browser build / extension | JavaScript cannot reliably wipe secrets from memory, has no **Argon2id** (WebCrypto offers only PBKDF2 — weaker against GPUs), and is awkward to audit. A Rust core gives `zeroize`, Argon2id, constant-time primitives, and **one** audited implementation shared by every platform. This is the path Bitwarden itself took (TypeScript clients + Rust SDK). |

**How we get there without a big-bang rewrite** — the file formats stay the contract:
1. *Now:* web test bench (this repo). The data formats (vault v1, VMX1, VMS1, QR v2, BEAM1) are frozen by tests.
2. *Next:* wrap the same code in Tauri 2; add native biometrics / secure storage on each OS.
3. *Then:* port `js/crypto.js` + `js/vault.js` merge logic to a Rust crate behind the same function names; our unit tests (known-answer vectors, tamper, merge convergence) become the conformance suite that the Rust core must pass. Add a vault format v2 with Argon2id (old vaults upgrade at next unlock).
4. *Before 1.0:* independent security audit.

Sandbox note: building / signing Windows, macOS, iOS and Android packages needs those platforms' toolchains and developer accounts; I can scaffold the Tauri project and CI, but signing and store submission happen on your side.

## Status (v0.7.0)
Done and tested: 28 categories in 8 groups · welcome splash + guided tour · field-level sync merge with conflict review · look & feel (appearance, effects, dock, widgets) · 13 categories (logins, notes, cards, apps, Wi-Fi / network, computer accounts, shopping, insurance, lockers, travel, ID, bank, server) + custom fields · expiry checks · Beam device-to-device sync · encrypted vault · generator · TOTP · vault health · QR sealing + paper backup · import / export (Bitwarden, KeePassXC, Chrome, …) · recovery key · attachments · version history · audit trail · encrypted sync (file + secret GitHub gist) · passkey unlock (WebAuthn PRF) · tabbed settings · installable offline PWA.

## Things that change when we move from "test site" to "final app"
| Topic | Test bench (GitHub Pages) | Final stand-alone build |
|---|---|---|
| **Passkeys** | Bound to the site's address (`ulyweb.github.io`); they will *not* carry over | Re-add per device. Inside a native wrapper, passkeys need extra platform setup (iOS associated domains, Android Digital Asset Links) — or we switch to the OS keystore / biometrics (Secure Enclave, Android Keystore, Windows Hello via the wrapper). *Decision point.* |
| **Storage** | Browser storage (can be evicted) — hence "Protect storage" and backups | App-private storage; far less eviction risk |
| **Sync transport** | Beam (peer to peer), secret GitHub gist, or `.vmsync` file | Same encrypted bundle, more transports: user-chosen cloud folder, WebDAV, or a tiny self-hosted relay. The bundle format (VMS1) does not change |
| **Security headers** | Only `<meta>` CSP (no `frame-ancestors`) | Real headers / native shell removes that gap |
| **Autofill** | Copy & paste | Needs native integration: browser extension (PC), Android Autofill service, iOS AutoFill credential provider |
| **Updates** | Service-worker cache, "Refresh app files" | App-store / auto-updater with signed builds |

## Packaging options (to decide)
1. **Installable PWA** (works today on PC and phones; lowest effort, same code).
2. **Tauri** for Windows / macOS / Linux and **Capacitor** for iOS / Android — wrap the same web code, add native biometrics, autofill and secure storage.
3. Fully native later, only if autofill demands it.

## Feature backlog
Add your wishes here — this list is the source of truth while testing.
- [ ] Browser-extension autofill (PC) and OS autofill (mobile)
- [ ] Optional breach check (k-anonymity, opt-in, off by default — it needs the network)
- [ ] Sync to a user-chosen cloud folder / WebDAV
- [ ] Photo wallpapers (ulyOS fetches Wikimedia images; VaultManager stays offline, so only the 12 drawn scenes for now; uploading your own image is a candidate)
- [ ] Shared vaults / emergency access
- [ ] Secure notes with Markdown, custom fields, folders
- [ ] Independent security audit before the 1.0 release

## Test checklist (what to try on each device)
- [ ] Create vault, lock/unlock, wrong-password delay, recovery key unlock
- [ ] Add login / note / card with an image and a document; open on the other device after a sync
- [ ] Passkey: add, unlock, remove (needs HTTPS or localhost)
- [ ] Sync both ways (file and gist); edit the same item on both devices; delete on one
- [ ] Backup (file and paper QR) → restore into a fresh vault
- [ ] Installed-app mode, offline mode (airplane mode), auto-lock, clipboard clearing
- [ ] Settings → About → *Run crypto self-test* passes on every browser you use
