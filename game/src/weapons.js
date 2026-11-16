// weapons.js — gunplay shared by the player and the bots: hitscan fire with spread, bloom
// and recoil, headshot boxes, reloads, frag grenades, and the pooled tracer/impact effects.
// One damage model for everyone, so a bot's Longbow hurts exactly like the player's.
// Friendly fire is off: shots pass through teammates.

import * as THREE from 'three';
import { WEAPONS, FRAG_DAMAGE, FRAG_RADIUS, actorById, makeNoise } from './state.js';
import { rayVsWorld, segmentBlocked, COLLIDERS } from './map.js';
import { eyeHeight, speedOf } from './player.js';
import { sfx } from './audio.js';

const UP = { x: 0, y: 1, z: 0 };

// ------------------------------------------------------------ hit boxes

// Ray vs one box (slab test on plain numbers); returns distance along the normalised
// direction, or null. Boxes are {x0,x1,y0,y1,z0,z1}.
function rayVsBox(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let t0 = 0, t1 = maxDist;
  const axes = [
    [ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

function bodyBox(a) {
  const h = 1.78 - a.crouch * 0.48;
  return { x0: a.x - 0.34, x1: a.x + 0.34, y0: a.y, y1: a.y + h - 0.3, z0: a.z - 0.34, z1: a.z + 0.34 };
}
function headBox(a) {
  const h = 1.78 - a.crouch * 0.48;
  return { x0: a.x - 0.21, x1: a.x + 0.21, y0: a.y + h - 0.32, y1: a.y + h + 0.04, z0: a.z - 0.21, z1: a.z + 0.21 };
}

function gauss() {
  return (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
}

// The full spread multiplier for an actor about to fire: bloom from previous shots,
// movement (the heart of "stop to aim"), crouch and being airborne.
export function spreadMult(G, a, w) {
  const move = 1 + (speedOf(a) / 4.6) * (w.movePenalty - 1);
  const crouch = 1 - a.crouch * 0.35;
  const air = a.grounded ? 1 : 2.1;
  return (1 + a.bloom) * move * crouch * air;
}

function fireDir(a, base, spreadDeg) {
  // two perpendicular axes around the base direction, reused scratch values
  let rx = base.z, rz = -base.x; // cross(dir, up) without allocation, y-up special case
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const s = spreadDeg * Math.PI / 180;
  const a1 = gauss() * s, a2 = gauss() * s;
  // right vector is (rx, 0, rz); the second axis is cross(right, dir)
  const ux = -rz * base.y, uy = rz * base.x - rx * base.z, uz = rx * base.y;
  let dx = base.x + rx * a1 + ux * a2;
  let dy = base.y + uy * a2;
  let dz = base.z + rz * a1 + uz * a2;
  const l = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / l, y: dy / l, z: dz / l };
}

// ------------------------------------------------------------ effects (pooled)

let fx = null;

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function initFx(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
  const flashTex = glowTexture('rgba(255,230,170,1)', 'rgba(255,140,40,0)');
  const dustTex = glowTexture('rgba(216,196,160,0.9)', 'rgba(216,196,160,0)');
  fx = { tracers: [], impacts: [], flashes: [], light: null };
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
    m.visible = false; scene.add(m);
    fx.tracers.push({ mesh: m, until: 0 });
  }
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false }));
    m.visible = false; scene.add(m);
    fx.impacts.push({ mesh: m, until: 0, born: 0 });
  }
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false }));
    m.visible = false; scene.add(m);
    fx.flashes.push({ mesh: m, until: 0 });
  }
  fx.light = new THREE.PointLight(0xffa04e, 0, 26, 1.8);
  scene.add(fx.light);
  return fx;
}

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
function spawnTracer(t, ax, ay, az, bx, by, bz) {
  if (!fx) return;
  const slot = fx.tracers.find(s => !s.mesh.visible) ?? fx.tracers[0];
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  if (len < 0.5) return;
  slot.mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  _v.set(bx - ax, by - ay, bz - az);
  _t.copy(slot.mesh.position).add(_v);
  slot.mesh.lookAt(_t);
  slot.mesh.scale.set(1, 1, len);
  slot.mesh.visible = true;
  slot.until = t + 0.05;
}
function spawnImpact(t, x, y, z, scale = 0.3) {
  if (!fx) return;
  const slot = fx.impacts.find(s => !s.mesh.visible) ?? fx.impacts[0];
  slot.mesh.position.set(x, y, z);
  slot.mesh.scale.set(scale, scale, 1);
  slot.mesh.material.opacity = 0.8;
  slot.mesh.visible = true;
  slot.born = t; slot.until = t + 0.28;
}
function spawnFlash(t, x, y, z, scale = 0.5) {
  if (!fx) return;
  const slot = fx.flashes.find(s => !s.mesh.visible) ?? fx.flashes[0];
  slot.mesh.position.set(x, y, z);
  slot.mesh.scale.set(scale, scale, 1);
  slot.mesh.material.rotation = Math.random() * Math.PI;
  slot.mesh.visible = true;
  slot.until = t + 0.035;
}

