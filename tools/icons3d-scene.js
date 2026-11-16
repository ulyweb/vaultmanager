/* Builds the 3D icon objects (real three.js models made from rounded slabs, cylinders, spheres and extrusions, in glossy "clay plastic").
   Used only by tools/render-icons3d.mjs, which renders each one to a transparent picture that ships in icons3d/.
   Nothing here is copied from anyone else's artwork: every object is modelled from simple shapes. */
import * as T from '/experience/vendor/three.bundle.min.js';

const M = (color, o = {}) => new T.MeshPhysicalMaterial({ color, roughness: 0.34, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.22, ...o });
const GOLD = () => M(0xffc43d, { metalness: 0.9, roughness: 0.26, clearcoat: 0.5 });
const SILVER = () => M(0xdfe6ee, { metalness: 0.9, roughness: 0.3, clearcoat: 0.5 });
const WHITE = () => M(0xf6f8fb, { roughness: 0.45 });
const DARK = () => M(0x1c2430, { roughness: 0.4 });
const GLASS = () => M(0x0f1620, { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });

const rrShape = (w, h, r) => {
  const s = new T.Shape(), x = -w / 2, y = -h / 2; r = Math.max(0.001, Math.min(r, w / 2, h / 2));
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
};
const ext = (shape, d, mat, b = 0.05) => {
  const inner = Math.max(0.004, d - 2 * b);
  const g = new T.ExtrudeGeometry(shape, { depth: inner, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 20 }); g.translate(0, 0, -inner / 2);
  return new T.Mesh(g, mat);
};
const slab = (w, h, d, r, mat, b = 0.05) => ext(rrShape(w - 2 * b, h - 2 * b, r - b), d, mat, b);
const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };
const cyl = (r, h, mat, seg = 48, rt = r) => { const m = new T.Mesh(new T.CylinderGeometry(rt, r, h, seg), mat); return m; };
const disc = (r, d, mat) => { const m = cyl(r, d, mat); m.rotation.x = Math.PI / 2; return m; };   // faces +z
const ball = (r, mat) => new T.Mesh(new T.SphereGeometry(r, 40, 28), mat);
const ring = (R, r, mat, arc = Math.PI * 2) => new T.Mesh(new T.TorusGeometry(R, r, 20, 64, arc), mat);
const box = (w, h, d, mat) => new T.Mesh(new T.BoxGeometry(w, h, d), mat);
const bar = (w, h, d, mat) => slab(w, h, d, Math.min(w, h) / 2, mat, Math.min(d, 0.04) * 0.9);
const poly = (pts, d, mat, b = 0.03) => { const s = new T.Shape(pts.map((p) => new T.Vector2(p[0], p[1]))); return ext(s, d, mat, b); };
const G = (...c) => { const g = new T.Group(); g.add(...c); return g; };

/* chunky line across two points (for check marks, arms of glasses ...) */
const stroke = (a, b, w, d, mat) => { const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy); const m = bar(len + w, w, d, mat); m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0); m.rotation.z = Math.atan2(dy, dx); return m; };

