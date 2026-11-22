/* TOTP (RFC 6238) / HOTP (RFC 4226) with WebCrypto HMAC. Compatible with Google Authenticator,
   Authy, 1Password, Bitwarden etc. via otpauth:// URIs and base32 secrets. */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not a valid base32 secret.');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  if (!out.length) throw new Error('Empty secret.');
  return Uint8Array.from(out);
}

const HASH = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export async function hotp(secret, counter, digits = 6, algo = 'SHA1') {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: HASH[algo] || 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter), false);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % Math.pow(10, digits)).padStart(digits, '0');
}

/* `input` is a base32 secret or a full otpauth://totp/... URI. */
export function parseTotp(input) {
  const raw = String(input || '').trim();
  const cfg = { secret: raw, digits: 6, period: 30, algo: 'SHA1', issuer: '', label: '' };
  if (/^otpauth:\/\//i.test(raw)) {
    const u = new URL(raw);
    if (u.hostname.toLowerCase() !== 'totp') throw new Error('Only time-based (TOTP) codes are supported.');
    cfg.secret = u.searchParams.get('secret') || '';
    cfg.digits = parseInt(u.searchParams.get('digits') || '6', 10);
    cfg.period = parseInt(u.searchParams.get('period') || '30', 10);
    cfg.algo = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    cfg.issuer = u.searchParams.get('issuer') || '';
    cfg.label = decodeURIComponent(u.pathname.replace(/^\//, ''));
  }
  if (![6, 7, 8].includes(cfg.digits) || !(cfg.period > 0 && cfg.period <= 300) || !HASH[cfg.algo]) throw new Error('Unsupported TOTP parameters.');
  base32Decode(cfg.secret);
  return cfg;
}

export async function totpNow(input, nowMs = Date.now()) {
  const cfg = typeof input === 'string' ? parseTotp(input) : input;
  const counter = Math.floor(nowMs / 1000 / cfg.period);
  const code = await hotp(base32Decode(cfg.secret), counter, cfg.digits, cfg.algo);
  const remaining = cfg.period - (Math.floor(nowMs / 1000) % cfg.period);
  return { code, remaining, period: cfg.period };
}

/* Read the text of a scanned 2FA setup QR. Returns { value, issuer, account } for an otpauth://totp link,
   or { error } with a plain explanation of why it cannot be used. Nothing here touches the network. */
export function totpFromQR(text) {
  const t = String(text || '').trim();
  if (/^otpauth-migration:\/\//i.test(t)) return { error: 'This is a Google Authenticator export QR (several accounts in one). VaultManager cannot read that format. Scan each site’s own 2FA setup QR instead, or paste the setup key the site shows.' };
  if (/^otpauth:\/\/hotp\//i.test(t)) return { error: 'This QR is for a counter-based (HOTP) code. Only time-based codes (TOTP) are supported, which is what almost every site uses.' };
  if (!/^otpauth:\/\/totp\//i.test(t)) return { error: 'This QR is not a 2FA setup code. A 2FA setup QR holds a link that starts with otpauth://totp/.' };
  try {
    const cfg = parseTotp(t), label = cfg.label || '', i = label.indexOf(':');
    return { value: t, issuer: cfg.issuer || (i > 0 ? label.slice(0, i).trim() : ''), account: (i >= 0 ? label.slice(i + 1) : label).trim() };
  } catch (e) { return { error: 'This 2FA QR could not be used: ' + (e && e.message ? e.message : 'it is not valid') + '.' }; }
}
