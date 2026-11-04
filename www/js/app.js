// TAO – Test Auditif Optique — application
// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

import { APP, FREQUENCIES, EARS, EAR_LABEL, THEMES, LEVEL_PRESETS, EXTRA500_PRESETS,
         DURATION_PRESETS, RECAL_DAYS } from './config.js';
import * as store from './store.js';
import * as device from './device.js';
import { resume, playHL, playDbfs, playContinuous, NoiseMonitor, LevelError } from './audio.js';
import { ToneTest } from './tonetest.js';
import { DinTest, dinAvailable, dinManifest, resolveVoice } from './din.js';
import { ICONS, MASCOT, themeIcon } from './icons.js';
import { showScreen, confetti } from './fx.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SORTED_F = [...FREQUENCIES].sort((a, b) => a - b);

const S = {
  settings: store.getSettings(),
  calibInfo: null,
  advisor: null,
  test: null,
  din: null,
  current: null,
  noise: new NoiseMonitor(),
  unRoute: null,
};

// ---------------------------------------------------------------- utilitaires UI
function show(id) { showScreen(id); }
function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function overlay(html) {
  const root = $('#overlay-root');
  const o = document.createElement('div');
  o.className = 'overlay'; o.innerHTML = html;
  root.appendChild(o);
  return { el: o, close: () => o.remove() };
}

function pinPad(title = 'Code équipe') {
  return new Promise(resolve => {
    let v = '';
    const o = overlay(`<div class="card col center" style="min-width:40vw">
      <h2>${esc(title)}</h2><div class="pin-dots"></div>
      <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button class="k-del" data-k="del">⌫</button><button data-k="0">0</button><button class="k-ok" data-k="ok">OK</button></div>
      <button class="btn ghost" data-k="cancel">Annuler</button></div>`);
    const dots = $('.pin-dots', o.el);
    const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, v.length) }, (_, i) => `<i class="${i < v.length ? 'on' : ''}"></i>`).join(''); };
    draw();
    o.el.addEventListener('click', e => {
      const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
      if (k === 'cancel') { o.close(); resolve(null); }
      else if (k === 'del') { v = v.slice(0, -1); draw(); }
      else if (k === 'ok') { o.close(); resolve(v); }
      else if (v.length < 8) { v += k; draw(); }
    });
  });
}

async function staffLogin() {
  const pin = await pinPad('Code équipe');
  if (pin === null) return null;
  if (await store.checkPin('audio', pin)) return 'audio';
  if (await store.checkPin('advisor', pin)) return 'advisor';
  toast('Code incorrect');
  return null;
}

function demoFlag() {
  $('.demo-flag')?.remove();
  const c = S.calibInfo?.calib;
  const msgs = [];
  if (!device.isNative()) msgs.push('Navigateur – démonstration');
  if (c?.method === 'demo') msgs.push('Étalonnage de DÉMONSTRATION');
  if (S.settings.trialMode) msgs.push('MODE ESSAI sans casque – interdit en magasin');
  if (msgs.length) {
    const d = document.createElement('div'); d.className = 'demo-flag'; d.textContent = msgs.join(' · ');
    document.body.appendChild(d);
  }
}

// ---------------------------------------------------------------- démarrage
async function boot() {
  S.settings = store.getSettings();
  S.calibInfo = await store.getCalibration();
  $('#logo-hold').innerHTML = `${ICONS.logo}<span>${APP.name}</span>`;
  $('#attract-icons').innerHTML = SORTED_F.map(f => `<div class="ic">${themeIcon(THEMES[f].key)}</div>`).join('');
  $('#headset-ic').innerHTML = ICONS.headset;
  $('#attract-mascot').innerHTML = MASCOT.coucou;
  $('#instr-mascot').innerHTML = MASCOT.ecoute;
  $('#din-mascot').innerHTML = MASCOT.ecoute;
  $('#attract-brand').textContent = APP.brand;
  $('#attract-store').textContent = S.settings.storeName || '';
  demoFlag();
  if (S.settings.kiosk) device.startKiosk();
  goHome();
}

function blocked(title, msg) {
  $('#blocked-icon').innerHTML = MASCOT.ecoute;
  $('#blocked-title').textContent = title;
  $('#blocked-msg').textContent = msg;
  show('s-blocked');
}

async function goHome() {
  stopTestResources();
  S.current = null; S.advisor = null;
  S.calibInfo = await store.getCalibration();
  demoFlag();
  if (!S.calibInfo.valid) return blocked('Test indisponible', `${S.calibInfo.reason}. Un audioprothésiste doit étalonner la tablette et le casque.`);
  const c = S.calibInfo.calib;
  const ageDays = (Date.now() - new Date(c.date).getTime()) / 86400000;
  if (ageDays > RECAL_DAYS && c.method !== 'demo') return blocked('Étalonnage expiré', `Dernier étalonnage il y a ${Math.round(ageDays)} jours. Réétalonnage nécessaire.`);
  show('s-attract');
}

function stopTestResources() {
  try { S.test?.abort(); } catch {}
  try { S.din?.abort(); } catch {}
  S.test = null; S.din = null;
  S.noise.stop();
  S.unRoute?.(); S.unRoute = null;
  device.unlockVolume();
  device.keepAwake(false);
}

