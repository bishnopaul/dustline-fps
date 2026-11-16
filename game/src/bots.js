// bots.js — the nine bot fighters: their low-poly figures and their brains. A bot perceives
// on a staggered think tick (vision cone + line of sight + heard gunfire), plans on the
// waypoint graph, and fights through the same weapons.js fire model as the player, with a
// per-bot skill factor widening its spread. Brains decide at think rate; bodies move and
// shoot every simulation step.

import * as THREE from 'three';
import { NODES, DEF_HOLDS, PLANT_HOLDS, SITES, inSite, nearestNode, findPath, collide, segmentBlocked } from './map.js';
import { PALETTE } from './map.js';
import { fireWeapon, startReload, updateWeaponState, throwFrag, swapTo } from './weapons.js';
import { actorById, ROUND_TIME } from './state.js';

const TURN_RATE = 7.5;

// ------------------------------------------------------------ figures

const MATS = {};
let unitBox = null;

function buildFigure(a) {
  const g = new THREE.Group();
  const teamMat = a.team === 'atk' ? MATS.atk : MATS.def;
  const darkMat = a.team === 'atk' ? MATS.atkDark : MATS.defDark;
  const part = (mat, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(unitBox, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // legs pivot at the hip so they can swing
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.94, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.94, 0); g.add(legR);
  for (const leg of [legL, legR]) {
    const m = new THREE.Mesh(unitBox, MATS.trousers);
    m.scale.set(0.17, 0.92, 0.19); m.position.y = -0.46; m.castShadow = true;
    leg.add(m);
  }
  part(darkMat, 0.44, 0.16, 0.26, 0, 1.0, 0);                    // belt/hips
  part(teamMat, 0.46, 0.56, 0.27, 0, 1.34, 0);                  // torso
  part(MATS.vest, 0.5, 0.4, 0.31, 0, 1.32, 0);                  // vest block
  part(MATS.skin, 0.15, 0.42, 0.15, -0.33, 1.32, 0);            // left arm
  const armR = part(teamMat, 0.15, 0.15, 0.52, 0.3, 1.44, -0.2); // right arm, forward
  part(MATS.skin, 0.25, 0.27, 0.25, 0, 1.68, 0);                // head
  part(darkMat, 0.3, 0.11, 0.3, 0, 1.85, 0);                    // helmet
  part(MATS.vest, 0.26, 0.09, 0.02, 0, 1.68, -0.14);           // visor shade
  // the gun, held forward; its tip is where tracers begin
  const gun = new THREE.Group();
  gun.position.set(0.24, 1.42, -0.3);
  const body = new THREE.Mesh(unitBox, MATS.gun);
  body.scale.set(0.08, 0.14, 0.72); gun.add(body);
  const barrel = new THREE.Mesh(unitBox, MATS.gun);
  barrel.scale.set(0.045, 0.045, 0.3); barrel.position.set(0, 0.04, -0.48); gun.add(barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.66);
  gun.add(muzzle);
  g.add(gun);
  // the charge rides on the carrier's back, blinking amber
  const pack = new THREE.Mesh(unitBox, MATS.pack);
  pack.scale.set(0.3, 0.36, 0.14);
  pack.position.set(0, 1.36, 0.2);
  pack.visible = false;
  g.add(pack);
  g.userData = { legL, legR, armR, gun, pack, muzzle, walkPhase: Math.random() * 6 };
  return g;
}

export function initFigures(scene, G) {
  unitBox = new THREE.BoxGeometry(1, 1, 1);
  const std = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  MATS.atk = std(PALETTE.atk); MATS.def = std(PALETTE.def);
  MATS.atkDark = std(0x8a4a1e); MATS.defDark = std(0x274a75);
  MATS.trousers = std(0x3c3833); MATS.vest = std(0x2c2c30, 0.7);
  MATS.skin = std(0xc9a189, 0.65); MATS.gun = std(0x1f2124, 0.45);
  MATS.pack = new THREE.MeshStandardMaterial({ color: 0x2c2c30, emissive: 0xf2a541, emissiveIntensity: 0.7 });
  for (const a of G.actors) {
    if (a.isPlayer) continue;
    a.view = buildFigure(a);
    scene.add(a.view);
  }
}

// ------------------------------------------------------------ brain

// Round-start assignments: attackers share a plan (a main site hit by the carrier and the
// escorts, one feint at the other site); defenders take their posts. Called by rounds.js
// after positions are reset.
export function planRound(G) {
  const site = Math.random() < 0.55 ? 'A' : 'B';
  const other = site === 'A' ? 'B' : 'A';
  const atk = G.actors.filter(a => a.team === 'atk' && !a.isPlayer);
  const roles = ['site', 'site', 'site', 'feint'];
  atk.forEach((a, i) => {
    const role = a.hasBomb ? 'site' : roles[i % roles.length];
    a.ai.role = role;
    a.ai.mainSite = site;
    a.ai.planSite = role === 'feint' ? other : site;
    a.ai.state = 'advance';
    a.ai.path = []; a.ai.pathI = 0;
    a.ai.targetId = 0; a.ai.seenAt = -9;
  });
  const player = G.player;
  player.ai.planSite = site;
  const def = G.actors.filter(a => a.team === 'def');
  def.forEach((a, i) => {
    const hold = DEF_HOLDS[i % DEF_HOLDS.length];
    a.ai.holdNode = hold.node;
    a.ai.holdX = NODES[hold.node][0]; a.ai.holdZ = NODES[hold.node][1];
    a.ai.watchX = hold.wx; a.ai.watchZ = hold.wz;
    a.ai.state = 'advance';
    a.ai.path = []; a.ai.pathI = 0;
    a.ai.targetId = 0; a.ai.seenAt = -9;
  });
}

function setGoal(a, nodeIdx, finalX = null, finalZ = null) {
  const from = nearestNode(a.x, a.z);
  a.ai.path = findPath(from, nodeIdx);
  a.ai.pathI = a.ai.path.length > 1 ? 1 : 0;
  a.ai.goalNode = nodeIdx;
  a.ai.finalX = finalX; a.ai.finalZ = finalZ;
}

function faceToward(a, x, z, dt, rate = TURN_RATE) {
  const want = Math.atan2(-(x - a.x), -(z - a.z));
  let diff = want - a.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.max(-rate * dt, Math.min(rate * dt, diff));
  a.yaw += turn;
  return Math.abs(diff) < 0.05;
}

// What this bot can currently see and hear, refreshed on its think tick.
function perceive(G, a) {
  const ai = a.ai;
  const eyeY = a.y + 1.52;
  let bestT = null, bestScore = Infinity, bestDist = Infinity;
  for (const e of G.actors) {
    if (!e.alive || e.team === a.team) continue;
    const dx = e.x - a.x, dz = e.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 65) continue;
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const dot = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
    if (dot < 0.22 && dist > 2.6) continue;                    // outside the vision cone
    const chestY = e.y + 1.12 - e.crouch * 0.4;
    if (segmentBlocked(a.x, eyeY, a.z, e.x, chestY, e.z)) continue;
    // defenders shoot the nearest threat to their post; attackers finish the wounded —
    // a pushing team that splits its fire across three defenders kills none of them
    const score = a.team === 'atk' ? dist * (0.55 + e.hp / 200) : dist;
    if (score < bestScore) { bestScore = score; bestDist = dist; bestT = e; }
  }
  if (bestT) {
    if (ai.targetId !== bestT.id) {
      ai.targetId = bestT.id;
      // a holder is scanning a lane, not staring down the exact pixel: a beat slower to
      // fire than a bot already pushing with its gun up
      ai.reactionAt = G.time + Math.max(0.16, 0.46 - ai.skill * 0.18) + (ai.state === 'hold' ? 0.12 : 0);
    }
    ai.seenAt = G.time;
    ai.lastKnownX = bestT.x; ai.lastKnownZ = bestT.z;
  }
  // hearing: the freshest noise inside its radius moves the bot's attention
  for (const n of G.noises) {
    if (n.at <= ai.heardAt) continue;
    if (Math.hypot(n.x - a.x, n.z - a.z) < n.radius) {
      ai.heardAt = n.at; ai.heardX = n.x; ai.heardZ = n.z;
    }
  }
  // spread grows against fast or distant targets
  const t = actorById(G, ai.targetId);
  const tSpeed = t ? Math.hypot(t.vx, t.vz) : 0;
  ai.spreadFactor = ai.baseSpread * (tSpeed > 3 ? 1.45 : 1) * (1 + Math.max(0, bestDist - 18) / 55);
}