const B = {
  login() {   // a key
    const gold = GOLD(); const head = ring(0.62, 0.24, gold); head.position.set(-0.55, 0.55, 0);
    const shaft = at(bar(1.9, 0.3, 0.32, gold), 0.4, -0.2); shaft.rotation.z = -Math.PI / 4 * 1;
    const g = G(head, shaft); const t1 = bar(0.5, 0.26, 0.3, gold), t2 = bar(0.36, 0.26, 0.3, gold);
    t1.position.set(1.0, -1.15, 0); t2.position.set(0.55, -1.45, 0); t1.rotation.z = t2.rotation.z = -Math.PI / 4;
    const dot = at(ball(0.2, M(0xff5d73)), -0.55, 0.55, 0.0); return G(head, shaft, t1, t2, at(disc(0.24, 0.3, gold), -0.55, 0.55, 0), dot).translateX(0.1);
  },
  note() {
    const body = slab(1.7, 2.2, 0.28, 0.18, WHITE()), top = at(slab(1.7, 0.42, 0.34, 0.18, M(0x35d6c8)), 0, 0.9, 0);
    const lines = [0.35, -0.05, -0.45, -0.85].map((y, i) => at(bar(i === 3 ? 0.7 : 1.2, 0.11, 0.06, M(0xc4ccd6)), i === 3 ? -0.25 : 0, y, 0.17));
    const rings = [-0.5, 0, 0.5].map((x) => at(ring(0.1, 0.045, SILVER()), x, 1.12, 0.05));
    const pen = at(bar(0.14, 1.2, 0.14, M(0xffb02e)), 0.95, -0.35, 0.3); pen.rotation.z = -0.5;
    return G(body, top, ...lines, ...rings, pen);
  },
  card() {
    const c = slab(2.5, 1.6, 0.18, 0.22, M(0x7a5cff));
    const chip = at(slab(0.5, 0.38, 0.06, 0.08, GOLD(), 0.02), -0.7, 0.2, 0.11), stripe = at(bar(2.5, 0.28, 0.04, DARK()), 0, 0.62, 0.1);
    const n = [0, 1, 2, 3].map((i) => at(bar(0.38, 0.1, 0.04, WHITE()), -0.9 + i * 0.52, -0.3, 0.1)), n2 = at(bar(0.9, 0.1, 0.04, M(0xbfaeff)), -0.45, -0.6, 0.1);
    const c2 = at(slab(2.5, 1.6, 0.14, 0.22, M(0x2fd6c8)), 0.35, -0.3, -0.35); c2.rotation.z = 0.2;
    return G(c2, c, chip, stripe, ...n, n2).rotateZ(-0.12);
  },
  technical() {   // a gear
    const teeth = 10, R1 = 1.15, R2 = 0.88, s = new T.Shape();
    for (let i = 0; i < teeth; i++) { const a = (i / teeth) * Math.PI * 2, w = Math.PI / teeth * 0.5; [[a - w, R2], [a - w * 0.6, R1], [a + w * 0.6, R1], [a + w, R2]].forEach(([t, r], k) => { const p = [Math.cos(t) * r, Math.sin(t) * r]; if (i === 0 && k === 0) s.moveTo(...p); else s.lineTo(...p); }); }
    const h = new T.Path(); h.absarc(0, 0, 0.42, 0, Math.PI * 2, true); s.holes.push(h);
    return G(ext(s, 0.5, M(0x6b8cff), 0.07), at(ring(0.45, 0.07, SILVER()), 0, 0, 0.25));
  },
  social() {
    const b1 = at(slab(1.9, 1.4, 0.4, 0.5, M(0xff5d9e)), -0.25, 0.35, 0), t1 = at(poly([[-0.4, 0], [0.2, 0], [-0.55, -0.6]], 0.4, M(0xff5d9e), 0.04), -0.7, -0.4, 0);
    const b2 = at(slab(1.5, 1.1, 0.4, 0.42, M(0x3b82f6)), 0.6, -0.55, 0.45), t2 = at(poly([[-0.2, 0], [0.4, 0], [0.45, -0.5]], 0.4, M(0x3b82f6), 0.04), 1.0, -1.1, 0.45);
    const dots = [-0.65, -0.25, 0.15].map((x) => at(ball(0.11, WHITE()), x, 0.35, 0.28));
    const heart = new T.Shape(); heart.moveTo(0, -0.28); heart.bezierCurveTo(-0.5, 0.1, -0.2, 0.42, 0, 0.18); heart.bezierCurveTo(0.2, 0.42, 0.5, 0.1, 0, -0.28);
    return G(b1, t1, b2, t2, ...dots, at(ext(heart, 0.12, WHITE(), 0.03), 0.6, -0.55, 0.72));
  },
  shopping() {
    const bag = poly([[-0.95, 0.85], [0.95, 0.85], [1.1, -1.05], [-1.1, -1.05]], 0.85, M(0xffa23a), 0.1), handle = at(ring(0.45, 0.07, M(0xe9770f), Math.PI), 0, 0.85, 0);
    const fold = at(poly([[-0.95, 0.85], [0.95, 0.85], [0.95, 0.55], [-0.95, 0.55]], 0.9, M(0xe9770f), 0.04), 0, 0, 0);
    const tag = at(disc(0.38, 0.1, WHITE()), 0, -0.2, 0.46), star = at(ball(0.14, M(0xff5d73)), 0, -0.2, 0.52);
    return G(bag, handle, fold, tag, star);
  },
  app() {   // a package / app cube with a play-ish badge
    const cube = at(slab(1.7, 1.7, 1.7, 0.3, M(0x8b7dff), 0.22), 0, 0, 0); cube.rotation.set(0.45, -0.7, 0);
    const lid = at(slab(1.82, 0.4, 1.82, 0.16, M(0x6a5af0), 0.1), 0, 0.88, 0); lid.rotation.copy(cube.rotation);
    const g = G(cube); const badge = at(ball(0.34, M(0x2fe6d0)), 0.75, 0.6, 0.9); return G(cube, at(lid, 0, 0.88, 0), badge);
  },
  server() {
    const gs = [0.95, 0, -0.95].map((y, i) => { const s = at(slab(2.3, 0.78, 1.4, 0.2, M([0x4a5ae8, 0x5b6cf5, 0x6f7dff][i]), 0.08), 0, y, 0); const led = [0, 1, 2].map((k) => at(ball(0.07, M(k === 0 ? 0x4ade80 : 0xffffff, { emissive: k === 0 ? 0x2bd873 : 0x000000, emissiveIntensity: 0.9 })), -0.85 + k * 0.2, y, 0.72)); const sl = at(bar(0.9, 0.12, 0.06, DARK()), 0.5, y, 0.72); return G(s, ...led, sl); });
    return G(...gs);
  },
  computer() {
    const stand = at(cyl(0.12, 0.7, SILVER()), 0, -0.85, 0), base = at(cyl(0.7, 0.1, SILVER(), 48, 0.55), 0, -1.22, 0);
    const mon = slab(2.7, 1.8, 0.3, 0.2, M(0xdfe6ee, { metalness: 0.5, roughness: 0.3 })), scr = at(slab(2.4, 1.5, 0.1, 0.1, M(0x233a7a, { roughness: 0.15 }), 0.03), 0, 0, 0.14);
    const glow = at(slab(1.5, 0.9, 0.05, 0.1, M(0x35d6c8), 0.02), -0.2, 0.05, 0.2), l = at(bar(0.8, 0.12, 0.05, WHITE()), -0.2, -0.5, 0.2);
    return G(stand, base, mon.translateY(0.2), scr.translateY(0.2), glow.translateY(0.2), l.translateY(0.2)).translateY(0.15);
  },
  locker() {   // a safe
    const body = slab(2.2, 2.2, 1.2, 0.3, M(0x5c6b80, { metalness: 0.6, roughness: 0.35 }), 0.1), door = at(slab(1.8, 1.8, 0.22, 0.22, M(0x8091a8, { metalness: 0.6, roughness: 0.3 }), 0.06), 0, 0, 0.62);
    const dial = at(disc(0.55, 0.16, GOLD()), 0, 0.15, 0.82), dr = at(ring(0.6, 0.05, SILVER()), 0, 0.15, 0.8), knob = at(ball(0.11, DARK()), 0, 0.15, 0.95);
    const marks = [0, 1, 2, 3, 4, 5].map((i) => { const a = i * 1.0472; return at(ball(0.04, DARK()), Math.sin(a) * 0.42, 0.15 + Math.cos(a) * 0.42, 0.9); });
    return G(body, door, dial, dr, knob, ...marks, at(bar(0.14, 0.7, 0.1, SILVER()), -0.75, 0.15, 0.72), at(bar(0.9, 0.12, 0.1, GOLD()), 0, -0.6, 0.76));
  },
  network() {   // wifi
    const arcs = [0.5, 1.0, 1.5].map((r, i) => { const a = ring(r, 0.14, M([0x5eead4, 0x38bdf8, 0x6b8cff][i]), Math.PI * 0.55); a.rotation.z = Math.PI / 2 - Math.PI * 0.275; a.position.y = -0.7; return a; });
    return G(...arcs, at(ball(0.24, M(0x6b8cff)), 0, -0.7, 0));
  },
  internet() {   // globe
    const g = ball(1.15, M(0x2f8fff)); const land = [[0.3, 0.5, 0.0, 0.5], [-0.5, -0.2, 0.7, 0.42], [0.6, -0.5, 0.5, 0.34], [-0.2, 0.8, 0.5, 0.3]].map(([x, y, z, r]) => { const v = new T.Vector3(x, y, z).normalize().multiplyScalar(1.12); const m = ball(r * 0.6, M(0x4ade80)); m.scale.set(1, 1, 0.45); m.position.copy(v); m.lookAt(v.clone().multiplyScalar(2)); return m; });
    const orbit = ring(1.55, 0.05, SILVER()); orbit.rotation.set(1.2, 0.3, 0); const sat = ball(0.16, M(0xffc43d)); sat.position.set(1.55, 0, 0); const o = G(orbit); const sg = G(sat); sg.rotation.set(1.2, 0.3, 0); sat.position.set(1.4, 0.65, 0.0);
    return G(g, ...land, orbit, sat);
  },
  phone() {
    const b = slab(1.35, 2.5, 0.22, 0.34, M(0x232b3a, { roughness: 0.3 }), 0.08), s = at(slab(1.17, 2.3, 0.05, 0.26, M(0x6b8cff, { roughness: 0.12 }), 0.02), 0, 0, 0.12);
    const w = [0.55, 0.15, -0.25].map((y, i) => at(bar(i === 0 ? 0.8 : 0.9, 0.16, 0.04, i === 0 ? WHITE() : M(0xc9d6ff)), -0.08, y, 0.16)); const notch = at(bar(0.4, 0.08, 0.04, DARK()), 0, 1.05, 0.16);
    return G(b, s, ...w, notch, at(ball(0.18, M(0x35d6c8)), 0.3, -0.75, 0.2)).rotateZ(-0.12);
  },
  serial() {   // price-tag shaped serial tag
    const s = new T.Shape(); s.moveTo(-0.9, 1.0); s.lineTo(0.6, 1.0); s.lineTo(1.2, 0); s.lineTo(0.6, -1.0); s.lineTo(-0.9, -1.0); s.quadraticCurveTo(-1.15, -1.0, -1.15, -0.75); s.lineTo(-1.15, 0.75); s.quadraticCurveTo(-1.15, 1.0, -0.9, 1.0);
    const h = new T.Path(); h.absarc(0.6, 0, 0.17, 0, Math.PI * 2, true); s.holes.push(h);
    const bars = [0, 1, 2, 3, 4, 5].map((i) => at(bar(0.07 + (i % 2) * 0.05, 0.9, 0.05, DARK()), -0.7 + i * 0.17, -0.15, 0.2));
    return G(ext(s, 0.3, M(0x38bdf8), 0.07), at(bar(0.85, 0.14, 0.05, WHITE()), -0.35, 0.5, 0.2), ...bars, at(ring(0.34, 0.05, SILVER(), Math.PI * 1.6), 0.6, 0, 0.0)).rotateZ(0.4);
  },
  bank() {
    const roof = poly([[-1.35, 0.55], [0, 1.45], [1.35, 0.55]], 0.9, M(0x34d399), 0.07), beam = at(bar(2.8, 0.22, 1.0, WHITE()), 0, 0.5, 0), base = at(slab(2.9, 0.3, 1.1, 0.1, WHITE(), 0.05), 0, -1.2, 0), base2 = at(slab(2.6, 0.22, 1.0, 0.08, M(0xdce6f0), 0.04), 0, -0.98, 0);
    const cols = [-0.95, -0.32, 0.32, 0.95].map((x) => at(cyl(0.2, 1.4, WHITE(), 40, 0.16), x, -0.25, 0));
    return G(roof, beam, base, base2, ...cols, at(ball(0.2, GOLD()), 0, 0.95, 0.5));
  },
  crypto() {   // coins
    const mk = (x, y, z, rot) => { const c = disc(1.0, 0.26, GOLD()); const rim = ring(0.9, 0.08, M(0xffe27a, { metalness: 0.9, roughness: 0.25 })); rim.position.z = 0.14; const inner = at(disc(0.7, 0.05, M(0xf2a900, { metalness: 0.9, roughness: 0.3 })), 0, 0, 0.14); const bb = at(bar(0.18, 0.78, 0.06, M(0xffe27a, { metalness: 0.9 })), -0.1, 0, 0.19); const t = at(bar(0.5, 0.15, 0.06, M(0xffe27a, { metalness: 0.9 })), 0.1, 0.25, 0.19), t2 = at(bar(0.5, 0.15, 0.06, M(0xffe27a, { metalness: 0.9 })), 0.1, -0.25, 0.19); const g = G(c, rim, inner, bb, t, t2); g.position.set(x, y, z); g.rotation.y = rot; return g; };
    return G(mk(0.7, -0.2, -0.4, -0.5), mk(-0.4, 0.3, 0.3, -0.2));
  },
  insurance() {   // shield with a check
    const s = new T.Shape(); s.moveTo(0, 1.35); s.bezierCurveTo(0.5, 1.1, 0.9, 1.1, 1.2, 1.15); s.lineTo(1.2, 0.2); s.bezierCurveTo(1.2, -0.7, 0.5, -1.15, 0, -1.45); s.bezierCurveTo(-0.5, -1.15, -1.2, -0.7, -1.2, 0.2); s.lineTo(-1.2, 1.15); s.bezierCurveTo(-0.9, 1.1, -0.5, 1.1, 0, 1.35);
    const sh = ext(s, 0.5, M(0x34d399), 0.1); const inner = at(ext(new T.Shape(s.getPoints(24).map((p) => new T.Vector2(p.x * 0.78, p.y * 0.78 - 0.05))), 0.1, M(0x1faf7a), 0.03), 0, 0, 0.3);
    return G(sh, inner, stroke([-0.45, -0.02], [-0.1, -0.38], 0.24, 0.16, WHITE()).translateZ(0.42), stroke([-0.1, -0.38], [0.5, 0.4], 0.24, 0.16, WHITE()).translateZ(0.42));
  },
  identity() {
    const c = slab(2.6, 1.7, 0.2, 0.24, M(0xffa23a)), av = at(disc(0.38, 0.06, WHITE()), -0.75, 0.15, 0.13), hd = at(ball(0.16, M(0xe9770f)), -0.75, 0.22, 0.17), sh = at(slab(0.5, 0.26, 0.05, 0.12, M(0xe9770f), 0.02), -0.75, -0.08, 0.16);
    const ls = [0.3, -0.05, -0.4].map((y, i) => at(bar(i === 0 ? 1.0 : 0.85 - i * 0.1, 0.13, 0.05, WHITE()), 0.55, y, 0.13)); const fl = at(bar(1.8, 0.12, 0.05, M(0xffd08a)), 0, -0.62, 0.13);
    return G(c, av, hd, sh, ...ls, fl).rotateZ(0.1);
  },
  voter() {   // ballot box
    const b = slab(1.9, 1.6, 1.4, 0.2, M(0x4f6bff), 0.1), top = at(slab(2.0, 0.22, 1.5, 0.1, M(0x3b52e6), 0.06), 0, 0.82, 0), slot = at(bar(1.0, 0.1, 0.5, DARK()), 0, 0.96, 0);
    const paper = at(slab(0.9, 1.15, 0.05, 0.05, WHITE(), 0.02), 0, 1.3, 0); paper.rotation.set(0, 0, 0.1); const chk = [stroke([-0.22, 1.28], [-0.08, 1.12], 0.1, 0.05, M(0x4ade80)).translateZ(0.06), stroke([-0.08, 1.12], [0.25, 1.5], 0.1, 0.05, M(0x4ade80)).translateZ(0.06)];
    const star = at(ball(0.2, GOLD()), 0, -0.1, 0.72);
    return G(b, top, slot, paper, ...chk, star).translateY(-0.2);
  },
  photoid() {   // badge on a lanyard clip
    const c = slab(1.7, 2.3, 0.2, 0.26, WHITE()), hd = at(slab(1.7, 0.5, 0.26, 0.26, M(0x35d6c8)), 0, 0.9, 0), ph = at(slab(0.9, 0.9, 0.06, 0.12, M(0xc9d6ff), 0.02), 0, 0.05, 0.12), person = at(ball(0.18, M(0x6b8cff)), 0, 0.15, 0.17), body = at(slab(0.6, 0.3, 0.05, 0.15, M(0x6b8cff), 0.02), 0, -0.2, 0.16);
    const ls = [at(bar(1.1, 0.12, 0.05, M(0xc4ccd6)), 0, -0.72, 0.12), at(bar(0.7, 0.1, 0.05, M(0xc4ccd6)), -0.2, -0.95, 0.12)]; const clip = at(bar(0.55, 0.12, 0.2, SILVER()), 0, 1.25, 0.05);
    return G(c, hd, ph, person, body, ...ls, clip).rotateZ(-0.1);
  },
  library() {   // stack of books
    const bk = (w, h, y, col, x = 0, rz = 0) => { const b = at(slab(w, h, 1.2, 0.1, M(col), 0.06), x, y, 0); const pages = at(bar(w - 0.2, h - 0.2, 1.0, WHITE()), 0.07, y, 0.18); const sp = at(bar(0.12, h - 0.15, 1.22, M(0xffffff, { roughness: 0.5 })), -w / 2 + 0.05, y, 0); const g = G(b, pages, sp); g.rotation.z = rz; return g; };
    return G(bk(2.5, 0.52, -0.85, 0x4f6bff), bk(2.2, 0.5, -0.32, 0xff5d73, 0.1, 0.02), bk(2.4, 0.5, 0.2, 0x35d6c8, -0.1, -0.015), bk(1.9, 0.45, 0.7, 0xffb02e, 0.1, 0.02), at(ball(0.0001, WHITE()), 0, 0, 0));
  },
  membership() {   // star medal
    const s = new T.Shape(), n = 5; for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? 0.58 : 1.3; const p = [Math.cos(a) * r, Math.sin(a) * r]; if (i) s.lineTo(...p); else s.moveTo(...p); }
    const star = ext(s, 0.42, GOLD(), 0.12), gem = at(ball(0.3, M(0xff5d73)), 0, 0, 0.3);
    return G(star, gem).rotateZ(0.08);
  },
  healthcard() {   // medical cross on a case
    const c = slab(2.4, 1.9, 0.26, 0.3, WHITE()), v = at(slab(0.5, 1.2, 0.12, 0.12, M(0xff4d6d), 0.04), 0, 0, 0.18), hh = at(slab(1.2, 0.5, 0.12, 0.12, M(0xff4d6d), 0.04), 0, 0, 0.18);
    const pulse = at(bar(0.9, 0.08, 0.04, M(0xc4ccd6)), 0.6, -0.7, 0.15);
    return G(c, v, hh, pulse, at(bar(0.5, 0.08, 0.04, M(0xc4ccd6)), -0.6, -0.7, 0.15)).rotateZ(-0.1);
  },
  prescription() {   // pill bottle
    const bot = at(cyl(0.7, 1.7, M(0xffa23a, { transmission: 0 }), 48), 0, -0.2, 0), cap = at(cyl(0.78, 0.5, WHITE(), 48), 0, 0.9, 0), lab = at(cyl(0.705, 0.95, WHITE(), 48), 0, -0.25, 0), cross = [at(bar(0.14, 0.5, 0.06, M(0xff4d6d)), 0, -0.2, 0.72), at(bar(0.5, 0.14, 0.06, M(0xff4d6d)), 0, -0.2, 0.72)];
    const pill = at(new T.Mesh(new T.CapsuleGeometry(0.2, 0.55, 12, 24), M(0x35d6c8)), 1.1, -0.9, 0.5); pill.rotation.z = 0.9; const pill2 = at(ball(0.2, M(0xff5d9e)), 1.2, -0.35, 0.6);
    return G(bot, lab, cap, ...cross, pill, pill2).rotateZ(0.12);
  },
  lens() {   // glasses
    const f = M(0x232b3a, { roughness: 0.3 }), l = at(ring(0.62, 0.13, f), -0.8, 0, 0), r = at(ring(0.62, 0.13, f), 0.8, 0, 0), bridge = at(ring(0.25, 0.07, f, Math.PI), 0, 0.1, 0);
    const gl = [-0.8, 0.8].map((x) => at(disc(0.6, 0.04, M(0x8fd0ff, { transparent: true, opacity: 0.45, roughness: 0.05 })), x, 0, 0)); const sh = [-0.8, 0.8].map((x) => stroke([x - 0.3, 0.25], [x + 0.1, 0.4], 0.07, 0.04, WHITE()).translateZ(0.06));
    const a1 = at(bar(0.09, 0.09, 1.0, f), -1.45, 0.1, -0.5), a2 = at(bar(0.09, 0.09, 1.0, f), 1.45, 0.1, -0.5);
    return G(l, r, bridge, ...gl, ...sh, a1, a2);
  },
  travel() {   // passport
    const c = slab(1.85, 2.5, 0.3, 0.2, M(0x2f6bff)), pg = at(slab(1.7, 2.35, 0.1, 0.16, WHITE(), 0.03), 0.06, 0, -0.17), emb = at(disc(0.5, 0.06, GOLD()), 0, 0.3, 0.17), gl = at(ring(0.34, 0.04, M(0x2f6bff)), 0, 0.3, 0.21), mer = at(bar(0.06, 0.62, 0.05, M(0x2f6bff)), 0, 0.3, 0.22);
    const l1 = at(bar(1.1, 0.14, 0.05, GOLD()), 0, -0.55, 0.17), l2 = at(bar(0.8, 0.1, 0.05, M(0xffe27a, { metalness: 0.8 })), 0, -0.82, 0.17);
    const plane = at(poly([[0, 0.6], [0.14, 0.1], [0.62, -0.2], [0.62, -0.32], [0.14, -0.18], [0.1, -0.5], [0.3, -0.62], [0.3, -0.7], [0, -0.62], [-0.3, -0.7], [-0.3, -0.62], [-0.1, -0.5], [-0.14, -0.18], [-0.62, -0.32], [-0.62, -0.2], [-0.14, 0.1]], 0.05, M(0x2f6bff), 0.01), 0, 0.3, 0.22); plane.scale.setScalar(0.55);
    return G(c, pg, emb, at(plane, 0, 0.3, 0.2), l1, l2).rotateZ(0.12);
  },
  car() {
    const body = at(slab(3.0, 0.8, 1.3, 0.35, M(0xff4d6d), 0.12), 0, -0.25, 0), cab = at(slab(1.7, 0.78, 1.2, 0.34, M(0xff4d6d), 0.12), -0.1, 0.38, 0), win = at(slab(1.4, 0.55, 1.26, 0.22, M(0x9fd8ff, { roughness: 0.08 }), 0.05), -0.1, 0.4, 0);
    const wheels = [[-0.95, 0.6], [0.95, 0.6], [-0.95, -0.6], [0.95, -0.6]].map(([x, z]) => { const w = at(cyl(0.38, 0.28, DARK(), 40), x, -0.65, z * 1.0); w.rotation.x = Math.PI / 2; const hub = at(cyl(0.18, 0.3, SILVER(), 32), x, -0.65, z); hub.rotation.x = Math.PI / 2; return G(w, hub); });
    const lights = [at(ball(0.13, M(0xffe27a, { emissive: 0xffc43d, emissiveIntensity: 0.8 })), 1.5, -0.1, 0.4), at(ball(0.13, M(0xffe27a, { emissive: 0xffc43d, emissiveIntensity: 0.8 })), 1.5, -0.1, -0.4)];
    return G(body, cab, win, ...wheels, ...lights).rotateY(-0.5);
  },
  contact() {   // a person
    const hd = at(ball(0.68, M(0xffc09a, { roughness: 0.5 })), 0, 0.72, 0), hair = at(new T.Mesh(new T.SphereGeometry(0.72, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0x3a2a5a)), 0, 0.78, -0.02), body = at(new T.Mesh(new T.SphereGeometry(1.15, 40, 28, 0, Math.PI * 2, 0, Math.PI / 2), M(0x35d6c8)), 0, -1.0, 0);
    const eyes = [-0.22, 0.22].map((x) => at(ball(0.07, DARK()), x, 0.78, 0.62)); const smile = at(ring(0.2, 0.035, M(0xc2625d), Math.PI), 0, 0.55, 0.6); smile.rotation.z = Math.PI;
    return G(hd, hair, body, ...eyes, smile);
  },
  emergency() {   // siren
    const base = at(slab(2.0, 0.45, 1.5, 0.15, M(0x4b5566, { metalness: 0.4 }), 0.08), 0, -0.95, 0), mid = at(cyl(0.85, 0.28, DARK(), 48), 0, -0.6, 0);
    const dome = at(new T.Mesh(new T.SphereGeometry(0.95, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), M(0xff3b5c, { emissive: 0xff2244, emissiveIntensity: 0.55, transmission: 0 })), 0, -0.46, 0);
    const col = at(cyl(0.34, 0.8, M(0xffe3e8), 32), 0, 0.0, 0); const rays = [-1, 0, 1].map((i) => { const r = at(bar(0.14, 0.5, 0.1, M(0xffc43d)), i * 1.25, 1.15 - Math.abs(i) * 0.1, 0); r.rotation.z = -i * 0.5; return r; });
    return G(base, mid, dome, col, ...rays).translateY(-0.05);
  },
  lock() {
    const body = slab(1.9, 1.5, 0.9, 0.3, M(0x6b8cff), 0.12), sh = at(ring(0.62, 0.17, SILVER(), Math.PI), 0, 0.75, 0), l = at(cyl(0.17, 0.8, SILVER()), -0.62, 0.9, 0), r = at(cyl(0.17, 0.5, SILVER()), 0.62, 0.9, 0), kh = at(disc(0.17, 0.12, DARK()), 0, 0.1, 0.5), kb = at(bar(0.12, 0.38, 0.12, DARK()), 0, -0.15, 0.5);
    return G(at(body, 0, -0.1, 0), at(sh, 0, 0.65, 0), l.translateY(-0.2), r.translateY(-0.2), kh, kb);
  },
  star() {
    const s = new T.Shape(), n = 5; for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? 0.65 : 1.4; const p = [Math.cos(a) * r, Math.sin(a) * r]; if (i) s.lineTo(...p); else s.moveTo(...p); }
    return ext(s, 0.5, GOLD(), 0.16);
  },
};
export const NAMES = Object.keys(B);

