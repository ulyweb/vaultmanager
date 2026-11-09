/* VaultManager cryptography. WebCrypto only — no third-party crypto code.

   Vault at rest (same key hierarchy as ulyOS):
     A random 256-bit master key M encrypts the vault (AES-256-GCM, fresh 96-bit IV on every write).
     M is stored only *wrapped* (AES-GCM) by a key-encryption key derived from
       - the master password:  PBKDF2-HMAC-SHA256, 600,000 rounds, random 16-byte salt, and
       - optionally a 256-bit recovery key (HKDF-SHA256).
     Changing the password re-wraps M; the vault data is untouched.

   QR / backup payload (byte-compatible with QR Seal v2, so QR Seal can open VaultManager codes):
     [2][iterations u32 BE][salt 16][iv 12][AES-256-GCM ciphertext || 16-byte tag], base64.
     key = PBKDF2-HMAC-SHA256(NFKC(password), salt, iterations); the 5 header bytes are GCM additional data. */

import { te, td, b64, concat } from './util.js';

export const ITER_DEFAULT = 600000;
export const ITER_MIN = 100000;
export const ITER_MAX = 10000000;
const SALT = 16, IV = 12, TAG = 16, HDR = 5;

const subtle = () => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) throw new Error('WebCrypto is unavailable. Open VaultManager over https:// or http://localhost.');
  return globalThis.crypto.subtle;
};
export const available = () => !!(globalThis.crypto && globalThis.crypto.subtle);
export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const norm = (s) => String(s).normalize('NFKC');
export const wipe = (u8) => { if (u8 && u8.fill) u8.fill(0); };

/* ---------- key derivation ---------- */
export async function pbkdf2Bits(password, salt, iterations, bits = 256) {
  const base = await subtle().importKey('raw', te.encode(norm(password)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, bits));
}

async function passwordKey(password, salt, iterations, usage) {
  const base = await subtle().importKey('raw', te.encode(norm(password)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

async function hkdfKey(raw, info, usage = ['encrypt', 'decrypt']) {
  const base = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

async function gcmSeal(key, plain, aad) {
  const iv = rand(IV);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plain));
  return { iv, ct };
}
const gcmOpen = async (key, iv, ct, aad) => new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, ct));

/* ---------- QR Seal v2 payloads (text ⇄ base64) ---------- */
export function sealHeader(iterations) {
  const h = new Uint8Array(HDR);
  h[0] = 2;
  new DataView(h.buffer).setUint32(1, iterations, false);
  return h;
}

export async function sealText(text, password, opt = {}) {
  const iterations = opt.iterations || ITER_DEFAULT;
  if (!password) throw new Error('A password is required.');
  if (iterations < ITER_MIN || iterations > ITER_MAX) throw new Error('Iteration count out of range.');
  const salt = opt.salt || rand(SALT), iv = opt.iv || rand(IV), hdr = sealHeader(iterations);
  const key = await passwordKey(password, salt, iterations, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: hdr, tagLength: 128 }, key, te.encode(text)));
  return b64.enc(concat(hdr, salt, iv, ct));
}

export function inspectSeal(payload) {
  let p;
  try { p = b64.dec(String(payload).trim()); } catch { return { ok: false, why: 'Not a valid base64 payload.' }; }
  if (p.length < HDR + SALT + IV + TAG || p[0] !== 2) return { ok: false, why: 'Not a QR Seal v2 / VaultManager payload.' };
  const iterations = new DataView(p.buffer, p.byteOffset).getUint32(1, false);
  if (iterations < ITER_MIN || iterations > ITER_MAX) return { ok: false, why: 'Iteration count ' + iterations + ' is outside the accepted range.' };
  return { ok: true, version: 2, iterations, bytes: p.length, ctLen: p.length - HDR - SALT - IV - TAG };
}

export const BAD = 'Wrong password, or the data was damaged or tampered with.';

export async function openText(payload, password) {
  const info = inspectSeal(payload);
  if (!info.ok) throw new Error(info.why);
  const p = b64.dec(String(payload).trim());
  const hdr = p.subarray(0, HDR), salt = p.subarray(HDR, HDR + SALT), iv = p.subarray(HDR + SALT, HDR + SALT + IV), ct = p.subarray(HDR + SALT + IV);
  try {
    const key = await passwordKey(password, salt, info.iterations, ['decrypt']);
    return td.decode(await gcmOpen(key, iv, ct, hdr));
  } catch { throw new Error(BAD); }
}

/* ---------- recovery key (Crockford base32, 52 chars in 13 groups of 4) ---------- */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function recoveryEncode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join('-');
}
export function recoveryDecode(text) {
  const s = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('That recovery key contains an invalid character.');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  if (out.length !== 32) throw new Error('A recovery key has 52 characters.');
  return Uint8Array.from(out);
}

/* ---------- the vault record ---------- */
const wrapAad = (id, type) => te.encode('VaultManager-wrap-v1:' + id + ':' + type);
const dataAad = (id) => te.encode('VaultManager-data-v1:' + id);
const DATA_INFO = 'VaultManager data key v1';
const RECOVERY_INFO = 'VaultManager recovery wrap v1';