export function updateFx(G) {
  if (!fx) return;
  for (const s of fx.tracers) if (s.mesh.visible && G.time > s.until) s.mesh.visible = false;
  for (const s of fx.flashes) if (s.mesh.visible && G.time > s.until) s.mesh.visible = false;
  for (const s of fx.impacts) {
    if (!s.mesh.visible) continue;
    if (G.time > s.until) { s.mesh.visible = false; continue; }
    const k = (G.time - s.born) / 0.28;
    s.mesh.material.opacity = 0.8 * (1 - k);
    s.mesh.position.y += 0.004;
  }
  if (fx.light.intensity > 0) fx.light.intensity = Math.max(0, fx.light.intensity - 900 * 0.016);
}

// ------------------------------------------------------------ damage and death

// Apply damage to a victim; returns true when the shot kills. Kill rewards, the feed and
// the bomb drop happen here so every damage path (bullets, blasts) agrees.
export function applyDamage(G, victim, amount, attacker, head = false) {
  if (!victim.alive || G.phase !== 'live') return false;
  let dmg = amount;
  if (victim.vest) dmg *= head ? 0.75 : 0.55;
  victim.hp -= dmg;
  if (victim.isPlayer) G.events.push({ type: 'hurt' });
  if (attacker && attacker.isPlayer && victim.hp > 0) G.events.push({ type: 'hit', head });
  if (victim.hp > 0) return false;

  victim.hp = 0;
  victim.alive = false;
  victim.deathAt = G.time;
  victim.deaths++;
  if (victim.hasBomb) {
    victim.hasBomb = false;
    G.bomb.state = 'dropped';
    G.bomb.carrierId = 0;
    G.bomb.x = victim.x; G.bomb.z = victim.z;
    G.events.push({ type: 'bombdrop' });
  }
  if (attacker && attacker !== victim) {
    attacker.kills++;
    attacker.money += 250;
    if (attacker.isPlayer) G.events.push({ type: 'killconfirm', head });
  }
  G.feed.push({
    at: G.time,
    html: `<span class="${attacker && attacker.team === 'atk' ? 'a' : 'd'}">${attacker ? attacker.name : '—'}</span>` +
          ` ▸ <span class="${victim.team === 'atk' ? 'a' : 'd'}">${victim.name}</span>` +
          (head ? ' <span class="hs">HEADSHOT</span>' : ''),
  });
  return true;
}

// ------------------------------------------------------------ firing

// Fire the actor's current weapon once (all pellets), if the moment allows. `aim` is the
// base direction {x,y,z}; bots pass their aim point's direction, the player the camera's.
export function fireWeapon(G, a, aim) {
  const w = WEAPONS[a.cur];
  const ammo = a.ammo[a.cur];
  if (!ammo || G.time < a.nextShotAt || G.time < a.reloadUntil) return false;
  if (ammo.mag <= 0) {
    if (a.isPlayer) { sfx.dry(); startReload(G, a); }
    a.nextShotAt = G.time + 0.3;
    return false;
  }
  ammo.mag--;
  a.nextShotAt = G.time + 60 / w.rpm;
  a.lastShotAt = G.time;
  a.bloom = Math.min(2.4, a.bloom + 0.22 + w.kick * 0.16);

  const eyeY = a.y + (a.isPlayer ? eyeHeight(a) : 1.52 - a.crouch * 0.42);
  const spread = w.spread * spreadMult(G, a, w) * (a.isPlayer ? 1 : (a.ai.spreadFactor ?? 2));

  for (let p = 0; p < w.pellets; p++) {
    const dir = fireDir(a, aim, spread);
    const wallDist = rayVsWorld(a.x, eyeY, a.z, dir.x, dir.y, dir.z, 220);
    let bestT = wallDist ?? Infinity;
    let victim = null, head = false;
    for (const other of G.actors) {
      if (!other.alive || other.team === a.team || other === a) continue;
      const hb = headBox(other);
      const th = rayVsBox(a.x, eyeY, a.z, dir.x, dir.y, dir.z, hb, bestT);
      if (th !== null && th < bestT) { bestT = th; victim = other; head = true; continue; }
      const bb = bodyBox(other);
      const tb = rayVsBox(a.x, eyeY, a.z, dir.x, dir.y, dir.z, bb, bestT);
      if (tb !== null && tb < bestT) { bestT = tb; victim = other; head = false; }
    }
    const hx = a.x + dir.x * bestT, hy = eyeY + dir.y * bestT, hz = a.z + dir.z * bestT;
    // tracer from the gun, not the eye: viewmodel tip for the player, figure gun for a bot
    const muzzle = muzzleOf(a);
    spawnTracer(G.time, muzzle.x, muzzle.y, muzzle.z, hx, hy, hz);
    if (victim) {
      const fall = Math.max(0.3, 1 - Math.max(0, bestT - 15) / w.range);
      applyDamage(G, victim, (head ? w.damage * w.headMult : w.damage) * fall, a, head);
    } else if (bestT !== Infinity) {
      spawnImpact(G.time, hx, hy, hz, 0.22 + Math.random() * 0.15);
    }
  }

  // muzzle flash and sound, once per trigger pull rather than per pellet
  const muzzle = muzzleOf(a);
  spawnFlash(G.time, muzzle.x, muzzle.y, muzzle.z, a.cur === 'mule' ? 0.8 : 0.45);
  const distToPlayer = a.isPlayer ? 0 : Math.hypot(a.x - G.player.x, a.z - G.player.z);
  sfx.shot(a.cur, distToPlayer);
  makeNoise(G, a.x, a.z, 20);

  if (a.isPlayer) {
    a.recoilP = (a.recoilP || 0) + w.kick * 0.012;
    a.recoilY = (a.recoilY || 0) + (Math.random() - 0.5) * w.kick * 0.005;
  }
  return true;   // the weapon discharged (hit or miss); hit feedback rides on G.events
}