function think(G, a) {
  const ai = a.ai;
  perceive(G, a);
  const t = actorById(G, ai.targetId);
  const seeTarget = t && t.alive && G.time - ai.seenAt < 0.25;
  const bombPlanted = G.bomb.state === 'planted';

  if (seeTarget) {
    // the carrier does not stop to duel a distant contact: the charge reaching the site
    // matters more than one trade, and the escorts are there to fight the lane clear
    if (a.hasBomb && Math.hypot(t.x - a.x, t.z - a.z) > 14) { /* push on */ }
    else { ai.state = 'engage'; return; }
  }
  if (ai.state === 'engage') {
    ai.state = 'seek';                                        // push the last known position
    setGoal(a, nearestNode(ai.lastKnownX, ai.lastKnownZ), ai.lastKnownX, ai.lastKnownZ);
    return;
  }

  if (a.team === 'atk') {
    if (bombPlanted) {
      const holds = PLANT_HOLDS[G.bomb.site];
      const hold = holds[a.id % holds.length];
      if (ai.state !== 'hold' || ai.goalNode !== hold.node) { ai.state = 'hold'; setGoal(a, hold.node); ai.watchX = SITES[G.bomb.site].cx; ai.watchZ = SITES[G.bomb.site].cz; }
      return;
    }
    if (G.bomb.state === 'dropped' && !a.hasBomb) {
      const carrier = G.actors.find(x => x.team === 'atk' && x.hasBomb);
      if (!carrier) { ai.state = 'advance'; setGoal(a, nearestNode(G.bomb.x, G.bomb.z), G.bomb.x, G.bomb.z); ai.fetchBomb = true; return; }
    }
    if (a.hasBomb) {
      if (inSite(a.x, a.z, ai.planSite)) { ai.state = 'plant'; return; }
      ai.state = 'advance';
      const siteNode = nearestNode(SITES[ai.planSite].cx, SITES[ai.planSite].cz);
      if (ai.goalNode !== siteNode) setGoal(a, siteNode, SITES[ai.planSite].cx, SITES[ai.planSite].cz);
      return;
    }
    // escort / feint: push your site; on arrival, hold it and watch its heart. The feint
    // is a lie with an expiry: 25 s in, or once the real fight starts, it rotates to the
    // main site instead of guarding an empty one.
    ai.state = 'advance';
    if (ai.role === 'feint' && ai.planSite !== ai.mainSite &&
        (ROUND_TIME - G.roundLeft > 25 || G.actors.some(x => x.team === 'atk' && x.id !== a.id && G.time - x.lastShotAt < 4))) {
      ai.planSite = ai.mainSite;
      ai.goalNode = null;
    }
    const siteNode = nearestNode(SITES[ai.planSite].cx, SITES[ai.planSite].cz);
    if (ai.goalNode !== siteNode) setGoal(a, siteNode, SITES[ai.planSite].cx, SITES[ai.planSite].cz);
    if (inSite(a.x, a.z, ai.planSite)) { ai.state = 'hold'; ai.watchX = SITES[ai.planSite].cx; ai.watchZ = SITES[ai.planSite].cz; }
    return;
  }

  // defenders
  if (bombPlanted) {
    const d = Math.hypot(G.bomb.x - a.x, G.bomb.z - a.z);
    if (d < 1.7) { ai.state = 'defuse'; return; }
    ai.state = 'advance';
    if (ai.goalNode !== nearestNode(G.bomb.x, G.bomb.z) || ai.finalX !== G.bomb.x) {
      setGoal(a, nearestNode(G.bomb.x, G.bomb.z), G.bomb.x, G.bomb.z);
    }
    return;
  }
  if (ai.state === 'seek') return;                            // already pushing a contact
  if (G.time - ai.heardAt < 5 && ai.heardAt > 0) {
    ai.state = 'seek';
    setGoal(a, nearestNode(ai.heardX, ai.heardZ), ai.heardX, ai.heardZ);
    return;
  }
  if (ai.state !== 'hold' || ai.goalNode !== ai.holdNode) {
    ai.state = 'advance';
    setGoal(a, ai.holdNode);
  }
  if (nearNode(a, ai.holdNode)) {
    ai.state = 'hold';
    ai.watchX = ai.watchX ?? 0; ai.watchZ = ai.watchZ ?? 0;
  }
}