// Appui long (2 s) sur le logo → espace équipe
(function longPress() {
  let t = null;
  const el = $('#logo-hold');
  el.addEventListener('pointerdown', () => { t = setTimeout(openStaff, 2000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => clearTimeout(t)));
})();

async function openStaff() {
  const role = await staffLogin();
  if (role) openAdmin(role);
}

// ---------------------------------------------------------------- parcours client
async function startFlow() {
  await resume();
  const r = await device.audioRouteOk(!!S.settings.trialMode);
  if (!r.ok) return blocked('Vérifiez le casque', r.reason);
  const adv = S.settings.advisors || [];
  if (adv.length) {
    $('#advisor-list').innerHTML = adv.map(a => `<button class="btn secondary xl" data-act="pick-advisor" data-name="${esc(a)}">${esc(a)}</button>`).join('');
    show('s-advisor');
  } else { S.advisor = '—'; afterAdvisor(); }
}

function afterAdvisor() {
  if (S.settings.dailyCheck && !store.dailyCheckDone()) return show('s-daily');
  show('s-headset');
}

async function prepareAudio() {
  await resume();
  if (S.settings.systemVolumeIndex !== null && S.settings.systemVolumeIndex !== undefined) {
    const v = await device.lockVolume(S.settings.systemVolumeIndex);
    if (device.isNative() && !v.ok) toast('Volume non verrouillé : ' + (v.error || ''));
  }
  device.keepAwake(true);
  if (S.settings.noiseCheck && S.calibInfo.calib.noiseRef) await S.noise.start();
}

function playSafe(fn) {
  try { return fn(); }
  catch (e) { toast(e instanceof LevelError ? e.message : 'Erreur audio'); return null; }
}

async function demoSound() {
  await prepareAudio();
  const c = S.calibInfo.calib;
  const h = playSafe(() => playHL({ calib: c, freq: 1000, ear: 'R', dbHL: 45, duration: S.settings.stimulusDuration, type: S.settings.stimulusType }));
  await h?.done; await sleep(500);
  playSafe(() => playHL({ calib: c, freq: 1000, ear: 'L', dbHL: 45, duration: S.settings.stimulusDuration, type: S.settings.stimulusType }));
}

function setTrialUI(ear, freq, i) {
  const th = THEMES[freq];
  const themed = S.settings.stimulusType === 'theme';
  const ic = $('#theme-ic');
  ic.innerHTML = themed ? themeIcon(th.key) : ICONS.ear;
  ic.classList.remove('swap'); void ic.offsetWidth; ic.classList.add('swap');
  $('#theme-label').textContent = themed ? `Cherchez ${th.short}…` : 'Écoutez bien…';
  const b = $('#ear-badge'); b.className = `ear-badge ${ear}`; $('#ear-label').textContent = `Oreille ${EAR_LABEL[ear]}`;
  const k = i % FREQUENCIES.length, n = FREQUENCIES.length;
  const j = $('#journey');
  j.innerHTML = `<div class="fill"></div>` + FREQUENCIES.map((f, x) =>
    `<div class="st ${x < k ? 'done' : x === k ? 'now' : ''}">${themed ? themeIcon(THEMES[f].key) : ICONS.ear}</div>`).join('');
  requestAnimationFrame(() => { $('.fill', j).style.width = `calc((100% - 60px) * ${k / (n - 1)})`; });
}

async function runTest() {
  await prepareAudio();
  show('s-test');
  const c = S.calibInfo.calib;
  S.test = new ToneTest({
    calib: c, settings: S.settings, noise: S.noise.active ? S.noise : null, noiseRef: c.noiseRef,
    hooks: {
      onTrial: setTrialUI,
      onNoise: w => $('#noise-banner').classList.toggle('hidden', !w),
      onEarChange: async ear => {
        if (ear === EARS[0]) return;
        const m = $('#earchange-ic'); m.innerHTML = MASCOT.bravo;
        m.classList.remove('jump'); void m.offsetWidth; m.classList.add('jump');
        $('#earchange-title').textContent = `Bravo ! Passons à l'oreille ${EAR_LABEL[ear]}`;
        show('s-earchange'); confetti({ count: 70, duration: 1800 }); await sleep(2800); show('s-test');
      },
    },
  });
  S.unRoute = device.onRouteChange(st => {
    if (S.test && st && (!st.wired || st.bluetooth)) { S.test.pause(); pauseOverlay('Le casque a été débranché. Rebranchez-le pour continuer.'); }
  });
  let r;
  try { r = await S.test.run(); }
  catch (e) { toast(e instanceof LevelError ? e.message : 'Erreur pendant le test'); return goHome(); }
  if (!r || r.aborted) return;
  S.noise.stop();

  const s = S.settings;
  S.current = store.addResult({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    fiche: store.nextFicheNumber(),
    date: new Date().toISOString(),
    store: s.storeName, advisor: S.advisor,
    levelHL: s.levelHL, extra500: s.extra500, stimulusType: s.stimulusType, duration: s.stimulusDuration,
    tone: r.tone, missed: r.missed, falsePositives: r.falsePositives, reliable: r.reliable,
    outcome: r.outcome, referred: false, din: null,
    calibDate: c.date, calibMethod: c.method, headsetMode: c.headsetMode, appVersion: APP.version,
  });

  if (s.dinEnabled && r.outcome !== 'unreliable') {
    const last = store.getResults().filter(x => x.din?.voice).slice(-1)[0]?.din?.voice;
    S.dinVoice = resolveVoice(s.dinVoice || 'auto', last);
    if (await dinAvailable(S.dinVoice)) return show('s-din-intro');
  }
  showResult();
}

function pauseOverlay(msg = 'Test en pause') {
  const o = overlay(`<div class="card col center"><h2>${esc(msg)}</h2>
    <div class="row"><button class="btn action" data-k="go">Reprendre</button><button class="btn danger" data-k="stop">Arrêter le test</button></div></div>`);
  o.el.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    if (k === 'go') {
      const r = await device.audioRouteOk(!!S.settings.trialMode);
      if (!r.ok) return toast(r.reason);
      o.close(); S.test?.resume();
    } else { o.close(); goHome(); }
  });
}

function showResult() {
  const r = S.current;
  const title = $('#result-title'), msg = $('#result-msg');
  if (r.outcome === 'pass') {
    $('#result-ic').innerHTML = MASCOT.pouce;
    title.textContent = 'Bravo, voyage réussi !';
    msg.textContent = 'Vous avez repéré tous les sons du test. Un contrôle régulier de votre audition reste conseillé.';
    setTimeout(() => confetti(), 350);
  } else if (r.outcome === 'refer') {
    $('#result-ic').innerHTML = MASCOT.coucou;
    title.textContent = 'Merci pour votre participation !';
    msg.textContent = 'Certains sons vous ont échappé. Nous vous proposons un bilan auditif gratuit avec notre audioprothésiste, pour faire le point en toute tranquillité.';
  } else {
    $('#result-ic').innerHTML = ICONS.ear;
    title.textContent = 'Le test n’a pas pu aller au bout';
    msg.textContent = 'Ce n’est pas grave ! Votre conseiller va vous réexpliquer la consigne pour recommencer.';
  }
  show('s-result');
}

function resultTable(r) {
  const cell = (e, f) => {
    const x = r.tone?.[e]?.[f];
    if (!x) return '<td class="na">–</td>';
    return `<td class="${x.heard ? 'ok' : 'ko'}">${x.heard ? '✓' : '✗'}${x.noisy ? '<br><span class="tiny">bruit</span>' : ''}</td>`;
  };
  return `<table class="grid-res"><tr><th></th>${SORTED_F.map(f => `<th>${f} Hz</th>`).join('')}</tr>
    ${EARS.map(e => `<tr><th style="color:${e === 'R' ? 'var(--ear-r)' : 'var(--ear-l)'}">Oreille ${EAR_LABEL[e]}</th>${SORTED_F.map(f => cell(e, f)).join('')}</tr>`).join('')}</table>`;
}

function outcomePill(o) {
  return o === 'pass' ? '<span class="pill ok">Tous les sons perçus</span>'
    : o === 'refer' ? '<span class="pill ko">Bilan conseillé</span>'
    : '<span class="pill warn">Non fiable – à refaire</span>';
}

function showAdvisorResult() {
  const r = S.current;
  $('#ar-meta').textContent = `Fiche n° ${String(r.fiche).padStart(4, '0')} · ${new Date(r.date).toLocaleString('fr-FR')} · ${r.advisor}`;
  $('#ar-table').innerHTML = `<h3>Sons perçus à ${r.levelHL} dB HL${r.extra500 ? ` (500 Hz : ${r.levelHL + r.extra500} dB HL)` : ''}</h3>${resultTable(r)}`;
  $('#ar-side').innerHTML = `<h3>Synthèse</h3><p>${outcomePill(r.outcome)}</p>
    <p class="small">Fausses alarmes : <b>${r.falsePositives}</b> ${r.reliable ? '' : '(trop élevé)'}</p>
    ${r.din ? `<p class="small">Chiffres dans le bruit : <b>${r.din.srt} dB RSB</b> (voix ${r.din.voice}${r.din.antiphasic ? ', antiphasique' : ''})</p>` : ''}
    <p class="small soft">Sons : ${r.stimulusType === 'theme' ? 'thématiques' : 'purs pulsés'} · ${r.duration} s</p>
    <p class="small soft">Étalonnage du ${r.calibDate ? new Date(r.calibDate).toLocaleDateString('fr-FR') : '?'} (${r.calibMethod || '?'})</p>`;
  $('#btn-refer').textContent = r.referred ? 'Fiche d’orientation' : 'Orienter vers le centre audio';
  show('s-advisor-result');
}

