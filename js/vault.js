/* Vault data layer: encrypted persistence, items, attachments, audit trail, sync merge, health,
   import / export. DOM-free so it can be unit-tested in Node. */

import { createVault, openVault, sealText, openText, innerSeal, innerOpen, rand, ITER_DEFAULT } from './crypto.js';
import { uid, hostOf, b64, debounce } from './util.js';
import { estimate } from './strength.js';
import { parseTotp } from './totp.js';
import { memoryBlobs } from './blobs.js';
import { APP_VERSION } from './version.js';
import { normalizeLook, LOOK_DEFAULTS } from './look.js';
import { TYPE_META, TYPE_KEYS, TEMPLATES, isSecretField, MAX_CUSTOM, daysUntil } from './templates.js';

export const TYPES = Object.fromEntries(Object.entries(TYPE_META).map(([k, m]) => [k, m.label]));
export const KEY = 'vaultmanager.vault';
const FAIL_KEY = 'vaultmanager.fails';
const HISTORY_MAX = 10, REVISIONS_MAX = 10, AUDIT_MAX = 1000, TOMBSTONE_DAYS = 90;
export const OLD_DAYS = 365;
export const MAX_ATTACHMENT = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_ITEM = 20;
export const TRACKED = ['name', 'username', 'url', 'password', 'totp', 'notes', 'tags', 'card', 'fields', 'custom', 'lock'];
/* What the optional per-item "secondary passcode" seals away (name, tags and favourite stay visible so the item can be found). */
export const SENSITIVE = ['username', 'password', 'url', 'totp', 'notes', 'card', 'fields', 'custom'];
const pickSensitive = (o) => Object.fromEntries(SENSITIVE.map((k) => [k, o[k]]));
const BLANK = () => ({ username: '', password: '', url: '', totp: '', notes: '', card: { holder: '', number: '', expiry: '', cvv: '', pin: '' }, fields: {}, custom: [] });
export const LOCK_UNLOCK_MS = 10 * 60 * 1000;

export const DEFAULT_SETTINGS = {
  autolock: 5, clipboard: 30, theme: 'auto', lockOnHide: false, trashDays: 30, logReveal: true, displayName: '', tourSeen: false, welcomeAlways: false,
  gen: { mode: 'password', length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false, words: 5, separator: '-', capitalize: false, number: false },
  sync: { method: 'off', token: '', gistId: '', passphrase: '', auto: true, attachments: true, last: null },
  look: LOOK_DEFAULTS,
};

export function newItem(type = 'login', init = {}) {
  const now = Date.now();
  return {
    id: uid(), type, name: '', username: '', password: '', url: '', totp: '', notes: '', tags: [], favorite: false,
    card: { holder: '', number: '', expiry: '', cvv: '', pin: '' }, fields: {}, custom: [], attachments: [], revisions: [], ft: {}, sv: {}, attRemoved: {}, conflicts: [], cr: {},
    history: [], created: now, updated: now, pwChanged: now, deleted: 0, lock: '', ...init,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- field-level merge (used by sync) ----------
   Every field remembers when it was last edited (ft) and the value-time it had at the last merge (sv).
   Two devices that edit DIFFERENT fields of one item both keep their changes. If both edited the SAME field
   since they last merged, the newest wins deterministically (both devices pick the same winner) and the other
   value is kept as a conflict for the user to review. */
const MERGE_KEYS = ['name', 'username', 'url', 'password', 'totp', 'notes', 'tags', 'card', 'custom', 'lock', 'favorite', 'deleted'];
const NO_CONFLICT = new Set(['favorite', 'deleted']);
const keysOf = (it) => [...MERGE_KEYS, ...Object.keys(it.fields || {}).map((k) => 'f:' + k)];
const getKey = (it, k) => (k.startsWith('f:') ? (it.fields || {})[k.slice(2)] ?? '' : it[k]);
const setKey = (it, k, v) => { if (k.startsWith('f:')) { it.fields = it.fields || {}; if (v === '' || v == null) delete it.fields[k.slice(2)]; else it.fields[k.slice(2)] = v; } else it[k] = v; };
const ftOf = (it, k) => (it.ft && it.ft[k] !== undefined ? it.ft[k] : it.sv && it.sv[k] !== undefined ? it.sv[k] : it.updated || 0);
const svOf = (it, k) => (it.sv && it.sv[k] !== undefined ? it.sv[k] : null);   // null: never merged, so nothing counts as "edited since"
export function keyLabel(it, k) {
  if (k.startsWith('f:')) { const f = ((TEMPLATES[it.type] || {}).fields || []).find((x) => x.k === k.slice(2)); return f ? f.l : k.slice(2); }
  return ({ name: 'Name', username: 'Username', url: 'Website', password: 'Password', totp: 'One-time code secret', notes: 'Notes', tags: 'Tags', card: 'Card details', custom: 'Custom fields', lock: 'Secondary passcode lock' })[k] || k;
}
export function keyIsSecret(it, k) {
  if (['password', 'totp', 'card', 'lock'].includes(k)) return true;
  if (k.startsWith('f:')) { const f = ((TEMPLATES[it.type] || {}).fields || []).find((x) => x.k === k.slice(2)); return !!f && isSecretField(f); }
  return false;
}
export function describeValue(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x && x.label !== undefined ? x.label + ': ' + (x.secret ? '••••' : x.value) : JSON.stringify(x))).join(', ') || '(empty)';
  if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => x).map(([k, x]) => k + ': ' + x).join(' · ') || '(empty)';
  return String(v ?? '') || '(empty)';
}
export const currentValue = (it, k) => getKey(it, k);
export const conflictId = (key, value) => { let h = 5381; const t = key + '\u0001' + JSON.stringify(value); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };

