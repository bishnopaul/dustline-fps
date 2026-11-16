// viewmodel.js — the gun in the player's hands: one small model per weapon, built from
// boxes and cylinders, with walk bob, recoil kick, a reload dip and a draw raise. It is
// pure presentation: the hitscan in weapons.js reads only the muzzle's world position.

import * as THREE from 'three';
import { WEAPONS } from './state.js';
import { speedOf } from './player.js';

const GUNMETAL = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.42, metalness: 0.65 });
const POLYMER = new THREE.MeshStandardMaterial({ color: 0x35322c, roughness: 0.8, metalness: 0.1 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.85 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0xe07b39, roughness: 0.55, metalness: 0.2 });

function box(parent, mat, sx, sy, sz, x, y, z, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  parent.add(m);
  return m;
}
function tube(parent, mat, r, len, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// One model per weapon, muzzle marked at the barrel tip. Proportions differ so the gun in
// hand reads as itself: long Longbow, fat Mule, stubby Hornet, small Sparrow.
const BUILDERS = {
  sparrow(g) {
    box(g, GUNMETAL, 0.055, 0.075, 0.23, 0, 0.02, -0.08);
    box(g, POLYMER, 0.05, 0.13, 0.07, 0, -0.07, 0.03, 0.25);
    box(g, ACCENT, 0.057, 0.018, 0.05, 0, 0.065, -0.16);
    return -0.21;
  },
  hornet(g) {
    box(g, POLYMER, 0.07, 0.11, 0.4, 0, 0.01, -0.1);
    box(g, GUNMETAL, 0.045, 0.045, 0.2, 0, 0.03, -0.38);
    box(g, GUNMETAL, 0.05, 0.16, 0.07, 0, -0.1, -0.08, 0.3);
    box(g, POLYMER, 0.06, 0.09, 0.16, 0, 0, 0.16);
    return -0.5;
  },
  mule(g) {
    tube(g, GUNMETAL, 0.032, 0.62, 0, 0.03, -0.2);
    tube(g, GUNMETAL, 0.02, 0.5, 0, -0.045, -0.16);
    box(g, WOOD, 0.055, 0.07, 0.18, 0, -0.03, -0.28);
    box(g, WOOD, 0.06, 0.11, 0.2, 0, -0.02, 0.14, 0.15);
    return -0.53;
  },
  longbow(g) {
    box(g, GUNMETAL, 0.065, 0.1, 0.55, 0, 0.01, -0.16);
    tube(g, GUNMETAL, 0.016, 0.3, 0, 0.035, -0.55);
    box(g, GUNMETAL, 0.05, 0.15, 0.07, 0, -0.09, -0.12, 0.18);
    tube(g, POLYMER, 0.028, 0.14, 0, 0.1, -0.18);
    box(g, POLYMER, 0.055, 0.08, 0.18, 0, -0.01, 0.2);
    box(g, ACCENT, 0.067, 0.02, 0.1, 0, -0.045, -0.3);
    return -0.72;
  },
};

export function createViewmodel(camera) {
  const group = new THREE.Group();
  group.position.set(0.25, -0.235, -0.45);
  camera.add(group);

  const guns = {};
  const muzzles = {};
  for (const id of Object.keys(WEAPONS)) {
    const g = new THREE.Group();
    const tipZ = BUILDERS[id](g);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, tipZ);
    g.add(muzzle);
    g.visible = false;
    group.add(g);
    guns[id] = g;
    muzzles[id] = muzzle;
  }

  const vm = {
    group,
    muzzle: muzzles.sparrow,
    current: 'sparrow',
    drawAt: -9,
    bobPhase: 0,
    setWeapon(id) {
      if (!guns[id]) return;
      guns[vm.current].visible = false;
      guns[id].visible = true;
      vm.current = id;
      vm.muzzle = muzzles[id];
      vm.drawAt = performance.now() / 1000;
    },
    // Per-frame pose: bob while moving, kick from recoil, dip through a reload, rise on draw.
    update(G, dt) {
      const a = G.player;
      const speed = speedOf(a);
      vm.bobPhase += dt * speed * 1.9;
      const bob = a.grounded && a.alive ? Math.min(1, speed / 4.6) : 0;
      const by = Math.sin(vm.bobPhase * 2) * 0.011 * bob;
      const bx = Math.cos(vm.bobPhase) * 0.008 * bob;
      const kick = (a.recoilP || 0) * 2.4;
      let dip = 0, lower = 0;
      if (a.reloadUntil > G.time) {
        const w = WEAPONS[a.cur];
        const p = 1 - (a.reloadUntil - G.time) / w.reload;
        dip = Math.sin(p * Math.PI) * 0.65;
        lower = Math.sin(p * Math.PI) * 0.09;
      }
      const sinceDraw = performance.now() / 1000 - vm.drawAt;
      const raise = sinceDraw < 0.25 ? (0.25 - sinceDraw) * 1.4 : 0;
      group.position.set(0.25 + bx, -0.235 + by - lower - raise * 0.4, -0.45 + kick);
      group.rotation.x = -dip - kick * 0.7 - raise * 0.5;
      group.visible = a.alive && G.phase !== 'menu';
    },
  };
  guns.sparrow.visible = true;
  return vm;
}
