# threejs-tactical-fps

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/bishnopaul/dustline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/bishnopaul/dustline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

**DUSTLINE — Kestrel Yard**: a complete round-based tactical FPS in three.js. Five Jackals attack a dusk freight depot against five Warden bots: plant the charge on site A (Crane Pad) or B (Fuel Row), or wipe the other team. Eight-second buy phase, 100-second rounds, first to 7. Four weapons (P9 Sparrow pistol, VZ-9 Hornet SMG, Mule-12 shotgun, RK-7 Longbow rifle), Ember frag grenades, Kevlar vest, and a full economy ($800 start, kill/plant/win/loss-streak payouts). Bots run a 32-node waypoint graph with vision cones, line-of-sight raycasts and hearing; hitscan rewards stopping to aim — recoil and spread punish firing on the move, headshots multiply damage. All sound is synthesized WebAudio; the simulation runs at a fixed 1/60 step apart from rendering. Static files only: serve `game/` with any static server and play in desktop Chrome, no network needed.

## Run it

```sh
node serve.ts
# then open http://localhost:8080 in desktop Chrome and click to deploy
# (main.ts is the hand-in program: it copies game/ and screenshots/ to the
# output dir and writes dossier.json — MAKEFUN_OUTPUT_DIR=out node main.ts)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=kcfnhgtq&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