export function mergeItem(l, r) {
  l.ft = l.ft || {}; l.sv = l.sv || {}; l.conflicts = l.conflicts || []; l.cr = l.cr || {}; l.attRemoved = l.attRemoved || {};
  const before = {}; for (const k of TRACKED) before[k] = structuredClone(l[k]);
  const changed = [], found = [];
  for (const k of new Set([...keysOf(l), ...keysOf(r)])) {
    const lv = getKey(l, k), rv = getKey(r, k), lt = ftOf(l, k), rt = ftOf(r, k);
    if (same(lv, rv)) { l.ft[k] = Math.max(lt, rt); continue; }
    const lsv = svOf(l, k), rsv = svOf(r, k);
    const bothEdited = lsv !== null && lt > lsv && rsv !== null && rt > rsv;
    const remoteWins = rt > lt || (rt === lt && JSON.stringify(rv) > JSON.stringify(lv));
    if (bothEdited && !NO_CONFLICT.has(k)) { const loser = remoteWins ? lv : rv; found.push({ id: conflictId(k, loser), key: k, value: structuredClone(loser), at: remoteWins ? lt : rt }); }
    if (remoteWins) { setKey(l, k, structuredClone(rv)); l.ft[k] = rt; changed.push(k); } else l.ft[k] = lt;
  }
  // attachments: union of both sides, minus anything either side removed
  for (const [id, t] of Object.entries(r.attRemoved || {})) if (!(l.attRemoved[id] >= t)) l.attRemoved[id] = t;
  const byId = new Map(); for (const a of [...(l.attachments || []), ...(r.attachments || [])]) if (!byId.has(a.id) || (a.lk && !byId.get(a.id).lk)) byId.set(a.id, a);   // the sealed version of a file's entry wins
  const attBefore = (l.attachments || []).map((a) => a.id).join();
  l.attachments = [...byId.values()].filter((a) => !l.attRemoved[a.id]);
  if (l.attachments.map((a) => a.id).join() !== attBefore) changed.push('attachments');
  // conflicts: union, minus the ones either side has resolved
  for (const [id, t] of Object.entries(r.cr || {})) if (!(l.cr[id] >= t)) l.cr[id] = t;
  const conf = new Map(); for (const c of [...l.conflicts, ...(r.conflicts || []), ...found]) if (!l.cr[c.id] && !conf.has(c.id)) conf.set(c.id, c);
  const prevConf = l.conflicts.map((c) => c.id).sort().join();
  l.conflicts = [...conf.values()].slice(0, 20);
  if (changed.some((k) => TRACKED.includes(k) || k.startsWith('f:'))) {
    const keysChanged = [...new Set(changed.map((k) => (k.startsWith('f:') ? 'fields' : k)).filter((k) => TRACKED.includes(k)))];
    if (keysChanged.length) l.revisions = [{ at: l.updated, changed: keysChanged, snap: before }, ...(l.revisions || [])].slice(0, REVISIONS_MAX);
  }
  if (l.lock) Object.assign(l, BLANK());   // a locked item never keeps readable secrets, even if another device edited them meanwhile
  l.updated = Math.max(l.updated || 0, r.updated || 0);
  for (const k of new Set([...keysOf(l), ...keysOf(r)])) l.sv[k] = l.ft[k] !== undefined ? l.ft[k] : ftOf(l, k);
  return { changed, newConflicts: l.conflicts.map((c) => c.id).sort().join() !== prevConf ? found.length : 0 };
}

export class VaultStore {
  constructor(storage, key = KEY, blobs = memoryBlobs(), failKey = FAIL_KEY) {
    this.storage = storage; this.key = key; this.blobs = blobs; this.failKey = failKey;
    this.session = null; this.data = null; this.chain = Promise.resolve();
    this.itemKeys = new Map(); this.itemFails = new Map();   // opened locked items (memory only) / wrong-passcode counters
    this.onSaved = null; this._auditDirty = false;
    this._auditSave = debounce(() => { if (this._auditDirty && this.session) { this._auditDirty = false; this.save().catch(() => {}); } }, 1500);
  }

