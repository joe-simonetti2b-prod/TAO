// Test « chiffres dans le bruit » (module 2) – protocole du type Digits-in-Noise (Smits et al. 2004) :
// - 24 triplets de chiffres 0-9 (3 chiffres différents), énoncés d'un seul tenant (prosodie naturelle)
// - bruit stationnaire au spectre de la voix, niveau de bruit fixe, voix variable
// - cotation par triplet ENTIER (les 3 chiffres justes dans l'ordre)
// - adaptatif 1 bas / 1 haut, pas de 2 dB, départ à 0 dB RSB
// - SRT = moyenne des RSB des triplets 5 à 24 + RSB du 25e (calculé, non présenté)
// - durée ≈ 3 minutes ; variante antiphasique en option

import { getContext } from './audio.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function dinManifest() {
  try {
    const r = await fetch('din/manifest.json', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function dinAvailable(voice) {
  const m = await dinManifest();
  return !!(m && m.voices && m.voices[voice] && m.voices[voice].noise);
}

// 'auto' : alterne homme / femme d'un test à l'autre
export function resolveVoice(setting, lastVoice) {
  if (setting === 'homme' || setting === 'femme') return setting;
  return lastVoice === 'homme' ? 'femme' : 'homme';
}

export class DinTest {
  /**
   * o: { calib, voice ('homme'|'femme'), antiphasic (bool), hooks: { onTriplet(i, total), askAnswer(): Promise<string> } }
   */
  constructor(o) {
    this.o = o; this.aborted = false;
    this.total = 24; this.step = 2; this.startSnr = 0;
  }
  abort() { this.aborted = true; }

  async load() {
    const c = getContext();
    const all = await (await fetch('din/manifest.json')).json();
    const m = all.voices[this.o.voice];
    if (!m) throw new Error('Voix indisponible');
    const dec = async url => c.decodeAudioData(await (await fetch('din/' + url)).arrayBuffer());
    this.noise = await dec(m.noise);
    if (m.triplets) {
      // Triplets préenregistrés : on tire au sort ceux de la séance (sans répétition) et on ne décode qu'eux
      const keys = Object.keys(m.triplets).sort(() => Math.random() - 0.5).slice(0, this.total + 2);
      this.trip = {};
      await Promise.all(keys.map(async k => { this.trip[k] = await dec(m.triplets[k]); }));
      this.tripQueue = keys;
    } else {
      this.digits = {};
      for (const [d, files] of Object.entries(m.digits)) this.digits[d] = await Promise.all(files.map(dec));
    }
    // Niveau de bruit fixe ≈ 55 dB HL rapporté à l'étalonnage 1 kHz (moyenne des deux oreilles)
    const r = this.o.calib?.ref;
    const ref1k = r ? ((r.R?.[1000] ?? -90) + (r.L?.[1000] ?? -90)) / 2 : -90;
    this.noiseDbfs = Math.min(-12, ref1k + 55);
    this.speechRmsDb = m.speechRmsDb ?? -20; // RMS des enregistrements (dBFS)
    this.noiseRmsDb = m.noiseRmsDb ?? -20;
  }

  randomTriplet() {
    if (this.tripQueue) return this.tripQueue.shift().split('');
    const ds = Object.keys(this.digits);
    const t = [];
    while (t.length < 3) {
      const d = ds[Math.floor(Math.random() * ds.length)];
      if (!t.includes(d)) t.push(d);
    }
    return t;
  }

  async playTriplet(triplet, snr) {
    const c = getContext();
    const t0 = c.currentTime + 0.1;
    // Garde-fou anti-saturation : crête voix ≤ RMS + 19 dB et crête bruit ≤ RMS + 14 dB (mesuré) doivent rester sous −1 dBFS.
    // Si besoin, voix ET bruit baissent ensemble : le rapport signal/bruit est conservé.
    const excess = Math.max(0, this.noiseDbfs + snr + 19 + 1, this.noiseDbfs + 14 + 1);
    const noiseGain = Math.pow(10, (this.noiseDbfs - excess - this.noiseRmsDb) / 20);
    const speechGain = Math.pow(10, (this.noiseDbfs - excess + snr - this.speechRmsDb) / 20);
    // Durée : 0,5 s de bruit, chiffres espacés de 0,3 s, 0,5 s de bruit
    let t = t0 + 0.5;
    const nodes = [];
    const pieces = this.trip ? [this.trip[triplet.join('')]] : triplet.map(d => {
      const v = this.digits[d]; return v[Math.floor(Math.random() * v.length)];
    });
    for (const b of pieces) {
      const src = c.createBufferSource(); src.buffer = b;
      const merger = c.createChannelMerger(2);
      const gL = c.createGain(), gR = c.createGain();
      gL.gain.value = speechGain;
      gR.gain.value = this.o.antiphasic ? -speechGain : speechGain; // antiphasique : voix inversée à droite
      src.connect(gL); src.connect(gR);
      gL.connect(merger, 0, 0); gR.connect(merger, 0, 1);
      merger.connect(c.destination);
      src.start(t);
      nodes.push(src);
      t += b.duration + (this.trip ? 0 : 0.3);
    }
    const end = t + 0.5;
    const ns = c.createBufferSource(); ns.buffer = this.noise; ns.loop = true;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t0);
    ng.gain.linearRampToValueAtTime(noiseGain, t0 + 0.1);
    ng.gain.setValueAtTime(noiseGain, end);
    ng.gain.linearRampToValueAtTime(0, end + 0.1);
    ns.connect(ng); ng.connect(c.destination);
    ns.start(t0); ns.stop(end + 0.15);
    await sleep((end + 0.2 - c.currentTime) * 1000);
  }

  async run() {
    await this.load();
    let snr = this.startSnr;
    const track = [];
    for (let i = 0; i < this.total && !this.aborted; i++) {
      this.o.hooks?.onTriplet?.(i, this.total);
      const trip = this.randomTriplet();
      this.o.hooks?.onListen?.(true);
      await this.playTriplet(trip, snr);
      this.o.hooks?.onListen?.(false);
      if (this.aborted) break;
      const answer = await this.o.hooks.askAnswer();
      const correct = answer === trip.join('');
      track.push({ snr, triplet: trip.join(''), answer, correct });
      snr += correct ? -this.step : this.step;
      snr = Math.max(-20, Math.min(10, snr));
    }
    if (this.aborted) return { aborted: true };
    const used = track.slice(4).map(t => t.snr).concat([snr]);
    const srt = used.reduce((a, b) => a + b, 0) / used.length;
    return { aborted: false, srt: Math.round(srt * 10) / 10, track, antiphasic: !!this.o.antiphasic, voice: this.o.voice };
  }
}
