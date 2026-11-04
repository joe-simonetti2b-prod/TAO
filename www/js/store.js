// Stockage local (tablette). Toutes les lectures/écritures sont protégées.
import { DEFAULT_SETTINGS, FREQUENCIES, EARS } from './config.js';

const K = {
  settings: 'tao.settings',
  calib: 'tao.calibration',
  results: 'tao.results',
  pins: 'tao.pins',
  daily: 'tao.dailycheck',
  seq: 'tao.seq',
  history: 'tao.calib.history',
  periodic: 'tao.periodic',
};

// Sel interne pour l'empreinte d'intégrité de l'étalonnage
const SEAL = 'TAO·Weave·JMS·2026';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Réglages ----------
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(K.settings, {}) };
}
export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  write(K.settings, s);
  return s;
}

// ---------- Codes PIN ----------
// Par défaut : conseiller 1234, audioprothésiste 0000 (à changer à l'installation)
export async function checkPin(role, pin) {
  const pins = read(K.pins, null);
  const h = await sha256(SEAL + role + pin);
  if (!pins || !pins[role]) {
    const def = role === 'audio' ? '0000' : '1234';
    return pin === def;
  }
  return pins[role] === h;
}
export async function setPin(role, pin) {
  const pins = read(K.pins, {}) || {};
  pins[role] = await sha256(SEAL + role + pin);
  write(K.pins, pins);
}
export function pinsAreDefault() {
  const pins = read(K.pins, {}) || {};
  return !pins.audio || !pins.advisor;
}

// ---------- Étalonnage ----------
export function emptyCalibration() {
  const ref = {};
  for (const e of EARS) { ref[e] = {}; for (const f of FREQUENCIES) ref[e][f] = null; }
  return { ref, date: null, method: null, headsetMode: null, volumeIndex: null,
           noiseRef: null, subjects: [], seal: null };
}

async function sealOf(c) {
  const core = JSON.stringify({ ref: c.ref, date: c.date, method: c.method, btName: c.btName || null,
    headsetMode: c.headsetMode, volumeIndex: c.volumeIndex });
  return sha256(SEAL + core);
}

export function getCalibrationRaw(profile = 'wired') {
  return read(profile === 'bt' ? K.calib + '.bt' : K.calib, null) || emptyCalibration();
}

// Renvoie { calib, valid, complete, reason }
export async function getCalibration(profile = 'wired') {
  const c = getCalibrationRaw(profile);
  const complete = EARS.every(e => FREQUENCIES.every(f => typeof c.ref?.[e]?.[f] === 'number'));
  if (!c.date) return { calib: c, valid: false, complete, reason: 'Aucun étalonnage enregistré' };
  const ok = c.seal && c.seal === await sealOf(c);
  if (!ok) return { calib: c, valid: false, complete, reason: 'Étalonnage altéré : test bloqué' };
  if (!complete) return { calib: c, valid: false, complete, reason: 'Étalonnage incomplet' };
  return { calib: c, valid: true, complete, reason: '' };
}

export async function saveCalibration(c, profile = 'wired') {
  c.date = c.date || new Date().toISOString();
  c.seal = await sealOf(c);
  write(profile === 'bt' ? K.calib + '.bt' : K.calib, c);
  const h = read(K.history, []) || [];
  h.push({ date: c.date, method: c.method, profile, headsetMode: c.headsetMode, volumeIndex: c.volumeIndex, btName: c.btName || null });
  write(K.history, h.slice(-50));
  return c;
}
export function getCalibrationHistory() { return read(K.history, []) || []; }

// ---------- Contrôle périodique (auditeur référent) ----------
export function getPeriodic() { return read(K.periodic, null); }
export function savePeriodic(p) { write(K.periodic, p); }

// Sauvegarde des données de travail (sujets, bruit) sans valider l'étalonnage
export function saveCalibrationDraft(c, profile = 'wired') { write(profile === 'bt' ? K.calib + '.bt' : K.calib, c); }

// ---------- Résultats ----------
export function getResults() { return read(K.results, []); }
export function nextFicheNumber() {
  const n = (read(K.seq, 0) || 0) + 1;
  write(K.seq, n);
  return n;
}
export function addResult(r) {
  const all = getResults();
  all.push(r);
  write(K.results, all);
  return r;
}
export function updateResult(id, patch) {
  const all = getResults();
  const i = all.findIndex(r => r.id === id);
  if (i >= 0) { all[i] = { ...all[i], ...patch }; write(K.results, all); return all[i]; }
  return null;
}

// ---------- Contrôle quotidien ----------
function today() { return new Date().toISOString().slice(0, 10); }
export function dailyCheckDone() {
  const d = read(K.daily, null);
  return d && d.day === today() && d.ok;
}
export function setDailyCheck(ok, advisor) {
  write(K.daily, { day: today(), ok, advisor, at: new Date().toISOString() });
}

// ---------- Export CSV ----------
export function resultsToCSV(results) {
  const head = ['fiche', 'date', 'magasin', 'conseiller', 'niveau_dBHL', 'type_son',
    ...FREQUENCIES.map(f => `OD_${f}`), ...FREQUENCIES.map(f => `OG_${f}`),
    'faux_positifs', 'fiable', 'resultat', 'oriente', 'din_srt', 'din_voix', 'din_mode'];
  const rows = results.map(r => [
    r.fiche, r.date, r.store, r.advisor, r.levelHL, r.stimulusType,
    ...FREQUENCIES.map(f => r.tone?.R?.[f]?.heard === true ? 'oui' : r.tone?.R?.[f]?.heard === false ? 'non' : ''),
    ...FREQUENCIES.map(f => r.tone?.L?.[f]?.heard === true ? 'oui' : r.tone?.L?.[f]?.heard === false ? 'non' : ''),
    r.falsePositives, r.reliable ? 'oui' : 'non', r.outcome, r.referred ? 'oui' : 'non',
    r.din?.srt ?? '', r.din?.voice ?? '', r.din ? (r.din.antiphasic ? 'antiphasique' : 'diotique') : '',
  ]);
  return [head, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
}
