# VaultManager offline apps — PC and mobile

VaultManager never needs the internet to open, edit or search your vault: everything is stored encrypted on the device. "Offline app" therefore means *a way to run it without a web server*. There are three, from easiest to most native.

| | What you get | Works on | Status |
|---|---|---|---|
| **A. Installed web app (PWA)** | An app icon, its own window, runs with no internet after the first visit | Windows / Mac / Linux (Chrome, Edge), Android (Chrome), iPhone / iPad (Safari) | **Built and tested** (browser tests cut the network and the app keeps working) |
| **B. Single-file copy** | `VaultManager-offline.html` — the whole app in one file you can keep on a USB stick or e-mail yourself | Any modern browser on PC; Android; (iOS is awkward — use A) | **Built and tested** (opened from `file://`) |
| **C. Native installers** | Real installable apps: `.msi` / `.exe`, `.dmg`, `.deb` / `.AppImage`, Android `.apk`, iOS `.ipa` | Windows, macOS, Linux, Android, iOS | **Project and automated build are set up; not yet built or run** (see "What is verified" below) |

> **Your vault does not move by itself between these.** Each one (and each browser) keeps its own copy in its own private storage. To bring a vault to another app or device use **Settings → Sync** (Beam, file or gist) or **Import & export → encrypted backup**. The formats are identical everywhere.

---

## A. Install the web app (works offline)

1. Open VaultManager in the browser **once, with internet**, and let it finish loading (Settings → General → *Install as an app & work offline* shows "✓ Ready to work offline").
2. Install it:
   - **Windows / Mac / Linux (Chrome or Edge):** click the install icon in the address bar, or menu → *Install VaultManager*. Or press **Settings → General → Install VaultManager**.
   - **Android (Chrome):** menu ⋮ → *Install app* (or *Add to Home screen*).
   - **iPhone / iPad (Safari):** Share button → **Add to Home Screen**. *Do this rather than leaving it in a Safari tab: Safari may clear a website's stored data after about a week without use, but not for apps on the Home Screen.*
3. Open it from your app list / home screen. Turn on airplane mode to prove it works.

New versions: when you are online the app notices an update and shows "A new version is ready — tap here to reload". *Settings → About → Refresh app files* forces it.

Always keep an **encrypted backup** (Import & export). Any browser can clear site data.

## B. The single-file copy

Build it (or take it from a release):

```bash
npm install
npm run build:offline        # → offline/VaultManager-offline.html  (+ .sha256)
```

- Double-click the file; it opens in your browser and works with no internet and no server.
- Check the download: `sha256sum -c VaultManager-offline.html.sha256` (Windows: `certutil -hashfile VaultManager-offline.html SHA256`).
- Security: the file contains **all** code. Its Content-Security-Policy allows only its own two inline blocks (by SHA-256 hash) and — for the optional gist sync — `api.github.com`. Nothing else can load or be contacted.
- Caveats: browsers store `file://` data per browser (and some per file location) — keep the file in one place and keep backups. A single file cannot be "installed" or use a service worker; passkeys are not available from `file://`.

## C. Native apps (Tauri 2)

The `native/` folder is a small Rust shell that hosts the same web app in the system WebView. It adds one native feature — the system **Save as…** dialog, so backups and attachment downloads work reliably on phones — and nothing else (see `native/src-tauri/capabilities/default.json`).

### Easiest: let GitHub build them
1. Push to GitHub, open **Actions → native-apps → Run workflow** (or push a tag like `v0.10.0`).
2. When it finishes, download the artifacts: `VaultManager-windows`, `VaultManager-macos-apple-silicon`, `VaultManager-macos-intel`, `VaultManager-linux`, `VaultManager-android`.
3. Install: run the `.msi` / `.exe`; open the `.dmg`; `sudo dpkg -i` the `.deb` or run the `.AppImage`; on Android allow "install unknown apps" and open the `.apk`.

*Unsigned apps:* Windows SmartScreen and macOS Gatekeeper will warn about an unknown publisher (right-click → Open on macOS; "More info → Run anyway" on Windows). Removing the warnings needs a code-signing certificate (Windows) and an Apple Developer account (macOS notarisation) — see "Signing".

### Build on your own computer
Prerequisites: [Rust](https://rustup.rs), Node 22, and the [Tauri system prerequisites](https://tauri.app/start/prerequisites/) for your OS (Windows: WebView2 + MSVC build tools; Linux: `libwebkit2gtk-4.1-dev` etc.; macOS: Xcode command-line tools).

```bash
npm install && cd native && npm install
npm run dev          # opens the desktop app with the current code
npm run build        # installers → native/src-tauri/target/release/bundle/
```

**Android** (also needs JDK 17, Android SDK + NDK, `ANDROID_HOME`, `NDK_HOME`):
```bash
npm run android:init        # once
# add the camera permission to native/src-tauri/gen/android/app/src/main/AndroidManifest.xml (the CI job shows the one-line sed)
npm run android:build -- --apk --debug
```
**iOS** (needs a Mac, Xcode and an Apple Developer account):
```bash
npm run ios:init && npm run ios:build
```

### Signing and stores
- **Android**: the CI APK is *debug-signed* (fine for your own devices). For the Play Store or stable in-place updates create a keystore (`keytool -genkey …`), keep it safe, and sign with it.
- **iOS**: an `.ipa` can only be installed through TestFlight / the App Store / your own provisioned devices. Apple asks export-compliance questions about encryption when you submit — answering them is the publisher's responsibility.
- **Windows / macOS**: certificates and notarisation as above.

### What is verified — and what is not
Verified here (automated tests, every change): the web app itself, the offline behaviour of A and B, the Tauri configuration files parse, the Cargo manifest is valid, icons for every platform are generated.
**Not verified:** the native binaries. The environment this was written in has no WebKit, Android SDK or Apple toolchain, so nobody has compiled or run the native apps yet. Expect to fix small things on the first CI run (e.g. a Tauri version detail). In particular please test on a real device:
- **Camera / QR scanning** inside the WebView (permissions are set up but untested).
- **Saving files** through the native dialog.
- **Passkeys**: WebAuthn inside a WebView depends on the OS (Windows WebView2 supports it; macOS / iOS / Android WebViews need platform setup). If unavailable, the master password always works.
- **Storage location and backup**: the vault lives in the app's private WebView storage. Back it up.

### Roadmap for native
Move the security core (key derivation, vault, merge) into the Rust crate with Argon2id and memory zeroisation, store the wrapping key in the OS keystore (Windows Hello / Secure Enclave / Android Keystore), add autofill services. The data formats stay the same, so nothing has to be re-exported.

## The one-file copy for a USB stick

`offline/VaultManager-offline.html` is committed to the repository and is also offered as a download:

* Settings → General → **Keep one file on a USB stick** → *Download VaultManager-offline.html* (the button also appears on the sign-in screen).
* Or download the file directly from GitHub.

Open it by double-clicking; it runs from `file://` with no server and no network. Its SHA-256 is shown after the download and stored in `VaultManager-offline.html.sha256`.

Note: browser **"Install app"** (PWA) is a different thing — it creates a browser profile, an app id and an app URL, not a file. Use the download button for the file.

## Profiles

Every person on a device gets their own profile (own master password, own vault). The sign-in screen lists them; **Import a profile backup** restores a whole `.vmprofile` (items, attachments, settings, audit) on the very first screen.
