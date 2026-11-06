// Moteur audio TAO
// - Sons de test générés en temps réel (aucun fichier compressé), précision flottante.
// - Convention de niveau : un stimulus de niveau L a la même amplitude crête d'enveloppe
//   qu'un son pur continu de niveau L. L'étalonnage au sonomètre (son pur) et l'étalonnage
//   biologique (même stimulus que le test) restent donc cohérents.
// - Un seul canal actif : l'autre oreille reçoit un zéro numérique absolu.
// - Sur la tablette (v0.9.1), les sons de test sont joués par Android lui-même
//   (module natif, stéréo) : le moteur web pouvait perdre le canal droit sur
//   certaines sorties. Le moteur web ne sert plus qu'à l'aperçu navigateur et
//   au test dans le bruit (même signal dans les deux oreilles).

import { THEMES, MAX_DBFS } from './config.js';
import * as device from './device.js';

export class LevelError extends Error {}

let ctx = null;

// Sortie native disponible (appli Android) ?
export function nativeAudio() { return device.isNative(); }

// Mode essai : une sortie mono est signalée sans bloquer
let allowMono = false;
export function setAllowMono(v) { allowMono = !!v; }

// Signalement des incidents de sortie audio (affichage côté interface)
let issueHandler = null;
export function onAudioIssue(fn) { issueHandler = fn; }

export function getContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); }
  catch { ctx = new AC({ latencyHint: 'interactive' }); }
  try {
    ctx.destination.channelCount = 2;
    ctx.destination.channelCountMode = 'explicit';
    ctx.destination.channelInterpretation = 'discrete';
  } catch {}
  return ctx;
}

export async function resume() {
  const c = getContext();
  if (c.state !== 'running') { try { await c.resume(); } catch {} }
  return c;
}

const TAU = Math.PI * 2;
const dbToAmp = db => Math.pow(10, db / 20);

// ---------- Génération des stimuli ----------

// Rampe en cosinus surélevé (évite les clics, donc les étalements spectraux)
function rampGain(i, n, rampN) {
  if (i < rampN) return 0.5 - 0.5 * Math.cos(Math.PI * i / rampN);
  if (i > n - rampN) return 0.5 - 0.5 * Math.cos(Math.PI * (n - i) / rampN);
  return 1;
}

// Découpe la durée en segments sonores répétés : [{start, len}] en échantillons
function segments(totalN, sr, onS, offS, groupSize = 0, groupPauseS = 0) {
  const out = [];
  let t = 0, k = 0;
  const on = Math.round(onS * sr), off = Math.round(offS * sr), gp = Math.round(groupPauseS * sr);
  while (t < totalN) {
    const len = Math.min(on, totalN - t);
    if (len < Math.round(0.06 * sr) && out.length) break; // pas de fragment trop court en fin
    out.push({ start: t, len, idx: k });
    t += on + off; k++;
    if (groupSize && k % groupSize === 0) t += gp;
  }
  return out;
}

/**
 * Renvoie un Float32Array mono, enveloppe crête = 1.
 * type : 'theme' (son ludique à bande étroite) | 'pulsed' (son pur pulsé 225 ms) | 'pure' (continu)
 */
