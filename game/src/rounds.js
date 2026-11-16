// rounds.js — the match itself: phases (buy, live, end, over), the round clock, the bomb
// (carried, dropped, planted, defused, blown), channels, win checks, and the economy that
// pays both teams and stocks the bots. The player buys through buyItem(); bots buy through
// botBuy() on a simple save/force/full policy.

import { WEAPONS, PAY, ROUND_TIME, BUY_TIME, END_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME,
         WIN_SCORE, MAX_ROUNDS, FRAG_COST, VEST_COST, TEAM_SIZE, freshAmmo, livingTeam } from './state.js';
import { SPAWNS, SITES, inSite } from './map.js';
import { planRound } from './bots.js';
import { bombBlast, clearGrenades, swapTo } from './weapons.js';
import { sfx } from './audio.js';

const BUYABLE = ['hornet', 'mule', 'longbow', 'vest', 'frag'];

// ------------------------------------------------------------ match setup

export function startMatch(G) {
  G.scores.atk = 0; G.scores.def = 0;
  G.lossStreak.atk = 0; G.lossStreak.def = 0;
  G.round = 1;
  G.winner = null;
  for (const a of G.actors) {
    a.money = PAY.start;
    a.kills = 0; a.deaths = 0;
    a.primary = null; a.frags = 0; a.vest = false;
    a.survived = false;
    // fixed per-bot skill for the whole match: reaction and spread derive from it.
    // Attackers get a small edge — they are the ones who must take ground from set posts.
    a.ai.skill = 0.8 + Math.random() * 0.45 + (a.team === 'atk' ? 0.08 : 0);
    a.ai.baseSpread = 2.5 - a.ai.skill * 0.8;
  }
  setupRound(G);
}

function setupRound(G) {
  G.phase = 'buy';
  G.phaseLeft = BUY_TIME;
  G.roundLeft = ROUND_TIME;
  G.buyOpen = true;
  G.channel = null;
  G.noises.length = 0;
  clearGrenades();
  for (const team of ['atk', 'def']) {
    const spawns = SPAWNS[team];
    G.actors.filter(a => a.team === team).forEach((a, i) => {
      const s = spawns[i % spawns.length];
      a.x = s.x; a.z = s.z; a.y = 0;
      a.vx = 0; a.vy = 0; a.vz = 0;
      a.yaw = s.yaw; a.pitch = 0;
      a.crouch = 0; a.hp = 100; a.alive = true;
      a.bloom = 0; a.reloadUntil = 0; a.nextShotAt = 0; a.chan = null;
      a.hasBomb = false;
      if (!a.survived) {           // the dead start over with the issue sidearm
        a.primary = null; a.frags = 0; a.vest = false;
      }
      a.ammo = { sparrow: freshAmmo('sparrow') };
      if (a.primary) a.ammo[a.primary] = freshAmmo(a.primary);
      a.cur = a.primary ?? 'sparrow';
      if (a.isPlayer && a.viewmodel) a.viewmodel.setWeapon(a.cur);
      a.ai.state = 'advance'; a.ai.path = []; a.ai.pathI = 0; a.ai.targetId = 0;
      a.ai.seenAt = -9; a.ai.heardAt = -9; a.ai.fetchBomb = false;
    });
  }
  // the charge goes to a living attacker: often the player early, then by lot
  const atk = G.actors.filter(a => a.team === 'atk');
  const carrier = G.round <= 2 && G.player.alive ? G.player
    : atk[Math.floor(Math.random() * atk.length)];
  carrier.hasBomb = true;
  G.bomb.state = 'carried';
  G.bomb.carrierId = carrier.id;
  G.bomb.timer = 0;
  for (const a of G.actors) if (!a.isPlayer) botBuy(a);
  planRound(G);
}

// ------------------------------------------------------------ economy

export function itemCost(item) {
  if (item === 'vest') return VEST_COST;
  if (item === 'frag') return FRAG_COST;
  return WEAPONS[item].cost;
}