/* One object -> a transparent picture. The caller supplies the renderer. */
let ENV = null;
export function renderOne(renderer, name, size = 512) {
  const scene = new T.Scene(), obj = B[name](); scene.environment = ENV; scene.environmentIntensity = 0.9;
  const box = new T.Box3().setFromObject(obj), sz = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
  obj.position.sub(c); const holder = new T.Group(); holder.add(obj); holder.rotation.set(0.32, -0.55, 0); scene.add(holder);
  const k = 2.7 / Math.max(sz.x, sz.y, sz.z * 1.0, 0.001); holder.scale.setScalar(k);
  const cam = new T.PerspectiveCamera(28, 1, 0.1, 50); cam.position.set(0, 0.2, 8.2); cam.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xffffff, 0x8899bb, 1.05));
  const key = new T.DirectionalLight(0xffffff, 2.6); key.position.set(-3, 5, 6); scene.add(key);
  const rim = new T.DirectionalLight(0xbfe3ff, 1.6); rim.position.set(5, 1.5, -4); scene.add(rim);
  const fill = new T.DirectionalLight(0xffe2cc, 0.8); fill.position.set(4, -2, 4); scene.add(fill);
  renderer.setSize(size, size, false); renderer.setClearColor(0x000000, 0); renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}
export function makeEnv(renderer) {
  const env = new T.Scene(), bright = (c, i) => new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(i), side: T.BackSide });
  env.add(new T.Mesh(new T.BoxGeometry(20, 20, 20), bright(0x9fb0c8, 0.85)));
  const panel = (x, y, z, w, h, col, i) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(i), side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
  panel(0, 9, 2, 12, 5, 0xffffff, 6); panel(-8, 3, 5, 5, 8, 0xfff2e0, 4); panel(8, 2, 2, 4, 9, 0xd8ecff, 3.5); panel(0, -8, 3, 14, 4, 0x8899aa, 1.2);
  const pm = new T.PMREMGenerator(renderer); const tex = pm.fromScene(env, 0.03).texture; pm.dispose(); ENV = tex; return tex;
}
export { T };
