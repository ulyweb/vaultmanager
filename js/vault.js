/* Vault data layer: encrypted persistence, items, attachments, audit trail, sync merge, health,
   import / export. DOM-free so it can be unit-tested in Node. */

import { createVault, openVault, sealText, openText, ITER_DEFAULT } from './crypto.js';
import { uid, hostOf, b64, debounce } from './util.js';
import { estimate } from './strength.js';
import { parseTotp } from './totp.js';
import { memoryBlobs } from './blobs.js';
import { APP_VERSION } from './version.js';

export const TYPES = { login: 'Login', note: 'Secure note', card: 'Payment card' };
export const KEY = 'vaultmanager.vault';
const FAIL_KEY = 'vaultmanager.fails';
const HISTORY_MAX = 10, REVISIONS_MAX = 10, AUDIT_MAX = 1000, TOMBSTONE_DAYS = 90;
export const OLD_DAYS = 365;
export const MAX_ATTACHMENT = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ITEM = 20;
export const TRACKED = ['name', 'username', 'url', 'password', 'totp', 'notes', 'tags', 'card'];

export const DEFAULT_SETTINGS = {
  autolock: 5, clipboard: 30, theme: 'auto', lockOnHide: false, trashDays: 30, logReveal: true,
  gen: { mode: 'password', length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false, words: 5, separator: '-', capitalize: false, number: false },
  sync: { method: 'off', token: '', gistId: '', passphrase: '', auto: true, attachments: true, last: null },
};

