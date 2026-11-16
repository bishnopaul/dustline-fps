# DUSTLINE — Kestrel Yard

A complete tactical FPS in three.js, built for the make.fun bounty "Make the best
three.js tactical FPS" (slug `threejs-fps-01`). This is a fresh entry for the first
running of the bounty, reusing the DUSTLINE design first entered in threejs-fps-02
with new screenshot staging (Hornet SMG cover frame, round 7). 5v5 bomb-defusal rounds on an original
map: the **Jackals** (attack, orange) plant a charge on one of two sites in a dusk
freight depot; the **Wardens** (defence, blue) hold the yard and defuse. The player is
Jackal #0 — often the one carrying the charge.

## The game

- **Match**: first to 7 round wins, max 13 rounds. Round = 8 s buy phase, 100 s live,
  4.5 s end banner. Bomb fuse 35 s; plant channel 3 s (hold E on a site); defuse 5 s.
- **Win conditions**: elimination, detonation, defuse, or the clock (defence). If the
  charge is planted, eliminating the attackers does *not* end the round — the Wardens
  must defuse or lose it to the blast.
- **Weapons**: P9 Sparrow pistol (issue sidearm), VZ-9 Hornet SMG ($1250), Mule-12
  shotgun ($1100, 8 pellets), RK-7 Longbow rifle ($2700) — plus Ember frag grenades
  ($300) and a Kevlar vest ($650, body damage ×0.55, head ×0.75).
- **Economy**: $800 start; kill +$250; plant +$250 planter / +$200 team; round win
  $1400 (elimination) / $1600 (bomb); loss $1000 + $250 per consecutive loss (cap 4).
  Survivors keep their guns; the dead re-buy from the Sparrow up.
- **Gunplay**: hitscan against head/body boxes (headshot ×3–3.4), damage falloff,
  recoil and bloom, and spread that grows hard while moving or airborne and shrinks
  crouched and still — stopping to aim pays, and the HUD crosshair breathes with the
  true spread of the shot you would fire right now.
- **Movement**: acceleration-based, walk 4.6 m/s, crouch (2.3, quieter), jump, circle
  vs AABB collision with hoppable low cover.
- **Bots**: a 32-node waypoint graph with BFS routing; a state machine
  (advance / engage / seek / hold / plant / defuse); vision cone + line-of-sight
  raycasts; hearing (gunfire noise radius, footsteps); per-bot skill set at match
  start driving reaction time and spread. Attackers run a shared plan — main site,
  one feint that rotates in after 25 s or first shots, a carrier who pushes through
  distant contact instead of duelling; defenders take posts (one per site, the
  approach lanes, mid), scan, rotate on noise, and push the defuse once planted.
- **Sound**: fully synthesised WebAudio — per-weapon shots with distance mixing,
  reloads, hit/kill ticks, plant beeps that quicken as the fuse burns, explosions,
  buy clicks, round stingers. No audio files.

## Controls

WASD move · mouse look (pointer lock) · Shift walk quietly · Ctrl/C crouch · Space jump
LMB fire · R reload · 1 sidearm · 2 primary · 4 / G frag · E plant (hold, on a site)
B buy menu (also clickable, keys 1–5, during the buy phase) · Esc pause

## Architecture

Static ES modules under `game/`, no build step, no network. One import map:
`"three"` → `./vendor/three/three.module.min.js` (three.js 0.187.0, copied byte-for-byte
from the kit, as is `vendor/makefun-threejs.ts`).

| module | job |
|---|---|
| `game/src/state.js` | the single game-state object, weapon/pay tables, constants |
| `game/src/map.js` | Kestrel Yard: one PROPS table drives meshes **and** colliders; sites, spawns, waypoint graph, physics helpers (collide / rayVsWorld / segmentBlocked / findPath), scene building |
| `game/src/input.js` | pointer lock, key state, mouse deltas |
| `game/src/player.js` | the human's movement controller and camera |
| `game/src/weapons.js` | shared hitscan for player and bots, reloads, pooled tracers/impacts/flashes, frag grenades, blasts |
| `game/src/bots.js` | bot brains (perceive / think / engage), round plans, low-poly figures |
| `game/src/rounds.js` | phase machine, bomb channels, win checks, economy, buying |
| `game/src/hud.js` | all DOM HUD: readouts, kill feed, banners, buy menu, minimap |
| `game/src/audio.js` | WebAudio synthesis |
| `game/src/viewmodel.js` | first-person gun models, bob / recoil / reload poses |
| `game/src/main.js` | boot, fixed-step (1/60) simulation loop, render, pointer-lock flow, `?shot=` staging for screenshots |

The simulation advances in fixed 1/60 steps, separated from rendering; hot loops use
scratch vectors and pooled objects (40 tracers, 28 impact sprites, 16 flashes, 6
grenades) — no per-frame allocations in the step. Game state lives in one object
created by `state.js`.

Own source (html/js under `game/`, excluding vendored three.js): **117,965 bytes**
(cap 163,840). `game/` total 2.25 MB, 15 files.

## Hand-in

`main.ts` (repo root, Node ≥22, stdlib only) copies `game/` and `screenshots/` to the
output dir (`MAKEFUN_OUTPUT_DIR` outside the grader) and writes `dossier.json` via
`buildDossier` from `vendor/makefun-threejs.ts`, with the kit's caps. Running it twice
produces byte-identical output (verified). `serve.ts` serves `game/` on
localhost:8080 for local play and screenshot staging (`?shot=start|play|site|buy`).

## Verification (headless, no browser)

- **Parse/import audit**: every `.js` under `game/` parses as an ES module
  (vm.SourceTextModule) and every static import resolves inside `game/`. PASS.
- **Waypoint audit**: all 32 nodes have ≥0.45 m clearance from every collider and are
  reachable from node 0; all 45 graph edges are walkable in a straight line at ground
  level (segment vs colliders). PASS — this audit caught three nodes inside props and
  ten blocked edges in the first layout; the graph was repaired until clean.
- **Play-tests** (the real modules driven headlessly): waypoint/LOS/ray sanity;
  a directed duel kills and credits the killer; the player plants on site A and the
  charge detonates for the round; a defender defuses; full simulated matches run to a
  conclusion with scoring, kill feed and economy intact. ALL PASS.
- **Balance**: bot-only exhibitions (the simulated player is an AFK statue on the
  attacking side, so attacks play 4v5) run defence-favoured but competitive —
  44–61 kills and 2–3 plants per match, attacker match wins occur (observed up to
  7–2). With a human in the carrier slot the attack is the stronger side, as intended.
- **Hand-in**: scratch copy with 3 dummy screenshots → dossier written, two runs
  byte-identical. **Serving**: all 14 page/module URLs return 200.

## Known limitations

- No spectator camera after death (the view stays at the corpse with a fallen tilt
  while the round plays out).
- Bot balance is tuned by simulation, not by human playtesting; defender posts are
  strong by design and the player's own impact is the counterweight.
