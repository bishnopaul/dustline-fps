// main.js — boot and the frame loop. The simulation advances in fixed 1/60 steps
// (player, bots, weapons, grenades, rounds) and rendering follows; the HUD reads the
// state the steps leave behind. This file also owns the pointer-lock flow, the menu and
// match-end overlays, camera shake, and the ?shot= staging used to take the entry's
// screenshots (a posed, frozen frame of the real game and HUD).

import * as THREE from 'three';
import { createGame } from './state.js';
import { buildWorld, SPAWNS } from './map.js';
import { createInput } from './input.js';
import { updatePlayer, applyCamera } from './player.js';
import { initFx, initGrenades, updateFx, updateGrenades, updatePlayerArsenal } from './weapons.js';
import { initFigures, updateBots, updateViews } from './bots.js';
import { startMatch, updateRounds } from './rounds.js';
import { initHud, updateHud, pumpEvents } from './hud.js';
import { initAudio } from './audio.js';
import { createViewmodel } from './viewmodel.js';

const DT = 1 / 60;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');

const G = createGame();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 500);
scene.add(camera);
buildWorld(scene);
initFigures(scene, G);
initFx(scene);
initGrenades(scene);
const viewmodel = createViewmodel(camera);
G.player.viewmodel = viewmodel;

// the charge itself, when it is on the ground: a dark case with a beacon that blinks
// faster as the fuse burns (while carried it rides on the carrier's back instead)
const bombProp = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.26, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 0.13;
  body.castShadow = true;
  bombProp.add(body);
}
const bombBeaconMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff2211, emissiveIntensity: 0 });
const bombBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), bombBeaconMat);
bombBeacon.position.y = 0.29;
bombProp.add(bombBeacon);
bombProp.visible = false;
scene.add(bombProp);
const input = createInput(renderer.domElement);
initHud(G);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------ flow: menu, pause, restart

const startEl = document.getElementById('startscreen');
const endEl = document.getElementById('matchend');
let suppressPause = false;   // set when we unlock on purpose (the buy phase frees the mouse)

function deploy() {
  initAudio();
  if (!G.started || G.phase === 'over' || G.phase === 'menu') {
    startMatch(G);
    G.started = true;
  }
  startEl.classList.add('hidden');
  endEl.classList.add('hidden');
  if (G.phase === 'live') input.lock();
}
startEl.addEventListener('click', deploy);
endEl.addEventListener('click', deploy);
renderer.domElement.addEventListener('click', () => {
  if (G.started && G.phase === 'live' && !input.locked) input.lock();
});
input.onLockChange = locked => {
  if (!locked) {
    if (suppressPause) { suppressPause = false; return; }   // we freed the mouse ourselves
    if (G.started && G.phase === 'live') startEl.classList.remove('hidden');   // Esc: pause
  }
  if (locked) startEl.classList.add('hidden');
};

// place the cast at their spawns so the menu looks over a living yard
for (const team of ['atk', 'def']) {
  G.actors.filter(a => a.team === team).forEach((a, i) => {
    const s = SPAWNS[team][i % SPAWNS[team].length];
    a.x = s.x; a.z = s.z; a.yaw = s.yaw;
  });
}

// ------------------------------------------------------------ screenshot staging

