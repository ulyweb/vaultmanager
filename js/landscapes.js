/* Procedurally drawn nature wallpapers (ported from ulyOS): layered ridges, sky gradients, sun / moon, stars, fog, water, trees.
   Pure SVG generated in the browser — no image files, no network, works offline. */
  const W = 1600, H = 900;
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  function ridge(seed, base, amp, jag) {
    const r = rng(seed), ph = [0, 1, 2, 3, 4].map(() => r() * 6.283), fr = [1.1, 2.6, 5.2, 9.4, 16].map((f) => f * (0.8 + r() * 0.5)), steps = 90;
    let d = 'M0,' + H;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * W;
      let y = 0, a = 1, s = 0;
      for (let k = 0; k < 5; k++) {
        const wave = Math.sin((x / W) * fr[k] * Math.PI * 2 * 0.5 + ph[k]);
        y += (jag * (1 - Math.abs(wave)) + (1 - jag) * (wave * 0.5 + 0.5)) * a; s += a; a *= 0.52;
      }
      d += ' L' + x.toFixed(1) + ',' + (base * H - (y / s) * amp * H).toFixed(1);
    }
    return d + ' L' + W + ',' + H + ' Z';
  }
  function pines(seed, base, color, density) {
    const r = rng(seed); let d = '';
    for (let x = -10; x < W + 20; x += density * (0.6 + r() * 0.8)) {
      const h = 38 + r() * 70, w = h * 0.34, y = base * H + (r() - 0.5) * 16;
      d += 'M' + x.toFixed(1) + ',' + (y - h).toFixed(1) + ' L' + (x + w).toFixed(1) + ',' + y.toFixed(1) + ' L' + (x - w).toFixed(1) + ',' + y.toFixed(1) + ' Z ';
    }
    return '<path d="' + d + '" fill="' + color + '"/>';
  }

  const SPECS = {
    alpine: { name: 'Alpine dawn', sky: ['#1d2b53', '#7e5a9b', '#f08a7e', '#ffd2a1'], sun: { x: 0.72, y: 0.56, r: 46, c: '#fff3d4', g: '#ffc58a' }, fog: 0.7,
      layers: [{ b: 0.55, a: 0.2, s: 11, j: 1, c: ['#9a86b8', '#5d4f86'] }, { b: 0.66, a: 0.17, s: 12, j: 1, c: ['#6b5b94', '#3a3162'] }, { b: 0.78, a: 0.12, s: 13, j: 0.6, c: ['#3a3768', '#1c1a3a'] }, { b: 0.9, a: 0.07, s: 14, j: 0.3, c: ['#1a1a36', '#0b0b1e'] }], trees: { b: 0.97, c: '#08081a', d: 26, s: 5 } },
    forest: { name: 'Misty forest', sky: ['#0d1f1a', '#2d5a4a', '#9ec3a8', '#e4efd8'], sun: { x: 0.5, y: 0.4, r: 60, c: '#f4f8dc', g: '#cfe7b8' }, fog: 1,
      layers: [{ b: 0.6, a: 0.14, s: 21, j: 0.7, c: ['#7fa88f', '#4c7a68'] }, { b: 0.7, a: 0.12, s: 22, j: 0.6, c: ['#4f8068', '#2a5446'] }, { b: 0.82, a: 0.1, s: 23, j: 0.5, c: ['#2b5646', '#14302a'] }], trees: { b: 0.82, c: '#0c231d', d: 18, s: 7 }, trees2: { b: 0.97, c: '#06140f', d: 30, s: 9 } },
    dunes: { name: 'Desert dunes', sky: ['#2b1b3a', '#c0566b', '#f6a05a', '#ffe0a8'], sun: { x: 0.3, y: 0.6, r: 62, c: '#fff1c8', g: '#ffb36a' },
      layers: [{ b: 0.66, a: 0.1, s: 31, j: 0, c: ['#e29a62', '#b0643a'] }, { b: 0.76, a: 0.12, s: 32, j: 0, c: ['#c0713f', '#85452a'] }, { b: 0.88, a: 0.12, s: 33, j: 0, c: ['#8f4a2b', '#4d2418'] }] },
    ocean: { name: 'Ocean sunset', sky: ['#10163a', '#4b2f7a', '#e0577b', '#ffb86b'], sun: { x: 0.5, y: 0.6, r: 72, c: '#fff0c4', g: '#ff9d6b' }, water: { y: 0.62, c: ['#e98a6a', '#14183f'] },
      layers: [{ b: 0.62, a: 0.05, s: 41, j: 0.4, c: ['#30204f', '#1a1236'] }] },
    aurora: { name: 'Northern lights', sky: ['#030816', '#0b2a3d', '#0f4c4a'], stars: 170, aurora: true,
      layers: [{ b: 0.7, a: 0.18, s: 51, j: 1, c: ['#26425e', '#0f2036'] }, { b: 0.82, a: 0.12, s: 52, j: 0.8, c: ['#0f2036', '#060f1d'] }], trees: { b: 0.98, c: '#02070d', d: 24, s: 3 } },
    lavender: { name: 'Lavender fields', sky: ['#2c2a5a', '#8f6fb5', '#f0a6c8', '#ffe3d1'], sun: { x: 0.8, y: 0.52, r: 48, c: '#fff4e4', g: '#ffc4d8' }, fog: 0.5,
      layers: [{ b: 0.62, a: 0.1, s: 61, j: 0.2, c: ['#a47bc2', '#6c4a97'] }, { b: 0.74, a: 0.12, s: 62, j: 0.1, c: ['#7d56a8', '#46296f'] }, { b: 0.87, a: 0.12, s: 63, j: 0, c: ['#55337f', '#2a1646'] }] },
    canyon: { name: 'Red canyon', sky: ['#1f2a52', '#5a6fa8', '#f7b27a', '#fde4b8'], sun: { x: 0.62, y: 0.5, r: 42, c: '#fff6dc', g: '#ffd29a' },
      layers: [{ b: 0.58, a: 0.16, s: 71, j: 0.55, c: ['#d98a5a', '#a1503a'] }, { b: 0.7, a: 0.16, s: 72, j: 0.5, c: ['#b8613f', '#7a3426'] }, { b: 0.84, a: 0.14, s: 73, j: 0.45, c: ['#8a3f2b', '#4a1c16'] }] },
    beach: { name: 'Tropical beach', sky: ['#0b3a5c', '#2a8fb5', '#8fd3d6', '#fff1c9'], sun: { x: 0.25, y: 0.45, r: 50, c: '#fffbe2', g: '#fff0b0' }, water: { y: 0.58, c: ['#3ec2c4', '#0b5c7a'] },
      layers: [{ b: 0.58, a: 0.03, s: 81, j: 0.3, c: ['#2d7f8a', '#1c5560'] }, { b: 0.88, a: 0.05, s: 82, j: 0, c: ['#f3d9a4', '#cfa86a'] }] },
    starry: { name: 'Starry peaks', sky: ['#02030a', '#0c1030', '#1b2a5a'], stars: 240, moon: { x: 0.78, y: 0.22, r: 34, c: '#fffbe8' },
      layers: [{ b: 0.62, a: 0.2, s: 91, j: 1, c: ['#26346a', '#10183a'] }, { b: 0.76, a: 0.14, s: 92, j: 0.9, c: ['#141d46', '#080c22'] }, { b: 0.9, a: 0.08, s: 93, j: 0.5, c: ['#0a0f2a', '#04061a'] }] },
    autumn: { name: 'Autumn hills', sky: ['#3a2a4a', '#c4684a', '#f3b266', '#fde6b0'], sun: { x: 0.2, y: 0.55, r: 54, c: '#fff1c4', g: '#ffbe70' }, fog: 0.6,
      layers: [{ b: 0.62, a: 0.1, s: 101, j: 0.3, c: ['#d98a4a', '#9e5a2e'] }, { b: 0.74, a: 0.12, s: 102, j: 0.25, c: ['#b8602a', '#74361a'] }, { b: 0.87, a: 0.12, s: 103, j: 0.1, c: ['#7a3818', '#3f1c0c'] }], trees: { b: 0.98, c: '#2a1208', d: 30, s: 4 } },
    snow: { name: 'Snowy peaks', sky: ['#4a6fa5', '#9cbfe0', '#dff0fa', '#ffffff'], sun: { x: 0.8, y: 0.3, r: 38, c: '#ffffff', g: '#e8f4ff' }, fog: 0.8,
      layers: [{ b: 0.5, a: 0.24, s: 111, j: 1, c: ['#ffffff', '#a9c3e0'] }, { b: 0.64, a: 0.18, s: 112, j: 0.95, c: ['#e3eef8', '#7f9fc4'] }, { b: 0.8, a: 0.12, s: 113, j: 0.8, c: ['#b8cde4', '#5d7ea6'] }], trees: { b: 0.98, c: '#14293f', d: 26, s: 6 } },
    lake: { name: 'Moonlit lake', sky: ['#050a1a', '#12254a', '#2b4673'], stars: 130, moon: { x: 0.5, y: 0.26, r: 42, c: '#fffdf0' }, water: { y: 0.66, c: ['#1f3a66', '#070f24'] },
      layers: [{ b: 0.66, a: 0.14, s: 121, j: 0.9, c: ['#1a2c52', '#0b1530'] }, { b: 0.7, a: 0.05, s: 122, j: 0.6, c: ['#0b1530', '#060c1e'] }] },
  };

  const cache = {};
  function build(id) {
    const sp = SPECS[id];
    const r = rng(id.length * 977 + 13);
    let defs = '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' + sp.sky.map((c, i) => '<stop offset="' + (i / (sp.sky.length - 1)).toFixed(2) + '" stop-color="' + c + '"/>').join('') + '</linearGradient>';
    let body = '<rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
    if (sp.stars) for (let i = 0; i < sp.stars; i++) body += '<circle cx="' + (r() * W).toFixed(0) + '" cy="' + (r() * H * 0.6).toFixed(0) + '" r="' + (0.5 + r() * 1.3).toFixed(1) + '" fill="#fff" opacity="' + (0.35 + r() * 0.65).toFixed(2) + '"/>';
    if (sp.aurora) {
      defs += '<filter id="bl" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="22"/></filter><linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5dffb0" stop-opacity="0"/><stop offset=".5" stop-color="#5dffb0" stop-opacity=".75"/><stop offset="1" stop-color="#9b6bff" stop-opacity="0"/></linearGradient>';
      [[0.22, 0.2], [0.3, 0.16], [0.16, 0.12]].forEach(([y, a], i) => { let d = 'M0,' + H * 0.55; for (let k = 0; k <= 24; k++) d += ' L' + (k / 24 * W).toFixed(0) + ',' + (H * y + Math.sin(k * 0.55 + i * 2) * H * a * 0.5 + Math.sin(k * 1.3 + i) * 20).toFixed(0); d += ' L' + W + ',' + H * 0.62 + ' Z'; body += '<path d="' + d + '" fill="url(#au)" filter="url(#bl)" opacity="' + (0.7 - i * 0.15) + '"/>'; });
    }
    if (sp.sun) { const s = sp.sun; defs += '<radialGradient id="sg"><stop offset="0" stop-color="' + s.g + '" stop-opacity=".95"/><stop offset="1" stop-color="' + s.g + '" stop-opacity="0"/></radialGradient>'; body += '<circle cx="' + s.x * W + '" cy="' + s.y * H + '" r="' + s.r * 5 + '" fill="url(#sg)"/><circle cx="' + s.x * W + '" cy="' + s.y * H + '" r="' + s.r + '" fill="' + s.c + '"/>'; }
    if (sp.moon) { const m = sp.moon; defs += '<radialGradient id="mg"><stop offset="0" stop-color="#cfe0ff" stop-opacity=".55"/><stop offset="1" stop-color="#cfe0ff" stop-opacity="0"/></radialGradient>'; body += '<circle cx="' + m.x * W + '" cy="' + m.y * H + '" r="' + m.r * 4.5 + '" fill="url(#mg)"/><circle cx="' + m.x * W + '" cy="' + m.y * H + '" r="' + m.r + '" fill="' + m.c + '"/>'; }
    if (sp.water) {
      const w = sp.water;
      defs += '<linearGradient id="wt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + w.c[0] + '"/><stop offset="1" stop-color="' + w.c[1] + '"/></linearGradient>';
    }
    sp.layers.forEach((l, i) => {
      defs += '<linearGradient id="l' + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + l.c[0] + '"/><stop offset="1" stop-color="' + l.c[1] + '"/></linearGradient>';
      body += '<path d="' + ridge(l.s, l.b, l.a, l.j) + '" fill="url(#l' + i + ')"/>';
      if (sp.fog && i < sp.layers.length - 1) { defs += '<linearGradient id="f' + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="' + (0.16 * sp.fog).toFixed(2) + '"/></linearGradient>'; body += '<rect y="' + (l.b * H - 40) + '" width="' + W + '" height="' + (H * 0.22) + '" fill="url(#f' + i + ')"/>'; }
      if (i === 0 && sp.water) {   // water sits in front of the first (far) ridge
        body += '<rect y="' + sp.water.y * H + '" width="' + W + '" height="' + (H - sp.water.y * H) + '" fill="url(#wt)"/>';
        const refl = sp.sun || sp.moon;
        if (refl) for (let k = 0; k < 9; k++) body += '<ellipse cx="' + (refl.x * W + (r() - 0.5) * 30) + '" cy="' + (sp.water.y * H + 16 + k * 22) + '" rx="' + (70 - k * 5 + r() * 18) + '" ry="3" fill="' + (refl.c) + '" opacity="' + (0.5 - k * 0.045).toFixed(2) + '"/>';
      }
    });
    if (sp.trees) body += pines(sp.trees.s, sp.trees.b, sp.trees.c, sp.trees.d);
    if (sp.trees2) body += pines(sp.trees2.s, sp.trees2.b, sp.trees2.c, sp.trees2.d);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice"><defs>' + defs + '</defs>' + body + '</svg>';
  }

/* Real photographs (NASA, public domain — see wallpapers/CREDITS.md). Shipped inside the app so they work offline;
   the single-file build embeds them as data: URLs. */
const PHOTOS = [["space", "earth", "Blue Marble"], ["space", "carina", "Carina Nebula (Hubble)"], ["space", "earthrise", "Earthrise (Apollo 17)"], ["space", "aurora", "Aurora from the ISS"], ["space", "pillars", "Pillars of Creation"], ["space", "saturn", "Saturn portrait (Cassini)"], ["space", "andromeda", "Andromeda Galaxy"], ["space", "earthset", "Earthset (Artemis II)"], ["city", "night1", "City lights from orbit I"], ["city", "night2", "City lights from orbit II"], ["city", "night3", "Europe at night"], ["city", "turin", "Turin, Italy"], ["city", "nyc", "New York at night"], ["city", "cairo", "Cairo & Alexandria"], ["city", "vegas", "Night over the desert"], ["city", "night4", "City lights from orbit III"]];
const GRADS = [['dusk', 'Dusk', ['#1a1040', '#6b2d7b', '#f0735a']], ['ocean', 'Deep ocean', ['#031a3a', '#0b5a8a', '#2fd0c8']], ['ember', 'Ember', ['#1a0a0a', '#8a1c1c', '#ff9a3c']],
  ['aurora', 'Aurora glow', ['#04121f', '#0f7a6a', '#7c5cff']], ['graphite', 'Graphite', ['#0c0f14', '#232a36', '#4a5568']], ['rose', 'Rose quartz', ['#2a1030', '#b0467a', '#ffc2a8']],
  ['forestg', 'Evergreen', ['#04140c', '#145a3a', '#9ad87a']], ['sky', 'Clear sky', ['#0b3d91', '#3b8fe0', '#bfe6ff']]];
const gradSvg = (cols) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' + cols.map((c, i) => '<stop offset="' + (i / (cols.length - 1)) + '" stop-color="' + c + '"/>').join('') + '</linearGradient></defs><rect width="16" height="9" fill="url(#g)"/></svg>');
let embeddedPhotos = null;
const embeddedPhoto = (src) => { if (embeddedPhotos === null) { embeddedPhotos = {}; try { const el = document.getElementById('vm-embed'); if (el) embeddedPhotos = JSON.parse(el.textContent) || {}; } catch { /* not embedded */ } } return embeddedPhotos[src] || null; };
const HTTPS = /^https:\/\/[^\s"'()<>\\]{3,1000}$/;

export const landscapes = {
    list: Object.keys(SPECS).map((id) => [id, SPECS[id].name]),
    photos: PHOTOS.filter((p) => p[0] === 'space').map((p) => [p[1], p[2]]),
    cities: PHOTOS.filter((p) => p[0] === 'city').map((p) => [p[1], p[2]]),
    gradients: GRADS.map((g) => [g[0], g[1]]),
    /** Is this a wallpaper id we know how to draw? (custom / remote depend on the look object) */
    has(id) { return !!SPECS[id] || /^(photo|grad):[a-z0-9]+$/.test(id) && (id.startsWith('photo:') ? PHOTOS.some((p) => 'photo:' + p[1] === id) : GRADS.some((g) => 'grad:' + g[0] === id)) || id === 'custom' || id === 'remote'; },
    /** URL usable in CSS url("…"): data: for drawn scenes / gradients / your own picture, a bundled file for photos, https for a remote picture */
    url(id, look = {}) {
      if (SPECS[id]) return cache[id] || (cache[id] = 'data:image/svg+xml,' + encodeURIComponent(build(id)));
      if (id.startsWith('photo:')) { const f = 'wallpapers/' + id.slice(6) + '.jpg'; return embeddedPhoto(f) || f; }
      if (id.startsWith('grad:')) { const g = GRADS.find((x) => 'grad:' + x[0] === id); return g ? gradSvg(g[2]) : ''; }
      if (id === 'custom') return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(look.wallImage || '') ? look.wallImage : '';
      if (id === 'remote') return HTTPS.test(look.wallUrl || '') ? look.wallUrl : '';
      return '';
    },
  };
