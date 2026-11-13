/* Application version, data-format versions and changelog (shown in Settings → About). */

export const APP_VERSION = '0.25.1';
export const APP_NAME = 'VaultManager';
export const REPO_URL = 'https://github.com/ulyweb/vaultmanager';

export const FORMATS = [
  ['Vault record', 'v1 — AES-256-GCM, wrapped master key'],
  ['QR / backup payload', 'v2 — QR Seal v2 compatible (PBKDF2-SHA256 → AES-256-GCM)'],
  ['Encrypted backup file', 'VMX1 (.vmvault) — items + optional attachments'],
  ['Whole-profile backup', 'VMP1 (.vmprofile) — items, attachments, settings, audit trail'],
  ['Sync bundle', 'VMS1 (.vmsync / gist / Beam) — items, tombstones, optional attachments'],
  ['Beam pairing code', 'BEAM1 — compressed WebRTC offer / answer, DTLS peer to peer'],
  ['Passkey wrap', 'WebAuthn PRF → HKDF-SHA256 → AES-256-GCM, bound to credential id'],
  ['Attachments at rest', 'AES-256-GCM per file, bound to vault + file id'],
];

export const CHANGELOG = [
  { v: '0.25.1', date: '2026-11-13', notes: [
    'Sign-in screen: the profile picture, name, “Use recovery key instead” link and the feature badges are now centred on the card (the picture sits above the name).',
  ] },
  { v: '0.25.0', date: '2026-11-11', notes: [
    'Browser compatibility: the full test suite now runs on Chromium (Chrome, Edge, Brave, Helium), Firefox and WebKit (Safari). Safari fixes: the blurred save bar and system menu and the select-all / no-select rules now carry the -webkit- prefixes. Beam no longer drops a connection when Firefox reports a failed ICE state before the other device has joined.',
    'A browser that is too old (no WebCrypto, IndexedDB, modules, structuredClone or CSS color-mix) now shows a clear “update your browser” message listing what is missing, instead of a blank page. The README lists browser support and what cannot be tested automatically.',
  ] },
  { v: '0.24.0', date: '2026-11-10', notes: [
    'You can now change your profile picture after creating the profile: Settings → General → Profile picture (letter, emoji or photo). The name there also updates the letter picture live. Clicking your profile at the top of the system menu opens it.',
  ] },
  { v: '0.23.1', date: '2026-11-10', notes: [
    'The offline copy now carries its version: the download link and button name it, the file is saved as VaultManager-offline_v<version>.html, and when you run it the sign-in screen, the system menu (About) and Settings say “offline copy” with the version.',
    'Explained browser storage: the limit is set by the browser, not by VaultManager, and nothing in a web page can raise it; keep an exported profile as a backup.',
  ] },
  { v: '0.23.0', date: '2026-11-10', notes: [
    'Share one item together with its attached files: Seal as QR now has “Save item + files as encrypted file” (a QR is too small for files). The recipient restores it under Import & export → Restore from backup. The dialog explains why files cannot be inside the QR itself.',
  ] },
  { v: '0.22.0', date: '2026-11-10', notes: [
    'Device & browser security check (Tools → Task manager → Security check): live detection of traces left by browser extensions in this page (injected elements and scripts, known password managers / writing assistants, replaced browser functions), a warning bar if something is clearly tampering, and plain recommendations. Browsers do not let websites list extensions, so it reports what a page can honestly see.',
    'Settings → Security now shows what is protected: everything is encrypted; only each profile’s name and picture (and harmless appearance choices) are visible on the sign-in screen.',
    'The guided tour and Help explain both.',
  ] },
  { v: '0.21.0', date: '2026-11-10', notes: [
    'Security review of all scripts (see SECURITY.md). Fixed: a crafted backup could weaken settings (auto-lock, reveal logging, generator); imported file names are cleaned; PBKDF2 limit for untrusted payloads lowered to 5,000,000; the app refuses to be framed.',
    'The unlock screen is centred, like ulyOS.',
    'Auto-hide now also works for the side bar (slides to the left edge), not only the dock.',
    'Time & date can sit on the left, middle or right of the top bar.',
    'The New button is a live icon tile with a glow ring, shine and spinning plus — not a plain “+ New”.',
  ] },
  { v: '0.20.1', date: '2026-11-10', notes: [
    'The system menu (and the phone menu) now show the current profile’s picture and name at the top; clicking it opens the profile settings.',
  ] },
  { v: '0.20.0', date: '2026-11-10', notes: [
    'System menu (click the VaultManager logo, like ulyOS): About, Keyboard shortcuts (F1), Guided tour, Settings, Task manager, Lock screen, Purge memory now, Switch profile, Contact admin and Restart. Purge memory now, Switch profile and Restart are also in the phone menu.',
    'Fixed the “QR tools sends me back to Home” glitch: after an inactivity lock you now land on the page you were on (not Home), and a click on a menu item while the unlock screen is still showing is no longer swallowed.',
    'Fixed missing icon on Undo changes.',
  ] },
  { v: '0.19.0', date: '2026-11-10', notes: [
    'The version number is shown on the create-profile and locked sign-in screens.',
    'Every file the app saves now carries the date and time in its name (…-2026-11-10_14-32-05.vmprofile / .png / .vmvault / .vmsync / .csv / .json / .txt).',
    'Wherever you seal something into a QR (Seal as QR on an item, Seal text, Backup to QR) you get the Base64 payload text with Copy and Save as .txt; Open QR has a Paste payload text button. Purge memory sits next to all of them.',
  ] },
  { v: '0.18.0', date: '2026-11-10', notes: [
    'Open QR now shows the WHOLE item as a full card (every field, notes, custom fields, tags) before you add it — before, only name, type, username and website were listed, which looked like “just the name” for items such as Crypto wallets.',
    'Seal as QR checks itself: it reads the QR back, lists exactly what is inside (and that attached files are not), and has a “Preview what a scan restores” button. Explanations added to the dialog.',
    'Backup to QR explains what is backed up, what is not and how to restore, and verifies the codes would restore every item. Open QR has a short restore guide.',
    'Mouse cursor settings like ulyOS: style (classic, dot, crosshair, neon, ring, solid, target, system), size, colour and a trailing ring (Settings → Effects).',
  ] },
  { v: '0.17.0', date: '2026-11-10', notes: [
    'Contact Admin now works like ulyOS: a form that sends your message through the same relay to the administrator (sign-in screen, Help, menu, Settings → About). Never includes passwords or vault data.',
    'The administrator is emailed when a profile is created or restored — with an on-screen disclosure and an optional contact-email field (not sent from localhost or the offline copy).',
    'Fixed: the sign-in card and the top-bar icons were not centred.',
  ] },
  { v: '0.16.0', date: '2026-11-09', notes: [
    'Side bar, dock and menu icons are now real app-style icon tiles (glossy, coloured, bigger), like the ulyOS desktop. Top-bar icons are larger too.',
    'First login: Home page, and in Categories only “Everyday” is expanded (the other groups open with one click).',
    'Export whole profile: the backup password is hidden, typed twice (or generated), with show / copy buttons. Seal-as-QR works the same way.',
    'Home widgets can be pinned to the top and resized freely: drag the corner grip or use the arrow keys; double-click resets.',
  ] },
  { v: '0.15.0', date: '2026-11-09', notes: [
    'Import & export explained: a “Which one do I need?” guide on Tools → Import & export and in Settings → General. Whole profile (.vmprofile) = profile + passwords + attachments + settings; Database backup (.vmvault) = passwords only. Whole-profile buttons now also live on the Tools page. Also in the guided tour and Help tips.',
    'QR tools: passwords are hidden and must be typed twice (with show / copy / generate), also for the QR backup and the Tools backup file. New Purge memory button wipes fields, QR codes, opened locked items and the clipboard.',
    'Task manager (Tools): processes, memory, frame rate, storage and device details, live.',
    'Hide tools and categories from the side bar, dock and menu: Settings → Dock & menu bar → Show or hide.',
    'Contact admin: set an administrator address (js/config.js or per device in Settings → About); it appears on the sign-in screen and, at profile creation, offers to email the admin the profile name (opens your mail app — never sends passwords).',
  ] },
  { v: '0.14.0', date: '2026-11-09', notes: [
    'The item passcode lock now covers attached files: file contents are sealed under a random key kept inside the passcode seal, and their names and types are hidden until you unlock the item.',
    'Items locked with 0.13 get their existing files sealed the next time you open them.',
    'The audit trail no longer remembers file names of locked items. Verified on desktop, iPhone, iPad and the single-file offline build.',
  ] },
  { v: '0.13.0', date: '2026-11-09', notes: [
    'Secondary passcode lock for any item (offered for Bank, Crypto wallet, Emergency, Secure notes and every other category): its details are encrypted again with a passcode of its own, so they stay hidden even after the vault is unlocked.',
    'Add it when creating an item, or later with “Add passcode lock”. Opened items lock again after 10 minutes or when the vault locks; wrong passcodes are throttled.',
    'Locked items never keep readable copies in history or revisions, and a sync from another device cannot bring the secrets back in the clear.',
  ] },
  { v: '0.12.0', date: '2026-11-09', notes: [
    'Every password and secret now shows its length and entropy: in QR tools, Seal-as-QR, backups and in the detail view of Bank, Crypto wallet, Emergency and Secure notes.',
    'Seal a single secret (for example a wallet’s recovery seed phrase) as its own encrypted QR with the new QR button on the field; the whole item can still be sealed too.',
    'Appearance: real NASA / public-domain photos, “Cities & lights” (Earth at night), drawn landscapes, colour gradients, your own image from this computer, or from a web address.',
    'Appearance now says that changes are saved automatically to this profile, with Undo changes and Save now.',
  ] },
  { v: '0.11.0', date: '2026-11-09', notes: [
    'Profiles: several people on one device, each with a completely separate vault, master password and picture — pick who is signing in, like ulyOS.',
    'Import a whole-profile backup (.vmprofile) right on the first screen: items, attachments, settings and audit trail come back in one step.',
    'Export whole profile… in Settings; your sync token and passkeys are deliberately left out.',
    'Download VaultManager-offline.html — one file for a USB stick, from Settings and from the sign-in screen (installing the web app is not the same thing).',
    'The colourful, animated icon style is back: duotone glyphs on vivid tiles, each with its own colour and motion (respects reduced-motion).',
  ] },
  { v: '0.10.0', date: '2026-11-09', notes: [
    'Offline apps for PC and mobile: the installable web app keeps working with no internet (tested with the network cut), a single-file copy (VaultManager-offline.html) runs straight from disk, and a Tauri project builds native Windows, macOS, Linux, Android and iOS apps from the same code.',
    'Update prompt for the installed app, a “Running as” line in About, and a native Save-as dialog for exports when running inside the native app.',
    'Native apps are set up but have not been compiled or run yet — see docs/OFFLINE-APPS.md for what is verified.',
  ] },
  { v: '0.9.0', date: '2026-11-09', notes: [
    'Tablets (700–1023 px, e.g. iPad portrait) get a persistent side menu with grouped categories and single-pane drill-down; landscape tablets and PCs get the two-pane layout; phones keep the bottom bar.',
    'App-style look on phones and tablets: large titles, inset grouped lists with disclosure chevrons, a native-style navigation bar (‹ back · Edit) on item screens, grouped field cards, bottom sheets with a grab handle you can swipe down, slide transitions, haptic taps (Android) and no tap-highlight or text-selection on controls.',
    'Installable app: PNG icons (including a maskable Android icon and the iPhone home-screen icon), standalone display, status-bar styling, an Install button and offline-status panel in Settings → General.',
    'Fixed: widgets could overflow the page on tablet widths; long generated passwords now wrap.',
  ] },
  { v: '0.8.0', date: '2026-11-09', notes: [
    'Built for phones as well as PCs: a bottom navigation bar with a centre “New” button, a More sheet that reaches every category and tool, a two-row top bar with a full-width search, bottom-sheet dialogs, scrolling settings tabs, 44-pixel touch targets and safe-area support for notched phones.',
    'One icon set everywhere: every icon is now a built-in SVG drawn identically on Windows, iPhone, Android and Mac (emoji looked different on every device). Category icons are coloured tiles that follow Settings → Appearance → Icon style.',
    'Compact welcome screen and docked tour card on small screens; toasts no longer pile up.',
    'Tested on iPhone SE, iPhone 13, Pixel 7 and iPad Mini profiles: no horizontal overflow on any screen, and the icon artwork is byte-identical to the desktop.',
  ] },
  { v: '0.7.0', date: '2026-11-09', notes: [
    '15 new categories: Contact, Phone / SIM, Technical account, Crypto wallet, Emergency numbers, Lens prescription, Membership, Internet settings, Prescription / medication, Serial number, Voter card, Picture / photo ID card, Library card, Health numbers and Car / vehicle — 28 in total.',
    'Categories are now grouped by purpose (Everyday, Accounts & access, Home & devices, Money, IDs & documents, Health, Travel & vehicles, People & emergency) in the side bar, the New picker and the Categories dialog; groups fold away.',
    'More things that expire are tracked in Vault health: car registration, insurance and service, prescriptions, lens prescriptions, memberships, library and photo-ID cards, internet contracts and warranties.',
  ] },
  { v: '0.6.0', date: '2026-11-09', notes: [
    'Welcome splash (hero, feature cards, Enter / Take the tour / Make it yours) after your first unlock, or every unlock if you switch it on.',
    'Guided spotlight tour of the real screens — works with the side bar or the dock and walks you through Home, search, categories, generator, health, QR, Beam, sync, look & feel, security, audit and lock.',
    'Help (?) button and dock item: replay the tour or welcome screen, keyboard shortcuts. Replay also from Settings → General and About.',
    'Home is now the default start page.',
    'Optional display name for greetings.',
  ] },
  { v: '0.5.0', date: '2026-11-09', notes: [
    'Conflict handling: sync now merges field by field. Edits to different fields of one item are both kept; if the same field was edited on two devices the newest wins and the other value is saved under “Needs review” (side-by-side, keep or use the other). Resolutions sync too.',
    'Appearance, Effects, Dock & menu bar and Widgets settings (modelled on ulyOS): accent colours, 12 offline wallpapers, icon styles and sizes, density, corner radius, UI size, window animation styles, animation speed, boot animation, aurora, 3D tilt, glow, CRT scanlines, glass blur and panel fill.',
    'Dock navigation (with magnify, labels, auto-hide) and a configurable menu-bar clock.',
    'Home dashboard with widgets: clock, vault health, live one-time codes, expiring soon, favorites, recent, quick generator, categories, sync status, needs review, security tip.',
    'Fixed: saving from the item editor could overwrite per-field sync timestamps.',
  ] },
  { v: '0.4.0', date: '2026-11-09', notes: [
    'New categories: Apps / software, Wi-Fi / network, Computer account, Shopping, Insurance, Locker / combination, Travel, ID / identity, Bank account and Server / API key — each with its own fields.',
    'Custom fields (label, value, optional secret) on every item, in every category.',
    'Wi-Fi QR for guests, and “expiring soon / expired” checks for passports, licences, policies and renewals in Vault health.',
    'Attachments: Add images / documents / take a photo straight from the item view, in every category.',
    'Beam sync: pair two devices by QR or code and merge both vaults peer to peer (the ulyOS Beam engine) — no cloud, no account, verified by a shared 6-digit number.',
  ] },
  { v: '0.3.0', date: '2026-11-09', notes: [
    'Passkey unlock: fingerprint, face, Windows Hello, phone or security key (WebAuthn PRF). Per device; the master password always remains as the fallback.',
    'Passkeys are added and removed in Settings → Security (re-confirming the master password) and recorded in the audit trail.',
  ] },
  { v: '0.2.0', date: '2026-11-09', notes: [
    'Encrypted sync: export / import a .vmsync file, or sync through a secret GitHub gist (your token and sync passphrase stay in the encrypted vault).',
    'Attachments on logins, secure notes and cards: images (with preview) and documents, encrypted per file.',
    'Settings reorganised into General, Security, Sync, Audit trail and About.',
    'Audit trail: an encrypted log of security-relevant events (sign-ins, edits, exports, sync). It never contains passwords or other secrets.',
    'Version history for every item, with one-click restore.',
    'Backups can include attachments.',
  ] },
  { v: '0.1.0', date: '2026-11-09', notes: [
    'First release: encrypted vault, generator, TOTP, vault health, QR sealing and paper backup, import / export, recovery key, offline PWA.',
  ] },
];
