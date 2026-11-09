/* Password / passphrase / PIN generation. All randomness comes from crypto.getRandomValues
   with rejection sampling, so every symbol is exactly uniform (no modulo bias). */

import { WORDS } from './wordlist.js';

export const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIGUOUS = /[O0oIl1|`'"]/g;

export function randInt(max) {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) throw new RangeError('randInt: bad range');
  if (max === 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(buf); if (buf[0] < limit) return buf[0] % max; }
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = randInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export const DEFAULTS = { length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false, customSymbols: '' };

function pools(o) {
  const out = [];
  for (const k of ['lower', 'upper', 'digits', 'symbols']) {
    if (!o[k]) continue;
    let chars = k === 'symbols' && o.customSymbols ? Array.from(new Set(o.customSymbols)).join('') : SETS[k];
    if (o.noAmbiguous) chars = chars.replace(AMBIGUOUS, '');
    if (chars) out.push(chars);
  }
  return out;
}

export function passwordEntropy(o = DEFAULTS) {
  const p = pools({ ...DEFAULTS, ...o });
  const n = new Set(p.join('')).size;
  return n > 1 ? Math.max(0, Math.floor(o.length || DEFAULTS.length)) * Math.log2(n) : 0;
}

/* Guarantees at least one character from every enabled set, then shuffles. */
export function generatePassword(opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const length = Math.max(4, Math.min(256, Math.floor(o.length)));
  const p = pools(o);
  if (!p.length) throw new Error('Choose at least one character set.');
  const all = Array.from(new Set(p.join('')));
  const out = [];
  if (length >= p.length) for (const set of p) out.push(set[randInt(set.length)]);
  while (out.length < length) out.push(all[randInt(all.length)]);
  return shuffle(out).join('');
}

export const PASSPHRASE_DEFAULTS = { words: 5, separator: '-', capitalize: false, number: false };

export function passphraseEntropy(o = PASSPHRASE_DEFAULTS) {
  const w = Math.max(1, o.words || 5);
  return w * Math.log2(WORDS.length) + (o.number ? Math.log2(10 * w) : 0) + (o.capitalize ? 0 : 0);
}

export function generatePassphrase(opt = {}) {
  const o = { ...PASSPHRASE_DEFAULTS, ...opt };
  const n = Math.max(3, Math.min(16, Math.floor(o.words)));
  const words = Array.from({ length: n }, () => WORDS[randInt(WORDS.length)]);
  if (o.capitalize) for (let i = 0; i < words.length; i++) words[i] = words[i][0].toUpperCase() + words[i].slice(1);
  if (o.number) { const i = randInt(n); words[i] += String(randInt(10)); }
  return words.join(o.separator === undefined ? '-' : o.separator);
}

export function generatePin(len = 6) {
  const n = Math.max(4, Math.min(24, Math.floor(len)));
  return Array.from({ length: n }, () => randInt(10)).join('');
}
