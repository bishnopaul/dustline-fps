// map.js — Kestrel Yard: a freight depot at dusk. One data table (PROPS) drives both the
// collision boxes and the meshes, so what you see is exactly what blocks you. The pure
// helpers (collide, rayVsWorld, segmentBlocked, findPath) use plain numbers and never touch
// three.js, which keeps the simulation independent of the renderer.

import * as THREE from 'three';

// ---------------------------------------------------------------- layout data

// kind, centre x/z, size x/z, height, colour key. Every prop is an axis-aligned box for
// collision (tanks are cylinders visually, boxed here), tall enough to matter.
const PROPS = [
  // perimeter fence (visual posts aside, these are the world edge)
  ['wall', 0, -29.2, 76, 1.2, 3.2, 'fence'], ['wall', 0, 29.2, 76, 1.2, 3.2, 'fence'],
  ['wall', -37.2, 0, 1.2, 60, 3.2, 'fence'], ['wall', 37.2, 0, 1.2, 60, 3.2, 'fence'],
  // the warehouse, centre map: walls with a door gap on each side
  ['wall', -5.25, -7, 7.5, 0.4, 3.6, 'warehouse'], ['wall', 5.25, -7, 7.5, 0.4, 3.6, 'warehouse'],
  ['wall', -5, 7, 8, 0.4, 3.6, 'warehouse'], ['wall', 5.5, 7, 7, 0.4, 3.6, 'warehouse'],
  ['wall', -9, -4, 0.4, 6, 3.6, 'warehouse'], ['wall', -9, 4.5, 0.4, 5, 3.6, 'warehouse'],
  ['wall', 9, -2.75, 0.4, 8.5, 3.6, 'warehouse'], ['wall', 9, 5.75, 0.4, 2.5, 3.6, 'warehouse'],
  ['pillar', -7.5, -5.5, 0.7, 0.7, 3.6, 'warehouse'], ['pillar', 7.5, 5.5, 0.7, 0.7, 3.6, 'warehouse'],
  ['crate', -3.5, -3, 2.2, 2.2, 2.2, 'wood'], ['crate', 2.5, 2.5, 1.6, 1.6, 1.6, 'wood'],
  // site A — the crane pad, north-west
  ['container', -29, -16, 2.4, 9, 2.6, 'teal'], ['container', -15, -21.5, 9, 2.4, 2.6, 'rust'],
  ['container', -16, -10.5, 6, 2.4, 2.6, 'slate'],
  ['crate', -22.5, -9.5, 1.3, 1.3, 1.3, 'wood'], ['crate', -18, -19, 2.2, 2.2, 2.2, 'wood'],
  ['sandbag', -17, -13.5, 4, 0.8, 0.9, 'sand'], ['sandbag', -20, -24.5, 3.4, 0.8, 0.9, 'sand'],
  ['leg', -26, -22, 0.5, 0.5, 7.5, 'steel'], ['leg', -14, -22, 0.5, 0.5, 7.5, 'steel'],
  ['leg', -26, -10, 0.5, 0.5, 7.5, 'steel'], ['leg', -14, -10, 0.5, 0.5, 7.5, 'steel'],
  // site B — fuel row, south-east
  ['tank', 26, 11, 3.4, 3.4, 3.6, 'rust'], ['tank', 26, 21, 3.4, 3.4, 3.6, 'rust'], ['tank', 18, 21.5, 3.4, 3.4, 3.6, 'slate'],
  ['container', 30.5, 16, 2.4, 9, 2.6, 'olive'], ['container', 15, 11.5, 6, 2.4, 2.6, 'teal'],
  ['container', 20, 24.5, 8, 2.4, 2.6, 'maroon'],
  ['barrel', 13.5, 18, 0.7, 0.7, 0.95, 'rust'], ['barrel', 14.3, 18.6, 0.7, 0.7, 0.95, 'teal'], ['barrel', 13.9, 17.2, 0.7, 0.7, 0.95, 'slate'],
  ['sandbag', 12.5, 15, 0.8, 4, 0.9, 'sand'], ['crate', 23.5, 13.5, 1.3, 1.3, 1.3, 'wood'],
  // lanes and mid cover
  ['container', 0, -13, 9, 2.4, 2.6, 'maroon'], ['container', -2, 14, 6, 2.4, 2.6, 'slate'],
  ['container', 14, -4, 2.4, 6, 2.6, 'teal'], ['container', -15, 4, 2.4, 6, 2.6, 'rust'],
  ['container', 24, -12, 6, 2.4, 2.6, 'olive'], ['container', -24, 9, 6, 2.4, 2.6, 'teal'],
  ['crate', 6, -18, 1.3, 1.3, 1.3, 'wood'], ['crate', -6, 20, 1.3, 1.3, 1.3, 'wood'],
  ['crate', 18, 2, 1.6, 1.6, 1.6, 'wood'], ['crate', -20, 1, 1.6, 1.6, 1.6, 'wood'],
  ['crate', 10, 18, 1.3, 1.3, 1.3, 'wood'], ['crate', -30, -3, 1.6, 1.6, 1.6, 'wood'],
  ['crate', 31, -18, 1.3, 1.3, 1.3, 'wood'], ['crate', 4, -24, 1.6, 1.6, 1.6, 'wood'],
  ['sandbag', 0, -19, 4, 0.8, 0.9, 'sand'], ['sandbag', -13, 13, 3.4, 0.8, 0.9, 'sand'],
  ['sandbag', 13, -14, 0.8, 3.4, 0.9, 'sand'],
];