async function wrapMaster(kek, mk, id, type) {
  const { iv, ct } = await gcmSeal(kek, mk, wrapAad(id, type));
  return { iv: b64.enc(iv), ct: b64.enc(ct) };
}
async function passwordWrap(password, mk, id, iterations = ITER_DEFAULT) {
  const salt = rand(SALT);
  const kek = await passwordKey(password, salt, iterations, ['encrypt']);
  return { type: 'password', salt: b64.enc(salt), iter: iterations, ...(await wrapMaster(kek, mk, id, 'password')) };
}
async function recoveryWrap(recoveryBytes, mk, id) {
  const kek = await hkdfKey(recoveryBytes, RECOVERY_INFO, ['encrypt']);
  return { type: 'recovery', added: Date.now(), ...(await wrapMaster(kek, mk, id, 'recovery')) };
}

const validWrap = (w) => w && typeof w.iv === 'string' && typeof w.ct === 'string' &&
  ((w.type === 'password' && typeof w.salt === 'string' && Number.isInteger(w.iter) && w.iter >= ITER_MIN && w.iter <= ITER_MAX) || w.type === 'recovery');

/* A session holds the unlocked secrets. lock() zeroes the raw master key. */
export class Session {
  constructor(id, mk, dataKey, wraps) { this.id = id; this.mk = mk; this.dataKey = dataKey; this.wraps = wraps; }
  lock() { wipe(this.mk); this.mk = null; this.dataKey = null; }

  /* Encrypt `data` into a storable record. A fresh IV is used on every call. */
  async seal(data) {
    const { iv, ct } = await gcmSeal(this.dataKey, te.encode(JSON.stringify(data)), dataAad(this.id));
    return { v: 1, id: this.id, wraps: this.wraps, iv: b64.enc(iv), ct: b64.enc(ct) };
  }

  async verifyPassword(password) {
    const w = this.wraps.find((x) => x.type === 'password');
    try { await unwrap(await passwordKey(password, b64.dec(w.salt), w.iter, ['decrypt']), w, this.id, 'password'); return true; } catch { return false; }
  }

  /* Re-wrap the master key under a new password (new random salt). Data is untouched. */
  async changePassword(newPassword, iterations = ITER_DEFAULT) {
    const w = await passwordWrap(newPassword, this.mk, this.id, iterations);
    this.wraps = this.wraps.map((x) => (x.type === 'password' ? w : x));
  }

  /* Create (or replace) the recovery wrap. Returns the printable key; it is not stored anywhere. */
  async createRecovery() {
    const bytes = rand(32);
    const w = await recoveryWrap(bytes, this.mk, this.id);
    this.wraps = this.wraps.filter((x) => x.type !== 'recovery').concat(w);
    const text = recoveryEncode(bytes);
    wipe(bytes);
    return text;
  }
  removeRecovery() { this.wraps = this.wraps.filter((x) => x.type !== 'recovery'); }
  hasRecovery() { return this.wraps.some((x) => x.type === 'recovery'); }
  iterations() { const w = this.wraps.find((x) => x.type === 'password'); return w ? w.iter : 0; }
}

async function unwrap(kek, w, id, type) { return gcmOpen(kek, b64.dec(w.iv), b64.dec(w.ct), wrapAad(id, type)); }

export async function createVault(password, data, opt = {}) {
  const id = Array.from(rand(8), (x) => x.toString(16).padStart(2, '0')).join('');
  const mk = rand(32);
  const dataKey = await hkdfKey(mk, DATA_INFO);
  const wraps = [await passwordWrap(password, mk, id, opt.iterations || ITER_DEFAULT)];
  const session = new Session(id, mk, dataKey, wraps);
  return { session, record: await session.seal(data) };
}

/* secret = { password } or { recovery } . Throws Error('bad-secret') when it does not open the vault. */
export async function openVault(record, secret) {
  if (!record || record.v !== 1 || !Array.isArray(record.wraps) || !record.wraps.every(validWrap) || typeof record.iv !== 'string' || typeof record.ct !== 'string' || typeof record.id !== 'string') {
    throw new Error('The stored vault looks corrupted.');
  }
  let mk;
  try {
    if (secret.recovery) {
      const w = record.wraps.find((x) => x.type === 'recovery');
      if (!w) throw new Error('no recovery wrap');
      const bytes = recoveryDecode(secret.recovery);
      mk = await unwrap(await hkdfKey(bytes, RECOVERY_INFO, ['decrypt']), w, record.id, 'recovery');
      wipe(bytes);
    } else {
      const w = record.wraps.find((x) => x.type === 'password');
      mk = await unwrap(await passwordKey(secret.password, b64.dec(w.salt), w.iter, ['decrypt']), w, record.id, 'password');
    }
  } catch (e) { if (/invalid character|52 characters/.test(e.message)) throw e; throw new Error('bad-secret'); }
  const dataKey = await hkdfKey(mk, DATA_INFO);
  let data;
  try { data = JSON.parse(td.decode(await gcmOpen(dataKey, b64.dec(record.iv), b64.dec(record.ct), dataAad(record.id)))); }
  catch { wipe(mk); throw new Error('The vault failed its integrity check (damaged or tampered).'); }
  return { session: new Session(record.id, mk, dataKey, record.wraps), data };
}