function ficheText(r) {
  const missedBy = e => SORTED_F.filter(f => r.tone?.[e]?.[f] && !r.tone[e][f].heard);
  const line = e => { const m = missedBy(e); return m.length ? m.map(f => `${f} Hz`).join(', ') : 'aucun'; };
  const n = String(r.fiche).padStart(4, '0');
  const txt = [
    `TAO – ${APP.brand}`, `Fiche d'orientation n° ${n}`,
    `${new Date(r.date).toLocaleString('fr-FR')} – ${r.store} – Conseiller : ${r.advisor}`,
    `Dépistage à ${r.levelHL} dB HL${r.extra500 ? ` (500 Hz : ${r.levelHL + r.extra500})` : ''} – sons ${r.stimulusType === 'theme' ? 'thématiques' : 'purs pulsés'}`,
    `Sons non perçus OD : ${line('R')}`, `Sons non perçus OG : ${line('L')}`,
    r.din ? `Chiffres dans le bruit : ${r.din.srt} dB RSB (voix ${r.din.voice}${r.din.antiphasic ? ', antiphasique' : ''})` : null,
    `Fiabilité : ${r.reliable ? 'bonne' : 'à vérifier'} (${r.falsePositives} fausse(s) alarme(s))`,
    `Étalonnage du ${r.calibDate ? new Date(r.calibDate).toLocaleDateString('fr-FR') : '?'} – TAO v${r.appVersion || APP.version}`,
    `À présenter à l'audioprothésiste. Test de sensibilisation, ne constitue pas un examen médical.`,
  ].filter(Boolean).join('\n');
  return { n, line, txt };
}

function qrSVG(text) {
  try {
    const q = window.qrcode(0, 'M');
    window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
    q.addData(text, 'Byte'); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch { return ''; }
}

function showFiche() {
  const r = S.current;
  const { n, line, txt } = ficheText(r);
  $('#fiche-card').innerHTML = `
    <div class="row"><div class="logo">${ICONS.logo}<span>${APP.name} · ${esc(APP.brand)}</span></div><div class="spacer"></div>
      <h2>Fiche d'orientation n° ${n}</h2></div>
    <div class="fiche-grid">
      <div class="col">
        <p>${new Date(r.date).toLocaleString('fr-FR')} · ${esc(r.store)} · Conseiller : ${esc(r.advisor)}</p>
        <div class="card" style="box-shadow:none;border:2px solid var(--line)">
          <p><b>Sons non perçus</b> (niveau de dépistage ${r.levelHL} dB HL)</p>
          <p><b style="color:var(--ear-r)">Oreille droite :</b> ${line('R')}</p>
          <p><b style="color:var(--ear-l)">Oreille gauche :</b> ${line('L')}</p>
          ${r.din ? `<p><b>Compréhension dans le bruit :</b> ${r.din.srt} dB RSB</p>` : ''}
        </div>
        <p style="font-size:1.05em"><b>Votre audioprothésiste vous attend pour un bilan auditif gratuit.</b></p>
      </div>
      <div class="col center qr-box">
        <div class="qr">${qrSVG(txt)}</div>
        <p class="small center"><b>Prenez ce code en photo</b><br>et présentez-le au centre audio</p>
      </div>
    </div>
    <p class="legal">Test de sensibilisation réalisé en magasin d'optique. Ce document n'est pas un examen médical et ne remplace pas un bilan auditif réalisé par un audioprothésiste. Aucune donnée personnelle n'est enregistrée.</p>`;
  show('s-fiche');
}

// ---------------------------------------------------------------- chiffres dans le bruit
async function runDin() {
  show('s-din');
  const pad = $('#din-pad');
  pad.innerHTML = [1,2,3,4,5,6,7,8,9].map(n => `<button data-d="${n}">${n}</button>`).join('') +
    '<button class="k-del" data-d="del">⌫</button><button data-d="0">0</button><button class="k-ok" data-d="ok">OK</button>';
  let resolver = null, typed = '';
  const slots = $$('#din-slots span');
  const draw = () => slots.forEach((sp, i) => {
    const v = typed[i] || '';
    if (sp.textContent !== v) { sp.textContent = v; sp.classList.toggle('on', !!v); }
  });
  pad.onclick = e => {
    const d = e.target.closest('[data-d]')?.dataset.d; if (!d || !resolver) return;
    if (d === 'del') typed = typed.slice(0, -1);
    else if (d === 'ok') { if (typed.length === 3) { const r = resolver; resolver = null; r(typed); } return; }
    else if (typed.length < 3) typed += d;
    draw();
  };
  S.din = new DinTest({
    calib: S.calibInfo.calib, voice: S.dinVoice || 'homme', antiphasic: !!S.settings.dinAntiphasic,
    hooks: {
      onTriplet: (i, n, practice) => {
        $('#din-progress').textContent = practice ? `Essai ${i + 1} / ${n}` : `${i + 1} / ${n}`;
        $('#din-bar').style.width = practice ? '0%' : `${(i / n) * 100}%`;
        typed = ''; draw(); $('#din-title').textContent = 'Écoutez…'; $('#din-hint').textContent = 'Écoutez les 3 chiffres…';
      },
      onListen: on => $('#din-listen').classList.toggle('idle', !on),
      askAnswer: () => new Promise(res => {
        typed = ''; draw(); $('#din-title').textContent = 'À vous !';
        $('#din-hint').textContent = 'Tapez les 3 chiffres dans l\u2019ordre, puis OK'; resolver = res;
      }),
    },
  });
  let r;
  try { r = await S.din.run(); } catch { toast('Module chiffres indisponible'); return showResult(); }
  if (r.aborted) return;
  const outcome = (S.current.outcome === 'pass' && r.srt > (S.settings.dinReferSrt ?? -7)) ? 'refer' : S.current.outcome;
  S.current = store.updateResult(S.current.id, { din: r, outcome });
  showResult();
}

// ---------------------------------------------------------------- actions globales
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  switch (a) {
    case 'start': return startFlow();
    case 'home': return goHome();
    case 'retry': return goHome();
    case 'staff': return openStaff();
    case 'pick-advisor': S.advisor = b.dataset.name; return afterAdvisor();
    case 'daily-play': {
      await resume(); await prepareAudio();
      playSafe(() => playHL({ calib: S.calibInfo.calib, freq: 1000, ear: b.dataset.ear, dbHL: 40, duration: 1.5, type: 'pulsed' }));
      return;
    }
    case 'daily-ok': store.setDailyCheck(true, S.advisor); return show('s-headset');
    case 'daily-ko': store.setDailyCheck(false, S.advisor);
      return blocked('Contrôle du jour non conforme', 'Vérifiez le branchement du casque et les réglages de la tablette, puis prévenez l’audioprothésiste.');
    case 'headset-done': return show('s-instructions');
    case 'demo': return demoSound();
    case 'begin': return runTest();
    case 'pause': S.test?.pause(); return pauseOverlay();
    case 'to-advisor': {
      const role = await staffLogin(); if (!role) return;
      return showAdvisorResult();
    }
    case 'refer':
      if (!S.current.referred) S.current = store.updateResult(S.current.id, { referred: true, referredAt: new Date().toISOString() });
      return showFiche();
    case 'retest': show('s-headset'); return;
    case 'finish': return goHome();
    case 'din-start': return runDin();
    case 'din-skip': return showResult();
  }
});

