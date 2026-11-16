// state.js — every piece of match state lives in the one object made by createGame().
// Modules read and write it; nothing keeps a private copy of score, money or round data.
// Times are seconds on the simulation clock (G.time), distances are metres.

export const TEAM_NAME = { atk: 'JACKALS', def: 'WARDENS' };
export const TEAM_SIZE = 5;
export const ROUND_TIME = 100;      // seconds of live play before the defence wins on time
export const BUY_TIME = 8;           // freeze/buy phase at the top of each round
export const END_TIME = 4.5;         // pause on the round banner before the next buy phase
export const BOMB_TIME = 35;         // fuse after a successful plant
export const PLANT_TIME = 3;         // channel time to plant
export const DEFUSE_TIME = 5;        // channel time to defuse
export const WIN_SCORE = 7;          // rounds to take the match
export const MAX_ROUNDS = 13;

// Weapon table. damage is per bullet (per pellet for the Mule), headMult multiplies a head
// hit, spread is the base cone in degrees at rest, bloom adds while firing or moving.
export const WEAPONS = {
  sparrow: { name: 'P9 SPARROW', short: 'Sparrow', cost: 0, damage: 24, headMult: 3.2, rpm: 330,
             mag: 12, reserve: 60, reload: 1.1, spread: 0.55, kick: 0.55, auto: false, pellets: 1,
             movePenalty: 1.6, range: 70, slot: 'sidearm' },
  hornet:  { name: 'VZ-9 HORNET', short: 'Hornet', cost: 1250, damage: 19, headMult: 3.0, rpm: 780,
             mag: 32, reserve: 128, reload: 1.9, spread: 1.15, kick: 0.34, auto: true, pellets: 1,
             movePenalty: 2.2, range: 55, slot: 'primary' },
  mule:    { name: 'MULE-12', short: 'Mule', cost: 1100, damage: 9, headMult: 2.0, rpm: 68,
             mag: 6, reserve: 30, reload: 2.6, spread: 3.4, kick: 2.6, auto: false, pellets: 8,
             movePenalty: 1.4, range: 22, slot: 'primary' },
  longbow: { name: 'RK-7 LONGBOW', short: 'Longbow', cost: 2700, damage: 33, headMult: 3.4, rpm: 620,
             mag: 25, reserve: 100, reload: 2.2, spread: 0.7, kick: 0.8, auto: true, pellets: 1,
             movePenalty: 2.6, range: 110, slot: 'primary' },
};
export const FRAG_COST = 300;
export const VEST_COST = 650;
export const FRAG_DAMAGE = 92;      // at the centre of the blast, before falloff and cover
export const FRAG_RADIUS = 5.6;

export const PAY = {
  start: 800,
  kill: 250,
  plant: 250,          // to the planter
  plantTeam: 200,      // to every attacker when the charge goes down
  winElim: 1400,
  winBomb: 1600,       // detonation (attackers) or defuse (defenders)
  lossBase: 1000,
  lossStep: 250,       // extra per consecutive lost round, capped in rounds.js
};

let nextId = 1;

// One combatant. Bots and the player share this shape; the player is steered by input.js,
// bots by bots.js, and both shoot through weapons.js.
export function makeActor(team, name, isPlayer) {
  return {
    id: nextId++, team, name, isPlayer,
    alive: true, hp: 100, vest: false,
    money: PAY.start, kills: 0, deaths: 0,
    // kinematics: feet position, velocity, facing. yaw 0 looks north (-z); pitch is look up/down.
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    crouch: 0,            // 0 standing, 1 fully crouched (eased)
    grounded: true,
    radius: 0.35,
    // arsenal: owned guns by slot, per-gun ammunition, the gun in hand
    primary: null, sidearm: 'sparrow', frags: 0,
    cur: 'sparrow',
    ammo: {},             // weaponId -> { mag, reserve }
    nextShotAt: 0, reloadUntil: 0, bloom: 0, lastShotAt: -9,
    hasBomb: false,
    // bot brain (unused for the player)
    ai: {
      state: 'advance', path: [], pathI: 0, goalNode: -1,
      targetId: 0, seenAt: -9, lastKnownX: 0, lastKnownZ: 0, heardAt: -9, heardX: 0, heardZ: 0,
      nextThink: 0, nextScan: 0, reactionAt: 0, burstLeft: 0, burstWaitUntil: 0,
      holdX: 0, holdZ: 0, holdYaw: 0, strafeDir: 1, strafeUntil: 0, planSite: 'A',
      channelUntil: 0, stuckAt: 0, lastX: 0, lastZ: 0,
    },
    view: null,           // three.js group, set by bots.js (null for the player)
    deathAt: 0,
  };
}

export function freshAmmo(weaponId) {
  const w = WEAPONS[weaponId];
  return { mag: w.mag, reserve: w.reserve };
}

// The whole match. Created once by main.js; rounds.js drives the phase machine.
export function createGame() {
  nextId = 1;
  const actors = [];
  const atkNames = ['You', 'Rook', 'Sable', 'Fen', 'Ivo'];
  const defNames = ['Bram', 'Odile', 'Sten', 'Yara', 'Cato'];
  for (let i = 0; i < TEAM_SIZE; i++) actors.push(makeActor('atk', atkNames[i], i === 0));
  for (let i = 0; i < TEAM_SIZE; i++) actors.push(makeActor('def', defNames[i], false));
  return {
    time: 0,
    phase: 'menu',        // menu | buy | live | end | over
    phaseLeft: 0,
    round: 1,
    scores: { atk: 0, def: 0 },
    lossStreak: { atk: 0, def: 0 },
    roundLeft: ROUND_TIME,
    actors,
    player: actors[0],
    bomb: { state: 'carried', carrierId: 0, x: 0, z: 0, timer: 0, site: 'A' },
    channel: null,        // { actorId, kind: 'plant'|'defuse', until } while someone channels
    lastRound: null,      // { winner, reason } for the banner
    noises: [],           // { x, z, radius, at } gunfire and explosions bots can hear
    feed: [],             // kill feed entries { text, html, at } consumed by hud.js
    toasts: [],           // one-line messages for the player
    events: [],           // sound/visual events consumed by audio.js and hud.js each frame
    winner: null,         // match winner once phase is 'over'
    buyOpen: false,
    started: false,
  };
}

export function actorById(G, id) {
  for (const a of G.actors) if (a.id === id) return a;
  return null;
}

export function livingTeam(G, team) {
  let n = 0;
  for (const a of G.actors) if (a.team === team && a.alive) n++;
  return n;
}

// A noise bots may react to; loud events (explosions) carry further than shots.
export function makeNoise(G, x, z, radius) {
  G.noises.push({ x, z, radius, at: G.time });
  if (G.noises.length > 24) G.noises.shift();
}