function nearNode(a, idx) {
  const n = NODES[idx];
  return Math.hypot(n[0] - a.x, n[1] - a.z) < 1.1;
}

// Move along the current path (or to the final point); returns true when arrived.
function followPath(G, a, dt, speed) {
  const ai = a.ai;
  let tx = null, tz = null;
  if (ai.pathI < ai.path.length) {
    const n = NODES[ai.path[ai.pathI]];
    tx = n[0]; tz = n[1];
    if (Math.hypot(tx - a.x, tz - a.z) < 0.75) { ai.pathI++; return followPath(G, a, dt, speed); }
  } else if (ai.finalX !== null && ai.finalX !== undefined) {
    tx = ai.finalX; tz = ai.finalZ;
    if (Math.hypot(tx - a.x, tz - a.z) < 0.6) return true;
  } else return true;
  faceToward(a, tx, tz, dt);
  moveToward(a, tx, tz, dt, speed);
  return false;
}

function moveToward(a, tx, tz, dt, speed) {
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz) || 1;
  const k = 1 - Math.exp(-9 * dt);
  a.vx += ((dx / d) * speed - a.vx) * k;
  a.vz += ((dz / d) * speed - a.vz) * k;
}

function stopBody(a, dt) {
  const k = 1 - Math.exp(-10 * dt);
  a.vx += (0 - a.vx) * k;
  a.vz += (0 - a.vz) * k;
}

