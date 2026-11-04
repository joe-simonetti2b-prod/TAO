# Prépare les voix du test « chiffres dans le bruit » à partir des sorties Piper (branche voices-raw).
# Usage : python3 tools/voices/process.py <dossier voices-raw> <dossier www/din>
import json, sys, pathlib, numpy as np, scipy.io.wavfile as w, scipy.signal as s

SRC, DST = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
SR = 48000
TARGET_RMS = -20.0   # dBFS, RMS de la partie active de chaque chiffre
NOISE_RMS = -20.0
CHOICE = {  # voix retenues
    'homme': ('homme_upmc_pierre', 'Voix « Pierre » – Piper fr_FR-upmc (données UPMC/MaryTTS, licence CC-BY-SA 4.0)'),
    'femme': ('femme_siwis', 'Voix « SIWIS » – Piper fr_FR-siwis (données SIWIS, Université d’Édimbourg, licence CC-BY 4.0)'),
}
rng = np.random.default_rng(20261104)

def load(fn):
    sr, x = w.read(fn); x = x.astype(np.float64) / 32768.0
    if x.ndim > 1: x = x.mean(1)
    return s.resample_poly(x, SR, sr) if sr != SR else x

def trim(x):
    env = np.convolve(np.abs(x), np.ones(240) / 240, 'same')
    idx = np.where(env > env.max() * 0.02)[0]
    a, b = max(0, idx[0] - int(0.015 * SR)), min(len(x), idx[-1] + int(0.03 * SR))
    y = x[a:b].copy(); n = int(0.008 * SR)
    r = np.sin(np.linspace(0, np.pi / 2, n)) ** 2
    y[:n] *= r; y[-n:] *= r[::-1]
    return y

def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)

def write(fn, x):
    assert np.abs(x).max() < 1.0, fn
    w.write(fn, SR, (x * 32767).astype(np.int16))

manifest = {'version': 1, 'voices': {}}
for key, (src, credit) in CHOICE.items():
    out = DST / key; out.mkdir(parents=True, exist_ok=True)
    digits, allx = {}, []
    for d in '0123456789':
        digits[d] = []
        for k in range(3):
            x = trim(load(SRC / src / f'{d}_{k}.wav'))
            x *= 10 ** ((TARGET_RMS - rms_db(x)) / 20)
            if np.abs(x).max() > 0.95: x *= 0.95 / np.abs(x).max()
            write(out / f'{d}_{k}.wav', x); allx.append(x)
            digits[d].append(f'{key}/{d}_{k}.wav')
    # Bruit stationnaire au spectre moyen de la voix (LTASS)
    speech = np.concatenate(allx)
    fr, P = s.welch(speech, SR, nperseg=4096)
    mag = np.sqrt(P); mag = np.convolve(mag, np.ones(9) / 9, 'same')  # lissage
    mag /= mag.max()
    fir = s.firwin2(4097, fr / (SR / 2), mag)
    n = rng.standard_normal(int(12.5 * SR))
    nz = s.lfilter(fir, 1, n)[int(1.5 * SR):int(12.5 * SR)]
    L, X = int(10 * SR), int(0.25 * SR)            # boucle de 10 s, fondu enchaîné 250 ms
    body = nz[:L].copy(); tail = nz[L:L + X]
    fade = np.linspace(0, 1, X)
    body[:X] = body[:X] * fade + tail * (1 - fade)
    body *= 10 ** ((NOISE_RMS - rms_db(body)) / 20)
    write(out / 'noise.wav', body)
    manifest['voices'][key] = {
        'digits': digits, 'noise': f'{key}/noise.wav',
        'speechRmsDb': TARGET_RMS, 'noiseRmsDb': round(rms_db(body), 2), 'credit': credit,
    }
    print(key, 'ok', f'{len(allx)} chiffres', f'bruit {rms_db(body):.1f} dBFS')
(DST / 'manifest.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