// Bouton « J'entends » : pointerdown pour une latence minimale
$('#hear-btn').addEventListener('pointerdown', e => {
  e.preventDefault();
  S.test?.press();
  const b = e.currentTarget; b.classList.add('press');
  setTimeout(() => b.classList.remove('press'), 140);
});

// ================================================================ ADMINISTRATION
const TABS_AUDIO = [
  ['settings', 'Réglages du test'], ['calib', 'Étalonnage'], ['hardware', 'Matériel'],
  ['team', 'Magasin et équipe'], ['results', 'Résultats'], ['guide', 'Guide conseiller'], ['about', 'À propos'],
  ['quit', '← Retour au test'], ['exit', '⏻ Quitter l\u2019application'],
];
const TABS_ADVISOR = [['today', 'Aujourd’hui'], ['guide', 'Guide conseiller'], ['quit', '← Retour au test']];
let ADMIN = { role: null, tab: null, draft: null, bio: null, slm: null, cont: null };

function openAdmin(role) {
  ADMIN = { role, tab: role === 'audio' ? 'settings' : 'today', draft: null, bio: { ear: 'R', freq: 1000, level: -60, subject: 0 },
            slm: { ear: 'R', freq: 1000, dbfs: -30 }, cont: null };
  ADMIN.draft = JSON.parse(JSON.stringify(store.getCalibrationRaw()));
  show('s-admin');
  renderAdmin();
}

function renderAdmin() {
  const tabs = ADMIN.role === 'audio' ? TABS_AUDIO : TABS_ADVISOR;
  $('#admin-nav').innerHTML = `<div class="logo" style="color:#fff;margin-bottom:2vh">${ICONS.logo}<span>${APP.name}</span></div>` +
    tabs.map(([k, l]) => `<button data-tab="${k}" class="${ADMIN.tab === k ? 'on' : ''}">${l}</button>`).join('') +
    `<div class="spacer"></div><p class="tiny" style="color:#8FA3B8">${ADMIN.role === 'audio' ? 'Audioprothésiste' : 'Conseiller'} · v${APP.version}</p>`;
  const m = $('#admin-main');
  const fn = { settings: tabSettings, calib: tabCalib, hardware: tabHardware, team: tabTeam,
               results: tabResults, about: tabAbout, today: tabToday, guide: tabGuide }[ADMIN.tab];
  m.innerHTML = '';
  fn?.(m);
}

$('#admin-nav').addEventListener('click', e => {
  const k = e.target.closest('[data-tab]')?.dataset.tab; if (!k) return;
  ADMIN.cont?.stop(); ADMIN.cont = null;
  if (k === 'quit') { device.unlockVolume(); S.noise.stop(); return goHome(); }
  if (k === 'exit') { return confirmExit(); }
  ADMIN.tab = k; renderAdmin();
});

function seg(name, options, current, labelFn = v => v) {
  return `<div class="seg" data-seg="${name}">${options.map(o => `<button data-v="${o}" class="${String(o) === String(current) ? 'on' : ''}">${labelFn(o)}</button>`).join('')}</div>`;
}
function bindSeg(root, name, cb) {
  const el = $(`[data-seg="${name}"]`, root); if (!el) return;
  el.addEventListener('click', e => {
    const v = e.target.closest('[data-v]')?.dataset.v; if (v === undefined) return;
    $$('button', el).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    cb(v);
  });
}
function saveSet(patch, msg = 'Réglage enregistré') { S.settings = store.saveSettings(patch); toast(msg); }

// ---------- Réglages du test
function tabSettings(m) {
  const s = S.settings;
  m.innerHTML = `<h2>Réglages du test</h2>
    <p class="soft small" style="margin-bottom:1.5em">Ces réglages sont verrouillés derrière le code audioprothésiste. Chaque test enregistre les réglages utilisés.</p>
    <div class="field"><label>Niveau de dépistage</label>${seg('level', LEVEL_PRESETS, s.levelHL, v => `${v} dB HL`)}</div>
    <div class="field"><label>Majoration à 500 Hz (bruit ambiant)</label>${seg('extra500', EXTRA500_PRESETS, s.extra500, v => `+${v} dB`)}
      <span class="soft small">Niveau effectif à 500 Hz : <b id="eff500">${s.levelHL + s.extra500}</b> dB HL</span></div>
    <div class="field"><label>Type de son</label>${seg('stype', ['theme', 'pulsed'], s.stimulusType, v => v === 'theme' ? 'Sons thématiques' : 'Son pur pulsé')}</div>
    <div class="field"><label>Durée de chaque son</label>${seg('dur', DURATION_PRESETS, s.stimulusDuration, v => `${String(v).replace('.', ',')} s`)}</div>
    <div class="field"><label>Essais muets (détection des réponses au hasard)</label>${seg('catch', [2, 3, 4], s.catchTrials)}</div>
    <div class="field"><label>Contrôle du bruit ambiant (micro)</label>${seg('noise', ['on', 'off'], s.noiseCheck ? 'on' : 'off', v => v === 'on' ? 'Activé' : 'Désactivé')}
      <span class="soft small">Tolérance au-dessus du bruit de référence :</span>${seg('margin', [10, 15, 20], s.noiseMarginDb, v => `${v} dB`)}</div>
    <div class="field"><label>Contrôle d'écoute quotidien par le conseiller</label>${seg('daily', ['on', 'off'], s.dailyCheck ? 'on' : 'off', v => v === 'on' ? 'Obligatoire' : 'Désactivé')}</div>
    <div class="field"><label>Module « chiffres dans le bruit »</label>${seg('din', ['on', 'off'], s.dinEnabled ? 'on' : 'off', v => v === 'on' ? 'Activé' : 'Désactivé')}
      ${seg('dinmode', ['diotic', 'anti'], s.dinAntiphasic ? 'anti' : 'diotic', v => v === 'anti' ? 'Antiphasique' : 'Diotique')}
      ${seg('dinvoice', ['homme', 'femme', 'auto'], s.dinVoice || 'auto', v => ({ homme: 'Voix d\u2019homme', femme: 'Voix de femme', auto: 'Alterner' }[v]))}
      <span class="soft small">Seuil d'orientation (RSB, à valider) : <input type="number" step="0.5" id="din-cut" value="${s.dinReferSrt ?? -7}" style="width:7em"> dB</span></div>`;
  bindSeg(m, 'level', v => { saveSet({ levelHL: +v }); $('#eff500').textContent = S.settings.levelHL + S.settings.extra500; });
  bindSeg(m, 'extra500', v => { saveSet({ extra500: +v }); $('#eff500').textContent = S.settings.levelHL + S.settings.extra500; });
  bindSeg(m, 'stype', v => saveSet({ stimulusType: v }));
  bindSeg(m, 'dur', v => saveSet({ stimulusDuration: +v }));
  bindSeg(m, 'catch', v => saveSet({ catchTrials: +v }));
  bindSeg(m, 'noise', v => saveSet({ noiseCheck: v === 'on' }));
  bindSeg(m, 'margin', v => saveSet({ noiseMarginDb: +v }));
  bindSeg(m, 'daily', v => saveSet({ dailyCheck: v === 'on' }));
  bindSeg(m, 'din', v => saveSet({ dinEnabled: v === 'on' }));
  bindSeg(m, 'dinmode', v => saveSet({ dinAntiphasic: v === 'anti' }));
  bindSeg(m, 'dinvoice', v => saveSet({ dinVoice: v }));
  $('#din-cut', m).addEventListener('change', e => saveSet({ dinReferSrt: +e.target.value }));
}

