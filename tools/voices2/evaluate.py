# Évaluation objective de l'intelligibilité : reconnaissance vocale (faster-whisper) en silence et dans le bruit.
import json, pathlib, re, subprocess, numpy as np, soundfile as sf
from scipy import signal
from common import TRIPLETS, EVAL, SCREEN
from faster_whisper import WhisperModel

RAW, OUT = pathlib.Path('raw'), pathlib.Path('out2')
OUT.mkdir(exist_ok=True)
SR = 16000
W = {'zéro': '0', 'zero': '0', 'un': '1', 'une': '1', 'deux': '2', 'trois': '3', 'quatre': '4', 'cinq': '5',
     'six': '6', 'sept': '7', 'huit': '8', 'neuf': '9'}
asr = WhisperModel('small', device='cpu', compute_type='int8')

def load(fn, sr=SR):
    x, r = sf.read(fn, dtype='float64')
    if x.ndim > 1: x = x.mean(1)
    if r != sr: x = signal.resample_poly(x, sr, r)
    env = np.convolve(np.abs(x), np.ones(80) / 80, 'same'); idx = np.where(env > env.max() * 0.02)[0]
    x = x[max(0, idx[0] - 160):idx[-1] + 320]
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-12) * 0.1

def ssn(xs, n, rng):
    fr, P = signal.welch(np.concatenate(xs), SR, nperseg=1024)
    fir = signal.firwin2(1025, fr / (SR / 2), np.sqrt(P) / np.sqrt(P).max())
    z = signal.lfilter(fir, 1, rng.standard_normal(n + 4000))[4000:]
    return z / np.sqrt(np.mean(z ** 2)) * 0.1

def recog(x):
    segs, _ = asr.transcribe(x.astype(np.float32), language='fr', beam_size=5, without_timestamps=True,
                             initial_prompt='Trois chiffres : quatre, deux, neuf.', vad_filter=False,
                             condition_on_previous_text=False)
    txt = ' '.join(s.text for s in segs).lower()
    out = ''
    for tok in re.findall(r"[a-zéèêàç]+|\d", txt):
        if tok.isdigit(): out += tok
        elif tok in W: out += W[tok]
    return out, txt

def evaluate(name, trips, snrs=(None, 0, -4, -8)):
    rng = np.random.default_rng(7)
    xs = {t: load(RAW / name / f'{t}.wav') for t in trips if (RAW / name / f'{t}.wav').exists()}
    res = {}
    for snr in snrs:
        ok = 0; errs = []
        for t, x in xs.items():
            if snr is None: y = x
            else:
                pad = np.zeros(int(0.4 * SR)); s = np.concatenate([pad, x, pad])
                y = s * 10 ** (snr / 20) + ssn(list(xs.values()), len(s), rng)
            got, raw = recog(y)
            if got == t: ok += 1
            elif len(errs) < 6: errs.append(f'{t}→{got or raw.strip()}')
        res['propre' if snr is None else f'{snr:+d}dB'] = {'score': round(100 * ok / max(1, len(xs)), 1), 'exemples_erreurs': errs}
    # F0 médiane
    f0s = []
    for x in list(xs.values())[:6]:
        fr = int(0.04 * SR)
        for i in range(0, len(x) - fr, 160):
            seg = x[i:i + fr] * np.hanning(fr)
            if np.sqrt(np.mean(seg ** 2)) < 0.05: continue
            ac = np.correlate(seg, seg, 'full')[fr - 1:]; lo, hi = SR // 400, SR // 70
            k = lo + np.argmax(ac[lo:hi])
            if ac[k] > 0.3 * ac[0]: f0s.append(SR / k)
    res['F0_Hz'] = round(float(np.median(f0s)), 0) if f0s else None
    return res

import sys
rp = OUT / 'report.json'
report = json.load(open(rp)) if rp.exists() else {}
names = sorted(p.name for p in RAW.iterdir() if p.is_dir() and not p.name.startswith('_'))
mode = sys.argv[1]
if mode == 'screen':
    mls = [n for n in names if n.startswith('mls_') and n.count('_') == 1]
    for n in mls: report[n] = evaluate(n, SCREEN, snrs=(None, -4))
    for n in [n for n in names if not n.startswith('mls_')]: report[n] = evaluate(n, EVAL)
    def best(pred):
        c = [(report[n].get('-4dB', {}).get('score', 0), report[n].get('propre', {}).get('score', 0), n)
             for n in mls if pred(report[n].get('F0_Hz') or 0)]
        return [n for *_, n in sorted(c, reverse=True)[:2]]
    sel = {'M': best(lambda f: 0 < f < 155), 'F': best(lambda f: f > 170)}
    json.dump(sel, open(OUT / 'mls_best.json', 'w')); print('MLS retenus', sel)
elif mode == 'full':
    for n in [n for n in names if n.startswith('mls_') and n.count('_') == 2]: report[n] = evaluate(n, EVAL)
json.dump(report, open(rp, 'w'), indent=1, ensure_ascii=False)
print(json.dumps(report, indent=1, ensure_ascii=False))