export function newItem(type = 'login', init = {}) {
  const now = Date.now();
  return {
    id: uid(), type, name: '', username: '', password: '', url: '', totp: '', notes: '', tags: [], favorite: false,
    card: { holder: '', number: '', expiry: '', cvv: '', pin: '' }, attachments: [], revisions: [],
    history: [], created: now, updated: now, pwChanged: now, deleted: 0, ...init,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class VaultStore {
  constructor(storage, key = KEY, blobs = memoryBlobs()) {
    this.storage = storage; this.key = key; this.blobs = blobs;
    this.session = null; this.data = null; this.chain = Promise.resolve();
    this.onSaved = null; this._auditDirty = false;
    this._auditSave = debounce(() => { if (this._auditDirty && this.session) { this._auditDirty = false; this.save().catch(() => {}); } }, 1500);
  }

  exists() { return !!this.storage.getItem(this.key); }
  get unlocked() { return !!this.session; }
  get items() { return this.data.items; }
  get settings() { return this.data.settings; }

  /* ----- unlock throttling (a courtesy against typos / casual guessing; real protection is PBKDF2) ----- */
  failState() { try { return JSON.parse(this.storage.getItem(FAIL_KEY)) || { n: 0, until: 0, times: [] }; } catch { return { n: 0, until: 0, times: [] }; } }
  delayLeft() { return Math.max(0, this.failState().until - Date.now()); }
  _fail() {
    const s = this.failState(); s.n++; s.times = [...(s.times || []), Date.now()].slice(-20);
    s.until = s.n >= 3 ? Date.now() + Math.min(300, 2 ** (s.n - 2)) * 1000 : 0;
    this.storage.setItem(FAIL_KEY, JSON.stringify(s));
  }
  _clearFails() { this.storage.removeItem(FAIL_KEY); }

  _prepare(data) {
    data.items = data.items || [];
    data.audit = Array.isArray(data.audit) ? data.audit : [];
    data.tombstones = data.tombstones && typeof data.tombstones === 'object' ? data.tombstones : {};
    data.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(data.settings || {}) };
    data.settings.gen = { ...DEFAULT_SETTINGS.gen, ...(data.settings.gen || {}) };
    data.settings.sync = { ...DEFAULT_SETTINGS.sync, ...(data.settings.sync || {}) };
    for (const i of data.items) { i.attachments = i.attachments || []; i.revisions = i.revisions || []; i.history = i.history || []; }
    return data;
  }

  async create(password, opt = {}) {
    const data = this._prepare({ v: 1, created: Date.now(), items: [] });
    const { session, record } = await createVault(password, data, opt);
    this.session = session; this.data = data;
    this.storage.setItem(this.key, JSON.stringify(record));
    this._clearFails();
    this.log('security', 'Vault created on this device (AES-256-GCM, PBKDF2-SHA256 ' + session.iterations().toLocaleString('en-US') + ' rounds)');
    await this.save();
  }

  /* secret: { password } | { recovery }. Throws Error('bad-secret' | 'locked-out' | message). */
  async unlock(secret) {
    if (!secret.passkey && this.delayLeft() > 0) throw new Error('locked-out');   // a passkey needs the authenticator + user verification, so it is not throttled
    const raw = this.storage.getItem(this.key);
    if (!raw) throw new Error('There is no vault on this device yet.');
    let record;
    try { record = JSON.parse(raw); } catch { throw new Error('The stored vault looks corrupted.'); }
    let opened;
    try { opened = await openVault(record, secret); } catch (e) { if (e.message === 'bad-secret') this._fail(); throw e; }
    const fails = this.failState();
    this._clearFails();
    this.session = opened.session; this.data = this._prepare(opened.data);
    if (fails.times && fails.times.length) this.log('security', `${fails.times.length} failed unlock attempt${fails.times.length > 1 ? 's' : ''} before this sign-in (latest ${new Date(fails.times[fails.times.length - 1]).toISOString().replace('T', ' ').slice(0, 19)} UTC)`, 'warn');
    this.log('security', 'Vault unlocked with ' + (secret.recovery ? 'the recovery key' : secret.passkey ? 'a passkey' : 'the master password'), secret.recovery ? 'warn' : 'info');
    this._purgeTrash();
    await this._gcBlobs();
  }

  lock() {
    const s = this.session;
    if (!s) return;
    this._auditSave.cancel();
    if (this._auditDirty) { this._auditDirty = false; this.save().catch(() => {}); }
    this.session = null; this.data = null;
    this.chain = this.chain.then(() => s.lock(), () => s.lock());
  }

  /* Serialised, atomic-ish write: previous record is kept as a .bak until the next successful write. */
  save() {
    const s = this.session, d = this.data;
    if (!s) return Promise.resolve();
    this.chain = this.chain.then(async () => {
      const record = await s.seal(d);
      const prev = this.storage.getItem(this.key);
      if (prev) { try { this.storage.setItem(this.key + '.bak', prev); } catch { /* quota: skip the backup copy */ } }
      this.storage.setItem(this.key, JSON.stringify(record));
      if (this.onSaved) { try { this.onSaved(); } catch { /* ignore */ } }
    }).catch((e) => { this.lastError = e; throw e; });
    return this.chain;
  }

  /* ----- audit trail (inside the encrypted vault; never contains secret values) ----- */
  log(kind, message, level = 'info') {
    if (!this.data) return;
    this.data.audit.unshift({ t: Date.now(), k: kind, m: String(message).slice(0, 300), l: level });
    if (this.data.audit.length > AUDIT_MAX) this.data.audit.length = AUDIT_MAX;
    this._auditDirty = true; this._auditSave();
  }
  auditLog() { return this.data ? this.data.audit : []; }
  clearAudit() { this.data.audit = []; this.log('security', 'Audit trail cleared by the user', 'warn'); return this.save(); }

  /* ----- items ----- */
  get(id) { return this.data.items.find((i) => i.id === id); }

  add(item) { this.data.items.push(item); this.log('item', 'Created ' + item.type + ' “' + item.name + '”'); return this.save(); }

  update(id, patch) {
    const it = this.get(id);
    if (!it) return Promise.resolve();
    const changed = TRACKED.filter((k) => patch[k] !== undefined && !same(patch[k], it[k]));
    if (changed.length) {
      const snap = {}; for (const k of TRACKED) snap[k] = structuredClone(it[k]);
      it.revisions = [{ at: it.updated, changed, snap }, ...(it.revisions || [])].slice(0, REVISIONS_MAX);
    }
    if (patch.password !== undefined && patch.password !== it.password) {
      if (it.password) it.history = [{ pw: it.password, at: it.pwChanged || it.updated }, ...(it.history || [])].slice(0, HISTORY_MAX);
      it.pwChanged = Date.now();
    }
    Object.assign(it, patch, { updated: Date.now() });
    if (changed.length) this.log('item', 'Edited “' + it.name + '” (' + changed.join(', ') + ')');
    return this.save();
  }

  /* Put an earlier revision's field values back (recorded as a new revision, so it can be undone). */
  restoreRevision(id, index) {
    const it = this.get(id), rev = it && it.revisions[index];
    if (!rev) return Promise.resolve();
    this.log('item', 'Restored an earlier version of “' + it.name + '”');
    return this.update(id, structuredClone(rev.snap));
  }

  trash(id) { const it = this.get(id); if (it) { it.deleted = Date.now(); it.updated = Date.now(); this.log('item', 'Moved “' + it.name + '” to trash'); } return this.save(); }
  restore(id) { const it = this.get(id); if (it) { it.deleted = 0; it.updated = Date.now(); this.log('item', 'Restored “' + it.name + '” from trash'); } return this.save(); }

  async _drop(items) {
    for (const it of items) { this.data.tombstones[it.id] = Date.now(); for (const a of it.attachments || []) await this.blobs.del(this._bk(a.id)); }
    const ids = new Set(items.map((i) => i.id));
    this.data.items = this.data.items.filter((i) => !ids.has(i.id));
  }
  async purge(id) { const it = this.get(id); if (it) { this.log('item', 'Permanently deleted “' + it.name + '”', 'warn'); await this._drop([it]); } return this.save(); }
  async emptyTrash() { const t = this.trashed(); if (t.length) this.log('item', 'Emptied trash (' + t.length + ' item' + (t.length > 1 ? 's' : '') + ')', 'warn'); await this._drop(t); return this.save(); }
  _purgeTrash() {
    const days = this.settings.trashDays;
    if (!days) return false;
    const cut = Date.now() - days * 864e5;
    const old = this.data.items.filter((i) => i.deleted && i.deleted <= cut);
    if (!old.length) return false;
    this._pendingDrop = old; this.log('item', 'Auto-purged ' + old.length + ' item(s) older than ' + days + ' days in trash');
    return true;
  }

  active() { return this.data.items.filter((i) => !i.deleted); }
  trashed() { return this.data.items.filter((i) => i.deleted); }
  tags() { const m = new Map(); for (const i of this.active()) for (const t of i.tags || []) m.set(t, (m.get(t) || 0) + 1); return [...m].sort((a, b) => a[0].localeCompare(b[0])); }

  async changePassword(oldPassword, newPassword) {
    if (!(await this.session.verifyPassword(oldPassword))) throw new Error('Current password is wrong.');
    await this.session.changePassword(newPassword);
    this.log('security', 'Master password changed (new salt, master key re-wrapped)', 'warn');
    return this.save();
  }

  /* passkey wraps live in the vault record (not in synced data), so passkeys are per device */
  hasPasskeys() { try { const r = JSON.parse(this.storage.getItem(this.key)); return !!(r && r.wraps.some((w) => w.type === 'passkey')); } catch { return false; } }
  passkeyWraps() { try { return JSON.parse(this.storage.getItem(this.key)).wraps.filter((w) => w.type === 'passkey'); } catch { return []; } }

  async wipe() {
    const s = this.session;
    if (s) { const keys = await this.blobs.keys(); for (const k of keys) if (k.startsWith(s.id + ':')) await this.blobs.del(k); }
    this.lock();
    this.storage.removeItem(this.key); this.storage.removeItem(this.key + '.bak'); this.storage.removeItem(FAIL_KEY);
  }

  /* ----- attachments (encrypted per file, stored in IndexedDB) ----- */
  _bk(attId) { return this.session.id + ':' + attId; }

  async addAttachment(itemId, { name, type, bytes }) {
    const it = this.get(itemId);
    if (!it) throw new Error('Item not found.');
    if (bytes.length > MAX_ATTACHMENT) throw new Error(`“${name}” is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT / 1048576} MB per file.`);
    if (it.attachments.length >= MAX_ATTACHMENTS_PER_ITEM) throw new Error('An item can hold at most ' + MAX_ATTACHMENTS_PER_ITEM + ' attachments.');
    const att = { id: uid(), name: String(name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200), type: String(type || 'application/octet-stream').slice(0, 100), size: bytes.length, added: Date.now() };
    await this.blobs.put(this._bk(att.id), await this.session.sealBlob(att.id, bytes));
    it.attachments.push(att); it.updated = Date.now();
    this.log('item', `Attached “${att.name}” (${Math.ceil(att.size / 1024)} KB) to “${it.name}”`);
    await this.save();
    return att;
  }

  async readAttachment(itemId, attId) {
    const it = this.get(itemId), meta = it && it.attachments.find((a) => a.id === attId);
    if (!meta) throw new Error('Attachment not found.');
    const rec = await this.blobs.get(this._bk(attId));
    if (!rec) throw new Error('This attachment is not available on this device (it was not included in the sync or backup).');
    return { meta, bytes: await this.session.openBlob(attId, rec) };
  }

  async removeAttachment(itemId, attId) {
    const it = this.get(itemId);
    if (!it) return;
    const meta = it.attachments.find((a) => a.id === attId);
    it.attachments = it.attachments.filter((a) => a.id !== attId);
    await this.blobs.del(this._bk(attId));
    it.updated = Date.now();
    if (meta) this.log('item', `Removed attachment “${meta.name}” from “${it.name}”`);
    await this.save();
  }

  async hasBlob(attId) { return !!(await this.blobs.get(this._bk(attId))); }

  async attachmentStats() {
    let count = 0, bytes = 0;
    for (const i of this.data.items) for (const a of i.attachments) { count++; bytes += a.size; }
    return { count, bytes };
  }

  /* Remove ciphertext no item refers to (e.g. after an interrupted edit) and apply pending trash purges. */
  async _gcBlobs() {
    if (this._pendingDrop) { const p = this._pendingDrop; this._pendingDrop = null; await this._drop(p); await this.save(); }
    const live = new Set(); for (const i of this.data.items) for (const a of i.attachments) live.add(this._bk(a.id));
    const prefix = this.session.id + ':';
    for (const k of await this.blobs.keys()) if (k.startsWith(prefix) && !live.has(k)) await this.blobs.del(k);
  }

  /* ----- backups ----- */
  async _attachmentMap(items, maxBytes = Infinity) {
    const out = {}; let total = 0, skipped = 0;
    for (const it of items) for (const a of it.attachments || []) {
      if (total + a.size > maxBytes) { skipped++; continue; }
      const rec = await this.blobs.get(this._bk(a.id));
      if (!rec) { skipped++; continue; }
      out[a.id] = b64.enc(await this.session.openBlob(a.id, rec)); total += a.size;
    }
    return { map: out, skipped, total };
  }

  async exportEncrypted(password, opt = {}) {
    const items = this.active();
    const att = opt.attachments ? await this._attachmentMap(items) : { map: {} };
    const body = JSON.stringify({ format: 'VaultManager-export', v: 1, app: APP_VERSION, exported: Date.now(),
      items: opt.attachments ? items : items.map((i) => ({ ...i, attachments: [] })), attachments: att.map });
    this.log('data', 'Exported an encrypted backup (' + items.length + ' items' + (opt.attachments ? ', with attachments' : '') + ')');
    this._auditSave();
    return 'VMX1:' + (await sealText(body, password, opt));
  }

  /* items: sanitised items (ids are regenerated); atts: { oldAttachmentId: base64 }.
     Returns { added, skipped, save } — `save` resolves when everything is persisted. */
  mergeItems(items, atts = {}) {
    const sig = (i) => [i.type, i.name, i.username, i.url, i.password, i.notes].join('\u0001');
    const have = new Set(this.active().map(sig));
    let added = 0, skipped = 0;
    const writes = [];
    for (const raw of items) {
      const it = newItem(raw.type || 'login', { ...raw, id: uid(), deleted: 0, revisions: [] });
      if (have.has(sig(it))) { skipped++; continue; }
      have.add(sig(it));
      const metas = it.attachments || []; it.attachments = [];
      for (const m of metas) {
        if (!atts[m.id]) continue;
        const na = { ...m, id: uid() }; it.attachments.push(na);
        writes.push(async () => this.blobs.put(this._bk(na.id), await this.session.sealBlob(na.id, b64.dec(atts[m.id]))));
      }
      this.data.items.push(it); added++;
    }
    this.log('data', `Imported ${added} item${added === 1 ? '' : 's'} (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)`);
    return { added, skipped, save: (async () => { for (const w of writes) await w(); await this.save(); })() };
  }

  /* ----- sync ----- */
  async buildBundle({ withAttachments = true, maxAttachmentBytes = 20 * 1048576 } = {}) {
    const att = withAttachments ? await this._attachmentMap(this.data.items, maxAttachmentBytes) : { map: {}, skipped: 0 };
    this._pruneTombstones();
    return { format: 'VaultManager-sync', v: 1, app: APP_VERSION, at: Date.now(), items: this.data.items, tombstones: this.data.tombstones, attachments: att.map, attachmentsSkipped: att.skipped };
  }
  _pruneTombstones() { const cut = Date.now() - TOMBSTONE_DAYS * 864e5; for (const [k, t] of Object.entries(this.data.tombstones)) if (t < cut) delete this.data.tombstones[k]; }

  /* Merge a remote bundle into this vault: per item the newest `updated` wins, deletions propagate. */
  async applyRemote(bundle) {
    if (!bundle || bundle.format !== 'VaultManager-sync' || !Array.isArray(bundle.items)) throw new Error('This is not a VaultManager sync bundle.');
    const res = { added: 0, updated: 0, removed: 0, attachments: 0 };
    const tomb = this.data.tombstones;
    for (const [id, t] of Object.entries(bundle.tombstones || {})) if (/^[0-9a-f]{24}$/.test(id) && Number.isFinite(t) && (!tomb[id] || tomb[id] < t)) tomb[id] = t;
    const local = new Map(this.data.items.map((i) => [i.id, i]));
    const rattach = bundle.attachments && typeof bundle.attachments === 'object' ? bundle.attachments : {};
    const pullBlobs = async (it) => {
      for (const a of it.attachments) if (!(await this.hasBlob(a.id)) && typeof rattach[a.id] === 'string') { await this.blobs.put(this._bk(a.id), await this.session.sealBlob(a.id, b64.dec(rattach[a.id]))); res.attachments++; }
    };
    for (const raw of bundle.items) {
      const r = sanitiseItem(raw, { keepMeta: true, keepAttachments: true });
      if (!/^[0-9a-f]{24}$/.test(r.id)) continue;
      if (tomb[r.id] && tomb[r.id] >= r.updated) continue;
      const l = local.get(r.id);
      if (!l) { this.data.items.push(r); local.set(r.id, r); await pullBlobs(r); res.added++; continue; }
      if (r.updated > l.updated) {
        const keep = new Set(r.attachments.map((a) => a.id));
        for (const a of l.attachments) if (!keep.has(a.id)) await this.blobs.del(this._bk(a.id));
        Object.assign(l, r); await pullBlobs(l); res.updated++;
      } else if (r.updated === l.updated) await pullBlobs(l);
    }
    const dead = this.data.items.filter((i) => tomb[i.id] && tomb[i.id] >= i.updated);
    if (dead.length) { for (const it of dead) for (const a of it.attachments) await this.blobs.del(this._bk(a.id)); const ids = new Set(dead.map((d) => d.id)); this.data.items = this.data.items.filter((i) => !ids.has(i.id)); res.removed = dead.length; }
    this._pruneTombstones();
    this.log('sync', `Merged remote changes: ${res.added} added, ${res.updated} updated, ${res.removed} removed, ${res.attachments} attachment(s)`);
    await this.save();
    return res;
  }
}

export async function decryptBackup(text, password) {
  const t = String(text).trim();
  if (!t.startsWith('VMX1:')) throw new Error('This is not a VaultManager backup (it should start with VMX1:).');
  const j = JSON.parse(await openText(t.slice(5), password));
  if (j.format !== 'VaultManager-export' || !Array.isArray(j.items)) throw new Error('Unrecognised backup contents.');
  return { items: j.items.map((i) => sanitiseItem(i, { keepAttachments: true })), attachments: j.attachments && typeof j.attachments === 'object' ? j.attachments : {} };
}

/* Coerce untrusted data into the item shape (defends against odd types in a hand-edited file or a hostile bundle).
   keepMeta: keep id / timestamps / revisions (sync). keepAttachments: keep attachment metadata. */
export function sanitiseItem(r, { keepMeta = false, keepAttachments = false } = {}) {
  const s = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  const type = ['login', 'note', 'card'].includes(r.type) ? r.type : 'login';
  const c = r.card && typeof r.card === 'object' ? r.card : {};
  const it = newItem(type, {
    name: s(r.name, 300), username: s(r.username, 500), password: s(r.password, 2000), url: s(r.url, 2000), totp: s(r.totp, 1000), notes: s(r.notes, 50000),
    tags: Array.isArray(r.tags) ? r.tags.map((t) => s(t, 50)).filter(Boolean).slice(0, 30) : [], favorite: !!r.favorite,
    card: { holder: s(c.holder, 200), number: s(c.number, 40), expiry: s(c.expiry, 10), cvv: s(c.cvv, 10), pin: s(c.pin, 20) },
  });
  if (Number.isFinite(r.created)) it.created = r.created;
  if (Number.isFinite(r.pwChanged)) it.pwChanged = r.pwChanged;
  if (Array.isArray(r.history)) it.history = r.history.filter((h) => h && typeof h.pw === 'string').slice(0, HISTORY_MAX).map((h) => ({ pw: s(h.pw, 2000), at: num(Number(h.at)) }));
  if (keepAttachments && Array.isArray(r.attachments)) {
    it.attachments = r.attachments.filter((a) => a && /^[0-9a-f]{24}$/.test(a.id)).slice(0, MAX_ATTACHMENTS_PER_ITEM)
      .map((a) => ({ id: a.id, name: s(a.name, 200) || 'file', type: s(a.type, 100), size: num(a.size), added: num(a.added) }));
  } else it.attachments = [];
  if (keepMeta) {
    it.id = s(r.id, 40); it.updated = num(r.updated, it.updated); it.deleted = num(r.deleted);
    if (Array.isArray(r.revisions)) it.revisions = r.revisions.filter((v) => v && v.snap && typeof v.snap === 'object').slice(0, REVISIONS_MAX).map((v) => {
      const sn = sanitiseItem(v.snap);
      return { at: num(v.at), changed: Array.isArray(v.changed) ? v.changed.map((x) => s(x, 20)).slice(0, 10) : [], snap: Object.fromEntries(TRACKED.map((k) => [k, sn[k]])) };
    });
  }
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
