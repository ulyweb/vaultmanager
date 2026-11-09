/* Vault data layer: encrypted persistence, items, health report, import / export.
   Everything here is DOM-free so it can be unit-tested in Node. */

import { createVault, openVault, sealText, openText, ITER_DEFAULT } from './crypto.js';
import { uid, hostOf } from './util.js';
import { estimate } from './strength.js';
import { parseTotp } from './totp.js';

export const TYPES = { login: 'Login', note: 'Secure note', card: 'Payment card' };
export const KEY = 'vaultmanager.vault';
const FAIL_KEY = 'vaultmanager.fails';
const TRASH_DAYS = 30, HISTORY_MAX = 10;
export const OLD_DAYS = 365;

export const DEFAULT_SETTINGS = { autolock: 5, clipboard: 30, theme: 'auto', lockOnHide: false, gen: { mode: 'password', length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false, words: 5, separator: '-', capitalize: false, number: false } };

export function newItem(type = 'login', init = {}) {
  const now = Date.now();
  return {
    id: uid(), type, name: '', username: '', password: '', url: '', totp: '', notes: '', tags: [], favorite: false,
    card: { holder: '', number: '', expiry: '', cvv: '', pin: '' },
    history: [], created: now, updated: now, pwChanged: now, deleted: 0, ...init,
  };
}

export class VaultStore {
  constructor(storage, key = KEY) {
    this.storage = storage; this.key = key;
    this.session = null; this.data = null; this.chain = Promise.resolve();
  }

  exists() { return !!this.storage.getItem(this.key); }
  get unlocked() { return !!this.session; }
  get items() { return this.data.items; }
  get settings() { return this.data.settings; }

  /* ----- unlock throttling (a courtesy against typos / casual guessing; real protection is PBKDF2) ----- */
  failState() { try { return JSON.parse(this.storage.getItem(FAIL_KEY)) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } }
  delayLeft() { return Math.max(0, this.failState().until - Date.now()); }
  _fail() { const s = this.failState(); s.n++; s.until = s.n >= 3 ? Date.now() + Math.min(300, 2 ** (s.n - 2)) * 1000 : 0; this.storage.setItem(FAIL_KEY, JSON.stringify(s)); }
  _clearFails() { this.storage.removeItem(FAIL_KEY); }

  async create(password, opt = {}) {
    const data = { v: 1, created: Date.now(), items: [], settings: structuredClone(DEFAULT_SETTINGS) };
    const { session, record } = await createVault(password, data, opt);
    this.session = session; this.data = data;
    this.storage.setItem(this.key, JSON.stringify(record));
    this._clearFails();
  }

  /* secret: { password } | { recovery }. Throws Error('bad-secret' | 'locked-out' | message). */
  async unlock(secret) {
    if (this.delayLeft() > 0) throw new Error('locked-out');
    const raw = this.storage.getItem(this.key);
    if (!raw) throw new Error('There is no vault on this device yet.');
    let record;
    try { record = JSON.parse(raw); } catch { throw new Error('The stored vault looks corrupted.'); }
    let opened;
    try { opened = await openVault(record, secret); } catch (e) { if (e.message === 'bad-secret') this._fail(); throw e; }
    this._clearFails();
    this.session = opened.session; this.data = opened.data;
    this.data.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(this.data.settings || {}) };
    this.data.settings.gen = { ...DEFAULT_SETTINGS.gen, ...(this.data.settings.gen || {}) };
    this._purgeTrash();
  }

  lock() {
    if (this.session) this.session.lock();
    this.session = null; this.data = null;
  }

  /* Serialised, atomic-ish write: previous record is kept as a .bak until the next successful write. */
  save() {
    if (!this.session) return Promise.resolve();
    this.chain = this.chain.then(async () => {
      if (!this.session) return;
      const record = await this.session.seal(this.data);
      const prev = this.storage.getItem(this.key);
      if (prev) { try { this.storage.setItem(this.key + '.bak', prev); } catch { /* quota: skip the backup copy */ } }
      this.storage.setItem(this.key, JSON.stringify(record));
    }).catch((e) => { this.lastError = e; throw e; });
    return this.chain;
  }

  /* ----- items ----- */
  get(id) { return this.data.items.find((i) => i.id === id); }

  add(item) { this.data.items.push(item); return this.save(); }

  update(id, patch) {
    const it = this.get(id);
    if (!it) return Promise.resolve();
    if (patch.password !== undefined && patch.password !== it.password) {
      if (it.password) it.history = [{ pw: it.password, at: it.pwChanged || it.updated }, ...(it.history || [])].slice(0, HISTORY_MAX);
      it.pwChanged = Date.now();
    }
    Object.assign(it, patch, { updated: Date.now() });
    return this.save();
  }

  trash(id) { const it = this.get(id); if (it) { it.deleted = Date.now(); it.updated = Date.now(); } return this.save(); }
  restore(id) { const it = this.get(id); if (it) { it.deleted = 0; it.updated = Date.now(); } return this.save(); }
  purge(id) { this.data.items = this.data.items.filter((i) => i.id !== id); return this.save(); }
  emptyTrash() { this.data.items = this.data.items.filter((i) => !i.deleted); return this.save(); }
  _purgeTrash() { const cut = Date.now() - TRASH_DAYS * 864e5; const n = this.data.items.length; this.data.items = this.data.items.filter((i) => !i.deleted || i.deleted > cut); return n !== this.data.items.length; }

  active() { return this.data.items.filter((i) => !i.deleted); }
  trashed() { return this.data.items.filter((i) => i.deleted); }
  tags() { const m = new Map(); for (const i of this.active()) for (const t of i.tags || []) m.set(t, (m.get(t) || 0) + 1); return [...m].sort((a, b) => a[0].localeCompare(b[0])); }

  async changePassword(oldPassword, newPassword) {
    if (!(await this.session.verifyPassword(oldPassword))) throw new Error('Current password is wrong.');
    await this.session.changePassword(newPassword);
    return this.save();
  }

  async wipe() {
    this.lock();
    this.storage.removeItem(this.key); this.storage.removeItem(this.key + '.bak'); this.storage.removeItem(FAIL_KEY);
  }

  /* ----- backups ----- */
  async exportEncrypted(password, opt = {}) {
    const body = JSON.stringify({ format: 'VaultManager-export', v: 1, exported: Date.now(), items: this.active() });
    return 'VMX1:' + (await sealText(body, password, opt));
  }

  /* Returns { added, skipped }. Items whose name+username+url+password match an existing one are skipped. */
  mergeItems(items) {
    const sig = (i) => [i.type, i.name, i.username, i.url, i.password, i.notes].join('\u0001');
    const have = new Set(this.active().map(sig));
    let added = 0, skipped = 0;
    for (const raw of items) {
      const it = newItem(raw.type || 'login', { ...raw, id: uid(), deleted: 0 });
      if (have.has(sig(it))) { skipped++; continue; }
      have.add(sig(it)); this.data.items.push(it); added++;
    }
    return { added, skipped, save: this.save() };
  }
}

