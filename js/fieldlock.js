/* Per-field passcode lock (for the few fields that deserve a passcode of their own: the recovery seed phrase and the 25th word).

   A locked field is stored as   "VMFL1:" + QR-Seal-v2 text (PBKDF2-SHA256 600k → AES-256-GCM) of the JSON-encoded value,
   sealed under a passcode that is never stored. It sits in the item's `fields` like any other string, so sync, backups, QR codes,
   the item-level lock and the merge logic need no special handling. An opened field is kept in memory only (ten minutes, or until
   the vault locks / Purge memory), keyed by its sealed text — which is unique per seal, so two fields never share an entry.
   No DOM in here: it is unit-tested in Node. */

import { sealText, openText } from './crypto.js';

export const FIELD_PREFIX = 'VMFL1:';
export const FIELD_CODE_MIN = 6;
export const FIELD_OPEN_MS = 10 * 60 * 1000;
export const MAX_SEALED = 20000;   // sealed values are longer than the text inside, so they get the multiline limit wherever fields are sanitised

export const isFieldLocked = (v) => typeof v === 'string' && v.startsWith(FIELD_PREFIX) && /^[A-Za-z0-9+/=]+$/.test(v.slice(FIELD_PREFIX.length));

const opened = new Map();   // sealed text → { value, at }
const fails = new Map();    // sealed text → { n, until }

export async function sealField(value, code, opt = {}) {
  if (String(code || '').length < FIELD_CODE_MIN) throw new Error('Use at least ' + FIELD_CODE_MIN + ' characters for the passcode.');
  return FIELD_PREFIX + (await sealText(JSON.stringify(String(value)), String(code), opt));   // a freshly locked field starts closed
}

/* throws Error('bad-passcode') for a wrong passcode, with a growing wait after repeated mistakes */
export async function openField(sealed, code) {
  if (!isFieldLocked(sealed)) throw new Error('This value is not locked.');
  const f = fails.get(sealed) || { n: 0, until: 0 };
  if (Date.now() < f.until) throw new Error('Too many wrong passcodes. Wait ' + Math.ceil((f.until - Date.now()) / 1000) + 's.');
  let value;
  try { value = JSON.parse(await openText(sealed.slice(FIELD_PREFIX.length), String(code || ''))); }
  catch { f.n++; f.until = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(f.n, 6)); fails.set(sealed, f); throw new Error('bad-passcode'); }
  fails.delete(sealed);
  opened.set(sealed, { value, at: Date.now() });
  return value;
}

/* the readable value of a locked field while it is open, otherwise null */
export function fieldValue(sealed) {
  const o = opened.get(sealed);
  if (!o) return null;
  if (Date.now() - o.at > FIELD_OPEN_MS) { opened.delete(sealed); return null; }
  return o.value;
}
export const relockField = (sealed) => { opened.delete(sealed); };
export const clearOpenFields = () => { const n = opened.size; opened.clear(); return n; };
export const openFieldCount = () => opened.size;
