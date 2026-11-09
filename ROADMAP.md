# Roadmap

## Where this is going
This repository is the **test bench**. Every feature is being proven here, in the browser, before the **final stand-alone build** for **PC and mobile** — secure, offline-capable and able to **sync between the two**. The web code is written so the same core (crypto, vault, sync, UI) can move into that build unchanged.

## Status (v0.3.0)
Done and tested: encrypted vault · generator · TOTP · vault health · QR sealing + paper backup · import / export (Bitwarden, KeePassXC, Chrome, …) · recovery key · attachments · version history · audit trail · encrypted sync (file + secret GitHub gist) · passkey unlock (WebAuthn PRF) · tabbed settings · installable offline PWA.

## Things that change when we move from "test site" to "final app"
| Topic | Test bench (GitHub Pages) | Final stand-alone build |
|---|---|---|
| **Passkeys** | Bound to the site's address (`ulyweb.github.io`); they will *not* carry over | Re-add per device. Inside a native wrapper, passkeys need extra platform setup (iOS associated domains, Android Digital Asset Links) — or we switch to the OS keystore / biometrics (Secure Enclave, Android Keystore, Windows Hello via the wrapper). *Decision point.* |
| **Storage** | Browser storage (can be evicted) — hence "Protect storage" and backups | App-private storage; far less eviction risk |
| **Sync transport** | Secret GitHub gist or `.vmsync` file | Same encrypted bundle, more transports: user-chosen cloud folder, WebDAV, or a tiny self-hosted relay. The bundle format (VMS1) does not change |
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
- [ ] Sync to a user-chosen cloud folder / WebDAV; conflict viewer for same-item edits
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