export async function decryptBackup(text, password) {
  const t = String(text).trim();
  if (!t.startsWith('VMX1:')) throw new Error('This is not a VaultManager backup (it should start with VMX1:).');
  const j = JSON.parse(await openText(t.slice(5), password));
  if (j.format !== 'VaultManager-export' || !Array.isArray(j.items)) throw new Error('Unrecognised backup contents.');
  return j.items.map(sanitiseItem);
}

/* Coerce untrusted import data into the item shape (defends against odd types in a hand-edited file). */
export function sanitiseItem(r) {
  const s = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
  const type = ['login', 'note', 'card'].includes(r.type) ? r.type : 'login';
  const c = r.card && typeof r.card === 'object' ? r.card : {};
  const it = newItem(type, {
    name: s(r.name, 300), username: s(r.username, 500), password: s(r.password, 2000), url: s(r.url, 2000), totp: s(r.totp, 1000), notes: s(r.notes, 50000),
    tags: Array.isArray(r.tags) ? r.tags.map((t) => s(t, 50)).filter(Boolean).slice(0, 30) : [], favorite: !!r.favorite,
    card: { holder: s(c.holder, 200), number: s(c.number, 40), expiry: s(c.expiry, 10), cvv: s(c.cvv, 10), pin: s(c.pin, 20) },
  });
  if (Number.isFinite(r.created)) it.created = r.created;
  if (Number.isFinite(r.pwChanged)) it.pwChanged = r.pwChanged;
  if (Array.isArray(r.history)) it.history = r.history.filter((h) => h && typeof h.pw === 'string').slice(0, HISTORY_MAX).map((h) => ({ pw: s(h.pw, 2000), at: Number(h.at) || 0 }));
  return it;
}

