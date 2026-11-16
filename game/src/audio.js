// audio.js — every sound is synthesised with WebAudio: no audio files, no network. One
// shared noise buffer and a handful of oscillator shapes cover shots, reloads, hits, the
// charge's beeps and the round stingers. Distant events are quieter and duller, so a fight
// across the yard sounds across the yard. The context is created lazily on the first user
// gesture (the click that starts the match), as browsers require.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function env(gain, t0, peak, decay) {
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
}

// A burst of filtered noise: the body of every gunshot and the explosion.
function burst({ at = 0, dur = 0.12, freq = 1800, q = 0.7, vol = 0.5, type = 'lowpass' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
  const gain = ctx.createGain();
  env(gain, t0, vol, dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

// A short oscillator blip: clicks, beeps, ticks, stingers.
function blip({ at = 0, freq = 800, end = null, dur = 0.08, vol = 0.2, type = 'square' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (end !== null) osc.frequency.exponentialRampToValueAtTime(end, t0 + dur);
  const gain = ctx.createGain();
  env(gain, t0, vol, dur);
  osc.connect(gain).connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

// Volume and brightness fall with distance from the listener (the player).
function distanceMix(dist) {
  const vol = Math.max(0.03, Math.min(1, 14 / (14 + dist)));
  return { vol, dull: 1 - Math.min(0.75, dist / 70) };
}

const SHOT_SHAPE = {
  sparrow: { dur: 0.09, freq: 2400, vol: 0.4 },
  hornet: { dur: 0.07, freq: 2100, vol: 0.36 },
  mule: { dur: 0.22, freq: 1100, vol: 0.7 },
  longbow: { dur: 0.14, freq: 1500, vol: 0.55 },
};

export const sfx = {
  shot(weaponId, dist = 0) {
    const s = SHOT_SHAPE[weaponId] ?? SHOT_SHAPE.longbow;
    const m = distanceMix(dist);
    burst({ dur: s.dur, freq: s.freq * m.dull, vol: s.vol * m.vol });
    burst({ dur: 0.03, freq: 4200 * m.dull, vol: 0.18 * m.vol, type: 'highpass' });
  },
  dry() { blip({ freq: 1400, dur: 0.03, vol: 0.12 }); },
  reload() {
    blip({ freq: 500, dur: 0.04, vol: 0.16, type: 'square' });
    blip({ at: 0.14, freq: 320, dur: 0.04, vol: 0.16, type: 'square' });
    blip({ at: 0.3, freq: 700, dur: 0.05, vol: 0.2, type: 'square' });
  },
  swap() { blip({ freq: 600, dur: 0.04, vol: 0.12 }); blip({ at: 0.07, freq: 900, dur: 0.04, vol: 0.12 }); },
  hit(head) {
    blip({ freq: head ? 1560 : 1050, dur: 0.05, vol: 0.22, type: 'sine' });
  },
  kill() {
    blip({ freq: 660, dur: 0.07, vol: 0.2, type: 'sine' });
    blip({ at: 0.07, freq: 990, dur: 0.1, vol: 0.2, type: 'sine' });
  },
  hurt() { burst({ dur: 0.08, freq: 500, vol: 0.3 }); },
  throwIt() { burst({ dur: 0.16, freq: 900, vol: 0.1, type: 'bandpass' }); },
  explosion(dist = 0) {
    const m = distanceMix(dist);
    burst({ dur: 0.7, freq: 300 * m.dull + 60, vol: 0.95 * m.vol });
    blip({ freq: 110, end: 34, dur: 0.6, vol: 0.6 * m.vol, type: 'sine' });
  },
  beep(final = false) { blip({ freq: final ? 1560 : 1040, dur: final ? 0.22 : 0.07, vol: 0.2, type: 'sine' }); },
  planted() { blip({ freq: 880, dur: 0.09, vol: 0.22, type: 'sine' }); blip({ at: 0.11, freq: 1174, dur: 0.14, vol: 0.22, type: 'sine' }); },
  buy() { blip({ freq: 1240, dur: 0.05, vol: 0.16, type: 'sine' }); blip({ at: 0.05, freq: 1660, dur: 0.08, vol: 0.16, type: 'sine' }); },
  denied() { blip({ freq: 220, dur: 0.1, vol: 0.18, type: 'square' }); },
  roundWin() {
    blip({ freq: 523, dur: 0.12, vol: 0.2, type: 'triangle' });
    blip({ at: 0.12, freq: 659, dur: 0.12, vol: 0.2, type: 'triangle' });
    blip({ at: 0.24, freq: 784, dur: 0.22, vol: 0.22, type: 'triangle' });
  },
  roundLose() {
    blip({ freq: 392, dur: 0.14, vol: 0.2, type: 'triangle' });
    blip({ at: 0.14, freq: 330, dur: 0.14, vol: 0.2, type: 'triangle' });
    blip({ at: 0.28, freq: 262, dur: 0.26, vol: 0.22, type: 'triangle' });
  },
  tick() { blip({ freq: 1180, dur: 0.03, vol: 0.1, type: 'sine' }); },
};
