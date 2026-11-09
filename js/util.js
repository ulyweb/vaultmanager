/* Small helpers shared by the app and the tests. No DOM access at import time. */

export const te = new TextEncoder();
export const td = new TextDecoder('utf-8', { fatal: true });

export const b64 = {
  enc(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str) {
    const s = atob(str.replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const fmtDate = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '—');
export const fmtInt = (n) => Number(n).toLocaleString('en-US');
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/* Hostname for display / matching; tolerant of bare "example.com" input. */
export function hostOf(url) {
  if (!url) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function safeHref(url) {
  if (!url) return '';
  const u = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url;
  try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : ''; } catch { return ''; }
}
