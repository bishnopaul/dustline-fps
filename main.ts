// Hand-in program for the "DUSTLINE: Kestrel Yard" entry (Node 22, standard library only).
//
// The game itself is the static site in game/ beside this file: plain ES modules, no build
// step, three.js 0.187.0 vendored under game/vendor/three/. This program's only job is to
// hand that site in: it copies game/ and screenshots/ into the output directory and writes
// dossier.json there with the kit's buildDossier, so the judge reads exactly the files the
// gate re-derives from the same bytes.
//
// In the grader the output directory is /output; anywhere else MAKEFUN_OUTPUT_DIR names it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The program keeps no state and reads nothing but its own directory, so two runs over the
// same repository write identical bytes.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });

mkdirSync(join(outDir, 'screenshots'), { recursive: true });
const shotsDir = join(repoDir, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

// The caps are the gate's own (see the kit's RULES.txt, "The gate"): the dossier text the
// judge reads is capped at 163,840 bytes, at most 4 screenshots of 256 KiB each, and game/
// holds at most 993 entries and 48 MiB.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