/* ---------- CSV (RFC 4180) ---------- */
export function parseCSV(text) {
  const rows = [];
  let row = [], f = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* Spreadsheet formula injection guard for exports: prefix cells that would be evaluated.
   Not applied to the password / TOTP columns, where a leading quote would corrupt the secret. */
const csvCell = (v, guard = true) => {
  let s = v == null ? '' : String(v);
  if (guard && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const ALIAS = {
  name: ['name', 'title', 'account', 'site', 'login_name'],
  url: ['url', 'login_uri', 'website', 'web site', 'uri', 'address'],
  username: ['username', 'login_username', 'user name', 'login', 'user', 'email'],
  password: ['password', 'login_password', 'pass'],
  notes: ['notes', 'note', 'extra', 'comments'],
  totp: ['totp', 'login_totp', 'otpauth', 'one-time password', 'otp'],
  folder: ['folder', 'group', 'grouping', 'tags'],
  favorite: ['favorite', 'fav'],
  type: ['type'],
};

/* Chrome / Edge / Firefox, Bitwarden, KeePass(XC), 1Password, LastPass and generic CSV exports. */
export function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The CSV file is empty.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(ALIAS)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; }
  if (col.password === undefined && col.notes === undefined) throw new Error('No password or notes column found. Expected headers like name, url, username, password.');
  const out = [];
  for (const r of rows.slice(1)) {
    const unguard = (v) => v.replace(/^'(?=[=+\-@])/, '');
    const g = (k) => (col[k] === undefined ? '' : (r[col[k]] || '').trim());
    const type = g('type').toLowerCase();
    const it = {
      type: type === 'note' || type === 'securenote' ? 'note' : type === 'card' ? 'card' : 'login',
      name: unguard(g('name')) || hostOf(g('url')) || '(unnamed)', url: unguard(g('url')), username: unguard(g('username')), password: r[col.password] || '',
      notes: unguard((col.notes !== undefined ? r[col.notes] : '') || ''), totp: g('totp'), tags: g('folder') ? [g('folder')] : [],
      favorite: ['1', 'true', 'yes'].includes(g('favorite').toLowerCase()),
    };
    if (!it.password && !it.username && !it.notes && !it.url) continue;
    out.push(sanitiseItem(it));
  }
  return out;
}

/* Bitwarden JSON export (unencrypted). */
export function importBitwardenJSON(text) {
  const j = JSON.parse(text);
  if (j.encrypted) throw new Error('This Bitwarden export is encrypted. Export it as unencrypted JSON (or CSV) instead.');
  if (!Array.isArray(j.items)) throw new Error('No items found in this JSON file.');
  const folders = new Map((j.folders || []).map((f) => [f.id, f.name]));
  return j.items.map((b) => {
    const l = b.login || {}, c = b.card || {};
    const type = b.type === 2 ? 'note' : b.type === 3 ? 'card' : 'login';
    return sanitiseItem({
      type, name: b.name, notes: b.notes, favorite: b.favorite, tags: b.folderId && folders.get(b.folderId) ? [folders.get(b.folderId)] : [],
      username: l.username, password: l.password, totp: l.totp, url: (l.uris && l.uris[0] && l.uris[0].uri) || '',
      card: { holder: c.cardholderName, number: c.number, expiry: [c.expMonth, c.expYear].filter(Boolean).join('/'), cvv: c.code },
    });
  });
}

export function importAny(text, filename = '') {
  const t = String(text).trim();
  if (t.startsWith('{')) return importBitwardenJSON(t);
  if (/\.json$/i.test(filename)) return importBitwardenJSON(t);
  return importCSV(t);
}

/* Bitwarden-compatible CSV (plaintext!). */
export function exportCSV(items) {
  const head = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp'];
  const lines = [head.join(',')];
  for (const i of items) {
    const notes = i.type === 'card' ? [i.notes, 'Card holder: ' + i.card.holder, 'Number: ' + i.card.number, 'Expiry: ' + i.card.expiry, 'CVV: ' + i.card.cvv].filter(Boolean).join('\n') : i.notes;
    lines.push([ (i.tags || [])[0] || '', i.favorite ? 1 : '', i.type === 'note' ? 'note' : 'login', i.name, notes, '', 0, i.url, i.username, i.password, i.totp ].map((v, n) => csvCell(v, n !== 9 && n !== 10)).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/* ---------- search ---------- */
export function matches(item, q) {
  if (!q) return true;
  const hay = [item.name, item.username, item.url, item.notes, (item.tags || []).join(' ')].join('\n').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/* ---------- vault health ---------- */
export function health(items, now = Date.now()) {
  const logins = items.filter((i) => !i.deleted && i.type === 'login');
  const weak = [], old = [], insecure = [], missing = [];
  const byPw = new Map();
  for (const i of logins) {
    if (!i.password) { missing.push(i); continue; }
    const e = estimate(i.password);
    if (e.score <= 1) weak.push({ item: i, est: e });
    if (now - (i.pwChanged || i.updated || i.created) > OLD_DAYS * 864e5) old.push(i);
    if (/^http:\/\//i.test(i.url || '')) insecure.push(i);
    (byPw.get(i.password) || byPw.set(i.password, []).get(i.password)).push(i);
  }
  const reused = [...byPw.values()].filter((g) => g.length > 1);
  const reusedCount = reused.reduce((n, g) => n + g.length, 0);
  const n = logins.length - missing.length;
  const penalty = n ? (weak.length * 2 + reusedCount * 2 + old.length * 0.5 + insecure.length) / n : 0;
  const score = n ? Math.max(0, Math.round(100 - Math.min(1, penalty / 2) * 100)) : 100;
  return { weak, old, insecure, missing, reused, score, total: logins.length };
}

export function totpValid(s) { try { parseTotp(s); return true; } catch { return false; } }
export { ITER_DEFAULT };
