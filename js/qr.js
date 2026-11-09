/* QR encode / decode and multi-QR chunking.
   Encoding uses vendor/qrcode.js (MIT), decoding uses the browser's BarcodeDetector when present and
   vendor/jsQR.js (Apache-2.0) otherwise. Both are loaded lazily, only when a QR feature is used. */

const loaded = {};
function loadScript(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  return loaded[src];
}

/* Largest payload first tried at ECC M (better for print / screens); falls back to L for big payloads. */
export async function makeQR(text) {
  await loadScript('vendor/qrcode.js');
  for (const ecc of ['M', 'L']) {
    try {
      const qr = globalThis.qrcode(0, ecc);
      qr.addData(text, 'Byte'); qr.make();
      return { qr, ecc, size: qr.getModuleCount(), version: (qr.getModuleCount() - 17) / 4 };
    } catch (e) { if (ecc === 'L') throw new Error('Too much data for a single QR code (' + text.length + ' characters). Use the multi-QR backup instead.'); }
  }
}

export async function drawQR(canvas, text, { scale = 6, margin = 4 } = {}) {
  const r = await makeQR(text);
  const n = r.size, px = (n + margin * 2) * scale;
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (r.qr.isDark(y, x)) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
  return r;
}

/* Decode from ImageData / canvas / bitmap. Returns the text or null. */
export async function decodeImage(source) {
  if ('BarcodeDetector' in globalThis) {
    try {
      const det = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
      const found = await det.detect(source);
      if (found && found[0] && found[0].rawValue) return found[0].rawValue;
    } catch { /* fall through to jsQR */ }
  }
  await loadScript('vendor/jsQR.js');
  const c = document.createElement('canvas');
  const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const r = globalThis.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}

export async function decodeFile(file) {
  const bmp = await createImageBitmap(file);
  try { return await decodeImage(bmp); } finally { if (bmp.close) bmp.close(); }
}

/* Camera scanner. onText(text) is called for each new decoded value; returns a stop() function. */
export async function startScanner(video, onText) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream; video.setAttribute('playsinline', ''); await video.play();
  let stopped = false, last = '';
  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2) {
      try { const t = await decodeImage(video); if (t && t !== last) { last = t; onText(t); } } catch { /* keep scanning */ }
    }
    setTimeout(tick, 180);
  };
  tick();
  return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}

/* ---------- multi-QR chunks: "VMQ1|<set>|<index>|<count>|<data>" ---------- */
export function chunkPayload(payload, size = 900, setId = null) {
  const id = setId || Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  const count = Math.max(1, Math.ceil(payload.length / size));
  const out = [];
  for (let i = 0; i < count; i++) out.push(`VMQ1|${id}|${i + 1}|${count}|${payload.slice(i * size, (i + 1) * size)}`);
  return out;
}

export function parseChunk(text) {
  const m = /^VMQ1\|([0-9a-f]{6})\|(\d{1,3})\|(\d{1,3})\|([A-Za-z0-9+/=:]+)$/.exec(String(text).trim());
  if (!m) return null;
  const index = +m[2], count = +m[3];
  if (index < 1 || index > count) return null;
  return { set: m[1], index, count, data: m[4] };
}

export class ChunkAssembler {
  constructor() { this.set = null; this.count = 0; this.parts = new Map(); }
  /* Returns { status: 'new'|'dup'|'other-set'|'invalid', have, count, done } */
  add(text) {
    const c = parseChunk(text);
    if (!c) return { status: 'invalid', have: this.parts.size, count: this.count, done: false };
    if (this.set && c.set !== this.set) return { status: 'other-set', have: this.parts.size, count: this.count, done: false };
    this.set = c.set; this.count = c.count;
    const dup = this.parts.has(c.index);
    this.parts.set(c.index, c.data);
    return { status: dup ? 'dup' : 'new', have: this.parts.size, count: this.count, done: this.parts.size === this.count };
  }
  missing() { const m = []; for (let i = 1; i <= this.count; i++) if (!this.parts.has(i)) m.push(i); return m; }
  payload() { if (this.parts.size !== this.count) throw new Error('Not all QR codes have been scanned yet.'); let s = ''; for (let i = 1; i <= this.count; i++) s += this.parts.get(i); return s; }
}
