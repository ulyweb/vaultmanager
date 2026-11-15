/* The pocket vault: a real three.js model built from parts (so it can be pulled apart), not a video.
   Rounded slab body in two shells, black glass screen with a live canvas texture, cream d-pad, two round buttons, speaker holes,
   and inside: mainboard, key cell and four screws. */
import * as THREE from '../vendor/three.bundle.min.js';

const rr = (w, h, r) => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
};
/* a rounded-rectangle slab of outer size w × h × d with soft bevelled edges, centred on the origin */
export const slab = (w, h, r, d, bevel = 0.06) => {
  const inner = Math.max(0.002, d - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(rr(w - 2 * bevel, h - 2 * bevel, Math.max(0.01, r - bevel)), { depth: inner, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 20 });
  g.translate(0, 0, -inner / 2);
  return g;
};

function textTexture(text, { w = 512, h = 64, font = '900 44px "Arial Black", "Helvetica Neue", Arial, sans-serif', color = '#0b0d10' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildDevice(screenCanvas) {
  const M = {
    body: new THREE.MeshPhysicalMaterial({ color: 0x19c8b4, roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.55 }),
    cream: new THREE.MeshPhysicalMaterial({ color: 0xf1ece0, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x040506, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc3c7cf, metalness: 1, roughness: 0.28 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x0f6b4f, roughness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 1, roughness: 0.35 }),
    cell: new THREE.MeshStandardMaterial({ color: 0xf7c948, roughness: 0.55 }),
  };
  const group = new THREE.Group(), parts = {}, hits = [];
  const part = (name, out, label) => { const g = new THREE.Group(); g.userData = { out: new THREE.Vector3(...out), label }; parts[name] = g; group.add(g); return g; };
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

  const W = 2.4, H = 3.2, R = 0.44;
  /* front shell */
  const front = part('front', [0, 0, 1.5], 'Front shell');
  front.add(mesh(slab(W, H, R, 0.32, 0.075), M.body, 0, 0, 0.158));
  const label = mesh(new THREE.PlaneGeometry(1.5, 0.1875), new THREE.MeshBasicMaterial({ map: textTexture('VAULTMANAGER'), transparent: true, depthWrite: false }), 0, 1.36, 0.321);
  front.add(label, mesh(new THREE.BoxGeometry(0.03, 0.5, 0.1), M.dark, -W / 2 + 0.005, 0.35, 0.06));

  /* screen: glass bezel + the live display */
  const screen = part('screen', [0, 0.2, 2.6], 'Screen');
  screen.add(mesh(slab(1.9, 1.52, 0.17, 0.06, 0.02), M.glass, 0, 0.42, 0.335));
  const tex = new THREE.CanvasTexture(screenCanvas); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const display = mesh(new THREE.PlaneGeometry(1.64, 1.23), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 0.42, 0.368);
  display.userData.act = 'start'; screen.add(display); hits.push(display);

  /* controls: d-pad, two buttons, speaker holes */
  const ctl = part('controls', [0, -0.25, 2.15], 'Controls');
  const dpad = new THREE.Group(); dpad.position.set(-0.62, -0.8, 0.345);
  const up = mesh(slab(0.24, 0.7, 0.06, 0.11, 0.03), M.cream), across = mesh(slab(0.7, 0.24, 0.06, 0.11, 0.03), M.cream);
  dpad.add(up, across); ctl.add(dpad);
  const padHit = (y, act) => { const m = mesh(new THREE.BoxGeometry(0.3, 0.3, 0.14), new THREE.MeshBasicMaterial({ visible: false }), 0, y, 0); m.userData = { act, press: dpad }; dpad.add(m); hits.push(m); };
  padHit(0.22, 'jump'); padHit(-0.22, 'slide');
  const button = (x, y, act) => {
    const g = new THREE.CylinderGeometry(0.165, 0.165, 0.11, 40); g.rotateX(Math.PI / 2);
    const m = mesh(g, M.cream, x, y, 0.345); m.userData = { act, press: m, z: 0.345 }; ctl.add(m); hits.push(m); return m;
  };
  const btnA = button(0.36, -0.9, 'jump'), btnB = button(0.8, -0.72, 'slide');
  const holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.027, 14), M.dark, 24), mat4 = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) { mat4.setPosition(0.36 + (i % 6) * 0.088, -1.2 - Math.floor(i / 6) * 0.088, 0.3215); holes.setMatrixAt(i, mat4); }
  ctl.add(holes);

  /* inside */
  const board = part('board', [0, 0, 0.5], 'Mainboard');
  board.add(mesh(slab(2.0, 2.8, 0.28, 0.05, 0.012), M.pcb));
  for (const [x, y, w, h] of [[-0.35, 0.75, 0.6, 0.6], [0.5, 0.9, 0.34, 0.26], [0.45, 0.25, 0.5, 0.2], [-0.5, -0.2, 0.3, 0.3]]) board.add(mesh(new THREE.BoxGeometry(w, h, 0.06), M.dark, x, y, 0.05));
  for (let i = 0; i < 7; i++) board.add(mesh(new THREE.BoxGeometry(0.08, 0.16, 0.012), M.gold, -0.72 + i * 0.24, -1.2, 0.032));
  const cell = part('cell', [0, 0, -0.55], 'Key cell');
  cell.add(mesh(slab(1.5, 1.0, 0.1, 0.16, 0.03), M.cell, 0, -0.45, -0.06));
  const cellLabel = mesh(new THREE.PlaneGeometry(1.2, 0.15), new THREE.MeshBasicMaterial({ map: textTexture('KEY CELL', { font: '900 40px "Arial Black", Arial, sans-serif' }), transparent: true, depthWrite: false }), 0, -0.45, -0.142);
  cellLabel.rotation.y = Math.PI; cell.add(cellLabel);
  const back = part('back', [0, 0, -1.6], 'Back shell');
  back.add(mesh(slab(W, H, R, 0.32, 0.075), M.body, 0, 0, -0.158));
  const screws = part('screws', [0, 0, -2.6], 'Four screws');
  for (const [x, y] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) { const g = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 18); g.rotateX(Math.PI / 2); screws.add(mesh(g, M.steel, x, y, -0.3)); }

  let explode = 0;
  const ease = (t) => t * t * (3 - 2 * t);
  return {
    group, parts, hits, materials: M, texture: tex, buttons: { btnA, btnB, dpad },
    /* device-local anchor points for the tour pins */
    anchors: { screen: [-0.74, 0.96, 0.4], label: [-0.98, 1.36, 0.34], dpad: [-0.62, -0.8, 0.42], buttons: [0.58, -0.81, 0.42], speaker: [0.58, -1.33, 0.34], side: [-1.22, 0.35, 0.06] },
    setColor(hex) { M.body.color.set(hex); },
    setExplode(t, spread = 1) { explode = t; const e = ease(Math.min(1, Math.max(0, t))) * spread; for (const p of Object.values(parts)) p.position.copy(p.userData.out).multiplyScalar(e); },
    get explode() { return explode; },
    press(target) { if (target && target.userData.press) target.userData.press.userData.dip = 1; },
    update(dt) {
      for (const b of [btnA, btnB, dpad]) { const u = b.userData; if (u.dip) { u.dip = Math.max(0, u.dip - dt * 6); const base = b === dpad ? 0.345 : u.z; b.position.z = base - 0.05 * Math.sin(Math.min(1, u.dip) * Math.PI); } }
    },
  };
}