export function buyItem(G, item) {
  const a = G.player;
  if (G.phase !== 'buy' || !a.alive) return false;
  const cost = itemCost(item);
  if (item === 'vest' && a.vest) return deny(G, 'Vest already fitted');
  if (item === 'frag' && a.frags >= 2) return deny(G, 'Frag limit reached');
  if (WEAPONS[item] && a.primary === item) return deny(G, 'Already in your hands');
  if (a.money < cost) return deny(G, 'Not enough funds');
  a.money -= cost;
  if (item === 'vest') a.vest = true;
  else if (item === 'frag') a.frags++;
  else {
    a.primary = item;
    a.ammo[item] = freshAmmo(item);
    swapTo(G, a, item);
  }
  sfx.buy();
  G.toasts.push({ text: `Bought ${item === 'vest' ? 'Kevlar vest' : item === 'frag' ? 'Ember frag' : WEAPONS[item].name} — $${a.money} left`, at: G.time });
  return true;
}

function deny(G, why) {
  sfx.denied();
  G.toasts.push({ text: why, at: G.time });
  return false;
}

// Bot shopping: keep a reserve, prefer a rifle with a vest on full buys, an SMG or the
// Mule on a force, and save after a loss when the bank is thin.
function botBuy(a) {
  const spend = (item) => {
    const cost = itemCost(item);
    if (a.money < cost) return false;
    a.money -= cost;
    if (item === 'vest') a.vest = true;
    else if (item === 'frag') a.frags++;
    else { a.primary = item; a.ammo[item] = freshAmmo(item); a.cur = item; }
    return true;
  };
  if (!a.primary) {
    if (a.money >= 3400) { spend('longbow'); spend('vest'); }
    else if (a.money >= 2000) { spend(Math.random() < 0.6 ? 'hornet' : 'mule'); spend('vest'); }
    else if (a.money >= 1250 && Math.random() < 0.7) spend(Math.random() < 0.5 ? 'hornet' : 'mule');
  }
  if (!a.vest && a.primary && a.money >= VEST_COST + 300) spend('vest');
  if (a.frags === 0 && a.money >= FRAG_COST + 500 && Math.random() < 0.55) spend('frag');
}

// ------------------------------------------------------------ the bomb

function siteAt(x, z) {
  for (const key of ['A', 'B']) if (inSite(x, z, key)) return key;
  return null;
}

// Progress a plant/defuse channel on an actor; returns true the step it completes.
function channelTick(G, a, kind, dur, dt) {
  if (!a.chan || a.chan.kind !== kind) a.chan = { kind, t: 0, x: a.x, z: a.z };
  if (Math.hypot(a.x - a.chan.x, a.z - a.chan.z) > 1.1) { a.chan = null; return false; }
  a.chan.t += dt;
  return a.chan.t >= dur;
}

function plantBomb(G, planter, site) {
  planter.hasBomb = false;
  planter.chan = null;
  G.bomb.state = 'planted';
  G.bomb.x = planter.x; G.bomb.z = planter.z;
  G.bomb.site = site;
  G.bomb.timer = BOMB_TIME;
  G.bomb.beepAt = 0;
  planter.money += PAY.plant;
  for (const a of G.actors) if (a.team === 'atk' && a.alive) a.money += PAY.plantTeam;
  G.events.push({ type: 'planted', site });
  sfx.planted();
}

