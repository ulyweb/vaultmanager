/* Everything around the vault: the photoreal powder bursts (Higgsfield stills, tinted and animated in code),
   the 3D debris (brass keys, padlocks, cards, shards), the particle cloud that forms each item category, and the stars. */
import * as THREE from '../vendor/three.bundle.min.js';
import { ic } from '../../js/icons.js';
import { slab } from './device.js';

const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- powder bursts ---------- */
export function makeBursts(scene) {
  const loader = new THREE.TextureLoader();
  const texs = ['a', 'b', 'c'].map((n) => loader.load('media/burst-' + n + '.jpg'));
  const layer = (size, order) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ alphaMap: texs[0], color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
    m.renderOrder = order; m.userData.size = size; scene.add(m); return m;
  };
  const A = layer(9.2, -3), B = layer(9.8, -4);
  let k = 0, spin = 0, n = 0;
  const right = new THREE.Vector3(), upv = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    layers: [A, B],
    fire() { k = 1; n++; A.material.alphaMap = texs[n % 3]; B.material.alphaMap = texs[(n + 1) % 3]; },
    setColors(a, b) { A.material.color.set(a); B.material.color.set(b); },
    setLight(light) { for (const l of [A, B]) { l.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; l.material.needsUpdate = true; } },
    get energy() { return k; },
    update(dt, camera, center, calm) {
      k = Math.max(0, k - dt / 1.7); spin += dt * 0.02;
      const e = 1 - k, out = 1 - Math.pow(1 - e, 3);                       // ease-out as the powder expands
      camera.getWorldDirection(dir); right.crossVectors(dir, camera.up).normalize(); upv.crossVectors(right, dir);
      const place = (m, dx, dy, depth, rot, phase) => {
        m.position.copy(center).addScaledVector(dir, depth).addScaledVector(right, dx).addScaledVector(upv, dy);
        m.quaternion.copy(camera.quaternion); m.rotateZ(rot + n * 1.3 + spin * (phase ? -1 : 1));
        const breathe = 1 + 0.025 * Math.sin(performance.now() / 1400 + phase);
        m.scale.setScalar(m.userData.size * (calm ? 1.12 : (0.62 + 0.62 * out)) * breathe);
        m.material.opacity = calm ? 0.3 : 0.28 + 0.72 * k;
      };
      place(A, -1.35, 0.1, 3.4, 0.2, 0); place(B, 1.55, -0.3, 4.0, 2.4, 2);
    },
  };
}

/* ---------- debris: keys, padlocks, cards, shards ---------- */
function keyMesh(mat) {
  const g = new THREE.Group();
  const bow = new THREE.Shape(); bow.absarc(0, 0, 0.21, 0, Math.PI * 2, false); const hole = new THREE.Path(); hole.absarc(-0.03, 0, 0.075, 0, Math.PI * 2, true); bow.holes.push(hole);
  const bg = new THREE.ExtrudeGeometry(bow, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 20 }); bg.translate(0, 0, -0.0175);
  g.add(new THREE.Mesh(bg, mat));
  const add = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), mat); m.position.set(x, y, 0); g.add(m); };
  add(0.62, 0.075, 0.5, 0); add(0.07, 0.11, 0.56, -0.08); add(0.06, 0.08, 0.67, -0.07); add(0.07, 0.12, 0.77, -0.09);
  return g;
}
function padlockMesh(steel, dark, open) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(slab(0.62, 0.5, 0.08, 0.2, 0.03), steel));
  const sh = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.05, 12, 28, Math.PI), steel); sh.position.set(open ? 0.19 : 0, 0.26, 0); if (open) sh.rotation.y = 0.9; g.add(sh);
  for (const x of open ? [0.19] : [-0.19, 0.19]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12), steel); leg.position.set(x, 0.24, 0); g.add(leg); }
  const kh = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), dark); kh.position.set(0, 0.02, 0.101); g.add(kh);
  return g;
}
function cardMesh(colour, gold) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(slab(0.86, 0.54, 0.06, 0.02, 0.006), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.2 })));
  const chip = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.11), gold); chip.position.set(-0.24, 0.05, 0.011); g.add(chip);
  return g;
}
export function makeDebris(scene) {
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a04a, metalness: 1, roughness: 0.32 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 1, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.9 });
  const rock = new THREE.MeshStandardMaterial({ color: 0x70757f, metalness: 0.7, roughness: 0.6, flatShading: true });
  const root = new THREE.Group(); scene.add(root);
  const items = [];
  const put = (obj, scale) => {
    const side = items.length % 2 ? 1 : -1;
    obj.scale.setScalar(scale);
    obj.userData = { a: rand(0.25, 1.35) * side, r: rand(2.3, 4.7), y: rand(-2.1, 2.1), z: rand(-3.4, -0.4), w: rand(0.02, 0.07) * (Math.random() < 0.5 ? -1 : 1), ax: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), sp: rand(0.12, 0.5), ph: rand(0, 6) };
    obj.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6)); root.add(obj); items.push(obj);
  };
  for (let i = 0; i < 8; i++) put(keyMesh(brass), rand(0.8, 1.5));
  put(padlockMesh(steel, dark, true), 1.5); put(padlockMesh(steel, dark, false), 1.15);
  put(cardMesh(0x1d2540, brass), 1.25); put(cardMesh(0x3b1d52, brass), 1.05);
  for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.07, 0.2), 0), rock); m.scale.set(rand(0.6, 1.5), rand(0.6, 1.3), rand(0.5, 1.2)); const g = new THREE.Group(); g.add(m); put(g, 1); }
  let push = 0, vel = 0;
  return {
    root,
    kick() { vel += 2.6; },
    update(dt, still) {
      vel += (-push * 14 - vel * 3.2) * dt; push += vel * dt;                // a damped spring: flung out, then drifting back
      const t = performance.now() / 1000;
      for (const o of items) {
        const u = o.userData, m = 1 + push * 0.55, ang = u.a + (still ? 0 : t * u.w * 0.25);
        o.position.set(Math.sin(ang) * u.r * m, u.y * m + (still ? 0 : Math.sin(t * 0.5 + u.ph) * 0.09), u.z - (m - 1) * 0.6);
        if (!still) o.rotateOnAxis(u.ax, dt * (u.sp + Math.abs(vel) * 0.9));
      }
    },
  };
}

