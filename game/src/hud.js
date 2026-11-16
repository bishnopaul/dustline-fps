// hud.js — everything drawn over the canvas: the readouts (health, ammunition, money,
// timer, score), the crosshair that breathes with the gun's true spread, the kill feed,
// banners, the buy menu, and the yard minimap. It only reads game state and the event
// queue; it never changes the simulation.

import { WEAPONS, TEAM_NAME, livingTeam } from './state.js';
import { COLLIDERS, SITES } from './map.js';
import { spreadMult } from './weapons.js';
import { buyItem, itemCost, BUYABLE } from './rounds.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
const els = {};
let minimapCtx = null;
let feedSeen = 0, toastSeen = 0, hitUntil = 0, killMarkUntil = 0;
const ITEM_BLURB = {
  longbow: 'RK-7 LONGBOW — hard-hitting rifle',
  hornet: 'VZ-9 HORNET — fast, loose SMG',
  mule: 'MULE-12 — eight pellets, no mercy up close',
  vest: 'KEVLAR VEST — soaks 45% of body damage',
  frag: 'EMBER FRAG — throwable, 1.7 s fuse',
};

export function initHud(G) {
  for (const id of ['hud', 'timer', 'roundof', 'bombstate', 'score-atk', 'score-def', 'alive-atk',
    'alive-def', 'killfeed', 'crosshair', 'hitmarker', 'vignette', 'flash', 'banner-big',
    'banner-small', 'actionbar', 'action-label', 'action-fill', 'hpnum', 'hpfill', 'vestline',
    'wpnname', 'ammo', 'money', 'nades', 'hint', 'toast', 'buy', 'buy-grid', 'buy-cash',
    'buy-title', 'minimap', 'startscreen', 'matchend', 'end-title', 'end-sub', 'end-stats']) {
    els[id] = $(id);
  }
  // build the buy grid once; refreshBuy() restyles it as money and ownership change
  for (const item of BUYABLE) {
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.item = item;
    div.innerHTML = `<div><div class="nm">${ITEM_BLURB[item].split(' — ')[0]}</div>` +
      `<div class="ds">${ITEM_BLURB[item].split(' — ')[1] ?? ''}</div></div>` +
      `<div class="pr">$${itemCost(item)}</div>`;
    div.addEventListener('click', () => { buyItem(G, item); refreshBuy(G); });
    els['buy-grid'].appendChild(div);
  }
  minimapCtx = els.minimap.getContext('2d');
  addEventListener('keydown', e => {
    if (!G.buyOpen || G.phase !== 'buy') return;
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (idx >= 0 && BUYABLE[idx]) { buyItem(G, BUYABLE[idx]); refreshBuy(G); }
  });
}