// The fight itself: face the target, manage bursts, strafing and reloads.
function engage(G, a, dt) {
  const ai = a.ai;
  const t = actorById(G, ai.targetId);
  if (!t || !t.alive) { ai.state = 'seek'; return; }
  const dx = t.x - a.x, dz = t.z - a.z;
  const dist = Math.hypot(dx, dz);
  faceToward(a, t.x, t.z, dt);
  a.pitch = Math.max(-0.5, Math.min(0.5, Math.atan2((t.y + 1.15) - (a.y + 1.52), dist)));

  // strafe while the range is long, but keep closing: a duel at 15 m against a set,
  // crouched defender is a losing trade, so push into the range where feet plant
  if (dist > 9) {
    if (G.time > ai.strafeUntil) { ai.strafeDir = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = G.time + 0.6 + Math.random() * 0.8; }
    const px = (-dz / (dist || 1)) * ai.strafeDir, pz = (dx / (dist || 1)) * ai.strafeDir;
    const closing = dist > 11 ? 0.6 : 0;
    moveToward(a, a.x + px * 3 + dx * closing, a.z + pz * 3 + dz * closing, dt, 3.4);
    a.crouchTarget = 0;
  } else {
    stopBody(a, dt);
    a.crouchTarget = dist > 13 ? 1 : 0;
  }

  const ammo = a.ammo[a.cur];
  if (ammo && ammo.mag === 0) { startReload(G, a); return; }
  if (G.time < ai.reactionAt || G.time < ai.burstWaitUntil) return;
  // only pull the trigger on a live line of sight
  const chestY = t.y + 1.12 - t.crouch * 0.4;
  if (segmentBlocked(a.x, a.y + 1.52, a.z, t.x, chestY, t.z)) return;
  const aim = { x: dx / (dist || 1), y: (chestY - (a.y + 1.52)) / (dist || 1), z: dz / (dist || 1) };
  const l = Math.hypot(aim.x, aim.y, aim.z) || 1;
  aim.x /= l; aim.y /= l; aim.z /= l;
  if (fireWeapon(G, a, aim) || ammo.mag < (a.ammo[a.cur]?.mag ?? 0)) { /* fired */ }
  ai.burstLeft--;
  if (ai.burstLeft <= 0) {
    ai.burstWaitUntil = G.time + 0.32 + Math.random() * 0.5;
    ai.burstLeft = a.cur === 'mule' ? 1 : 2 + (Math.random() * 3 | 0);
  }
  // a frag for a target holding still at mid range, now and then
  if (a.frags > 0 && dist > 10 && dist < 24 && Math.random() < dt * 0.25) {
    a.ai.aimDir = { x: dx / dist, y: 0.42, z: dz / dist };
    throwFrag(G, a);
  }
}