// Where the gun's muzzle sits in the world, for tracers and flashes.
const _m = new THREE.Vector3();
export function muzzleOf(a) {
  if (a.isPlayer && a.viewmodel) {
    a.viewmodel.muzzle.getWorldPosition(_m);
    return { x: _m.x, y: _m.y, z: _m.z };
  }
  if (a.view && a.view.userData.muzzle) {
    a.view.userData.muzzle.getWorldPosition(_m);
    return { x: _m.x, y: _m.y, z: _m.z };
  }
  return { x: a.x, y: a.y + 1.35, z: a.z };
}

export function startReload(G, a) {
  const w = WEAPONS[a.cur];
  const ammo = a.ammo[a.cur];
  if (!ammo || ammo.mag >= w.mag || ammo.reserve <= 0 || G.time < a.reloadUntil) return;
  a.reloadUntil = G.time + w.reload;
  if (a.isPlayer) sfx.reload();
}

// Per-step upkeep for one actor: finish reloads, cool bloom and recoil down.
export function updateWeaponState(G, a, dt) {
  if (a.reloadUntil && G.time >= a.reloadUntil) {
    const w = WEAPONS[a.cur];
    const ammo = a.ammo[a.cur];
    const take = Math.min(w.mag - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    a.reloadUntil = 0;
  }
  a.bloom = Math.max(0, a.bloom - dt * (a.bloom * 3.2 + 0.25));
  if (a.isPlayer) {
    a.recoilP = (a.recoilP || 0) * Math.exp(-dt * 8);
    a.recoilY = (a.recoilY || 0) * Math.exp(-dt * 8);
  }
}

// The human's trigger, mouse and weapon keys. Semi-automatic guns need a fresh click.
export function updatePlayerArsenal(G, input, dt) {
  const a = G.player;
  if (!a.alive || G.phase !== 'live') { a.wasFiring = false; return; }
  if (input.takePress('Digit1') && a.primary) swapTo(G, a, a.primary);
  if (input.takePress('Digit2')) swapTo(G, a, 'sparrow');
  if (input.takePress('KeyR')) startReload(G, a);
  if (input.takePress('KeyG') || input.takePress('Digit4')) throwFrag(G, a);

  const w = WEAPONS[a.cur];
  const wantFire = input.firing && G.time >= a.reloadUntil;
  if (wantFire && (w.auto || !a.wasFiring)) {
    const cp = Math.cos(a.pitch), sp = Math.sin(a.pitch);
    const aim = { x: -Math.sin(a.yaw) * cp, y: sp, z: -Math.cos(a.yaw) * cp };
    fireWeapon(G, a, aim);
  }
  a.wasFiring = input.firing;
  updateWeaponState(G, a, dt);
}

export function swapTo(G, a, weaponId) {
  if (a.cur === weaponId || !a.ammo[weaponId]) return;
  a.cur = weaponId;
  a.reloadUntil = 0;             // changing guns abandons a reload
  a.nextShotAt = Math.max(a.nextShotAt, G.time + 0.28);
  if (a.isPlayer) {
    sfx.swap();
    if (a.viewmodel) a.viewmodel.setWeapon(weaponId);
  }
}

// ------------------------------------------------------------ frag grenades

const grenades = [];
let grenadePoolReady = false;

export function initGrenades(scene) {
  if (grenadePoolReady) return;
  grenadePoolReady = true;
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 0.5, metalness: 0.4 });
  const band = new THREE.MeshStandardMaterial({ color: 0xe07b39, roughness: 0.5 });
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(geo, mat);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 6, 14), band);
    stripe.rotation.x = Math.PI / 2;
    g.add(body, stripe);
    g.visible = false;
    scene.add(g);
    grenades.push({ mesh: g, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, ownerId: 0 });
  }
}

