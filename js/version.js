/* Application version, data-format versions and changelog (shown in Settings → About). */

export const APP_VERSION = '0.16.0';
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