export function synth(freq, type, durationS, sr) {
  const n = Math.round(durationS * sr);
  const out = new Float32Array(n);
  const theme = type === 'theme' ? THEMES[freq]?.key : null;

  const fill = (seg, envFn, freqFn, rampS) => {
    const rampN = Math.max(1, Math.round(rampS * sr));
    let ph = 0;
    for (let i = 0; i < seg.len; i++) {
      const t = i / sr;
      const f = freqFn ? freqFn(t, seg) : freq;
      ph += TAU * f / sr;
      out[seg.start + i] = Math.sin(ph) * envFn(t, seg) * rampGain(i, seg.len, rampN);
    }
  };

  if (type === 'pure') {
    fill({ start: 0, len: n }, () => 1, null, 0.03);
    return out;
  }
  if (!theme) { // son pur pulsé : 225 ms ON / 225 ms OFF, rampes 25 ms
    for (const s of segments(n, sr, 0.225, 0.225)) fill(s, () => 1, null, 0.025);
    return out;
  }

  switch (theme) {
    case 'corne': { // 500 Hz – corne de brume : son tenu, vibrato lent ±3 %
      const seg = { start: 0, len: n };
      fill(seg, t => (0.78 + 0.22 * Math.sin(TAU * 2 * t)) / 1.0,
               t => freq * (1 + 0.03 * Math.sin(TAU * 4 * t)), 0.08);
      break;
    }
    case 'telephone': { // 1000 Hz – sonnerie : trille à 20 Hz, sonneries de 0,8 s
      for (const s of segments(n, sr, 0.8, 0.25)) {
        fill(s, t => 0.55 + 0.45 * (0.5 * (1 + Math.tanh(4 * Math.sin(TAU * 20 * t)))), null, 0.02);
      }
      break;
    }
    case 'clochette': { // 2000 Hz – tintements à décroissance exponentielle
      for (const s of segments(n, sr, 0.45, 0.08)) fill(s, t => Math.exp(-7 * t), null, 0.006);
      break;
    }
    case 'sifflet': { // 3000 Hz – trille ±1,5 % à 25 Hz
      for (const s of segments(n, sr, 0.9, 0.2)) {
        fill(s, t => 0.8 + 0.2 * Math.sin(TAU * 25 * t),
                t => freq * (1 + 0.015 * Math.sin(TAU * 25 * t)), 0.02);
      }
      break;
    }
    case 'oiseau': { // 4000 Hz – gazouillis : glissandos ±6 %, groupes de 5
      for (const s of segments(n, sr, 0.11, 0.06, 5, 0.22)) {
        const up = s.idx % 2 === 0;
        fill(s, () => 1, (t) => {
          const x = Math.min(1, t / 0.11);
          return freq * (up ? 0.94 + 0.12 * x : 1.06 - 0.11 * x);
        }, 0.012);
      }
      break;
    }
  }
  // Normalisation de sécurité : enveloppe crête exactement 1
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  if (pk > 0) for (let i = 0; i < n; i++) out[i] /= pk;
  return out;
}

const cache = new Map();
function stimulusBuffer(freq, type, durationS) {
  const c = getContext();
  const key = `${freq}|${type}|${durationS}|${c.sampleRate}`;
  if (!cache.has(key)) cache.set(key, synth(freq, type, durationS, c.sampleRate));
  return cache.get(key);
}

// ---------- Lecture ----------

/** Convertit un niveau dB HL en dBFS grâce à l'étalonnage. */
export function hlToDbfs(calib, ear, freq, dbHL) {
  const ref = calib?.ref?.[ear]?.[freq];
  if (typeof ref !== 'number') throw new LevelError(`Pas d'étalonnage pour ${freq} Hz oreille ${ear}`);
  return ref + dbHL;
}

/**
 * Joue un stimulus sur une oreille à un niveau en dBFS (crête d'enveloppe).
 * Renvoie { onsetMs, offsetMs, done: Promise, stop() } en temps performance.now().
 */
export function playDbfs({ freq, ear, dbfs, duration = 2, type = 'theme', delay = 0.05 }) {
  if (dbfs > MAX_DBFS) throw new LevelError(`Niveau trop élevé (${dbfs.toFixed(1)} dBFS) : hors de la plage sûre`);
  if (nativeAudio()) return playNative({ freq, ear, dbfs, duration, type });
  const c = getContext();
  const mono = stimulusBuffer(freq, type, duration);
  const buf = c.createBuffer(2, mono.length, c.sampleRate);
  const ch = ear === 'R' ? 1 : 0; // canal 0 = gauche, canal 1 = droite
  const amp = dbToAmp(dbfs);
  const data = buf.getChannelData(ch);
  for (let i = 0; i < mono.length; i++) data[i] = mono[i] * amp;
  // l'autre canal reste à zéro absolu (createBuffer initialise à 0)

  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  const startAt = c.currentTime + delay;
  src.start(startAt);

  const lat = (c.outputLatency || c.baseLatency || 0) * 1000;
  const onsetMs = performance.now() + delay * 1000 + lat;
  const offsetMs = onsetMs + duration * 1000;
  const done = new Promise(res => { src.onended = res; });
  const h = { ok: true, onsetMs, offsetMs, done, stop: () => { try { src.stop(); } catch {} } };
  h.ready = Promise.resolve(h);
  return h;
}