// Collision boxes derived from the props: { x0, x1, z0, z1, top }.
export const COLLIDERS = PROPS.map(p => ({
  x0: p[1] - p[3] / 2, x1: p[1] + p[3] / 2, z0: p[2] - p[4] / 2, z1: p[2] + p[4] / 2, top: p[5],
}));

export const SITES = {
  A: { x0: -27, x1: -12, z0: -23.5, z1: -9, cx: -19.5, cz: -16, label: 'CRANE PAD' },
  B: { x0: 14, x1: 30.5, z0: 9, z1: 24.5, cx: 22, cz: 16.5, label: 'FUEL ROW' },
};
export function inSite(x, z, site) {
  const s = SITES[site];
  return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
}

// Spawn rows, five a side, with the yaw each fighter starts facing (0 = north, -z).
export const SPAWNS = {
  atk: [
    { x: -24, z: 22.5, yaw: 0 }, { x: -27, z: 23.5, yaw: 0 }, { x: -21, z: 23, yaw: 0 },
    { x: -28.5, z: 20.5, yaw: 0 }, { x: -22, z: 20, yaw: 0 },
  ],
  def: [
    { x: 24, z: -22.5, yaw: Math.PI }, { x: 27, z: -23.5, yaw: Math.PI }, { x: 21, z: -23, yaw: Math.PI },
    { x: 28.5, z: -20.5, yaw: Math.PI }, { x: 22, z: -20, yaw: Math.PI },
  ],
};

// Waypoint graph: nodes are [x, z]; edges are walked by bots.js (BFS shortest path).
export const NODES = [
  [-25, 21], [-20, 17], [-28.5, 9], [-27, -3], [-23, -11], [-19, -16], [-13, -18], [-13.5, -5],
  [-12, 6], [-11, 0], [-5, 0], [0, -3], [5, 0], [11, 3], [0, 5], [0, 11], [19, 7],
  [20, 17], [26, 15], [15, 5], [24, 4], [25, -8], [25, -20], [16, -17], [-6, -16],
  [-8, -18], [-13.5, -19.6], [6, 18], [-10, 18], [18, -2], [-2, -20], [12, -21],
];
const EDGE_LIST = [
  [0, 1], [1, 2], [1, 28], [2, 3], [3, 4], [4, 5], [5, 6], [5, 26], [4, 7], [7, 8], [7, 25],
  [8, 9], [8, 28], [9, 10], [10, 11], [10, 14], [11, 12], [7, 24], [12, 13], [14, 15],
  [15, 27], [15, 16], [13, 19], [13, 29], [19, 20], [19, 16], [16, 17], [17, 18], [17, 20],
  [20, 21], [22, 23], [22, 31], [23, 24], [23, 29], [24, 25], [24, 30], [25, 26],
  [25, 6], [30, 31], [30, 25], [31, 23], [27, 28], [29, 21], [3, 7], [6, 26],
];
export const ADJ = NODES.map(() => []);
for (const [a, b] of EDGE_LIST) { ADJ[a].push(b); ADJ[b].push(a); }

