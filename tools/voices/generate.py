# TAO – génération et ÉVALUATION OBJECTIVE des voix du test « chiffres dans le bruit ».
# Exécuté sur GitHub Actions (accès Internet). Résultats poussés sur la branche voices-raw.
#
# 1. Génère les chiffres 0-9 avec plusieurs voix Piper, paramètres « diction claire »
#    (débit un peu ralenti, variabilité réduite).
# 2. Fait « écouter » chaque fichier par une reconnaissance vocale (Whisper small, français),
#    au calme puis dans un bruit au spectre de la parole à 0 et −4 dB RSB.
# 3. Classe les voix par intelligibilité, et estime la hauteur (F0) pour séparer homme / femme.
import json, wave, urllib.request, pathlib, traceback, re, sys
import numpy as np

BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
FIXED = {
    'femme_siwis':        ('fr/fr_FR/siwis/medium/fr_FR-siwis-medium', None, 'CC-BY 4.0'),
    'femme_upmc_jessica': ('fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'jessica', 'CC-BY-SA 4.0'),
    'homme_upmc_pierre':  ('fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'pierre', 'CC-BY-SA 4.0'),
}
MLS = 'fr/fr_FR/mls/medium/fr_FR-mls-medium'   # LibriVox (domaine public) / MLS, CC-BY 4.0, multi-locuteurs
MLS_MAX = 12
DIGITS = {'0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre',
          '5': 'cinq', '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf'}
VARIANTS = [(1.10, 0.35, 0.45), (1.20, 0.45, 0.55), (1.15, 0.40, 0.50)]  # (length, noise, noise_w)

out = pathlib.Path('out'); out.mkdir(exist_ok=True)
cache = pathlib.Path('models'); cache.mkdir(exist_ok=True)

def fetch(url, dest):
    if not dest.exists(): urllib.request.urlretrieve(url, dest)
    return dest

def read_wav(fn):
    with wave.open(str(fn)) as wf:
        sr = wf.getframerate(); x = np.frombuffer(wf.readframes(wf.getnframes()), np.int16).astype(np.float64) / 32768
    return x, sr

def f0_median(x, sr):
    fr, hop, vals = int(0.04 * sr), int(0.01 * sr), []
    for i in range(0, len(x) - fr, hop):
        seg = x[i:i + fr] * np.hanning(fr)
        if np.sqrt((seg ** 2).mean()) < 0.02: continue
        ac = np.correlate(seg, seg, 'full')[fr - 1:]
        lo, hi = int(sr / 400), int(sr / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3 * ac[0]: vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0

from piper import PiperVoice
voices = {}
for name, (path, spk, lic) in FIXED.items(): voices[name] = (path, spk, lic)
try:
    cfg = json.loads(fetch(BASE + MLS + '.onnx.json', cache / 'mls.onnx.json').read_text())
    for spk in list(cfg.get('speaker_id_map', {}).keys())[:MLS_MAX]:
        voices[f'mls_{spk}'] = (MLS, spk, 'CC-BY 4.0')
except Exception:
    print('MLS indisponible', traceback.format_exc())

loaded = {}
gen = {}
for name, (path, spk, lic) in voices.items():
    try:
        stem = path.split('/')[-1]
        onnx = fetch(BASE + path + '.onnx', cache / f'{stem}.onnx')
        cfgp = fetch(BASE + path + '.onnx.json', cache / f'{stem}.onnx.json')
        if path not in loaded: loaded[path] = (PiperVoice.load(str(onnx), config_path=str(cfgp)), json.loads(cfgp.read_text()))
        voice, conf = loaded[path]
        sid = conf.get('speaker_id_map', {}).get(spk) if spk is not None else None
        d = out / name; d.mkdir(exist_ok=True)
        for dg, txt in DIGITS.items():
            for k, (ls, ns, nw) in enumerate(VARIANTS):
                with wave.open(str(d / f'{dg}_{k}.wav'), 'wb') as wf:
                    voice.synthesize(txt + '.', wf, speaker_id=sid, length_scale=ls, noise_scale=ns, noise_w=nw)
        gen[name] = {'license': lic, 'speaker_id': sid}
    except Exception:
        gen[name] = {'error': traceback.format_exc()[-800:]}

# ---------------- Évaluation par reconnaissance vocale ----------------
import whisper
model = whisper.load_model('small')
WORD2D = {v: k for k, v in DIGITS.items()}
WORD2D.update({'zero': '0', 'hun': '1', 'une': '1', 'de': '2', 'ce': '6', 'sis': '6', 'cette': '7', 'set': '7', 'huitre': '8', 'oeuf': '9', 'neuf': '9'})
def recog(x, sr):
    import scipy.signal as ss
    y = ss.resample_poly(x, 16000, sr).astype(np.float32)
    y = np.concatenate([np.zeros(4000, np.float32), y, np.zeros(4000, np.float32)])
    r = model.transcribe(y, language='fr', temperature=0, condition_on_previous_text=False,
                         initial_prompt='Un chiffre entre zéro et neuf.', fp16=False)
    t = r['text'].lower().strip()
    m = re.search(r'\d', t)
    if m: return m.group(0), t
    for w in re.findall(r"[a-zéèêàùç]+", t.replace('é', 'é')):
        if w in WORD2D: return WORD2D[w], t
    return None, t

rng = np.random.default_rng(7)
def speech_noise(n, sr):
    # bruit au spectre moyen de la parole (pente −6 dB/octave au-dessus de 500 Hz)
    import scipy.signal as ss
    w = rng.standard_normal(n + 4096)
    b, a = ss.butter(1, 500 / (sr / 2), 'low')
    pink = ss.lfilter(b, a, w) + 0.15 * ss.lfilter(*ss.butter(2, [100 / (sr / 2), 0.9], 'band'), w)
    return pink[4096:]

def evaluate(folder):
    res = {'clean': 0, 'snr0': 0, 'snrm4': 0, 'n': 0, 'f0': [], 'errors': []}
    for fn in sorted(list(folder.glob('[0-9]_0.wav')) + list(folder.glob('[0-9]_1.wav'))):
        d = fn.name[0]; x, sr = read_wav(fn)
        x = x / (np.sqrt(np.mean(x ** 2)) + 1e-9) * 0.05
        res['n'] += 1; res['f0'].append(f0_median(x * 10, sr))
        got, t = recog(x, sr); res['clean'] += (got == d)
        if got != d: res['errors'].append(f'{fn.name}:calme→{t}')
        for key, snr in (('snr0', 0), ('snrm4', -4)):
            nz = speech_noise(len(x), sr); nz = nz / np.sqrt(np.mean(nz ** 2)) * 0.05 * 10 ** (-snr / 20)
            got, t = recog(x + nz, sr); res[key] += (got == d)
    n = max(1, res['n'])
    return {'calme_%': round(100 * res['clean'] / n, 1), 'rsb0_%': round(100 * res['snr0'] / n, 1),
            'rsb-4_%': round(100 * res['snrm4'] / n, 1), 'f0_Hz': round(float(np.median(res['f0'])), 0),
            'n': res['n'], 'erreurs_calme': res['errors'][:12]}

report = {'generation': gen, 'evaluation': {}}
for name in voices:
    if 'error' in gen.get(name, {}): continue
    try: report['evaluation'][name] = evaluate(out / name)
    except Exception: report['evaluation'][name] = {'error': traceback.format_exc()[-800:]}
# Contrôle des chiffres déjà intégrés dans l'appli (v0.1)
for v in ('homme', 'femme'):
    p = pathlib.Path('www/din') / v
    if p.exists():
        try: report['evaluation'][f'APPLI_v01_{v}'] = evaluate(p)
        except Exception: report['evaluation'][f'APPLI_v01_{v}'] = {'error': traceback.format_exc()[-800:]}

ranking = sorted(((k, v) for k, v in report['evaluation'].items() if 'calme_%' in v),
                 key=lambda kv: (kv[1]['calme_%'] + kv[1]['rsb0_%'] + kv[1]['rsb-4_%']), reverse=True)
report['classement'] = [{'voix': k, **{kk: vv for kk, vv in v.items() if kk != 'erreurs_calme'}} for k, v in ranking]
(out / 'report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False))
print(json.dumps(report['classement'], indent=1, ensure_ascii=False))