export function updateBots(G, dt) {
  for (const a of G.actors) {
    if (a.isPlayer) continue;
    if (!a.alive) continue;
    const ai = a.ai;
    ai.crouchTarget = ai.crouchTarget ?? 0;
    if (G.phase === 'live') {
      if (G.time >= ai.nextThink) {
        ai.nextThink = G.time + 0.11 + (a.id % 5) * 0.013;
        think(G, a);
      }
      switch (ai.state) {
        case 'engage': engage(G, a, dt); break;
        case 'advance': followPath(G, a, dt, 4.35); ai.crouchTarget = 0; break;
        case 'seek': if (followPath(G, a, dt, 4.35)) { ai.state = a.team === 'def' ? 'advance' : 'hold'; ai.watchX = ai.lastKnownX; ai.watchZ = ai.lastKnownZ; } break;
        case 'hold': {
          stopBody(a, dt);
          // holders alternate: crouched and still to watch, standing to scan the lanes
          ai.crouchTarget = Math.sin(G.time * 0.23 + a.id * 2.1) > 0 ? 1 : 0;
          const scan = Math.sin(G.time * 0.45 + a.id * 1.7) * 0.5;
          const wx = (ai.watchX ?? a.x) - a.x, wz = (ai.watchZ ?? a.z) - a.z;
          const base = Math.atan2(-wx, -wz);
          const want = base + scan;
          let diff = want - a.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          a.yaw += Math.max(-2 * dt, Math.min(2 * dt, diff));
          break;
        }
        case 'plant': case 'defuse': stopBody(a, dt); ai.crouchTarget = 1; break;
        default: stopBody(a, dt);
      }
      // stuck against a crate? re-path from the nearest node
      if ((ai.state === 'advance' || ai.state === 'seek') && G.time - ai.stuckAt > 0.6) {
        const moved = Math.hypot(a.x - ai.lastX, a.z - ai.lastZ);
        if (moved < 0.25 && Math.hypot(a.vx, a.vz) > 0.5) {
          ai.path = findPath(nearestNode(a.x, a.z), ai.goalNode ?? nearestNode(a.x, a.z));
          ai.pathI = ai.path.length > 1 ? 1 : 0;
        }
        ai.lastX = a.x; ai.lastZ = a.z; ai.stuckAt = G.time;
      }
    } else {
      stopBody(a, dt);
    }
    // integrate + collide
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    const [cx, cz] = collide(a.x, a.z, a.radius, 0);
    a.x = cx; a.z = cz;
    a.crouch += ((ai.crouchTarget || 0) - a.crouch) * Math.min(1, dt * 8);
    updateWeaponState(G, a, dt);
  }
}

// ------------------------------------------------------------ figure sync

export function updateViews(G, dt) {
  for (const a of G.actors) {
    if (a.isPlayer || !a.view) continue;
    const v = a.view;
    const u = v.userData;
    v.position.set(a.x, a.y, a.z);
    if (!a.alive) {
      // fall where they dropped, then settle
      const k = Math.min(1, (G.time - a.deathAt) * 3.2);
      v.rotation.x = -Math.PI / 2 * k;
      v.position.y = a.y + 0.12 * k;
      continue;
    }
    v.rotation.x = 0;
    v.rotation.y = a.yaw;
    const speed = Math.hypot(a.vx, a.vz);
    u.walkPhase += dt * speed * 2.4;
    const swing = Math.min(1, speed / 3) * 0.55;
    u.legL.rotation.x = Math.sin(u.walkPhase) * swing;
    u.legR.rotation.x = -Math.sin(u.walkPhase) * swing;
    const crouchDip = a.crouch * 0.34;
    v.position.y = a.y - crouchDip;
    u.gun.rotation.x = a.pitch * 0.7;
    u.pack.visible = a.hasBomb;
    if (a.hasBomb) MATS.pack.emissiveIntensity = 0.4 + Math.abs(Math.sin(G.time * 4)) * 0.9;
  }
}