// Defender posts: node to stand on, and the point to watch from it. One post per site plus
// the approach lanes and mid, so a site is covered but not pre-stacked — rotations matter.
export const DEF_HOLDS = [
  { node: 6, wx: -21, wz: -14 }, { node: 7, wx: -8, wz: -16 },
  { node: 18, wx: 19, wz: 16 }, { node: 19, wx: 21, wz: 16 },
  { node: 24, wx: -8, wz: -6 },
];
// Attacker post-plant posts per site.
export const PLANT_HOLDS = {
  A: [{ node: 6, wx: -19, wz: -16 }, { node: 3, wx: -19, wz: -16 }, { node: 7, wx: -19, wz: -16 }],
  B: [{ node: 20, wx: 21, wz: 16 }, { node: 18, wx: 21, wz: 16 }, { node: 19, wx: 21, wz: 16 }],
};

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first shortest path over the waypoint graph; returns node indices including both
// ends, or just [from] when already there. Allocations happen at think-rate, never per frame.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === to) break;
    for (const next of ADJ[cur]) {
      if (prev[next] === -1) { prev[next] = cur; queue.push(next); }
    }
  }
  if (prev[to] === -1) return [from];
  const path = [];
  for (let n = to; n !== from; n = prev[n]) path.push(n);
  path.push(from);
  path.reverse();
  return path;
}

// ---------------------------------------------------------------- physics helpers

// Push a circle (actor feet at height feetY) out of every collider it overlaps. Low props
// can be hopped: once the feet are near the top, the box stops blocking.
export function collide(x, z, radius, feetY) {
  for (const c of COLLIDERS) {
    if (feetY >= c.top - 0.35) continue;
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * radius;
      z = nz + (dz / d) * radius;
    } else {
      // centre inside the box: leave by the shallowest face
      const pl = x - c.x0, pr = c.x1 - x, pn = z - c.z0, pf = c.z1 - z;
      const m = Math.min(pl, pr, pn, pf);
      if (m === pl) x = c.x0 - radius; else if (m === pr) x = c.x1 + radius;
      else if (m === pn) z = c.z0 - radius; else z = c.z1 + radius;
    }
  }
  // world edge, inside the fence
  x = Math.max(-35.6, Math.min(35.6, x));
  z = Math.max(-27.6, Math.min(27.6, z));
  return [x, z];
}

// Nearest hit of a ray against the collision boxes (slab test), or null. Direction need not
// be normalised; dist is in the same units as maxDist along the direction vector.
export function rayVsWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const c of COLLIDERS) {
    let t0 = 0, t1 = best;
    // X slab
    if (Math.abs(dx) < 1e-9) { if (ox < c.x0 || ox > c.x1) continue; }
    else {
      let ta = (c.x0 - ox) / dx, tb = (c.x1 - ox) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Y slab (boxes stand on the ground)
    if (Math.abs(dy) < 1e-9) { if (oy < 0 || oy > c.top) continue; }
    else {
      let ta = (0 - oy) / dy, tb = (c.top - oy) / dy;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) { if (oz < c.z0 || oz > c.z1) continue; }
    else {
      let ta = (c.z0 - oz) / dz, tb = (c.z1 - oz) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 < best && t0 >= 0) best = t0;
  }
  return best < maxDist ? best : null;
}

// Is the straight segment a→b blocked by a box? Used for bot sight lines and blast cover.
export function segmentBlocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  return rayVsWorld(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05) !== null;
}

// ---------------------------------------------------------------- look of the place

