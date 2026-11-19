/* Shamir secret sharing over GF(256): split a secret into N shares so that any K of them recover it and fewer than K reveal nothing
   (information-theoretically: every possible secret is equally likely given K-1 shares). Used by Family recovery to split a vault, backup or QR
   password between people (for example 2 of 3: spouse, a relative, a safe) so that no single person or place can open it alone, yet no single lost share
   locks everyone out.

   Each byte of the secret is the constant term of its own random polynomial of degree K-1 over GF(2^8) (the AES field, x^8+x^4+x^3+x+1);
   share i holds every polynomial evaluated at x = i. Coefficients come from crypto.getRandomValues. This is the standard textbook scheme; the share
   text format below is VaultManager's own (it is NOT SLIP-39 and is not interoperable with other tools).

   Share text:  VMS1-<base32 groups>   decoded bytes = 'V' 'S' 1 | k | n | x | id(4) | data(len = padded secret) | crc32(4)
   The CRC catches typing mistakes; shares are also checked against each other (same id / k / n, distinct x, extra shares must agree).
   There is deliberately no hash of the secret in a share (that would let someone test password guesses offline). */

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x ^= (x << 1) ^ ((x & 0x80) ? 0x11b : 0); x &= 0xff; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
export const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
export const gfDiv = (a, b) => { if (b === 0) throw new RangeError('divide by zero'); return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; };

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = (u8) => { let bits = 0, val = 0, out = ''; for (const b of u8) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; };
const b32dec = (s) => { let bits = 0, val = 0; const out = []; for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) throw new Error('A share contains a character that is not allowed.'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(out); };
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (const b of u8) c = CRC_T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export const MAX_SECRET_BYTES = 200;
const PAD = 32;
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });

const pack = (k, n, x, id, data) => {
  const body = new Uint8Array(10 + data.length); body.set([0x56, 0x53, 1, k, n, x]); body.set(id, 6); body.set(data, 10);
  const out = new Uint8Array(body.length + 4); out.set(body); new DataView(out.buffer).setUint32(body.length, crc32(body));
  const t = b32enc(out); return 'VMS1-' + t.match(/.{1,5}/g).join('-');
};
export function parseShare(text) {
  const t = String(text).toUpperCase().replace(/[\s-]+/g, '');
  if (!t.startsWith('VMS1')) throw new Error('That does not look like a VaultManager share (it should start with VMS1-).');
  const raw = b32dec(t.slice(4));
  if (raw.length < 15) throw new Error('That share is too short.');
  const body = raw.slice(0, raw.length - 4), want = new DataView(raw.buffer, raw.byteOffset + raw.length - 4, 4).getUint32(0);
  if (crc32(body) !== want) throw new Error('A share has a typing mistake (its check code does not match). Re-enter it carefully, or scan its QR code.');
  if (body[0] !== 0x56 || body[1] !== 0x53 || body[2] !== 1) throw new Error('That share is from a different version.');
  const k = body[3], n = body[4], x = body[5];
  if (!(k >= 2 && k <= n && x >= 1 && x <= n)) throw new Error('That share is damaged.');
  return { k, n, x, id: body.slice(6, 10), data: body.slice(10) };
}

/* secret (string) -> array of share strings; k of n */
export function split(secret, k, n, random = (u8) => crypto.getRandomValues(u8)) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 2 || n < k || n > 10) throw new RangeError('Choose 2 or more shares needed, out of at most 10.');
  const bytes = enc.encode(String(secret));
  if (!bytes.length) throw new Error('There is nothing to split.');
  if (bytes.length > MAX_SECRET_BYTES) throw new Error(`That is too long to split (limit ${MAX_SECRET_BYTES} bytes).`);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / PAD) * PAD); padded[0] = bytes.length; padded.set(bytes, 1);
  const id = random(new Uint8Array(4));
  const coef = random(new Uint8Array(padded.length * (k - 1)));
  const shares = [];
  for (let x = 1; x <= n; x++) {
    const data = new Uint8Array(padded.length);
    for (let i = 0; i < padded.length; i++) {
      let y = 0;   // Horner: ((c_{k-1} x + c_{k-2}) x + ...) x + secret
      for (let j = k - 1; j >= 1; j--) y = gfMul(y, x) ^ coef[i * (k - 1) + (j - 1)];
      data[i] = gfMul(y, x) ^ padded[i];
    }
    shares.push(pack(k, n, x, id, data));
  }
  return shares;
}

const interpolateAt = (pts, x0) => {   // Lagrange at x0 over GF(256); pts = [[x, y]...]
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    let num = 1, den = 1;
    for (let j = 0; j < pts.length; j++) if (i !== j) { num = gfMul(num, x0 ^ pts[j][0]); den = gfMul(den, pts[i][0] ^ pts[j][0]); }
    acc ^= gfMul(pts[i][1], gfDiv(num, den));
  }
  return acc;
};

/* array of share strings -> the secret string. Throws a readable error when the shares are not enough, do not belong together, or disagree. */
export function combine(texts) {
  const list = texts.map(parseShare);
  if (!list.length) throw new Error('Add the shares first.');
  const { k, n, id, data } = list[0];
  for (const s of list) {
    if (s.k !== k || s.n !== n || s.data.length !== data.length || s.id.some((b, i) => b !== id[i])) throw new Error('These shares do not belong to the same secret.');
  }
  const xs = new Set(list.map((s) => s.x));
  if (xs.size !== list.length) throw new Error('The same share was entered twice. Each person’s share is different.');
  if (list.length < k) throw new Error(`${k} shares are needed to open this, and only ${list.length} ${list.length === 1 ? 'was' : 'were'} entered.`);
  const base = list.slice(0, k), out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = interpolateAt(base.map((s) => [s.x, s.data[i]]), 0);
  for (const extra of list.slice(k)) for (let i = 0; i < data.length; i++) if (interpolateAt(base.map((s) => [s.x, s.data[i]]), extra.x) !== extra.data[i]) throw new Error('One of the shares is wrong or damaged: the shares do not agree with each other.');
  const len = out[0];
  if (len === 0 || len + 1 > out.length) throw new Error('These shares did not combine into a valid secret.');
  for (let i = len + 1; i < out.length; i++) if (out[i] !== 0) throw new Error('These shares did not combine into a valid secret.');
  try { return dec.decode(out.slice(1, 1 + len)); } catch { throw new Error('These shares did not combine into a valid secret.'); }
}
export const _pack = pack;   // for tests
export const shareInfo = (text) => { const s = parseShare(text); return { k: s.k, n: s.n, x: s.x, id: [...s.id].map((b) => b.toString(16).padStart(2, '0')).join('') }; };
