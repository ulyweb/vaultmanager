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
export const ITER_MAX = 5000000;   // a hostile QR / backup must not be able to stall the page for minutes
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
const PASSKEY_INFO = 'VaultManager passkey wrap v1';

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
  ((w.type === 'password' && typeof w.salt === 'string' && Number.isInteger(w.iter) && w.iter >= ITER_MIN && w.iter <= ITER_MAX) || w.type === 'recovery' ||
   (w.type === 'passkey' && typeof w.cred === 'string' && typeof w.prf === 'string'));

/* Second layer for locked items: file bytes sealed under a random per-item key that lives inside the item's passcode seal. */
const INNER_AAD = new TextEncoder().encode('VaultManager-itemlock-att-v1');
export async function innerSeal(rawKey, bytes) {
  const k = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const { iv, ct } = await gcmSeal(k, bytes, INNER_AAD);
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length); return out;
}
export async function innerOpen(rawKey, data) {
  const k = await subtle().importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return gcmOpen(k, data.slice(0, IV), data.slice(IV), INNER_AAD);
}

/* A session holds the unlocked secrets. lock() zeroes the raw master key. */
export class Session {
  constructor(id, mk, dataKey, wraps) { this.id = id; this.mk = mk; this.dataKey = dataKey; this.wraps = wraps; }
  lock() { wipe(this.mk); this.mk = null; this.dataKey = null; }

  /* Encrypt `data` into a storable record. A fresh IV is used on every call. */
  async seal(data) {
    const { iv, ct } = await gcmSeal(this.dataKey, te.encode(JSON.stringify(data)), dataAad(this.id));
    return { v: 1, id: this.id, wraps: this.wraps, iv: b64.enc(iv), ct: b64.enc(ct) };
  }

  /* Attachments: each file is its own AES-GCM message under the data key, bound to this vault and file id. */
  async sealBlob(attId, bytes) {
    const { iv, ct } = await gcmSeal(this.dataKey, bytes, te.encode('VaultManager-att-v1:' + this.id + ':' + attId));
    return { iv, ct };
  }
  async openBlob(attId, rec) {
    return gcmOpen(this.dataKey, rec.iv, rec.ct, te.encode('VaultManager-att-v1:' + this.id + ':' + attId));
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

  /* Passkeys (WebAuthn PRF): the authenticator returns a 256-bit secret for `prfSalt`; it never leaves the
     authenticator except as this derived value, and it wraps the master key via HKDF. No offline guessing is
     possible without the authenticator. The wrap is bound to the credential id. */
  async addPasskey(credB64, prfSaltB64, prfOutput, label) {
    const kek = await hkdfKey(prfOutput, PASSKEY_INFO, ['encrypt']);
    const w = { type: 'passkey', cred: credB64, prf: prfSaltB64, label: String(label || 'Passkey').slice(0, 40), added: Date.now(), ...(await wrapMaster(kek, this.mk, this.id, 'passkey:' + credB64)) };
    this.wraps = this.wraps.filter((x) => !(x.type === 'passkey' && x.cred === credB64)).concat(w);
    return w;
  }
  removePasskey(credB64) { this.wraps = this.wraps.filter((x) => !(x.type === 'passkey' && x.cred === credB64)); }
  passkeys() { return this.wraps.filter((x) => x.type === 'passkey'); }
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

/* secret = { password } | { recovery } | { passkey: { cred, prf } } . Throws Error('bad-secret') when it does not open the vault. */
export async function openVault(record, secret) {
  if (!record || record.v !== 1 || !Array.isArray(record.wraps) || !record.wraps.every(validWrap) || typeof record.iv !== 'string' || typeof record.ct !== 'string' || typeof record.id !== 'string') {
    throw new Error('The stored vault looks corrupted.');
  }
  let mk;
  try {
    if (secret.passkey) {
      const w = record.wraps.find((x) => x.type === 'passkey' && x.cred === secret.passkey.cred);
      if (!w) throw new Error('no passkey wrap');
      mk = await unwrap(await hkdfKey(secret.passkey.prf, PASSKEY_INFO, ['decrypt']), w, record.id, 'passkey:' + w.cred);
    } else if (secret.recovery) {
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

/* ---------- encrypted files (VMF1): any photo or file sealed with a password, opened only with that password ----------
   file = "VMF1" | version 1 | iterations (uint32) | salt 16 | iv 12 | AES-256-GCM ciphertext; the first 25 bytes are authenticated (AAD).
   inside: uint32 length of a JSON header {name, type, size} | that JSON | the original bytes, so the name and type come back too. */
const FILE_MAGIC = [0x56, 0x4d, 0x46, 0x31];   // "VMF1"
export const MAX_SEAL_FILE = 100 * 1024 * 1024;
export async function sealFile(bytes, meta, password, opt = {}) {
  if (!password) throw new Error('A password is required.');
  if (bytes.length > MAX_SEAL_FILE) throw new Error(`That file is larger than ${MAX_SEAL_FILE / 1048576} MB.`);
  const iterations = opt.iterations || ITER_DEFAULT, salt = rand(SALT), iv = rand(IV);
  const hdr = new Uint8Array(9 + SALT); hdr.set(FILE_MAGIC); hdr[4] = 1; new DataView(hdr.buffer).setUint32(5, iterations, false); hdr.set(salt, 9);
  const m = te.encode(JSON.stringify({ name: String(meta.name || 'file').slice(0, 200), type: String(meta.type || 'application/octet-stream').slice(0, 100), size: bytes.length }));
  const plain = new Uint8Array(4 + m.length + bytes.length); new DataView(plain.buffer).setUint32(0, m.length, false); plain.set(m, 4); plain.set(bytes, 4 + m.length);
  const key = await passwordKey(password, salt, iterations, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: hdr, tagLength: 128 }, key, plain));
  plain.fill(0);
  return concat(hdr, iv, ct);
}
export const isSealedFile = (u8) => u8 && u8.length > 9 + SALT + IV + 16 && FILE_MAGIC.every((b, i) => u8[i] === b);
export async function openFile(u8, password) {
  if (!isSealedFile(u8)) throw new Error('This is not a VaultManager encrypted file (.vmenc).');
  if (u8[4] !== 1) throw new Error('This encrypted file is from a newer version of VaultManager.');
  const iterations = new DataView(u8.buffer, u8.byteOffset + 5, 4).getUint32(0, false);
  if (iterations < ITER_MIN || iterations > ITER_MAX) throw new Error('This file is damaged (iteration count out of range).');
  const hdr = u8.slice(0, 9 + SALT), salt = hdr.slice(9), iv = u8.slice(9 + SALT, 9 + SALT + IV), ct = u8.slice(9 + SALT + IV);
  const key = await passwordKey(password, salt, iterations, ['decrypt']);
  let plain; try { plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: hdr, tagLength: 128 }, key, ct)); } catch { throw new Error('Wrong password, or the file was changed or damaged.'); }
  const n = new DataView(plain.buffer, plain.byteOffset, 4).getUint32(0, false);
  let meta; try { meta = JSON.parse(new TextDecoder().decode(plain.slice(4, 4 + n))); } catch { throw new Error('This file is damaged.'); }
  return { name: String(meta.name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200), type: String(meta.type || 'application/octet-stream').slice(0, 100), bytes: plain.slice(4 + n), iterations };
}