export const PALETTE = {
  sky: 0x2c4258, fog: 0xcf9a68, sun: 0xffd9a8,
  sand: '#9a7d55', asphalt: '#6e6257',
  teal: 0x2f6f6d, rust: 0xb0512c, slate: 0x55606e, olive: 0x6b7248, maroon: 0x7a3b3b,
  warehouse: 0x8a7a63, fence: 0x4c4a44, wood: 0x9a7648, steel: 0xc9a227, sandbag: 0xa8905e,
  atk: 0xc96a2c, def: 0x3d6fb4,
};

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function speckle(ctx, w, h, n, colours) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colours[(Math.random() * colours.length) | 0];
    ctx.globalAlpha = 0.05 + Math.random() * 0.1;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  ctx.globalAlpha = 1;
}

// The yard floor: painted once onto a canvas — asphalt apron, worn lane paint, the two
// sites marked with their letters, so the map reads at a glance from any angle.
function groundTexture() {
  return canvasTex(1024, 768, (ctx, w, h) => {
    const px = x => (x + 50) / 100 * w;   // world x -50..50
    const pz = z => (z + 38) / 76 * h;    // world z -38..38
    ctx.fillStyle = PALETTE.sand; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, ['#7d6242', '#b08e60', '#8a6c48']);
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fillRect(px(-38), pz(-30), px(38) - px(-38), pz(30) - pz(-30));
    speckle(ctx, w, h, 1800, ['#5d5348', '#7e7264', '#66584a']);
    // warehouse slab
    ctx.fillStyle = '#7b7268'; ctx.fillRect(px(-10), pz(-8), px(10) - px(-10), pz(8) - pz(-8));
    // lane paint: two worn guide lines from the south gate to each site
    ctx.strokeStyle = 'rgba(240,200,90,.5)'; ctx.lineWidth = 3; ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.moveTo(px(-24), pz(28)); ctx.lineTo(px(-26), pz(-6)); ctx.lineTo(px(-21), pz(-13)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px(-24), pz(28)); ctx.lineTo(px(2), pz(20)); ctx.lineTo(px(19), pz(18)); ctx.stroke();
    ctx.setLineDash([]);
    // site markings
    for (const [site, colour] of [['A', '#e07b39'], ['B', '#e07b39']]) {
      const s = SITES[site];
      ctx.strokeStyle = colour; ctx.lineWidth = 4;
      ctx.strokeRect(px(s.x0), pz(s.z0), px(s.x1) - px(s.x0), pz(s.z1) - pz(s.z0));
      ctx.fillStyle = colour; ctx.font = `bold ${Math.round(h / 12)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(site, px((s.x0 + s.x1) / 2), pz((s.z0 + s.z1) / 2));
    }
    // spawn chevrons
    ctx.fillStyle = 'rgba(243,234,216,.35)'; ctx.font = `bold ${Math.round(h / 22)}px sans-serif`;
    ctx.fillText('JACKALS', px(-24), pz(25.5));
    ctx.fillText('WARDENS', px(24), pz(-25.5));
  });
}

function ribbedTexture(hex) {
  const base = `#${hex.toString(16).padStart(6, '0')}`;
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(x, 0, 3, h);
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(x + 3, 0, 2, h);
    }
    speckle(ctx, w, h, 260, ['#000000', '#ffffff']);
  }, true);
}

function plankTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#9a7648'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, y + 2, w, 2);
    }
    speckle(ctx, w, h, 200, ['#6e5230', '#b8905a']);
  }, true);
}

function corrugatedTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8a7a63'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 10) {
      ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x, 0, 2, h);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x + 2, 0, 2, h);
    }
    speckle(ctx, w, h, 220, ['#5f5342', '#a08c6c']);
  }, true);
}