  exists() { return !!this.storage.getItem(this.key); }
  get unlocked() { return !!this.session; }
  get items() { return this.data.items; }
  get settings() { return this.data.settings; }

  /* ----- unlock throttling (a courtesy against typos / casual guessing; real protection is PBKDF2) ----- */
  failState() { try { return JSON.parse(this.storage.getItem(this.failKey)) || { n: 0, until: 0, times: [] }; } catch { return { n: 0, until: 0, times: [] }; } }
  delayLeft() { return Math.max(0, this.failState().until - Date.now()); }
  _fail() {
    const s = this.failState(); s.n++; s.times = [...(s.times || []), Date.now()].slice(-20);
    s.until = s.n >= 3 ? Date.now() + Math.min(300, 2 ** (s.n - 2)) * 1000 : 0;
    this.storage.setItem(this.failKey, JSON.stringify(s));
  }
  _clearFails() { this.storage.removeItem(this.failKey); }

  _prepare(data) {
    data.items = data.items || [];
    data.audit = Array.isArray(data.audit) ? data.audit : [];
    data.tombstones = data.tombstones && typeof data.tombstones === 'object' ? data.tombstones : {};
    data.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(data.settings || {}) };
    data.settings.gen = { ...DEFAULT_SETTINGS.gen, ...(data.settings.gen || {}) };
    data.settings.sync = { ...DEFAULT_SETTINGS.sync, ...(data.settings.sync || {}) };
    data.settings.look = normalizeLook(data.settings.look || {});
    for (const i of data.items) { i.attachments = i.attachments || []; i.revisions = i.revisions || []; i.history = i.history || []; i.fields = i.fields || {}; i.custom = i.custom || []; i.ft = i.ft || {}; i.sv = i.sv || {}; i.attRemoved = i.attRemoved || {}; i.conflicts = i.conflicts || []; i.cr = i.cr || {}; }
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
    this.session = null; this.data = null; this.itemKeys.clear();
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
      this.storage.setItem(this.key, JSON.stringify(record)); this.lastSaved = Date.now();
      if (this.onSaved) { try { this.onSaved(); } catch { /* ignore */ } }
    }).catch((e) => { this.lastError = e; throw e; });
    return this.chain;
  }

  /* ----- per-item secondary passcode -----
     The sensitive fields of an item are sealed again (PBKDF2 → AES-256-GCM, the same format as QR Seal) under a passcode
     of its own, inside the already-encrypted vault. Without that passcode even someone who knows the master password
     sees only the name and tags. The passcode is never stored; an opened item is kept in memory for a few minutes only. */
  isLocked(it) { return !!(it && it.lock); }
  isOpen(it) { const c = it && this.itemKeys.get(it.id); if (!c) return false; if (Date.now() - c.at > LOCK_UNLOCK_MS) { this.itemKeys.delete(it.id); return false; } return true; }
  /* the item as the UI should see it: with its secrets filled in when it has been opened */
  reveal(it) {
    if (!it || !it.lock || !this.isOpen(it)) return it;
    const an = this.itemKeys.get(it.id).payload.an || {};
    return { ...it, ...pickSensitive(sanitiseItem({ type: it.type, ...this.itemKeys.get(it.id).payload }, {})), _open: true,
      attachments: it.attachments.map((a) => (a.lk && an[a.id] ? { ...a, name: an[a.id].n, type: an[a.id].t } : a)) };
  }
  relock(id) { this.itemKeys.delete(id); }
  async openItem(id, code) {
    const it = this.get(id); if (!it || !it.lock) throw new Error('This item has no passcode lock.');
    const f = this.itemFails.get(id) || { n: 0, until: 0 };
    if (Date.now() < f.until) throw new Error('Too many wrong passcodes. Wait ' + Math.ceil((f.until - Date.now()) / 1000) + 's.');
    let text; try { text = await openText(it.lock, String(code || '')); } catch { f.n++; f.until = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(f.n, 6)); this.itemFails.set(id, f); throw new Error('bad-passcode'); }
    this.itemFails.delete(id);
    const payload = JSON.parse(text); this.itemKeys.set(id, { code: String(code), payload, at: Date.now() });
    this.log('access', 'Opened passcode-locked “' + it.name + '”');
    if (await this._lockFiles(it, payload)) await this._resealPayload(id);   // items locked before files were covered: seal their files now
    return payload;
  }
  async lockItem(id, code, opt = {}) {
    const it = this.get(id); if (!it) throw new Error('Item not found.');
    if (String(code || '').length < 6) throw new Error('Use at least 6 characters for the item passcode.');
    const payload = it.lock ? this.itemKeys.get(id).payload : Object.fromEntries(SENSITIVE.map((k) => [k, structuredClone(it[k])]));
    await this._lockFiles(it, payload);
    const sealed = await sealText(JSON.stringify(payload), String(code), opt);
    await this.update(id, { ...BLANK(), lock: sealed });
    it.revisions = []; it.history = [];   // earlier versions hold the readable secrets
    this.itemKeys.delete(id);   // a freshly locked item starts closed
    this.log('item', 'Locked “' + it.name + '” with a secondary passcode', 'info');
    return this.save();
  }
  /* seal the plain files of a locked item under its item key; names and types move inside the passcode seal */
  async _lockFiles(it, payload) {
    let changed = false;
    if (!payload.ak) { payload.ak = b64.enc(rand(32)); changed = true; }
    payload.an = payload.an || {};
    const key = b64.dec(payload.ak);
    for (const a of it.attachments) {
      if (a.lk) continue;
      const rec = await this.blobs.get(this._bk(a.id)); if (!rec) continue;   // not on this device yet: sealed when it arrives and the item is next opened
      const plain = await this.session.openBlob(a.id, rec);
      await this.blobs.put(this._bk(a.id), await this.session.sealBlob(a.id, await innerSeal(key, plain)));
      const quoted = '“' + a.name + '”';   // the audit trail must not remember the file's real name either
      for (const e of this.data.audit) if (e.m.includes(quoted)) e.m = e.m.split(quoted).join('“a file”');
      payload.an[a.id] = { n: a.name, t: a.type }; a.name = 'Locked file'; a.type = 'application/octet-stream'; a.lk = true; changed = true;
    }
    return changed;
  }
  async _resealPayload(id) {
    const c = this.itemKeys.get(id); if (!c) throw new Error('Open the item first.');
    await this.update(id, { lock: await sealText(JSON.stringify(c.payload), c.code) });
    this.get(id).revisions = [];
    return this.save();
  }

  /* save edits to an opened locked item: the readable parts go back inside the seal */
  async saveLocked(id, meta, payload, opt = {}) {
    const c = this.itemKeys.get(id); if (!c) throw new Error('Open the item first.');
    const sealed = await sealText(JSON.stringify({ ...Object.fromEntries(SENSITIVE.map((k) => [k, payload[k]])), ak: c.payload.ak, an: c.payload.an }), c.code, opt);
    await this.update(id, { ...meta, lock: sealed });
    const it = this.get(id); it.revisions = []; it.history = [];
    c.payload = { ...Object.fromEntries(SENSITIVE.map((k) => [k, structuredClone(payload[k])])), ak: c.payload.ak, an: c.payload.an }; c.at = Date.now();
    return this.save();
  }
  async changeItemCode(id, oldCode, newCode, opt = {}) {
    await this.openItem(id, oldCode); return this.lockItem(id, newCode, opt);
  }
  async removeItemLock(id, code) {
    const payload = await this.openItem(id, code);
    const it = this.get(id);
    for (const a of it.attachments) if (a.lk) {
      const rec = await this.blobs.get(this._bk(a.id)), n = (payload.an || {})[a.id];
      if (rec) await this.blobs.put(this._bk(a.id), await this.session.sealBlob(a.id, await innerOpen(b64.dec(payload.ak), await this.session.openBlob(a.id, rec))));
      if (n) { a.name = n.n; a.type = n.t; } delete a.lk;
    }
    await this.update(id, { ...pickSensitive(sanitiseItem({ type: it.type, ...payload }, {})), lock: '' });
    this.itemKeys.delete(id); this.log('item', 'Removed the passcode lock from “' + it.name + '”', 'warn');
    return this.save();
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
    /* sync bookkeeping belongs to the store: a caller holding a stale copy of the item must never overwrite it */
    patch = { ...patch }; for (const k of ['id', 'ft', 'sv', 'attRemoved', 'conflicts', 'cr', 'attachments', 'revisions', 'history', 'created', 'pwChanged', 'deleted']) delete patch[k];
    const changed = TRACKED.filter((k) => patch[k] !== undefined && !same(patch[k], it[k]));
    const touched = [];   // field-level change times for sync merging
    for (const k of changed) {
      if (k === 'fields') for (const fk of new Set([...Object.keys(it.fields || {}), ...Object.keys(patch.fields || {})])) { if (!same((it.fields || {})[fk] ?? '', patch.fields[fk] ?? '')) touched.push('f:' + fk); }
      else touched.push(k);
    }
    if (patch.favorite !== undefined && patch.favorite !== it.favorite) touched.push('favorite');
    const now = Date.now();
    if (touched.length) this._seed(it);
    for (const k of touched) { if (it.sv[k] === undefined && it.ft[k] !== undefined) it.sv[k] = it.ft[k]; else if (it.sv[k] === undefined) it.sv[k] = it.updated; it.ft[k] = now; }
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

  /* first edit of an item: every field gets a baseline edit-time, so untouched fields never look newer than they are */
  _seed(it) { if (!Object.keys(it.ft).length) for (const k of keysOf(it)) it.ft[k] = it.sv[k] !== undefined ? it.sv[k] : it.updated; }
  _touch(it, k) { this._seed(it); if (it.sv[k] === undefined) it.sv[k] = it.ft[k] !== undefined ? it.ft[k] : it.updated; it.ft[k] = Date.now(); }
  trash(id) { const it = this.get(id); if (it) { this._touch(it, 'deleted'); it.deleted = Date.now(); it.updated = Date.now(); this.log('item', 'Moved “' + it.name + '” to trash'); } return this.save(); }
  restore(id) { const it = this.get(id); if (it) { this._touch(it, 'deleted'); it.deleted = 0; it.updated = Date.now(); this.log('item', 'Restored “' + it.name + '” from trash'); } return this.save(); }

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

  /* ----- conflicts (same field edited on two devices) ----- */
  conflictItems() { return this.active().filter((i) => (i.conflicts || []).length); }
  conflictCount() { return this.conflictItems().reduce((n, i) => n + i.conflicts.length, 0); }
  /* choice: 'keep' (current value stays) | 'other' (use the other device's value) */
  async resolveConflict(itemId, confId, choice) {
    const it = this.get(itemId), c = it && it.conflicts.find((x) => x.id === confId);
    if (!c) return;
    it.conflicts = it.conflicts.filter((x) => x.id !== confId); it.cr[confId] = Date.now();
    if (choice === 'other') {
      const patch = {};
      if (c.key.startsWith('f:')) patch.fields = { ...it.fields, [c.key.slice(2)]: c.value }; else patch[c.key] = c.value;
      if (c.key.startsWith('f:') && (c.value === '' || c.value == null)) delete patch.fields[c.key.slice(2)];
      await this.update(itemId, patch);
    } else { it.updated = Date.now(); await this.save(); }
    this.log('item', `Resolved a sync conflict on “${it.name}” (${choice === 'other' ? 'used the other value' : 'kept the current value'})`);
  }

  /* passkey wraps live in the vault record (not in synced data), so passkeys are per device */
  hasPasskeys() { try { const r = JSON.parse(this.storage.getItem(this.key)); return !!(r && r.wraps.some((w) => w.type === 'passkey')); } catch { return false; } }
  passkeyWraps() { try { return JSON.parse(this.storage.getItem(this.key)).wraps.filter((w) => w.type === 'passkey'); } catch { return []; } }

  /* Deletes this vault, its attachments and its bookkeeping — works whether it is unlocked or not
     (the vault id is stored in plain text in the record, so the ciphertext blobs can be found). */
  async wipe() {
    let id = this.session ? this.session.id : null;
    if (!id) { try { id = (JSON.parse(this.storage.getItem(this.key) || 'null') || {}).id || null; } catch { id = null; } }
    if (id) { for (const k of await this.blobs.keys()) if (k.startsWith(id + ':')) await this.blobs.del(k); }
    this.lock();
    this.storage.removeItem(this.key); this.storage.removeItem(this.key + '.bak'); this.storage.removeItem(this.failKey);
  }

  /* ----- attachments (encrypted per file, stored in IndexedDB) ----- */
  _bk(attId) { return this.session.id + ':' + attId; }

  async addAttachment(itemId, { name, type, bytes }) {
    const it = this.get(itemId);
    if (!it) throw new Error('Item not found.');
    if (bytes.length > MAX_ATTACHMENT) throw new Error(`“${name}” is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT / 1048576} MB per file.`);
    if (it.attachments.length >= MAX_ATTACHMENTS_PER_ITEM) throw new Error('An item can hold at most ' + MAX_ATTACHMENTS_PER_ITEM + ' attachments.');
    const lockedIt = !!it.lock; let ck = null;
    if (lockedIt) { ck = this.itemKeys.get(itemId); if (!ck) throw new Error('Unlock this item first to attach files to it.'); }
    const att = { id: uid(), name: String(name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200), type: String(type || 'application/octet-stream').slice(0, 100), size: bytes.length, added: Date.now() };
    let stored = bytes;
    if (lockedIt) { stored = await innerSeal(b64.dec(ck.payload.ak), bytes); (ck.payload.an = ck.payload.an || {})[att.id] = { n: att.name, t: att.type }; }
    await this.blobs.put(this._bk(att.id), await this.session.sealBlob(att.id, stored));
    const shown = { ...att };
    if (lockedIt) { att.name = 'Locked file'; att.type = 'application/octet-stream'; att.lk = true; }
    it.attachments.push(att); it.updated = Date.now();
    if (lockedIt) { await this._resealPayload(itemId); return shown; }
    this.log('item', `Attached “${att.name}” (${Math.ceil(att.size / 1024)} KB) to “${it.name}”`);
    await this.save();
    return att;
  }

  async readAttachment(itemId, attId) {
    const it = this.get(itemId), meta = it && it.attachments.find((a) => a.id === attId);
    if (!meta) throw new Error('Attachment not found.');
    const rec = await this.blobs.get(this._bk(attId));
    if (!rec) throw new Error('This attachment is not available on this device (it was not included in the sync or backup).');
    const bytes = await this.session.openBlob(attId, rec);
    if (!meta.lk) return { meta, bytes };
    const c = this.itemKeys.get(itemId); if (!c) throw new Error('This file is locked. Unlock the item first.');
    const n = (c.payload.an || {})[attId] || {};
    try { return { meta: { ...meta, name: n.n || meta.name, type: n.t || meta.type }, bytes: await innerOpen(b64.dec(c.payload.ak), bytes) }; }
    catch { throw new Error('This file is not available in its locked form on this device yet (sync it from the device that locked it).'); }
  }

  async removeAttachment(itemId, attId) {
    const it = this.get(itemId);
    if (!it) return;
    const meta = it.attachments.find((a) => a.id === attId);
    it.attachments = it.attachments.filter((a) => a.id !== attId);
    it.attRemoved[attId] = Date.now();
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

  /* ----- whole-profile backup: the entire database, not just the items ----- */
  async exportProfile(password, { profile = {}, attachments = true, ...opt } = {}) {
    const all = this.data.items;
    const att = attachments ? await this._attachmentMap(all) : { map: {} };
    const body = JSON.stringify({ format: 'VaultManager-profile', v: 1, app: APP_VERSION, exported: Date.now(),
      profile: { name: String(profile.name || '').slice(0, 60), avatar: profile.avatar || null },
      items: attachments ? all : all.map((i) => ({ ...i, attachments: [] })), attachments: att.map,
      settings: portableSettings(this.data.settings), audit: this.data.audit, tombstones: this.data.tombstones, created: this.data.created });
    this.log('data', `Exported the whole profile (${all.length} items${attachments ? ', with attachments' : ''})`);
    this._auditSave();
    return 'VMP1:' + (await sealText(body, password, opt));
  }

  /* Fill a freshly created (empty) vault from a decrypted profile export. */
  async restoreProfileData(d) {
    this.data.items = (d.items || []).map((i) => sanitiseItem(i, { keepMeta: true, keepAttachments: true })).filter((i) => /^[0-9a-f]{24}$/.test(i.id));
    for (const it of this.data.items) for (const a of it.attachments) { const b = d.attachments && d.attachments[a.id]; if (typeof b === 'string') await this.blobs.put(this._bk(a.id), await this.session.sealBlob(a.id, b64.dec(b))); }
    for (const it of this.data.items) it.attachments = it.attachments.filter((a) => d.attachments && typeof d.attachments[a.id] === 'string');
    const ts = {}; for (const [k, v] of Object.entries(d.tombstones || {})) if (/^[0-9a-f]{24}$/.test(k) && Number.isFinite(v)) ts[k] = v;
    this.data.tombstones = ts;
    const set = portableSettings(d.settings || {});
    this.data.settings = { ...this.data.settings, ...set, gen: { ...this.data.settings.gen, ...(set.gen || {}) }, look: normalizeLook({ ...this.data.settings.look, ...(set.look || {}) }) };
    if (Array.isArray(d.audit)) this.data.audit = d.audit.filter((e) => e && typeof e.m === 'string').slice(0, AUDIT_MAX).map((e) => ({ t: Number(e.t) || 0, k: String(e.k || '').slice(0, 20), m: e.m.slice(0, 300), l: e.l === 'warn' ? 'warn' : 'info' }));
    if (Number.isFinite(d.created)) this.data.created = d.created;
    this.log('data', `Profile restored from a backup (${this.data.items.length} items)`, 'warn');
    await this.save();
  }

  /* items: sanitised items (ids are regenerated); atts: { oldAttachmentId: base64 }.
     Returns { added, skipped, save } — `save` resolves when everything is persisted. */
  mergeItems(items, atts = {}) {
    const sig = (i) => [i.type, i.name, i.username, i.url, i.password, i.notes, JSON.stringify(i.fields), JSON.stringify(i.custom)].join('\u0001');
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
    const res = { added: 0, updated: 0, removed: 0, attachments: 0, conflicts: 0 };
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
      if (!l) { r.sv = { ...r.ft }; for (const k of keysOf(r)) if (r.sv[k] === undefined) r.sv[k] = r.updated; this.data.items.push(r); local.set(r.id, r); await pullBlobs(r); res.added++; continue; }
      const plainBefore = new Set(l.attachments.filter((a) => !a.lk).map((a) => a.id));
      const m = mergeItem(l, r);
      for (const a of l.attachments) if (a.lk && plainBefore.has(a.id) && typeof rattach[a.id] === 'string') await this.blobs.put(this._bk(a.id), await this.session.sealBlob(a.id, b64.dec(rattach[a.id])));   // the other device sealed this file under the item passcode
      for (const a of r.attachments) if (l.attRemoved[a.id]) await this.blobs.del(this._bk(a.id));
      for (const rid of Object.keys(l.attRemoved)) if (!l.attachments.some((a) => a.id === rid)) await this.blobs.del(this._bk(rid));
      await pullBlobs(l);
      if (m.changed.length) res.updated++;
      if (m.newConflicts) { res.conflicts += m.newConflicts; this.log('sync', 'Edited on two devices: “' + l.name + '” — kept the newest value and saved the other for review', 'warn'); }
    }
    const dead = this.data.items.filter((i) => tomb[i.id] && tomb[i.id] >= i.updated);
    if (dead.length) { for (const it of dead) for (const a of it.attachments) await this.blobs.del(this._bk(a.id)); const ids = new Set(dead.map((d) => d.id)); this.data.items = this.data.items.filter((i) => !ids.has(i.id)); res.removed = dead.length; }
    this._pruneTombstones();
    this.log('sync', `Merged remote changes: ${res.added} added, ${res.updated} updated, ${res.removed} removed, ${res.attachments} attachment(s)${res.conflicts ? ', ' + res.conflicts + ' conflict(s) to review' : ''}`);
    await this.save();
    return res;
  }
}

