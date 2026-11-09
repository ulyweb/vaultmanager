/* Application version, data-format versions and changelog (shown in Settings → About). */

export const APP_VERSION = '0.4.0';
export const APP_NAME = 'VaultManager';
export const REPO_URL = 'https://github.com/ulyweb/vaultmanager';

export const FORMATS = [
  ['Vault record', 'v1 — AES-256-GCM, wrapped master key'],
  ['QR / backup payload', 'v2 — QR Seal v2 compatible (PBKDF2-SHA256 → AES-256-GCM)'],
  ['Encrypted backup file', 'VMX1 (.vmvault) — items + optional attachments'],
  ['Sync bundle', 'VMS1 (.vmsync / gist / Beam) — items, tombstones, optional attachments'],
  ['Beam pairing code', 'BEAM1 — compressed WebRTC offer / answer, DTLS peer to peer'],
  ['Passkey wrap', 'WebAuthn PRF → HKDF-SHA256 → AES-256-GCM, bound to credential id'],
  ['Attachments at rest', 'AES-256-GCM per file, bound to vault + file id'],
];

export const CHANGELOG = [
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