// Build the whole scene's static geometry from PROPS. Returns the sun light so main.js can
// leave it alone; everything here is created once, never per frame.
export function buildWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 60, 210);

  const skyTex = canvasTex(32, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#22384e'); g.addColorStop(0.42, '#5d5a52');
    g.addColorStop(0.52, '#e08d4e'); g.addColorStop(0.58, '#8a5f3d'); g.addColorStop(1, '#3a2c20');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(240, 24, 14),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);

  const hemi = new THREE.HemisphereLight(0x9db8d6, 0x8a6a48, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.4);
  sun.position.set(-55, 42, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x604c38, 0.5));

  // ground: a painted yard slab over an endless sand plane
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshStandardMaterial({ color: 0x8a6c48, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2; sand.position.y = -0.05;
  sand.receiveShadow = true;
  scene.add(sand);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 76),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.receiveShadow = true;
  scene.add(yard);

  const texFor = {
    teal: ribbedTexture(PALETTE.teal), rust: ribbedTexture(PALETTE.rust),
    slate: ribbedTexture(PALETTE.slate), olive: ribbedTexture(PALETTE.olive),
    maroon: ribbedTexture(PALETTE.maroon),
    wood: plankTexture(), warehouse: corrugatedTexture(),
  };
  const mats = {
    fence: new THREE.MeshStandardMaterial({ color: PALETTE.fence, roughness: 0.9, metalness: 0.3 }),
    sand: new THREE.MeshStandardMaterial({ color: PALETTE.sandbag, roughness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.45, metalness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.8, metalness: 0.3 }),
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);

  for (const [kind, x, z, w, d, h, colour] of PROPS) {
    let mesh;
    if (kind === 'tank' || kind === 'barrel') {
      const tex = texFor[colour] ?? texFor.rust;
      mesh = new THREE.Mesh(unitCyl, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.35 }));
      mesh.scale.set(w, h, w);
    } else {
      const mat = texFor[colour]
        ? new THREE.MeshStandardMaterial({ map: texFor[colour], roughness: 0.85, metalness: 0.12 })
        : mats[colour] ?? mats.dark;
      mesh = new THREE.Mesh(unitBox, mat);
      mesh.scale.set(w, h, d);
    }
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // warehouse roof slab (visual only: grenades may arc over the walls, shots may not)
  const roof = new THREE.Mesh(unitBox, mats.dark);
  roof.scale.set(19.5, 0.3, 15.5);
  roof.position.set(0, 3.85, 0);
  roof.castShadow = true;
  scene.add(roof);

  // the crane over site A: two cross beams, a trolley and a hanging hook
  const beamMat = mats.steel;
  for (const z of [-22, -10]) {
    const beam = new THREE.Mesh(unitBox, beamMat);
    beam.scale.set(13.5, 0.55, 0.55); beam.position.set(-20, 7.6, z);
    beam.castShadow = true; scene.add(beam);
  }
  const cross = new THREE.Mesh(unitBox, beamMat);
  cross.scale.set(0.55, 0.55, 12.5); cross.position.set(-20, 7.9, -16);
  scene.add(cross);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6), mats.dark);
  cable.position.set(-20, 6, -16); scene.add(cable);
  const hook = new THREE.Mesh(unitBox, mats.dark);
  hook.scale.set(0.5, 0.7, 0.5); hook.position.set(-20, 4.1, -16);
  hook.castShadow = true; scene.add(hook);

  // lamp poles: emissive heads, two real point lights where fights happen
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x44403a, roughness: 0.6, metalness: 0.5 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 2.2 });
  for (const [x, z, light] of [[0, 0, true], [22, 16, true], [-24, 22, false], [24, -22, false], [-2, -20, false]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8), lampMat);
    pole.position.set(x, 2.6, z); pole.castShadow = true; scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat);
    bulb.position.set(x, 5.25, z); scene.add(bulb);
    if (light) {
      const pt = new THREE.PointLight(0xffb45e, 60, 30, 1.6);
      pt.position.set(x, 5, z); scene.add(pt);
    }
  }

  // distant silhouettes so the horizon is not empty: low depots in the haze
  const farMat = new THREE.MeshBasicMaterial({ color: 0x54432e, fog: true });
  const farGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [x, z, w, h, d] of [[-90, -60, 60, 14, 20], [70, -80, 80, 18, 24], [100, 30, 50, 12, 30],
                                 [-100, 40, 55, 10, 26], [0, -110, 120, 16, 20], [-40, 100, 90, 12, 22]]) {
    const m = new THREE.Mesh(farGeo, farMat);
    m.scale.set(w, h, d); m.position.set(x, h / 2 - 0.1, z);
    scene.add(m);
  }
  return { sun };
}