// ---------- Étalonnage
function calibStatusHTML(info) {
  const c = info.calib;
  return `<div class="card" style="box-shadow:none;border:2px solid var(--line);margin-bottom:1.5em">
    <p>${info.valid ? '<span class="pill ok">Étalonnage valide</span>' : `<span class="pill ko">${esc(info.reason)}</span>`}
    ${c.method === 'demo' ? ' <span class="pill warn">DÉMONSTRATION – interdit en magasin</span>' : ''}</p>
    <p class="small soft" style="margin-top:.5em">Date : ${c.date ? new Date(c.date).toLocaleString('fr-FR') : '—'} · Méthode : ${c.method || '—'} ·
      Casque : ${c.headsetMode === 'passive' ? 'éteint (filaire passif)' : c.headsetMode === 'anc' ? 'allumé + réduction de bruit' : '—'} · Cran volume : ${c.volumeIndex ?? '—'}</p></div>`;
}

function refTable(d) {
  return `<table class="t"><tr><th>Réf. 0 dB HL (dBFS)</th>${SORTED_F.map(f => `<th>${f} Hz</th>`).join('')}</tr>
    ${EARS.map(e => `<tr><th style="color:${e === 'R' ? 'var(--ear-r)' : 'var(--ear-l)'}">${EAR_LABEL[e]}</th>${SORTED_F.map(f => {
      const v = d.ref?.[e]?.[f]; return `<td>${typeof v === 'number' ? v.toFixed(1) : '—'}</td>`; }).join('')}</tr>`).join('')}</table>`;
}

async function tabCalib(m) {
  const info = await store.getCalibration();
  const d = ADMIN.draft;
  ADMIN.sub = ADMIN.sub || 'bio';
  if (S.settings.systemVolumeIndex !== null && S.settings.systemVolumeIndex !== undefined) device.lockVolume(S.settings.systemVolumeIndex);
  m.innerHTML = `<h2>Étalonnage</h2>${calibStatusHTML(info)}
    <div class="field"><label>Mode du casque pendant l'étalonnage (doit rester identique en magasin)</label>
      ${seg('hmode', ['passive', 'anc'], d.headsetMode || '', v => v === 'passive' ? 'Éteint – filaire passif' : 'Allumé + réduction de bruit')}</div>
    <div class="row wrap" style="margin-bottom:1.2em">${seg('sub', ['bio', 'slm', 'noise', 'demo'], ADMIN.sub,
      v => ({ bio: 'Biologique', slm: 'Sonomètre', noise: 'Bruit de référence', demo: 'Démonstration' }[v]))}</div>
    <div id="calib-sub"></div>
    <h3 style="margin-top:1.5em">Table en cours (brouillon)</h3>${refTable(d)}
    <div class="row" style="margin-top:1.2em">
      <button class="btn action" id="calib-save">Valider et sceller l'étalonnage</button>
      <button class="btn ghost" id="calib-reset">Repartir de l'étalonnage enregistré</button></div>`;
  bindSeg(m, 'hmode', v => { d.headsetMode = v; store.saveCalibrationDraft(d); });
  bindSeg(m, 'sub', v => { ADMIN.cont?.stop(); ADMIN.cont = null; ADMIN.sub = v; renderCalibSub($('#calib-sub', m)); });
  renderCalibSub($('#calib-sub', m));
  $('#calib-save', m).onclick = async () => {
    const complete = EARS.every(e => FREQUENCIES.every(f => typeof d.ref[e][f] === 'number'));
    if (!complete) return toast('Table incomplète : toutes les fréquences des deux oreilles sont nécessaires');
    if (!d.headsetMode && d.method !== 'demo') return toast('Indiquez le mode du casque');
    d.date = new Date().toISOString();
    d.volumeIndex = S.settings.systemVolumeIndex ?? null;
    await store.saveCalibration(d);
    toast('Étalonnage scellé');
    renderAdmin();
  };
  $('#calib-reset', m).onclick = () => { ADMIN.draft = JSON.parse(JSON.stringify(store.getCalibrationRaw())); renderAdmin(); };
}

