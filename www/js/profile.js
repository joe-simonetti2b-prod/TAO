// Profil indicatif du dépistage (jamais un diagnostic). Catégories inspirées de la classification BIAP,
// déduites des paliers 30 / 50 / 70 dB HL. Affiché à l'audioprothésiste, jamais au client.
import { FREQUENCIES, EARS } from './config.js';

export const GRADE = {
  ok:      { rank: 0, label: 'Perçu au niveau de dépistage', short: 'OK' },
  g1:      { rank: 1, label: 'Perçu à 50 dB HL : perte probable légère à moyenne débutante (31-50 dB)', short: '31-50' },
  g2:      { rank: 2, label: 'Perçu à 70 dB HL : perte probable moyenne (51-70 dB)', short: '51-70' },
  g3:      { rank: 3, label: 'Non perçu à 70 dB HL : perte probable sévère ou plus (> 70 dB)', short: '> 70' },
  miss:    { rank: 1, label: 'Non perçu au niveau de dépistage', short: 'non perçu' },
};

export function gradeOf(x) {
  if (!x) return null;
  if (x.heard) return 'ok';
  const c = x.confirm;
  if (!c) return 'miss';
  if (c[50] === true) return 'g1';
  if (c[70] === true) return 'g2';
  if (c[70] === false) return 'g3';
  if (c[50] === false) return 'g2';      // 70 non testé (hors plage) : au moins > 50
  return 'miss';
}

const LOW = [500, 1000], HIGH = [3000, 4000];

export function profile(r) {
  const ears = {};
  for (const e of EARS) {
    const g = Object.fromEntries(FREQUENCIES.map(f => [f, gradeOf(r.tone?.[e]?.[f])]));
    const missed = FREQUENCIES.filter(f => g[f] && g[f] !== 'ok').sort((a, b) => a - b);
    const worst = missed.reduce((w, f) => Math.max(w, GRADE[g[f]].rank), 0);
    let zone = null;
    if (missed.length) {
      const lo = missed.some(f => LOW.includes(f)), hi = missed.some(f => HIGH.includes(f));
      zone = missed.length >= 4 ? 'toutes les fréquences' : hi && !lo ? 'les aigus' : lo && !hi ? 'les graves' : 'plusieurs zones';
    }
    ears[e] = { grades: g, missed, worst, zone };
  }
  const R = ears.R, L = ears.L;
  const asym = Math.abs(R.worst - L.worst) >= 2 || (Math.abs(R.missed.length - L.missed.length) >= 3);
  const both = R.missed.length > 0 && L.missed.length > 0;
  const worstAll = Math.max(R.worst, L.worst);
  const level = ['aucun signe', 'léger à moyen débutant', 'moyen', 'sévère ou plus'][worstAll];
  return { ears, asym, both, worstAll, level };
}

const EAR_TXT = { R: 'droite', L: 'gauche' };
const fmtF = f => f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz';
// Lignes de synthèse pour le conseiller / l'audioprothésiste
export function profileLines(p) {
  const lines = [];
  for (const e of EARS) {
    const x = p.ears[e];
    lines.push(x.missed.length
      ? `Oreille ${EAR_TXT[e]} : sons non perçus ${x.zone === 'toutes les fréquences' ? 'sur' : 'dans'} ${x.zone} (${x.missed.map(fmtF).join(', ')})`
      : `Oreille ${EAR_TXT[e]} : tous les sons perçus`);
  }
  if (p.worstAll) lines.push(`Indication : perte probable ${p.level}`);
  if (p.asym) lines.push('Asymétrie entre les deux oreilles : à signaler en priorité');
  return lines;
}
export function profileSentence(p) { return profileLines(p).join('. ') + '.'; }

export function dinLabel(din, cutoff = -7) {
  if (!din) return null;
  return din.srt > cutoff ? 'à vérifier' : 'bonne';
}