/* ---------- particle cloud: ambient powder that gathers into the icon of an item category ---------- */
function iconPoints(name) {
  const svg = ic(name, { label: false }).querySelector('svg'); if (!svg) return [];
  const S = 96, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'); x.scale(S / 24, S / 24); x.lineWidth = 1.9; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#fff';
  const num = (el, k) => parseFloat(el.getAttribute(k) || '0');
  for (const el of svg.querySelectorAll('path, circle, rect, line')) {
    const t = el.tagName.toLowerCase();
    if (t === 'path') x.stroke(new Path2D(el.getAttribute('d')));
    else if (t === 'circle') { x.beginPath(); x.arc(num(el, 'cx'), num(el, 'cy'), num(el, 'r'), 0, 7); x.stroke(); }
    else if (t === 'rect') x.strokeRect(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'));
    else { x.beginPath(); x.moveTo(num(el, 'x1'), num(el, 'y1')); x.lineTo(num(el, 'x2'), num(el, 'y2')); x.stroke(); }
  }
  const d = x.getImageData(0, 0, S, S).data, pts = [];
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) if (d[(py * S + px) * 4 + 3] > 100) pts.push([px / S - 0.5, 0.5 - py / S]);
  return pts;
}
export function makeCloud(scene, count = 3400) {
  const pos = new Float32Array(count * 3), home = new Float32Array(count * 3), goal = new Float32Array(count * 3), rate = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2), r = rand(2.6, 7), y = rand(-3, 3);
    home[i * 3] = Math.cos(a) * r; home[i * 3 + 1] = y; home[i * 3 + 2] = -Math.abs(Math.sin(a)) * r * 0.6 - 0.6;
    rate[i] = rand(1.6, 5.5);
  }
  pos.set(home); goal.set(home);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.062, color: 0x19c8b4, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; scene.add(points);
  const cache = new Map();
  return {
    points,
    setColor(hex) { mat.color.set(hex); },
    setLight(light) { mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; mat.opacity = light ? 1 : 0.9; mat.size = light ? 0.07 : 0.062; mat.needsUpdate = true; },
    /* name: an icon to form at centre (x, y, z) with the given size; null: drift back out into ambient powder */
    form(name, cx = 0, cy = 0, cz = 0, size = 2.6) {
      if (!name) { goal.set(home); return 0; }
      if (!cache.has(name)) cache.set(name, iconPoints(name));
      const pts = cache.get(name); if (!pts.length) { goal.set(home); return 0; }
      for (let i = 0; i < count; i++) { const p = pts[(Math.random() * pts.length) | 0]; goal[i * 3] = cx + p[0] * size + rand(-0.012, 0.012); goal[i * 3 + 1] = cy + p[1] * size + rand(-0.012, 0.012); goal[i * 3 + 2] = cz + rand(-0.09, 0.09); }
      return pts.length;
    },
    scatter(force = 1) { for (let i = 0; i < count * 3; i++) pos[i] += rand(-1, 1) * force; },
    update(dt, still) {
      const t = performance.now() / 1000;
      for (let i = 0; i < count; i++) {
        const j = i * 3, k = Math.min(1, dt * rate[i]);
        pos[j] += (goal[j] - pos[j]) * k; pos[j + 1] += (goal[j + 1] - pos[j + 1]) * k; pos[j + 2] += (goal[j + 2] - pos[j + 2]) * k;
        if (!still) pos[j + 1] += Math.sin(t * 0.7 + i) * 0.0009;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/* ---------- stars (fade in as the page's clock reaches night) ---------- */
export function makeStars(scene, count = 500) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { pos[i * 3] = rand(-26, 26); pos[i * 3 + 1] = rand(-13, 15); pos[i * 3 + 2] = rand(-28, -16); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  return { set(o) { mat.opacity = o; pts.visible = o > 0.01; } };
}
