// Test « chiffres dans le bruit » (module 2, optionnel)
// Procédure adaptative 1 bas / 1 haut, pas de 2 dB, 24 triplets.
// SRT = moyenne des RSB des triplets 5 à 24 + RSB du 25e (non présenté).
// Nécessite : www/din/manifest.json, enregistrements des chiffres, bruit au spectre de la voix.

import { getContext } from './audio.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function dinAvailable() {
  try {
    const r = await fetch('din/manifest.json', { cache: 'no-store' });
    if (!r.ok) return false;
    const m = await r.json();
    return !!(m && m.digits && m.noise);
  } catch { return false; }
}

export class DinTest {
  /**
   * o: { calib, antiphasic (bool), hooks: { onTriplet(i, total), askAnswer(): Promise<string> } }
   */
  constructor(o) {
    this.o = o; this.aborted = false;
    this.total = 24; this.step = 2; this.startSnr = 0;
  }
  abort() { this.aborted = true; }

  async load() {
    const c = getContext();
    const m = await (await fetch('din/manifest.json')).json();
    const dec = async url => c.decodeAudioData(await (await fetch('din/' + url)).arrayBuffer());
    this.digits = {};
    for (const [d, files] of Object.entries(m.digits)) this.digits[d] = await Promise.all(files.map(dec));
    this.noise = await dec(m.noise);
    // Niveau de bruit fixe ≈ 55 dB HL rapporté à l'étalonnage 1 kHz (moyenne des deux oreilles)
    const r = this.o.calib?.ref;
    const ref1k = r ? ((r.R?.[1000] ?? -90) + (r.L?.[1000] ?? -90)) / 2 : -90;
    this.noiseDbfs = Math.min(-12, ref1k + 55 + (m.noiseCalibOffset || 0));
    this.speechRmsDb = m.speechRmsDb ?? -20; // RMS des enregistrements (dBFS)
    this.noiseRmsDb = m.noiseRmsDb ?? -20;
  }

  randomTriplet() {
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
    const noiseGain = Math.pow(10, (this.noiseDbfs - this.noiseRmsDb) / 20);
    const speechGain = Math.pow(10, (this.noiseDbfs + snr - this.speechRmsDb) / 20);
    // Durée : 0,5 s de bruit, chiffres espacés de 0,3 s, 0,5 s de bruit
    let t = t0 + 0.5;
    const nodes = [];
    for (const d of triplet) {
      const variants = this.digits[d];
      const b = variants[Math.floor(Math.random() * variants.length)];
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
      t += b.duration + 0.3;
    }
    const end = t + 0.2;
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
      await this.playTriplet(trip, snr);
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
    return { aborted: false, srt: Math.round(srt * 10) / 10, track, antiphasic: !!this.o.antiphasic };
  }
}