export function throwFrag(G, a) {
  if (a.frags <= 0 || G.phase !== 'live' || !a.alive) return;
  const slot = grenades.find(g => !g.live);
  if (!slot) return;
  a.frags--;
  const eyeY = a.y + (a.isPlayer ? eyeHeight(a) : 1.5);
  const cp = Math.cos(a.pitch), sp = Math.sin(a.pitch);
  const dir = a.isPlayer
    ? { x: -Math.sin(a.yaw) * cp, y: sp + 0.18, z: -Math.cos(a.yaw) * cp }
    : a.ai.aimDir ?? { x: -Math.sin(a.yaw), y: 0.35, z: -Math.cos(a.yaw) };
  slot.x = a.x + dir.x * 0.4; slot.y = eyeY; slot.z = a.z + dir.z * 0.4;
  slot.vx = dir.x * 11 + a.vx * 0.5; slot.vy = dir.y * 11 + 2; slot.vz = dir.z * 11 + a.vz * 0.5;
  slot.fuse = 1.7;
  slot.ownerId = a.id;
  slot.live = true;
  slot.mesh.visible = true;
  if (a.isPlayer) sfx.throwIt();
}

export function updateGrenades(G, dt) {
  for (const g of grenades) {
    if (!g.live) continue;
    g.fuse -= dt;
    g.vy -= 12.5 * dt;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    if (ny < 0.09) { ny = 0.09; g.vy *= -0.38; g.vx *= 0.72; g.vz *= 0.72; }
    // bounce off boxes: if the new point is inside a collider, step back and reflect
    for (const c of COLLIDERS) {
      if (nx > c.x0 && nx < c.x1 && nz > c.z0 && nz < c.z1 && ny < c.top) {
        const fromX = Math.min(Math.abs(g.x - c.x0), Math.abs(g.x - c.x1));
        const fromZ = Math.min(Math.abs(g.z - c.z0), Math.abs(g.z - c.z1));
        if (fromX < fromZ) { nx = g.x; g.vx *= -0.42; } else { nz = g.z; g.vz *= -0.42; }
        break;
      }
    }
    g.x = nx; g.y = ny; g.z = nz;
    g.mesh.position.set(g.x, g.y, g.z);
    g.mesh.rotation.x += dt * 6; g.mesh.rotation.z += dt * 4;
    if (g.fuse <= 0) explode(G, g);
  }
}

function explode(G, g) {
  g.live = false;
  g.mesh.visible = false;
  const owner = actorById(G, g.ownerId);
  blast(G, g.x, g.y, g.z, owner, FRAG_DAMAGE, FRAG_RADIUS, 3.2);
}

// Shared blast: light, flash, noise, shake, and cover-checked radial damage. `owner` is
// credited (never for teammates); the bomb passes a bigger radius and damage.
function blast(G, x, y, z, owner, maxDamage, radius, flashScale) {
  const distToPlayer = Math.hypot(x - G.player.x, z - G.player.z);
  sfx.explosion(distToPlayer);
  makeNoise(G, x, z, 42);
  spawnFlash(G.time, x, y + 0.3, z, flashScale);
  spawnImpact(G.time, x, 0.4, z, 1.6);
  if (fx) {
    fx.light.position.set(x, y + 1.2, z);
    fx.light.intensity = 900;
  }
  if (distToPlayer < 8) G.events.push({ type: 'shake', amount: (8 - distToPlayer) / 8 });
  for (const a of G.actors) {
    if (!a.alive) continue;
    if (owner && a.team === owner.team && a !== owner) continue;   // no friendly splash
    const d = Math.hypot(a.x - x, a.z - z);
    if (d > radius + 0.4) continue;
    const chestY = a.y + 1.1 - a.crouch * 0.4;
    if (segmentBlocked(x, y + 0.25, z, a.x, chestY, a.z)) continue;
    const dmg = maxDamage * Math.pow(Math.max(0, 1 - d / radius), 1.25);
    if (dmg > 1) applyDamage(G, a, dmg, owner && owner !== a ? owner : null, false);
  }
}

// The planted charge going off: a building-shaking blast on a 12 m radius.
export function bombBlast(G, x, z) {
  blast(G, x, 0.6, z, null, 150, 12, 7);
}

// Round reset: no live grenades carry over.
export function clearGrenades() {
  for (const g of grenades) {
    g.live = false;
    if (g.mesh) g.mesh.visible = false;
  }
}
