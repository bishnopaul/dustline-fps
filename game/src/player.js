// player.js — the first-person controller for the human player: mouse look, acceleration
// movement with crouch and jump, and collision against the map's boxes. Bots share the
// resulting kinematics shape (an actor's x/y/z, velocity and yaw) but steer it themselves.

import { collide } from './map.js';
import { makeNoise } from './state.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.06;
const WALK = 4.6, CROUCH_SPEED = 2.3, QUIET_SPEED = 2.6;
const GRAVITY = 16, JUMP_VEL = 5.2;
const MOUSE_SENS = 0.0021;

export function eyeHeight(a) {
  return EYE_STAND + (EYE_CROUCH - EYE_STAND) * a.crouch;
}

export function speedOf(a) {
  return Math.hypot(a.vx, a.vz);
}

// Advance the player one fixed step. `input` is input.js's object; firing and weapon keys
// are weapons.js's concern, movement and looking live here. During the buy phase the player
// is frozen in place but may still look around (frozen = true).
export function updatePlayer(G, input, dt, frozen = false) {
  const a = G.player;
  if (!a.alive) return;

  const m = input.takeMouse();
  a.yaw -= m.dx * MOUSE_SENS;
  a.pitch -= m.dy * MOUSE_SENS;
  a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch));

  if (frozen) {
    a.vx *= Math.exp(-10 * dt);
    a.vz *= Math.exp(-10 * dt);
    a.crouch += (0 - a.crouch) * Math.min(1, dt * 11);
    return;
  }

  const wantCrouch = input.held.has('ControlLeft') || input.held.has('KeyC');
  a.crouch += ((wantCrouch ? 1 : 0) - a.crouch) * Math.min(1, dt * 11);

  // wish direction on the ground plane, from the keys and the facing
  let ix = 0, iz = 0;
  if (input.held.has('KeyW')) iz -= 1;
  if (input.held.has('KeyS')) iz += 1;
  if (input.held.has('KeyA')) ix -= 1;
  if (input.held.has('KeyD')) ix += 1;
  const len = Math.hypot(ix, iz) || 1;
  ix /= len; iz /= len;
  const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
  const wx = ix * cos - iz * sin;
  const wz = ix * sin + iz * cos;

  const quiet = input.held.has('ShiftLeft') || input.held.has('ShiftRight');
  const speed = a.crouch > 0.5 ? CROUCH_SPEED : quiet ? QUIET_SPEED : WALK;
  // approach the wished velocity: fast on the ground (snappy stops, which is what makes
  // stopping to aim pay), weak in the air
  const rate = a.grounded ? 11 : 1.6;
  const k = 1 - Math.exp(-rate * dt);
  a.vx += (wx * speed - a.vx) * k;
  a.vz += (wz * speed - a.vz) * k;

  if (a.grounded && input.held.has('Space')) {
    a.vy = JUMP_VEL;
    a.grounded = false;
  }
  a.vy -= GRAVITY * dt;

  a.x += a.vx * dt;
  a.z += a.vz * dt;
  a.y += a.vy * dt;
  if (a.y <= 0) { a.y = 0; a.vy = 0; a.grounded = true; }

  const [cx, cz] = collide(a.x, a.z, a.radius, a.y);
  a.x = cx; a.z = cz;

  // running feet are a noise bots can hear; walking quietly and crouching are not
  a.stepAt = a.stepAt ?? 0;
  if (a.grounded && speedOf(a) > 3.4 && G.time >= a.stepAt) {
    makeNoise(G, a.x, a.z, 7);
    a.stepAt = G.time + 0.36;
  }
}

// Place the camera at the player's eye, with weapon recoil (weapons.js keeps recoilP/Y on
// the actor) folded into the view angles.
export function applyCamera(G, camera) {
  const a = G.player;
  camera.position.set(a.x, a.y + eyeHeight(a), a.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = a.yaw + (a.recoilY || 0);
  camera.rotation.x = a.pitch + (a.recoilP || 0);
  camera.rotation.z = 0;
}