function refreshBuy(G) {
  const a = G.player;
  els['buy-cash'].textContent = `$${a.money}`;
  els['buy-title'].textContent = `BUY — ROUND ${G.round} · ${Math.max(0, Math.ceil(G.phaseLeft))}s`;
  for (const div of els['buy-grid'].children) {
    const item = div.dataset.item;
    const owned = (item === 'vest' && a.vest) || (WEAPONS[item] && a.primary === item) ||
                  (item === 'frag' && a.frags >= 2);
    div.classList.toggle('owned', owned);
    div.classList.toggle('cant', !owned && a.money < itemCost(item));
    div.querySelector('.pr').textContent = owned ? 'OWNED' : `$${itemCost(item)}`;
  }
}

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Sound and screen feedback for the simulation's event queue. main.js clears the queue
// after this runs; the camera shake is main.js's own read of the same queue.
export function pumpEvents(G) {
  for (const e of G.events) {
    switch (e.type) {
      case 'hit':
        sfx.hit(e.head);
        hitUntil = performance.now() + 110;
        els.hitmarker.classList.remove('kill');
        break;
      case 'killconfirm':
        sfx.kill();
        killMarkUntil = performance.now() + 220;
        els.hitmarker.classList.add('kill');
        break;
      case 'hurt':
        sfx.hurt();
        els.vignette.style.transition = 'none';
        els.vignette.style.opacity = '0.95';
        requestAnimationFrame(() => {
          els.vignette.style.transition = 'opacity .5s ease-out';
          els.vignette.style.opacity = '0';
        });
        break;
      case 'shake':
        els.flash.style.opacity = String(0.25 * e.amount);
        setTimeout(() => { els.flash.style.opacity = '0'; }, 70);
        break;
      case 'planted':
        els['banner-big'].textContent = 'CHARGE PLANTED';
        els['banner-big'].className = 'big atk';
        els['banner-small'].textContent = `Site ${e.site} — keep it ticking, or take it back`;
        break;
      case 'roundwin-atk': case 'roundwin-def': {
        const winner = e.type === 'roundwin-atk' ? 'atk' : 'def';
        const mine = winner === 'atk';
        els['banner-big'].textContent = mine ? 'ROUND WON' : 'ROUND LOST';
        els['banner-big'].className = `big ${winner}`;
        els['banner-small'].textContent =
          e.reason === 'elim' ? `${TEAM_NAME[winner]} eliminated the other side` :
          e.reason === 'bomb' ? 'The charge detonated' :
          e.reason === 'defuse' ? 'The charge was defused' : 'Time ran out on the Jackals';
        if (G.phase !== 'over') mine ? sfx.roundWin() : sfx.roundLose();
        break;
      }
      case 'roundstart':
        els['banner-big'].textContent = '';
        els['banner-small'].textContent = '';
        break;
      case 'matchover': {
        const p = G.player;
        els['end-title'].textContent = G.winner === 'draw' ? 'DEADLOCK' : G.winner === 'atk' ? 'VICTORY' : 'DEFEAT';
        els['end-sub'].textContent = G.winner === 'draw' ? 'THE YARD BELONGS TO NO ONE'
          : `${TEAM_NAME[G.winner]} TAKE THE YARD ${G.scores.atk} — ${G.scores.def}`;
        els['end-stats'].textContent =
          `Your line: ${p.kills} kills · ${p.deaths} deaths · $${p.money} in the bank.`;
        els.matchend.classList.remove('hidden');
        break;
      }
    }
  }
  // kill feed: append what the simulation recorded since the last frame
  while (feedSeen < G.feed.length) {
    const entry = G.feed[feedSeen++];
    const div = document.createElement('div');
    div.className = 'kf panel';
    div.innerHTML = entry.html;
    els.killfeed.appendChild(div);
    setTimeout(() => div.remove(), 4600);
    while (els.killfeed.children.length > 5) els.killfeed.firstChild.remove();
  }
  if (toastSeen < G.toasts.length) {
    const t = G.toasts[G.toasts.length - 1];
    toastSeen = G.toasts.length;
    els.toast.textContent = t.text;
    setTimeout(() => { if (els.toast.textContent === t.text) els.toast.textContent = ''; }, 2300);
  }
}

function drawMinimap(G) {
  const ctx = minimapCtx;
  const W = 176, H = 140;
  const sx = x => (x + 38) / 76 * W;
  const sz = z => (z + 30) / 60 * H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(20,22,20,.35)';
  ctx.fillRect(0, 0, W, H);
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    ctx.strokeStyle = '#e07b39';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(s.x0), sz(s.z0), sx(s.x1) - sx(s.x0), sz(s.z1) - sz(s.z0));
    ctx.fillStyle = '#e07b39';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(key, sx(s.cx) - 3, sz(s.cz) + 3);
  }
  ctx.fillStyle = 'rgba(243,234,216,.4)';
  for (const c of COLLIDERS) {
    if (c.top < 1) continue;
    ctx.fillRect(sx(c.x0), sz(c.z0), Math.max(1.5, sx(c.x1) - sx(c.x0)), Math.max(1.5, sz(c.z1) - sz(c.z0)));
  }
  // teammates and the player; the enemy is never drawn (that is what eyes are for)
  for (const a of G.actors) {
    if (!a.alive || a.team !== 'atk') continue;
    ctx.fillStyle = a.isPlayer ? '#ffffff' : '#e07b39';
    ctx.beginPath();
    ctx.arc(sx(a.x), sz(a.z), a.isPlayer ? 3.4 : 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (a.isPlayer) {
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sz(a.z));
      ctx.lineTo(sx(a.x) - Math.sin(a.yaw) * 8, sz(a.z) - Math.cos(a.yaw) * 8);
      ctx.stroke();
    }
  }
  if (G.bomb.state === 'dropped' || G.bomb.state === 'planted') {
    const blink = G.bomb.state === 'dropped' || Math.sin(G.time * 6) > -0.2;
    if (blink) {
      ctx.fillStyle = '#ff5347';
      ctx.fillRect(sx(G.bomb.x) - 2.5, sz(G.bomb.z) - 2.5, 5, 5);
    }
  }
}