function renderCalibSub(el) {
  const d = ADMIN.draft;
  if (ADMIN.sub === 'bio') {
    const b = ADMIN.bio;
    d.subjects = d.subjects || [];
    if (!d.subjects.length) d.subjects.push({ name: 'Sujet 1', th: { R: {}, L: {} } });
    b.subject = Math.min(b.subject, d.subjects.length - 1);
    const sub = d.subjects[b.subject];
    el.innerHTML = `<p class="soft small">Sujet jeune, normo-entendant, au calme. Méthode ascendante : descendre de 10 dB après une réponse, remonter de 5 dB sans réponse ; seuil = plus faible niveau perçu 2 fois sur 3 en montée. Le son joué est exactement celui du test.</p>
      <div class="row wrap" style="margin:1em 0">${seg('subj', d.subjects.map((_, i) => i), b.subject, i => esc(d.subjects[i].name))}
        <button class="btn small secondary" id="subj-add">+ Sujet</button></div>
      <div class="row wrap">${seg('bear', EARS, b.ear, e => `Oreille ${EAR_LABEL[e]}`)} ${seg('bfreq', SORTED_F, b.freq, f => `${f} Hz`)}</div>
      <div class="row" style="margin:1.2em 0;gap:2vw">
        <div class="col center"><span class="soft small">Niveau (dBFS)</span><span class="level-readout" id="blevel">${b.level}</span></div>
        <div class="row wrap">${[-10, -5, -2, 2, 5, 10].map(s => `<button class="btn small secondary" data-step="${s}">${s > 0 ? '+' : ''}${s}</button>`).join('')}</div>
        <button class="btn" id="bplay">▶ Jouer</button>
        <button class="btn action" id="bsave">Enregistrer le seuil</button></div>
      <table class="t" id="bth"></table>
      <div class="row" style="margin-top:1em"><button class="btn secondary" id="bmean">Calculer la référence (moyenne des sujets)</button></div>`;
    const drawTh = () => {
      $('#bth', el).innerHTML = `<tr><th>Seuils (dBFS)</th>${SORTED_F.map(f => `<th>${f}</th>`).join('')}</tr>` +
        d.subjects.map(sj => EARS.map(e => `<tr><td>${esc(sj.name)} · ${e === 'R' ? 'OD' : 'OG'}</td>${SORTED_F.map(f => `<td>${sj.th?.[e]?.[f] ?? '—'}</td>`).join('')}</tr>`).join('')).join('');
    };
    drawTh();
    bindSeg(el, 'subj', v => { b.subject = +v; renderCalibSub(el); });
    bindSeg(el, 'bear', v => { b.ear = v; });
    bindSeg(el, 'bfreq', v => { b.freq = +v; });
    $('#subj-add', el).onclick = () => { d.subjects.push({ name: `Sujet ${d.subjects.length + 1}`, th: { R: {}, L: {} } }); b.subject = d.subjects.length - 1; store.saveCalibrationDraft(d); renderCalibSub(el); };
    $$('[data-step]', el).forEach(x => x.onclick = () => { b.level = Math.min(-3, Math.max(-130, b.level + +x.dataset.step)); $('#blevel', el).textContent = b.level; });
    $('#bplay', el).onclick = async () => { await resume(); playSafe(() => playDbfs({ freq: b.freq, ear: b.ear, dbfs: b.level, duration: S.settings.stimulusDuration, type: S.settings.stimulusType })); };
    $('#bsave', el).onclick = () => { sub.th[b.ear][b.freq] = b.level; store.saveCalibrationDraft(d); drawTh(); toast(`Seuil ${b.freq} Hz ${b.ear === 'R' ? 'OD' : 'OG'} : ${b.level} dBFS`); };
    $('#bmean', el).onclick = () => {
      let n = 0;
      for (const e of EARS) for (const f of FREQUENCIES) {
        const vals = d.subjects.map(sj => sj.th?.[e]?.[f]).filter(v => typeof v === 'number');
        if (vals.length) { d.ref[e][f] = Math.round(vals.reduce((a, c) => a + c, 0) / vals.length * 10) / 10; n++; }
      }
      d.method = d.method === 'slm' ? 'mixte' : 'biologique';
      d.stimulusType = S.settings.stimulusType;
      store.saveCalibrationDraft(d);
      toast(`${n} valeurs calculées`); renderAdmin();
    };
  }
  else if (ADMIN.sub === 'slm') {
    const sl = ADMIN.slm;
    const ret = S.settings.retspl || {};
    el.innerHTML = `<p class="soft small">Son pur continu sur le coupleur / oreille artificielle. Référence 0 dB HL = niveau dBFS − (mesure dB SPL − RETSPL). Les RETSPL du casque sont à renseigner par l'audioprothésiste.</p>
      <div class="row wrap" style="margin:1em 0">${seg('sear', EARS, sl.ear, e => `Oreille ${EAR_LABEL[e]}`)} ${seg('sfreq', SORTED_F, sl.freq, f => `${f} Hz`)}</div>
      <div class="row wrap" style="gap:2vw">
        <div class="field"><label>Niveau joué (dBFS)</label><input type="number" id="sdbfs" value="${sl.dbfs}" step="1" max="-3"></div>
        <button class="btn" id="splay">▶ Son continu</button>
        <div class="field"><label>Mesure (dB SPL)</label><input type="number" id="sspl" step="0.1"></div>
        <div class="field"><label>RETSPL ${sl.freq} Hz (dB SPL)</label><input type="number" id="sret" step="0.1" value="${ret[sl.freq] ?? ''}"></div>
        <button class="btn action" id="scalc">Calculer</button></div>`;
    bindSeg(el, 'sear', v => { sl.ear = v; ADMIN.cont?.stop(); ADMIN.cont = null; renderCalibSub(el); });
    bindSeg(el, 'sfreq', v => { sl.freq = +v; ADMIN.cont?.stop(); ADMIN.cont = null; renderCalibSub(el); });
    $('#sdbfs', el).onchange = e => { sl.dbfs = Math.min(-3, +e.target.value); ADMIN.cont?.setDbfs(sl.dbfs); };
    $('#splay', el).onclick = async () => {
      await resume();
      if (ADMIN.cont) { ADMIN.cont.stop(); ADMIN.cont = null; $('#splay', el).textContent = '▶ Son continu'; return; }
      ADMIN.cont = playSafe(() => playContinuous({ freq: sl.freq, ear: sl.ear, dbfs: sl.dbfs }));
      if (ADMIN.cont) $('#splay', el).textContent = '■ Arrêter';
    };
    $('#scalc', el).onclick = () => {
      const spl = parseFloat($('#sspl', el).value), rt = parseFloat($('#sret', el).value);
      if (isNaN(spl) || isNaN(rt)) return toast('Renseignez la mesure et le RETSPL');
      S.settings = store.saveSettings({ retspl: { ...(S.settings.retspl || {}), [sl.freq]: rt } });
      d.ref[sl.ear][sl.freq] = Math.round((sl.dbfs - (spl - rt)) * 10) / 10;
      d.method = d.method === 'biologique' ? 'mixte' : 'slm';
      store.saveCalibrationDraft(d); toast('Référence calculée'); renderAdmin();
    };
  }
  else if (ADMIN.sub === 'noise') {
    el.innerHTML = `<p class="soft small">À faire dans le magasin, au moment le plus calme, tablette à son emplacement habituel. Sert de référence pour le contrôle du bruit pendant les tests.</p>
      <div class="row" style="margin:1em 0"><button class="btn" id="nmeas">Mesurer le bruit de référence (5 s)</button></div>
      <div id="nres">${d.noiseRef ? noiseTable(d.noiseRef) : '<p class="soft">Aucune référence.</p>'}</div>`;
    $('#nmeas', el).onclick = async () => {
      await resume();
      if (!await S.noise.start()) return toast('Micro indisponible (autorisation refusée ?)');
      $('#nmeas', el).disabled = true; $('#nmeas', el).textContent = 'Mesure en cours…';
      d.noiseRef = await S.noise.average(FREQUENCIES, 5000);
      S.noise.stop(); store.saveCalibrationDraft(d);
      // la référence de bruit est aussi appliquée à l'étalonnage scellé sans le rompre
      const raw = store.getCalibrationRaw(); raw.noiseRef = d.noiseRef; store.saveCalibrationDraft(raw);
      renderCalibSub(el);
    };
  }
  else if (ADMIN.sub === 'demo') {
    el.innerHTML = `<p class="soft small">Charge des valeurs fictives pour tester l'interface (navigateur, présentation). <b>Ne jamais utiliser en magasin</b> : un bandeau « démonstration » reste affiché.</p>
      <button class="btn danger" id="ddemo" style="margin-top:1em">Charger un étalonnage de démonstration</button>`;
    $('#ddemo', el).onclick = async () => {
      for (const e of EARS) for (const f of FREQUENCIES) d.ref[e][f] = -72;
      d.method = 'demo'; d.headsetMode = d.headsetMode || 'passive';
      d.date = new Date().toISOString(); d.volumeIndex = S.settings.systemVolumeIndex ?? null;
      await store.saveCalibration(d); toast('Étalonnage de démonstration chargé'); renderAdmin();
    };
  }
}

function noiseTable(n) {
  return `<table class="t"><tr><th>Bande</th>${SORTED_F.map(f => `<th>${f} Hz</th>`).join('')}</tr>
    <tr><td>Référence (dB rel.)</td>${SORTED_F.map(f => `<td>${typeof n[f] === 'number' ? n[f].toFixed(1) : '—'}</td>`).join('')}</tr></table>`;
}