/* Settings that travel in a profile backup. Deliberately NOT included: the GitHub token, the sync passphrase and the
   gist id (secrets / device-specific) — set up sync again on the new device. */
export function portableSettings(st = {}) {
  const out = {};
  for (const k of ['autolock', 'clipboard', 'theme', 'lockOnHide', 'trashDays', 'logReveal', 'displayName', 'tourSeen', 'welcomeAlways']) if (st[k] !== undefined) out[k] = st[k];
  if (st.gen && typeof st.gen === 'object') out.gen = st.gen;
  if (st.look && typeof st.look === 'object') out.look = normalizeLook(st.look);
  if (st.sync && typeof st.sync === 'object') out.sync = { auto: !!st.sync.auto, attachments: st.sync.attachments !== false };
  return out;
}

/* Opens a profile backup (VMP1) or an items-only backup (VMX1). */
export async function decryptProfile(text, password) {
  const t = String(text).trim();
  if (t.startsWith('VMP1:')) {
    const j = JSON.parse(await openText(t.slice(5), password));
    if (j.format !== 'VaultManager-profile' || !Array.isArray(j.items)) throw new Error('Unrecognised profile backup contents.');
    return { kind: 'profile', name: (j.profile && j.profile.name) || '', avatar: (j.profile && j.profile.avatar) || null, ...j };
  }
  if (t.startsWith('VMX1:')) { const b = await decryptBackup(t, password); return { kind: 'items', name: '', avatar: null, items: b.items, attachments: b.attachments }; }
  throw new Error('This is not a VaultManager backup (it should start with VMP1: or VMX1:).');
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
  const type = TYPE_KEYS.includes(r.type) ? r.type : 'login';
  const c = r.card && typeof r.card === 'object' ? r.card : {};
  const it = newItem(type, {
    name: s(r.name, 300), username: s(r.username, 500), password: s(r.password, 2000), url: s(r.url, 2000), totp: s(r.totp, 1000), notes: s(r.notes, 50000),
    tags: Array.isArray(r.tags) ? r.tags.map((t) => s(t, 50)).filter(Boolean).slice(0, 30) : [], favorite: !!r.favorite,
    card: { holder: s(c.holder, 200), number: s(c.number, 40), expiry: s(c.expiry, 10), cvv: s(c.cvv, 10), pin: s(c.pin, 20) },
  });
  if (TEMPLATES[type] && r.fields && typeof r.fields === 'object') for (const f of TEMPLATES[type].fields) { const v = r.fields[f.k]; if (typeof v === 'string' && v) it.fields[f.k] = v.slice(0, f.kind === 'multiline' ? 20000 : 1000); }
  if (Array.isArray(r.custom)) it.custom = r.custom.filter((c) => c && typeof c === 'object').slice(0, MAX_CUSTOM).map((c) => ({ label: s(c.label, 60), value: s(c.value, 5000), secret: !!c.secret })).filter((c) => c.label || c.value);
  if (typeof r.lock === 'string' && r.lock.length <= 400000 && /^[A-Za-z0-9+/=]+$/.test(r.lock)) { it.lock = r.lock; Object.assign(it, BLANK()); }
  if (Number.isFinite(r.created)) it.created = r.created;
  if (Number.isFinite(r.pwChanged)) it.pwChanged = r.pwChanged;
  if (Array.isArray(r.history)) it.history = r.history.filter((h) => h && typeof h.pw === 'string').slice(0, HISTORY_MAX).map((h) => ({ pw: s(h.pw, 2000), at: num(Number(h.at)) }));
  if (keepAttachments && Array.isArray(r.attachments)) {
    it.attachments = r.attachments.filter((a) => a && /^[0-9a-f]{24}$/.test(a.id)).slice(0, MAX_ATTACHMENTS_PER_ITEM)
      .map((a) => ({ id: a.id, name: s(a.name, 200) || 'file', type: s(a.type, 100), size: num(a.size), added: num(a.added), ...(a.lk ? { lk: true } : {}) }));
  } else it.attachments = [];
  if (keepMeta) {
    it.id = s(r.id, 40); it.updated = num(r.updated, it.updated); it.deleted = num(r.deleted);
    const numMap = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).slice(0, 80).filter(([k, v]) => typeof k === 'string' && k.length < 60 && Number.isFinite(v)));
    it.ft = numMap(r.ft); it.sv = numMap(r.sv); it.attRemoved = numMap(r.attRemoved); it.cr = numMap(r.cr);
    if (Array.isArray(r.conflicts)) it.conflicts = r.conflicts.filter((c) => c && typeof c.id === 'string' && /^[0-9a-f]{8}$/.test(c.id) && typeof c.key === 'string' && c.key.length < 60 && JSON.stringify(c.value ?? '').length < 60000).slice(0, 20).map((c) => ({ id: c.id, key: c.key, value: c.value ?? '', at: num(c.at) }));
    it.favorite = !!r.favorite;
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
    const type = b.type === 2 ? 'note' : b.type === 3 ? 'card' : b.type === 4 ? 'identity' : 'login';
    const idn = b.identity || {};
    return sanitiseItem({
      type, name: b.name, notes: b.notes, favorite: b.favorite, tags: b.folderId && folders.get(b.folderId) ? [folders.get(b.folderId)] : [],
      username: l.username, password: l.password, totp: l.totp, url: (l.uris && l.uris[0] && l.uris[0].uri) || '',
      card: { holder: c.cardholderName, number: c.number, expiry: [c.expMonth, c.expYear].filter(Boolean).join('/'), cvv: c.code },
      fields: type === 'identity' ? { fullname: [idn.firstName, idn.middleName, idn.lastName].filter(Boolean).join(' '), number: idn.passportNumber || idn.licenseNumber || idn.ssn || '', country: idn.country || '' } : {},
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
    const tpl = TEMPLATES[i.type];
    const extra = [...(tpl ? tpl.fields.map((f) => (i.fields[f.k] ? f.l + ': ' + i.fields[f.k] : '')) : []), ...(i.custom || []).map((c) => c.label + ': ' + c.value)].filter(Boolean);
    const notes = i.type === 'card' ? [i.notes, 'Card holder: ' + i.card.holder, 'Number: ' + i.card.number, 'Expiry: ' + i.card.expiry, 'CVV: ' + i.card.cvv, ...extra].filter(Boolean).join('\n') : [i.notes, ...extra].filter(Boolean).join('\n');
    lines.push([ (i.tags || [])[0] || '', i.favorite ? 1 : '', i.type === 'note' ? 'note' : 'login', i.name, notes, '', 0, i.url, i.username, i.password, i.totp ].map((v, n) => csvCell(v, n !== 9 && n !== 10)).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/* ---------- search ---------- */
export function matches(item, q) {
  if (!q) return true;
  const tpl = TEMPLATES[item.type];
  const fieldText = tpl ? tpl.fields.filter((f) => !isSecretField(f)).map((f) => (item.fields || {})[f.k] || '') : [];
  const customText = (item.custom || []).filter((c) => !c.secret).map((c) => c.label + ' ' + c.value);
  const hay = [item.name, item.username, item.url, item.notes, (item.tags || []).join(' '), ...fieldText, ...customText].join('\n').toLowerCase();
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
  const expiring = [];
  for (const it of items) {
    const tpl = TEMPLATES[it.type];
    if (it.deleted || !tpl) continue;
    for (const f of tpl.fields) if (f.expiry && it.fields[f.k]) { const d = daysUntil(it.fields[f.k], now); if (d !== null && d <= 60) expiring.push({ item: it, label: f.l, date: it.fields[f.k], days: d }); }
  }
  expiring.sort((a, b) => a.days - b.days);
  const reused = [...byPw.values()].filter((g) => g.length > 1);
  const reusedCount = reused.reduce((n, g) => n + g.length, 0);
  const n = logins.length - missing.length;
  const penalty = n ? (weak.length * 2 + reusedCount * 2 + old.length * 0.5 + insecure.length) / n : 0;
  const score = n ? Math.max(0, Math.round(100 - Math.min(1, penalty / 2) * 100)) : 100;
  return { weak, old, insecure, missing, reused, expiring, score, total: logins.length };
}

export function totpValid(s) { try { parseTotp(s); return true; } catch { return false; } }
export { ITER_DEFAULT };
