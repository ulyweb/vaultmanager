/* The vault's screen: a 160 × 120 one-bit display drawn on a canvas and used as a texture on the 3D model.
   In "game" mode it runs Key Runner (Z / A button: jump, X / B button: slide). It plays itself until someone presses a button.
   The other modes are small status screens for the chapters of the tour. No DOM besides the canvas: testable on its own. */

const W = 160, H = 120, GROUND = 98, PX = 26;
const ON = [241, 236, 224], OFF = [6, 7, 8];

export class Screen {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = W * 2; this.canvas.height = H * 2;
    this.x = this.canvas.getContext('2d', { willReadFrequently: true }); this.x.imageSmoothingEnabled = false;
    this.mode = 'game'; this.t = 0; this.auto = true; this.best = 0; this.info = {}; this.onSound = null; this.acc = 0;
    this.reset();
  }
  reset() { this.p = { y: 0, vy: 0, slide: 0 }; this.obs = []; this.next = 70; this.speed = 1.6; this.dist = 0; this.score = 0; this.hearts = 3; this.over = 0; this.hurt = 0; this.idle = 0; }
  sound(n) { if (this.onSound && !this.auto) this.onSound(n); }

  /* a person pressed something */
  input(a) {
    if (this.mode !== 'game') return;
    if (this.auto) { this.auto = false; this.reset(); return; }
    this.idle = 0;
    if (this.over) { if (this.over > 30) this.reset(); return; }
    this.act(a);
  }
  act(a) {
    const p = this.p;
    if (a === 'jump' && p.y === 0 && !p.slide) { p.vy = 3.5; this.sound('jump'); }
    if (a === 'slide' && p.y === 0 && !p.slide) { p.slide = 30; this.sound('slide'); }
  }

  /* advance by real time, in fixed 60 Hz steps */
  advance(dt) { this.acc = Math.min(0.25, this.acc + dt); while (this.acc >= 1 / 60) { this.acc -= 1 / 60; this.step(); } this.draw(); }

  step() {
    this.t++;
    if (this.mode !== 'game') return;
    if (this.over) { this.over++; if (this.auto ? this.over > 100 : this.over > 420) { this.auto = true; this.reset(); } return; }
    if (!this.auto && ++this.idle > 1200) { this.auto = true; this.reset(); }   // hand the screen back to the demo after 20 quiet seconds
    const p = this.p;
    p.y += p.vy; if (p.y > 0 || p.vy > 0) p.vy -= 0.2; if (p.y <= 0) { p.y = 0; p.vy = 0; }
    if (p.slide) p.slide--;
    this.dist += this.speed; this.score = Math.floor(this.dist / 6); this.speed = Math.min(3.1, 1.6 + this.dist / 5200);
    if (--this.next <= 0) { this.obs.push({ x: W + 8, high: Math.random() < 0.38 }); this.next = (74 + Math.random() * 64) * (1.6 / this.speed) + 14; }
    for (const o of this.obs) {
      o.x -= this.speed;
      const d = o.x - PX;
      if (this.auto && d > 0 && d < 27 + this.speed * 4) this.act(o.high ? 'slide' : 'jump');
      if (!o.hit && o.x < PX + 9 && o.x + 8 > PX + 1) {
        const clear = o.high ? p.slide > 0 : p.y > 9;
        if (!clear) { o.hit = true; this.hearts--; this.hurt = 26; this.sound('hit'); if (this.hearts <= 0) { this.over = 1; if (!this.auto) this.best = Math.max(this.best, this.score); } }
      }
    }
    this.obs = this.obs.filter((o) => o.x > -14);
    if (this.hurt) this.hurt--;
    if (!this.auto) this.best = Math.max(this.best, this.score);
  }

  /* ---- drawing (everything is rectangles and small text, then snapped to two colours) ---- */
  R(x, y, w, h) { this.x.fillRect(Math.round(x) * 2, Math.round(y) * 2, Math.round(w) * 2, Math.round(h) * 2); }
  T(s, x, y, size = 9, align = 'left') { const c = this.x; c.font = `bold ${size * 2}px ui-monospace, Menlo, Consolas, monospace`; c.textAlign = align; c.textBaseline = 'top'; c.fillText(s, x * 2, y * 2); }
  frame(x, y, w, h) { this.R(x, y, w, 1); this.R(x, y + h - 1, w, 1); this.R(x, y, 1, h); this.R(x + w - 1, y, 1, h); }
  heart(x, y) { this.R(x + 1, y, 2, 1); this.R(x + 5, y, 2, 1); this.R(x, y + 1, 8, 2); this.R(x + 1, y + 3, 6, 1); this.R(x + 2, y + 4, 4, 1); this.R(x + 3, y + 5, 2, 1); }
  padlock(x, y, s = 1) { this.R(x + 3 * s, y, 6 * s, s); this.R(x + 2 * s, y + s, 2 * s, 4 * s); this.R(x + 8 * s, y + s, 2 * s, 4 * s); this.R(x, y + 5 * s, 12 * s, 9 * s); this.x.fillStyle = '#000'; this.R(x + 5 * s, y + 8 * s, 2 * s, 3 * s); this.x.fillStyle = '#fff'; }
  runner(x, y, slide) {
    const leg = Math.floor(this.t / 5) % 2;
    if (slide) { this.frame(x - 2, y + 9, 6, 6); this.R(x + 4, y + 11, 9, 2); this.R(x + 9, y + 13, 2, 2); this.R(x + 12, y + 13, 1, 2); return; }
    this.frame(x + 1, y, 7, 7);                                            // the key's bow is the head
    this.R(x + 8, y + 3, 7, 1); this.R(x + 11, y + 4, 1, 2); this.R(x + 13, y + 4, 1, 2);   // shaft and teeth
    this.R(x + 3, y + 7, 3, 5);                                            // body
    this.R(x + (leg ? 1 : 3), y + 12, 2, 4); this.R(x + (leg ? 6 : 4), y + 12, 2, leg ? 3 : 4);
    this.R(x, y + 8, 3, 1);                                                // trailing arm
  }
  spike(x) { for (let i = 0; i < 4; i++) this.R(x + i, GROUND - 1 - i * 2, 8 - i * 2, 2); }
  hook(x) { this.R(x + 3, 0, 1, 74); this.frame(x, 74, 8, 9); this.R(x + 3, 83, 2, 3); }

  draw() {
    const c = this.x;
    c.fillStyle = '#000'; c.fillRect(0, 0, W * 2, H * 2); c.fillStyle = '#fff';
    (this['draw_' + this.mode] || this.draw_game).call(this);
    const im = c.getImageData(0, 0, W * 2, H * 2), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] > 110 ? ON : OFF; d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = 255; }
    c.putImageData(im, 0, 0);
  }

  draw_game() {
    const p = this.p, scroll = Math.floor(this.dist);
    for (let i = 0; i < 3; i++) { const cx = ((i * 71 + 190 - scroll * 0.25) % 220 + 220) % 220 - 30, cy = 26 + (i % 2) * 9; this.R(cx + 3, cy, 10, 1); this.R(cx, cy + 1, 16, 1); this.R(cx + 1, cy + 2, 14, 1); }
    this.R(0, GROUND, W, 1); for (let x = -(scroll % 12); x < W; x += 12) this.R(x, GROUND + 3, 5, 1);
    for (const o of this.obs) (o.high ? this.hook(o.x) : this.spike(o.x));
    if (!(this.hurt && this.hurt % 6 < 3)) this.runner(PX, GROUND - 16 - p.y, p.slide > 0);
    for (let i = 0; i < this.hearts; i++) this.heart(6 + i * 11, 6);
    this.T('SCORE ' + String(this.score).padStart(6, '0'), W - 6, 5, 8, 'right');
    if (this.over) { this.T('GAME OVER', W / 2, 44, 12, 'center'); if (this.over % 50 < 32) this.T(this.auto ? 'PRESS Z TO PLAY' : 'PRESS Z', W / 2, 62, 8, 'center'); }
    else if (this.auto && this.t % 70 < 44) this.T('PRESS Z TO PLAY', W / 2, 106, 7, 'center');
  }
  draw_profile() {
    const letter = (this.info.letter || 'V').slice(0, 1);
    this.T('NEW PROFILE', W / 2, 8, 9, 'center');
    this.x.beginPath(); this.x.arc(W, 92, 44, 0, 7); this.x.fill(); this.x.fillStyle = '#000'; this.T(letter, W / 2, 30, 24, 'center'); this.x.fillStyle = '#fff';
    this.frame(22, 76, 116, 14); this.T('NAME', 26, 67, 7); this.T('MY VAULT' + (this.t % 60 < 30 ? '_' : ''), 27, 79, 8);
    for (let i = 0; i < 3; i++) { const on = Math.floor(this.t / 80) % 3 === i; (on ? this.R : this.frame).call(this, 30 + i * 36, 98, 28, 12); }
    this.x.fillStyle = '#000'; const k = Math.floor(this.t / 80) % 3; this.T(['AUTO', 'DARK', 'LITE'][k], 44 + k * 36, 100, 7, 'center'); this.x.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) if (i !== k) this.T(['AUTO', 'DARK', 'LITE'][i], 44 + i * 36, 100, 7, 'center');
  }
  draw_welcome() {
    const step = Math.floor(this.t / 110) % 4;
    this.T('WELCOME', W / 2, 12, 14, 'center'); this.padlock(W / 2 - 12, 38, 2);
    this.T(['A SHORT TOUR', 'YOUR ITEMS', 'YOUR TOOLS', 'LOCK AND GO'][step], W / 2, 76, 8, 'center');
    for (let i = 0; i < 4; i++) (i === step ? this.R : this.frame).call(this, 58 + i * 12, 96, 8, 8);
  }
  draw_item() {
    this.T((this.info.cat || 'LOGIN').toUpperCase().slice(0, 16), 8, 8, 10); this.R(8, 22, W - 16, 1);
    for (let i = 0; i < 4; i++) { const y = 30 + i * 20; this.frame(8, y, W - 16, 15); const n = 6 + ((i * 5 + Math.floor(this.t / 9)) % 9); for (let k = 0; k < n; k++) this.R(13 + k * 8, y + 5, 5, 5); }
    this.padlock(W - 24, 4, 1);
  }
  draw_lock() {
    this.padlock(W / 2 - 18, 18, 3); this.T('LOCKED', W / 2, 70, 13, 'center');
    this.T(this.info.time || '23:30', W / 2, 92, 9, 'center');
  }
  draw_menu() {
    const rows = ['LOCK NOW', 'PURGE MEMORY', 'SWITCH PROFILE', 'TASK MANAGER', 'SETTINGS'], sel = Math.floor(this.t / 70) % rows.length;
    this.T('SYSTEM MENU', 8, 7, 9); this.R(8, 20, W - 16, 1);
    rows.forEach((r, i) => { const y = 27 + i * 17; if (i === sel) { this.R(8, y - 2, W - 16, 14); this.x.fillStyle = '#000'; this.T(r, 14, y + 1, 8); this.x.fillStyle = '#fff'; } else this.T(r, 14, y + 1, 8); });
  }
  draw_qr() {
    const n = 21, s = 4, ox = (W - n * s) / 2, oy = 10, shown = Math.min(n * n, Math.floor((this.t % 420) * 2.2));
    const finder = (r, c) => { for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) { const a = r - fr, b = c - fc; if (a >= 0 && a < 7 && b >= 0 && b < 7) return (a === 0 || a === 6 || b === 0 || b === 6 || (a > 1 && a < 5 && b > 1 && b < 5)) ? 1 : 0; } return -1; };
    for (let i = 0; i < shown; i++) { const r = Math.floor(i / n), c = i % n, f = finder(r, c); const on = f >= 0 ? f : ((r * 7919 + c * 104729 + r * c * 31) % 5) < 2; if (on) this.R(ox + c * s, oy + r * s, s, s); }
    this.T(shown >= n * n ? 'SEALED' : 'SEALING...', W / 2, 100, 9, 'center');
  }
}