// ---------- Matériel
async function tabHardware(m) {
  const st = await device.getStatus();
  const s = S.settings;
  m.innerHTML = `<h2>Matériel</h2>
    <div class="card" style="box-shadow:none;border:2px solid var(--line);margin-bottom:1.5em">
      <p>Module natif : ${st.native ? '<span class="pill ok">actif</span>' : '<span class="pill warn">absent (navigateur)</span>'}</p>
      <p class="small" style="margin-top:.5em">Sortie audio : <b>${esc(st.route)}</b> · Casque filaire : ${st.wired === null ? '?' : st.wired ? 'oui' : 'non'} · Bluetooth audio : ${st.bluetooth === null ? '?' : st.bluetooth ? 'OUI (à couper)' : 'non'}</p>
      <p class="small">Volume média : ${st.volumeIndex ?? '?'} / ${st.volumeMax ?? '?'}</p></div>
    <div class="field"><label>Cran de volume média verrouillé pendant le test et l'étalonnage</label>
      <div class="row"><input type="number" id="vidx" min="0" max="${st.volumeMax ?? 15}" value="${s.systemVolumeIndex ?? ''}" style="width:7em">
      <button class="btn small" id="vset">Fixer et verrouiller</button>
      <button class="btn small secondary" id="vfree">Déverrouiller</button></div>
      <span class="soft small">Choisir un cran sous le seuil d'avertissement « volume élevé » d'Android. Changer ce cran impose un réétalonnage.</span></div>
    <div class="field"><label>Verrouillage de la tablette (kiosque)</label>
      ${seg('kiosk', ['on', 'off'], s.kiosk ? 'on' : 'off', v => v === 'on' ? 'Activé' : 'Désactivé')}
      <p class="small">Statut : ${st.deviceOwner ? '<span class="pill ok">TAO propriétaire de l\u2019appareil – verrouillage complet</span>' : '<span class="pill warn">Épinglage simple (contournable)</span>'} ${st.kiosk ? '<span class="pill ok">verrouillé</span>' : ''}</p>
      <span class="soft small">${st.deviceOwner ? 'Barres système, accueil et applis récentes désactivés ; la tablette redémarre directement dans TAO. Seul l\u2019administrateur peut quitter (menu « Quitter l\u2019application »).' : 'Pour un verrouillage complet : réinitialiser la tablette sans compte Google, puis depuis un PC : <code>adb shell dpm set-device-owner fr.weave.tao/.TaoAdminReceiver</code>'}</span>
      ${st.deviceOwner ? '<div class="row" style="margin-top:.6em"><button class="btn small danger" id="kown">Retirer le statut propriétaire</button></div>' : ''}</div>
    <div class="field"><label>Mode essai (téléphone, sans casque filaire)</label>
      ${seg('trial', ['on', 'off'], s.trialMode ? 'on' : 'off', v => v === 'on' ? 'Activé' : 'Désactivé')}
      <span class="soft small">Pour tester le fonctionnement sur un téléphone ou avec le haut-parleur. Un bandeau reste affiché. <b>Interdit pour un vrai dépistage.</b></span></div>
    <h3>Check-list d'installation de la tablette</h3>
    <ul class="small">
      <li>Dolby Atmos : désactivé (Paramètres › Sons et vibrations › Qualité et effets sonores)</li>
      <li>Égaliseur : « Normal » · UHQ upscaler : désactivé · Adapt Sound : désactivé</li>
      <li>Son séparé des applications : désactivé · Bluetooth : désactivé</li>
      <li>Mises à jour automatiques et notifications sonores : désactivées</li>
      <li>Casque Sony WH-CH720N branché en jack, dans le mode choisi à l'étalonnage · une paire tablette + casque étiquetée</li>
    </ul>`;
  $('#vset', m).onclick = async () => {
    const v = parseInt($('#vidx', m).value, 10);
    if (isNaN(v)) return toast('Cran invalide');
    if (s.systemVolumeIndex !== v && S.calibInfo?.valid) toast('Attention : cran modifié, réétalonnage nécessaire', 3500);
    saveSet({ systemVolumeIndex: v });
    const r = await device.lockVolume(v);
    toast(r.ok ? `Volume verrouillé au cran ${r.index ?? v}` : 'Verrouillage impossible hors tablette');
    renderAdmin();
  };
  $('#vfree', m).onclick = () => { device.unlockVolume(); toast('Volume déverrouillé'); };
  bindSeg(m, 'kiosk', async v => {
    saveSet({ kiosk: v === 'on' });
    if (v === 'on') { const r = await device.startKiosk(); toast(r.deviceOwner ? 'Tablette verrouillée' : 'Épinglage activé (verrouillage simple)'); }
    else { await device.stopKiosk(); toast('Verrouillage désactivé'); }
    setTimeout(renderAdmin, 600);
  });
  bindSeg(m, 'trial', v => { saveSet({ trialMode: v === 'on' }); demoFlag(); });
  const kown = $('#kown', m);
  if (kown) kown.onclick = async () => {
    const r = await device.releaseDeviceOwner();
    toast(r.ok && !r.deviceOwner ? 'Statut propriétaire retiré : TAO peut être désinstallée' : 'Échec : ' + (r.error || ''));
    saveSet({ kiosk: false }); renderAdmin();
  };
}

// ---------- Magasin et équipe
function tabTeam(m) {
  const s = S.settings;
  m.innerHTML = `<h2>Magasin et équipe</h2>
    <div class="field"><label>Nom du magasin</label><input type="text" id="tstore" value="${esc(s.storeName)}"></div>
    <div class="field"><label>Conseillers (traçabilité des orientations)</label>
      <div class="row wrap" id="tadv">${(s.advisors || []).map((a, i) => `<span class="pill ok">${esc(a)} <button class="btn ghost small" data-rm="${i}" style="min-height:0;padding:0 .3em">✕</button></span>`).join('') || '<span class="soft">Aucun</span>'}</div>
      <div class="row"><input type="text" id="tnew" placeholder="Prénom Nom"><button class="btn small" id="tadd">Ajouter</button></div></div>
    <div class="field"><label>Codes</label>
      ${store.pinsAreDefault() ? '<span class="pill ko">Codes par défaut encore actifs : changez-les</span>' : ''}
      <div class="row"><button class="btn small secondary" id="pin-adv">Changer le code conseiller</button>
      <button class="btn small secondary" id="pin-audio">Changer le code audioprothésiste</button></div></div>`;
  $('#tstore', m).onchange = e => saveSet({ storeName: e.target.value.trim() });
  $('#tadd', m).onclick = () => { const v = $('#tnew', m).value.trim(); if (!v) return; saveSet({ advisors: [...(s.advisors || []), v] }, 'Conseiller ajouté'); renderAdmin(); };
  $$('[data-rm]', m).forEach(b => b.onclick = () => { const a = [...s.advisors]; a.splice(+b.dataset.rm, 1); saveSet({ advisors: a }, 'Conseiller retiré'); renderAdmin(); });
  const change = async role => {
    const a = await pinPad('Nouveau code (4 à 8 chiffres)'); if (!a || a.length < 4) return toast('Code trop court');
    const b = await pinPad('Confirmez le code'); if (a !== b) return toast('Les codes ne correspondent pas');
    await store.setPin(role, a); toast('Code modifié'); renderAdmin();
  };
  $('#pin-adv', m).onclick = () => change('advisor');
  $('#pin-audio', m).onclick = () => change('audio');
}