// Lecture par Android. Même interface que la lecture web ; `ready` se résout quand
// Android a confirmé le départ du son et l'instant réel de sa sortie.
function playNative({ freq, ear, dbfs, duration, type }) {
  const t = performance.now();
  const h = { ok: true, error: null, onsetMs: t + 60, offsetMs: t + 60 + duration * 1000, stopped: false };
  let id = null, endTimer = null, endRes = null;
  h.ready = device.playStimulus({ freq, ear, dbfs, duration, type, allowMono }).then(r => {
    if (!r || r.ok === false) {
      h.ok = false; h.error = r?.error || 'Erreur audio';
      issueHandler?.({ error: h.error });
      return h;
    }
    id = r.id;
    h.onsetMs = performance.now() + (typeof r.startsInMs === 'number' ? r.startsInMs : 0);
    h.offsetMs = h.onsetMs + duration * 1000;
    h.route = r.route; h.mono = r.mono || null;
    if (r.mono) issueHandler?.({ warning: r.mono });
    if (h.stopped) device.stopStimulus(id);
    return h;
  });
  h.done = h.ready.then(() => (!h.ok || h.stopped) ? undefined : new Promise(res => {
    endRes = res; endTimer = setTimeout(res, Math.max(0, h.offsetMs - performance.now() + 30));
  }));
  h.stop = () => {
    h.stopped = true;
    if (id !== null) device.stopStimulus(id);
    if (endRes) { clearTimeout(endTimer); endRes(); }
  };
  return h;
}

export function playHL({ calib, freq, ear, dbHL, duration, type }) {
  return playDbfs({ freq, ear, dbfs: hlToDbfs(calib, ear, freq, dbHL), duration, type });
}

/** Son pur continu pour la mesure au sonomètre. */
export function playContinuous({ freq, ear, dbfs }) {
  if (dbfs > MAX_DBFS) throw new LevelError('Niveau trop élevé');
  if (nativeAudio()) {
    let chain = device.toneStart({ freq, ear, dbfs, allowMono }).then(r => {
      if (r && r.ok === false) issueHandler?.({ error: r.error || 'Erreur audio' });
      else if (r?.mono) issueHandler?.({ warning: r.mono });
    });
    return {
      setDbfs(v) { if (v <= MAX_DBFS) chain = chain.then(() => device.toneSet(v)); },
      stop() { chain = chain.then(() => device.toneStop()); },
    };
  }
  const c = getContext();
  const osc = c.createOscillator();
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = 0;
  const merger = c.createChannelMerger(2);
  osc.connect(g);
  g.connect(merger, 0, ear === 'R' ? 1 : 0);
  merger.connect(c.destination);
  const t0 = c.currentTime + 0.02;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(dbToAmp(dbfs), t0 + 0.05);
  osc.start(t0);
  return {
    setDbfs(v) { if (v <= MAX_DBFS) g.gain.setTargetAtTime(dbToAmp(v), c.currentTime, 0.02); },
    stop() {
      const t = c.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.05);
      try { osc.stop(t + 0.08); } catch {}
    },
  };
}

// ---------- Bruit ambiant (micro de la tablette) ----------

export class NoiseMonitor {
  constructor() { this.analyser = null; this.stream = null; this.bins = null; this.nat = null; }