if (shotMode) {
  G.started = true;
  startMatch(G);
  const p = G.player;
  const setActor = (name, x, z, yaw) => {
    const a = G.actors.find(v => v.name === name);
    a.x = x; a.z = z; a.yaw = yaw;
    return a;
  };
  if (shotMode === 'play') {
    G.phase = 'live'; G.round = 7; G.scores.atk = 4; G.scores.def = 3; G.roundLeft = 41;
    p.x = 3; p.z = 16; p.yaw = -0.35; p.hp = 100; p.money = 1850;
    p.primary = 'hornet'; p.ammo.hornet = { mag: 28, reserve: 120 }; p.cur = 'hornet';
    p.vest = true; p.frags = 2;
    viewmodel.setWeapon('hornet');
    setActor('Rook', -8, 4, 0.6); setActor('Sable', 8, 11, -0.5);
    setActor('Bram', 2, -6, 2.2); setActor('Odile', -7, -9, 3.1);
    startEl.classList.add('hidden');
  } else if (shotMode === 'site') {
    G.phase = 'live'; G.round = 4; G.scores.atk = 2; G.scores.def = 1;
    p.x = -15.5; p.z = -11; p.yaw = 0.15; p.money = 3100; p.hasBomb = false;
    p.primary = 'longbow'; p.ammo.longbow = { mag: 21, reserve: 100 }; p.cur = 'longbow';
    viewmodel.setWeapon('longbow');
    const rook = setActor('Rook', -19.5, -16, 1.2);
    rook.crouch = 1;
    setActor('Bram', -12.5, -19, -1.4);
    G.bomb.state = 'planted'; G.bomb.x = -19.5; G.bomb.z = -16; G.bomb.site = 'A'; G.bomb.timer = 18;
    startEl.classList.add('hidden');
  } else if (shotMode === 'buy') {
    G.phase = 'buy'; G.phaseLeft = 8; G.buyOpen = true; p.money = 5300;
    startEl.classList.add('hidden');
  } else {
    G.phase = 'menu';   // 'start': the title card over the yard
  }
}

// ------------------------------------------------------------ the loop

let last = performance.now();
let acc = 0;
let shake = 0;
let lastPhase = G.phase;
const menuCam = { t: 0 };

function step(dt) {
  G.time += dt;
  const frozen = G.phase !== 'live';
  updatePlayer(G, input, dt, frozen);
  if (G.phase === 'live') updatePlayerArsenal(G, input, dt);
  updateBots(G, dt);
  if (G.phase === 'live' || G.phase === 'end') updateGrenades(G, dt);
  updateRounds(G, input, dt);
  updateFx(G);
}

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!shotMode) {
    acc += realDt;
    while (acc >= DT) { step(DT); acc -= DT; }
    // free the mouse for the buy menu; take it back when the round goes live
    if (G.phase !== lastPhase) {
      if (G.phase === 'buy' && input.locked) { suppressPause = true; input.unlock(); }
      if (G.phase === 'live' && G.started && startEl.classList.contains('hidden')) input.lock();
      lastPhase = G.phase;
    }
  } else {
    G.time += realDt;   // let blinkers and beacons run in a posed frame
  }

  // camera: the player's eye, a fallen tilt when down, or the slow menu orbit
  if (G.phase === 'menu') {
    menuCam.t += realDt * 0.05;
    camera.position.set(Math.sin(menuCam.t) * 30, 13 + Math.sin(menuCam.t * 0.7) * 2, Math.cos(menuCam.t) * 30);
    camera.lookAt(0, 1, 0);
  } else if (!G.player.alive) {
    const p = G.player;
    camera.position.set(p.x, 0.55, p.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(p.pitch * 0.4, p.yaw, 0.45);
  } else {
    applyCamera(G, camera);
  }
  // shake from nearby blasts rides on the events queue
  for (const e of G.events) if (e.type === 'shake') shake = Math.max(shake, e.amount);
  if (shake > 0.003) {
    camera.rotation.x += (Math.random() - 0.5) * 0.05 * shake;
    camera.rotation.z += (Math.random() - 0.5) * 0.04 * shake;
    shake *= Math.exp(-realDt * 7);
  }
  pumpEvents(G);
  G.events.length = 0;

  // the grounded charge: visible while dropped or planted, beacon quickening when live
  const grounded = G.bomb.state === 'dropped' || G.bomb.state === 'planted';
  bombProp.visible = grounded;
  if (grounded) {
    bombProp.position.set(G.bomb.x, 0, G.bomb.z);
    const rate = G.bomb.state === 'planted' ? (G.bomb.timer > 10 ? 4 : G.bomb.timer > 5 ? 8 : 16) : 3;
    bombBeaconMat.emissiveIntensity = Math.sin(G.time * rate) > 0 ? 2.6 : 0.1;
  }

  viewmodel.update(G, realDt);
  updateViews(G, realDt);
  updateHud(G);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