// ---------- Résultats
function statsHTML(list) {
  const n = list.length, ref = list.filter(r => r.outcome === 'refer').length, ori = list.filter(r => r.referred).length;
  const unrel = list.filter(r => r.outcome === 'unreliable').length;
  return `<div class="row wrap" style="gap:1.5vw;margin-bottom:1.2em">
    <div class="card"><p class="soft small">Tests</p><p class="level-readout">${n}</p></div>
    <div class="card"><p class="soft small">Bilan conseillé</p><p class="level-readout">${ref}${n ? ` <span class="small soft">(${Math.round(ref / n * 100)} %)</span>` : ''}</p></div>
    <div class="card"><p class="soft small">Orientés (fiche remise)</p><p class="level-readout">${ori}</p></div>
    <div class="card"><p class="soft small">Non fiables</p><p class="level-readout">${unrel}</p></div></div>`;
}
function resultsList(list) {
  return `<table class="t"><tr><th>Fiche</th><th>Date</th><th>Conseiller</th><th>Résultat</th><th>Orienté</th><th>Non perçus</th></tr>
    ${list.slice().reverse().slice(0, 50).map(r => `<tr><td>${String(r.fiche).padStart(4, '0')}</td><td>${new Date(r.date).toLocaleString('fr-FR')}</td>
      <td>${esc(r.advisor)}</td><td>${outcomePill(r.outcome)}</td><td>${r.referred ? 'oui' : '—'}</td>
      <td class="small">${(r.missed || []).map(x => `${x.ear === 'R' ? 'OD' : 'OG'} ${x.freq}`).join(', ') || '—'}</td></tr>`).join('')}</table>`;
}
function tabResults(m) {
  const all = store.getResults();
  const byAdv = {};
  for (const r of all) { const k = r.advisor || '—'; byAdv[k] = byAdv[k] || { n: 0, o: 0 }; byAdv[k].n++; if (r.referred) byAdv[k].o++; }
  m.innerHTML = `<h2>Résultats</h2>${statsHTML(all)}
    <h3>Par conseiller</h3><table class="t" style="margin-bottom:1.2em"><tr><th>Conseiller</th><th>Tests</th><th>Orientations</th></tr>
      ${Object.entries(byAdv).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${v.o}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</table>
    <h3>Derniers tests</h3>${resultsList(all)}
    <h3 style="margin-top:1.2em">Export (CSV, séparateur ;)</h3>
    <div class="row"><button class="btn small" id="rexp">Générer l'export</button></div>
    <textarea id="rcsv" class="hidden" readonly></textarea>`;
  $('#rexp', m).onclick = () => {
    const csv = store.resultsToCSV(all);
    const ta = $('#rcsv', m); ta.value = csv; ta.classList.remove('hidden'); ta.select();
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `tao_resultats_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    } catch {}
  };
}
function tabToday(m) {
  const d = new Date().toISOString().slice(0, 10);
  const list = store.getResults().filter(r => r.date.slice(0, 10) === d);
  m.innerHTML = `<h2>Aujourd'hui</h2>${statsHTML(list)}${resultsList(list)}`;
}

// ---------- À propos
async function tabAbout(m) {
  const man = await dinManifest();
  const voices = man?.voices ? Object.values(man.voices).map(v => `<li>${esc(v.credit)}</li>`).join('') : '';
  m.innerHTML = `<h2>À propos</h2>
    <p><b>${APP.name} – ${APP.fullName}</b> · version ${APP.version}</p>
    <p>Conception et réalisation : <b>Joseph-Marie Simonetti – Weave</b>. © 2026. Tous droits réservés. Reproduction, copie ou extraction interdites.</p>
    <p class="small soft" style="margin-top:1em">Outil interne de sensibilisation à l'audition. Il ne constitue pas un examen médical et ne remplace pas un bilan auditif réalisé par un audioprothésiste.</p>
    <h3 style="margin-top:1.5em">Logiciels utilisés</h3>
    <ul class="small"><li>Capacitor – Ionic (licence MIT)</li><li>Android – AOSP (licence Apache 2.0)</li><li>Web Audio API (moteur audio du système)</li><li>Piper – Rhasspy (licence MIT)</li><li>qrcode-generator – Kazuhiko Arase (licence MIT)</li><li>Police Nunito (SIL Open Font License)</li>${voices}</ul>`;
}

// ---------- Quitter l'application (administrateur uniquement)
function confirmExit() {
  const o = overlay(`<div class="card col center" style="max-width:60vw"><h2>Quitter TAO ?</h2>
    <p class="soft center">Le verrouillage de la tablette est levé jusqu'au prochain lancement de l'appli.</p>
    <div class="row"><button class="btn secondary" data-k="no">Annuler</button><button class="btn danger" data-k="yes">Quitter</button></div></div>`);
  o.el.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    o.close();
    if (k === 'yes') {
      device.unlockVolume(); S.noise.stop();
      if (!(await device.exitApp())) { toast('Hors tablette : retour à l\u2019accueil'); goHome(); }
    }
  });
}

// ---------- Guide conseiller (non-audioprothésistes)
function tabGuide(m) {
  m.innerHTML = `<h2>Guide conseiller</h2>
    <p class="soft small" style="margin-bottom:1.2em">Vous n'avez pas à interpréter le test : vous accompagnez le client et vous l'orientez. Seul l'audioprothésiste réalise et interprète un bilan auditif.</p>
    <div class="guide">
      <div class="card"><h3>1. Proposer</h3><p class="small">« Nous proposons un petit test d'audition gratuit, 2 minutes, au casque. Ça vous dit ? » Ne jamais insister. Le test convient aux adultes, sans aide auditive portée.</p></div>
      <div class="card"><h3>2. Installer</h3><p class="small">Client assis, au calme, dos à l'agitation du magasin. Casque : <b style="color:var(--ear-r)">D</b> à droite, <b style="color:var(--ear-l)">G</b> à gauche. Lunettes retirées si elles gênent. Restez à proximité, sans parler pendant le test.</p></div>
      <div class="card"><h3>3. Pendant le test</h3><p class="small">Ne rien montrer ni signaler quand un son passe. Si le client est perdu : bouton « Pause », réexpliquez, reprenez. Bruit fort dans le magasin : l'appli attend toute seule.</p></div>
      <div class="card"><h3>4. Annoncer le résultat</h3><p class="small"><b>Tout entendu :</b> « Très bien ! Un contrôle régulier reste conseillé. »<br>
        <b>Sons manqués :</b> « Certains sons vous ont échappé. Ce n'est pas un diagnostic : notre audioprothésiste peut faire un bilan complet, gratuit. »<br>
        <b>Non fiable :</b> réexpliquez la consigne et proposez de recommencer.</p></div>
      <div class="card"><h3>5. Orienter</h3><p class="small">Bouton « Orienter vers le centre audio » : la fiche s'affiche avec un QR code. Le client le prend en photo et le présente au centre audio. Idéal : <b>fixer le rendez-vous tout de suite</b>, avec lui.</p></div>
      <div class="card"><h3>À ne jamais dire</h3><p class="small">« Vous êtes sourd », « vous avez une perte de… », « il vous faut un appareil », un pourcentage d'audition. Ne jamais commenter le détail des fréquences.</p></div>
    </div>
    <p class="small soft" style="margin-top:1.2em">Données : le test est anonyme. Aucun nom, téléphone ni e-mail n'est enregistré par l'appli.</p>`;
}

boot();
