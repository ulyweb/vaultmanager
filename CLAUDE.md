# Working rules for Claude on VaultManager

VaultManager is a password manager. These rules come from the owner and apply to every session, every
change and every reply. They are not optional.

## The five rules

1. **Vibe coding is for features and screens.** Building UI, wording, layout, dialogs and new tools
   quickly with AI help is fine. Code that protects secrets is held to the stricter rules below.
2. **Always double-check security code.** Any change that touches a security-critical file (list below)
   gets a second, deliberate pass before it is committed: re-read the whole diff line by line, check
   what happens with wrong passwords, tampered or truncated data, empty and oversized input, and old
   data formats, and confirm no secret or key can reach logs, the network, plaintext storage or the
   DOM. Say in the reply that this second check was done and what it covered. Recommend that a person
   who knows security reviews these changes too, and never invent cryptography: use WebCrypto and the
   existing helpers in `js/crypto.js`.
3. **Never merge on failing tests.** Merge a pull request only when every check (Chromium, Firefox and
   WebKit) is green on its current head, and only when the owner asked for the merge. If a test fails,
   find the root cause and fix it, even when the failure looks unrelated or was already red on `main`.
   Never skip, disable, loosen or quarantine a test to get green.
4. **Proof, not claims.** Never tell the owner that something works, already exists, or is fixed without
   showing evidence from this session: the code that does it (file and line), and a test or command
   that was run, with its result. If something was not verified, say so plainly. "The app already does
   that" must be checked in the code before it is said.
5. **Show a test, and check the code twice.** Every change comes with a test that fails without the
   change and passes with it (run both ways and report it). Read the changed code a second time before
   committing.

## Remind the owner every time

End every reply that reports work (a code change, a commit, a pull request, a merge, a test run, or an
answer about whether something works) with a short **Rules check**: one line per rule above that applied,
saying what was done to meet it (for example: "Proof: totpFromQR in js/totp.js:62; unit test passed 61/61").
If a rule could not be met, say which one and why, before anything else.

## Security-critical files (rule 2 applies)

- `js/crypto.js`: encryption, key derivation, sealing, the vault key hierarchy
- `js/vault.js`: encrypted persistence, attachments, import / export, sync merge
- `js/sync.js`, `js/beam.js`: anything that leaves the device
- `js/passkey.js`, `js/fieldlock.js`, `js/secure-fields.js`: unlock paths and per-field passcodes
- `js/shamir.js`, `js/family.js`: password splitting and family recovery
- `js/totp.js`: 2FA secrets and codes
- `js/blobs.js`, `js/filecrypt-ui.js`: encrypted files and attachments
- `js/profiles.js`, `js/profile-ui.js`: profile creation, export and import
- `js/selftest.js`: the known-answer tests that prove the crypto is right
- `sw.js`: the offline cache (what the browser keeps and serves)

## Project facts

- No build step for the web app. After any change under `js/`, `css/` or `index.html`, run
  `npm run build:offline` and commit `offline/VaultManager-offline.html` and its `.sha256`; `npm run lint`
  fails otherwise.
- Checks: `npm run lint`, `npm run test:unit`, `npm run test:e2e` (Chromium by default;
  `VM_BROWSER=firefox` or `webkit` for the others). CI runs all three browsers on every push and PR.
- A release bumps the version in `js/version.js` (with a changelog entry), `package.json`, `sw.js`,
  `native/package.json`, `native/package-lock.json` (two places), `native/src-tauri/Cargo.toml` and
  `native/src-tauri/tauri.conf.json`.
- GitHub Pages publishes the live site from `main`, so nothing goes live until it is merged.