  async start() {
    if (this.analyser || this.nat) return true;
    if (nativeAudio()) return this.startNative();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const c = getContext();
      const src = c.createMediaStreamSource(this.stream);
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0.6;
      src.connect(this.analyser); // non relié à la sortie : aucun retour dans le casque
      this.bins = new Float32Array(this.analyser.frequencyBinCount);
      return true;
    } catch { this.analyser = null; return false; }
  }

  // Micro intégré de la tablette via Android (analyse identique : FFT 8192, Blackman, lissage 0,6)
  async startNative() {
    const r = await device.micStart();
    if (!r?.ok) return false;
    const nat = { bands: null, a: null, timer: null, source: r.source };
    this.nat = nat;
    const poll = async () => {
      if (this.nat !== nat) return;
      const l = await device.micLevels();
      if (this.nat !== nat) return;
      if (l?.ok && l.ready) { nat.bands = l.bands; nat.a = l.a; }
      nat.timer = setTimeout(poll, 100);
    };
    await poll();
    const t0 = performance.now(); // première analyse disponible après ~0,2 s
    while (this.nat === nat && !nat.bands && performance.now() - t0 < 1500) await new Promise(res => setTimeout(res, 50));
    return this.nat === nat;
  }

  stop() {
    if (this.nat) { clearTimeout(this.nat.timer); this.nat = null; device.micStop(); }
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    this.analyser = null; this.stream = null;
  }

  get active() { return !!this.analyser || !!this.nat; }

  // Niveau (dB relatif, non étalonné) dans la bande d'octave centrée sur f
  bandLevel(f) {
    if (this.nat) { const v = this.nat.bands?.[f] ?? this.nat.bands?.[String(f)]; return typeof v === 'number' ? v : null; }
    if (!this.analyser) return null;
    this.analyser.getFloatFrequencyData(this.bins);
    const sr = getContext().sampleRate;
    const hz = sr / this.analyser.fftSize;
    const lo = Math.floor(f / Math.SQRT2 / hz), hi = Math.ceil(f * Math.SQRT2 / hz);
    let p = 0;
    for (let i = lo; i <= hi && i < this.bins.length; i++) p += Math.pow(10, this.bins[i] / 10);
    return 10 * Math.log10(p + 1e-20);
  }

  // Niveau global pondéré A (dB relatifs au micro ; + offset d'étalonnage = dB(A))
  levelA() {
    if (this.nat) return typeof this.nat.a === 'number' ? this.nat.a : null;
    if (!this.analyser) return null;
    this.analyser.getFloatFrequencyData(this.bins);
    const sr = getContext().sampleRate, hz = sr / this.analyser.fftSize;
    if (!this._aw || this._aw.length !== this.bins.length) {
      this._aw = new Float32Array(this.bins.length);
      for (let i = 0; i < this.bins.length; i++) {
        const f = Math.max(1, i * hz), f2 = f * f;
        const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
        const a = 20 * Math.log10(ra) + 2.0;
        this._aw[i] = f < 20 ? 0 : Math.pow(10, a / 10);
      }
    }
    let p = 0;
    for (let i = 1; i < this.bins.length; i++) p += Math.pow(10, this.bins[i] / 10) * this._aw[i];
    return 10 * Math.log10(p + 1e-20);
  }

  // Leq pondéré A sur une durée (ms)
  async leqA(ms = 3000) {
    let acc = 0, n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const l = this.levelA(); if (l !== null) { acc += Math.pow(10, l / 10); n++; }
      await new Promise(r => setTimeout(r, 100));
    }
    return n ? 10 * Math.log10(acc / n) : null;
  }

  levels(freqs) {
    const out = {};
    for (const f of freqs) out[f] = this.bandLevel(f);
    return out;
  }

  // Moyenne sur une durée (ms)
  async average(freqs, ms = 2000) {
    const acc = Object.fromEntries(freqs.map(f => [f, 0]));
    let n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const l = this.levels(freqs);
      for (const f of freqs) acc[f] += Math.pow(10, (l[f] ?? -120) / 10);
      n++;
      await new Promise(r => setTimeout(r, 100));
    }
    return Object.fromEntries(freqs.map(f => [f, 10 * Math.log10(acc[f] / Math.max(1, n))]));
  }
}
