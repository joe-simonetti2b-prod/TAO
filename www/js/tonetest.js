// Procédure du test tonal de dépistage (module 1)
import { FREQUENCIES, EARS } from './config.js';
import { playHL, hlToDbfs } from './audio.js';
import { MAX_DBFS } from './config.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

export class ToneTest {
  /**
   * @param {object} o
   *  calib, settings, noise (NoiseMonitor|null), noiseRef ({f: dB}|null)
   *  hooks: { onTrial(ear, freq, index, total), onNoise(waiting), onEarChange(ear) }
   */
  constructor(o) {
    this.o = o;
    this.presses = [];
    this.aborted = false;
    this.paused = false;
  }

  press() { this.presses.push(performance.now()); }
  abort() { this.aborted = true; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }

  levelFor(freq) {
    const s = this.o.settings;
    return s.levelHL + (freq === 500 ? s.extra500 : 0);
  }

  pressedBetween(t0, t1) { return this.presses.some(t => t >= t0 && t <= t1); }

  async waitIfPaused() { while (this.paused && !this.aborted) await sleep(150); }

  // Attend un environnement assez calme dans la bande de la fréquence testée
  async waitQuiet(freq) {
    const { noise, noiseRef, settings } = this.o;
    if (!settings.noiseCheck || !noise?.active || !noiseRef || typeof noiseRef[freq] !== 'number') return false;
    const limit = noiseRef[freq] + settings.noiseMarginDb;
    const t0 = performance.now();
    let waited = false;
    while (!this.aborted) {
      const l = noise.bandLevel(freq);
      if (l === null || l <= limit) break;
      if (!waited) { waited = true; this.o.hooks?.onNoise?.(true); }
      if (performance.now() - t0 > 6000) { this.o.hooks?.onNoise?.(false); return true; } // reste bruyant
      await sleep(250);
    }
    if (waited) this.o.hooks?.onNoise?.(false);
    return false;
  }

  // Une présentation : renvoie true si le client a répondu dans la fenêtre
  async present(ear, freq, dbHL = null, quick = false) {
    const s = this.o.settings;
    await sleep((quick ? rand(1.0, 2.0) : rand(s.isiMin, s.isiMax)) * 1000);
    await this.waitIfPaused();
    if (this.aborted) return null;
    const noisy = await this.waitQuiet(freq);
    const h = playHL({ calib: this.o.calib, freq, ear, dbHL: dbHL ?? this.levelFor(freq),
                       duration: s.stimulusDuration, type: s.stimulusType });
    const winEnd = h.offsetMs + s.responseWindowAfter * 1000;
    // Fin anticipée dès qu'une réponse arrive (le son est coupé, comme en audiométrie)
    while (performance.now() < winEnd && !this.aborted) {
      if (this.pressedBetween(h.onsetMs - 50, performance.now())) {
        if (performance.now() < h.offsetMs) h.stop();
        await sleep(400);
        return { heard: true, noisy };
      }
      await sleep(30);
    }
    h.stop();
    return { heard: false, noisy };
  }

  // Essai muet : une réponse pendant la fenêtre = fausse alarme
  async catchTrial() {
    const s = this.o.settings;
    await sleep(rand(s.isiMin, s.isiMax) * 1000);
    if (this.aborted) return false;
    const t0 = performance.now();
    const t1 = t0 + (s.stimulusDuration + s.responseWindowAfter) * 1000;
    await sleep(t1 - t0);
    return this.pressedBetween(t0, t1);
  }

  async run() {
    const s = this.o.settings;
    const result = { R: {}, L: {} };
    const plan = [];
    for (const ear of EARS) for (const freq of FREQUENCIES) plan.push({ ear, freq });
    // Position des essais muets (jamais en tout premier)
    const catchAt = new Set();
    while (catchAt.size < Math.min(s.catchTrials, plan.length - 1)) {
      catchAt.add(1 + Math.floor(Math.random() * (plan.length - 1)));
    }
    let catchFP = 0;
    const total = plan.length;
    let lastEar = null;

    for (let i = 0; i < plan.length && !this.aborted; i++) {
      const { ear, freq } = plan[i];
      if (ear !== lastEar) { lastEar = ear; await this.o.hooks?.onEarChange?.(ear); }
      this.o.hooks?.onTrial?.(ear, freq, i, total);

      if (catchAt.has(i)) { if (await this.catchTrial()) catchFP++; }

      const answers = [];
      let noisy = false;
      for (let k = 0; k < 2 && !this.aborted; k++) {
        const r = await this.present(ear, freq);
        if (!r) break;
        answers.push(r.heard); noisy = noisy || r.noisy;
      }
      if (answers.length === 2 && answers[0] !== answers[1] && !this.aborted) {
        const r = await this.present(ear, freq);
        if (r) { answers.push(r.heard); noisy = noisy || r.noisy; }
      }
      const yes = answers.filter(Boolean).length;
      result[ear][freq] = { heard: yes >= 2, answers, noisy, levelHL: this.levelFor(freq) };
    }

    if (this.aborted) return { aborted: true };

    // ---- Palier de confirmation : fréquences manquées rejouées à 50 puis 70 dB HL ----
    // Donne une indication de l'importance de la perte (pour l'audioprothésiste uniquement).
    const missedFirst = [];
    for (const ear of EARS) for (const freq of FREQUENCIES) if (!result[ear][freq].heard) missedFirst.push({ ear, freq });
    if (s.confirmEnabled !== false && missedFirst.length && catchFP <= s.maxFalsePositives) {
      await this.o.hooks?.onPhase?.('confirm', missedFirst.length);
      let idx = 0;
      for (const { ear, freq } of missedFirst) {
        if (this.aborted) break;
        if (ear !== lastEar) { lastEar = ear; await this.o.hooks?.onEarChange?.(ear, true); }
        this.o.hooks?.onTrial?.(ear, freq, idx++, missedFirst.length, true);
        const conf = {};
        for (const lvl of (s.confirmLevels || [50, 70])) {
          let dbfs;
          try { dbfs = hlToDbfs(this.o.calib, ear, freq, lvl); } catch { dbfs = Infinity; }
          if (dbfs > MAX_DBFS) { conf[lvl] = 'hors_plage'; break; }
          // 1 présentation par palier ; au dernier palier, une 2e chance avant de conclure
          const last = lvl === (s.confirmLevels || [50, 70]).slice(-1)[0];
          const answers = [];
          for (let k = 0; k < (last ? 2 : 1) && !this.aborted; k++) {
            const r = await this.present(ear, freq, lvl, true);
            if (!r) break;
            answers.push(r.heard);
            if (r.heard) break;
          }
          const heard = answers.some(Boolean);
          conf[lvl] = heard;
          if (heard) break;
        }
        result[ear][freq].confirm = conf;
      }
      if (this.aborted) return { aborted: true };
    }

    const missed = [];
    for (const ear of EARS) for (const freq of FREQUENCIES) if (!result[ear][freq].heard) missed.push({ ear, freq });
    const reliable = catchFP <= s.maxFalsePositives;
    const outcome = !reliable ? 'unreliable' : missed.length ? 'refer' : 'pass';
    return { aborted: false, tone: result, missed, falsePositives: catchFP, reliable, outcome };
  }
}