function channelsAndBomb(G, input, dt) {
  const bomb = G.bomb;
  // dropped charge: the first attacker to reach it picks it up
  if (bomb.state === 'dropped') {
    for (const a of G.actors) {
      if (a.team === 'atk' && a.alive && Math.hypot(a.x - bomb.x, a.z - bomb.z) < 1.15) {
        a.hasBomb = true;
        bomb.state = 'carried';
        bomb.carrierId = a.id;
        if (a.isPlayer) G.toasts.push({ text: 'You picked up the charge', at: G.time });
        break;
      }
    }
  }
  // the player's plant: hold E inside a site while carrying
  const p = G.player;
  if (bomb.state === 'carried' && p.hasBomb && p.alive) {
    const site = siteAt(p.x, p.z);
    if (site && input.held.has('KeyE')) {
      if (channelTick(G, p, 'plant', PLANT_TIME, dt)) { plantBomb(G, p, site); return; }
    } else if (p.chan && p.chan.kind === 'plant') p.chan = null;
  }
  // bot plant and defuse channels follow their brain states
  for (const a of G.actors) {
    if (a.isPlayer || !a.alive) continue;
    if (a.ai.state === 'plant' && a.hasBomb && bomb.state === 'carried') {
      const site = siteAt(a.x, a.z) ?? a.ai.planSite;
      if (channelTick(G, a, 'plant', PLANT_TIME, dt)) { plantBomb(G, a, site); return; }
    } else if (a.ai.state === 'defuse' && bomb.state === 'planted') {
      if (channelTick(G, a, 'defuse', DEFUSE_TIME, dt)) {
        a.chan = null;
        bomb.state = 'defused';
        endRound(G, 'def', 'defuse');
        return;
      }
    } else if (a.chan) a.chan = null;
  }
  // the planted charge: beeps quicken as the fuse burns, then it blows
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    if (G.time >= (bomb.beepAt ?? 0)) {
      sfx.beep(bomb.timer < 1.2);
      bomb.beepAt = G.time + (bomb.timer > 10 ? 1 : bomb.timer > 5 ? 0.5 : 0.25);
    }
    if (bomb.timer <= 0) {
      bomb.state = 'exploded';
      bombBlast(G, bomb.x, bomb.z);
      endRound(G, 'atk', 'bomb');
    }
  }
}

// ------------------------------------------------------------ round flow

function endRound(G, winner, reason) {
  const loser = winner === 'atk' ? 'def' : 'atk';
  G.scores[winner]++;
  const winPay = reason === 'elim' ? PAY.winElim : PAY.winBomb;
  const lossPay = PAY.lossBase + Math.min(4, G.lossStreak[loser]) * PAY.lossStep;
  for (const a of G.actors) {
    a.survived = a.alive;
    a.money += a.team === winner ? winPay : lossPay;
    a.chan = null;
  }
  G.lossStreak[winner] = 0;
  G.lossStreak[loser]++;
  G.lastRound = { winner, reason };
  G.phase = 'end';
  G.phaseLeft = END_TIME;
  G.buyOpen = false;
  G.events.push({ type: winner === 'atk' ? 'roundwin-atk' : 'roundwin-def', reason });
}

function checkWins(G) {
  const atkAlive = livingTeam(G, 'atk');
  const defAlive = livingTeam(G, 'def');
  if (defAlive === 0) { endRound(G, 'atk', 'elim'); return; }
  if (atkAlive === 0 && G.bomb.state !== 'planted') { endRound(G, 'def', 'elim'); return; }
  if (G.roundLeft <= 0 && G.bomb.state !== 'planted') endRound(G, 'def', 'time');
}

// The phase machine, stepped by main.js after movement and combat.
export function updateRounds(G, input, dt) {
  if (G.phase === 'buy') {
    G.phaseLeft -= dt;
    if (input.takePress('KeyB')) G.buyOpen = !G.buyOpen;
    if (G.phaseLeft <= 0) {
      G.phase = 'live';
      G.buyOpen = false;
      G.events.push({ type: 'roundstart' });
    }
    return;
  }
  if (G.phase === 'live') {
    if (G.bomb.state !== 'planted') G.roundLeft -= dt;
    channelsAndBomb(G, input, dt);
    if (G.phase === 'live') checkWins(G);
    return;
  }
  if (G.phase === 'end') {
    G.phaseLeft -= dt;
    if (G.phaseLeft > 0) return;
    const decided = G.scores.atk >= WIN_SCORE || G.scores.def >= WIN_SCORE || G.round >= MAX_ROUNDS;
    if (decided) {
      G.phase = 'over';
      G.winner = G.scores.atk === G.scores.def ? 'draw'
        : G.scores.atk > G.scores.def ? 'atk' : 'def';
      G.events.push({ type: 'matchover' });
    } else {
      G.round++;
      setupRound(G);
    }
  }
}

export { BUYABLE };