export function updateHud(G) {
  const p = G.player;
  els.hud.classList.toggle('hidden', G.phase === 'menu');
  // top bar
  els['score-atk'].textContent = G.scores.atk;
  els['score-def'].textContent = G.scores.def;
  els['roundof'].textContent = `ROUND ${G.round}`;
  els['alive-atk'].textContent = livingTeam(G, 'atk');
  els['alive-def'].textContent = livingTeam(G, 'def');
  if (G.phase === 'buy') {
    els.timer.textContent = fmtTime(G.phaseLeft);
    els.timer.classList.remove('low');
    els.bombstate.textContent = 'BUY TIME';
  } else if (G.bomb.state === 'planted') {
    els.timer.textContent = fmtTime(G.bomb.timer);
    els.timer.classList.add('low');
    els.bombstate.textContent = `CHARGE PLANTED — SITE ${G.bomb.site}`;
  } else {
    els.timer.textContent = fmtTime(G.roundLeft);
    els.timer.classList.toggle('low', G.roundLeft < 15 && G.phase === 'live');
    els.bombstate.textContent = G.bomb.state === 'dropped' ? 'CHARGE IS DOWN' : '';
  }
  // the player's vitals
  els.hpnum.innerHTML = `${Math.ceil(p.hp)} <small>HP</small>`;
  const fill = els.hpfill;
  fill.style.width = `${Math.max(0, p.hp)}%`;
  fill.className = p.hp > 55 ? '' : p.hp > 25 ? 'hurt' : 'crit';
  els.vestline.textContent = p.vest ? 'KEVLAR VEST — FITTED' : 'NO VEST';
  const w = WEAPONS[p.cur];
  const ammo = p.ammo[p.cur];
  els.wpnname.textContent = w.name;
  els.ammo.innerHTML = ammo ? `${ammo.mag} <small>/ ${ammo.reserve}</small>` : '—';
  els.ammo.classList.toggle('low', !!ammo && ammo.mag <= Math.ceil(w.mag * 0.25));
  els.money.textContent = `$${p.money}`;
  els.nades.textContent = `FRAG × ${p.frags} · [4] THROW`;
  // crosshair breathes with the true spread of the shot the gun would fire now
  const spreadDeg = w.spread * spreadMult(G, p, w);
  els.crosshair.style.setProperty('--gap', `${(3 + spreadDeg * 4.2).toFixed(1)}px`);
  els.crosshair.style.opacity = p.alive && G.phase === 'live' ? '1' : '0';
  els.hitmarker.classList.toggle('on', performance.now() < Math.max(hitUntil, killMarkUntil));
  // channel bar: the player's own channel, else a teammate's defuse to worry about
  const channer = G.actors.find(a => a.chan && a.alive);
  if (channer) {
    els.actionbar.classList.remove('hidden');
    const dur = channer.chan.kind === 'plant' ? 3 : 5;
    els['action-label'].textContent = channer.chan.kind === 'plant'
      ? `${channer.isPlayer ? 'YOU ARE' : channer.name.toUpperCase() + ' IS'} PLANTING`
      : `${channer.name.toUpperCase()} IS DEFUSING`;
    els['action-fill'].style.width = `${Math.min(100, channer.chan.t / dur * 100)}%`;
  } else {
    els.actionbar.classList.add('hidden');
  }
  // contextual hint line
  els.hint.textContent =
    G.phase === 'buy' ? 'Buy with the menu or keys 1–5 · B closes it' :
    !p.alive ? 'You are down — the round plays out' :
    G.phase !== 'live' ? '' :
    p.hasBomb ? (inSiteHint(G) ?? 'You carry the charge — plant it on A or B') :
    G.bomb.state === 'planted' ? (p.team === 'atk' ? 'Defend the charge' : 'Defuse it') : '';
  // buy menu visibility
  const showBuy = G.buyOpen && G.phase === 'buy' && p.alive;
  els.buy.classList.toggle('hidden', !showBuy);
  if (showBuy) refreshBuy(G);
  drawMinimap(G);
}

function inSiteHint(G) {
  const p = G.player;
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (p.x >= s.x0 && p.x <= s.x1 && p.z >= s.z0 && p.z <= s.z1) return `Hold E to plant on site ${key}`;
  }
  return null;
}
