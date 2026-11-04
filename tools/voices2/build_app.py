# Construit les ressources du test « chiffres dans le bruit » pour l'appli à partir des triplets retenus.
# Usage : python3 build_app.py <dossier final voices-v2> <www/din> homme=<nom> femme=<nom>
import json, sys, pathlib, subprocess, tempfile, numpy as np, scipy.io.wavfile as w, scipy.signal as s, soundfile as sf

SRC, DST = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
pick = dict(a.split('=') for a in sys.argv[3:])
CREDITS = json.loads((pathlib.Path(__file__).parent / 'credits.json').read_text())
SR, RMS = 48000, -20.0
rng = np.random.default_rng(20261104)

def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)

def prep(fn):
    x, r = sf.read(fn, dtype='float64')
    if x.ndim > 1: x = x.mean(1)
    if r != SR: x = s.resample_poly(x, SR, r)
    env = np.convolve(np.abs(x), np.ones(240) / 240, 'same'); idx = np.where(env > env.max() * 0.02)[0]
    x = x[max(0, idx[0] - int(.02 * SR)):idx[-1] + int(.05 * SR)].copy()
    n = int(.01 * SR); ramp = np.sin(np.linspace(0, np.pi / 2, n)) ** 2; x[:n] *= ramp; x[-n:] *= ramp[::-1]
    # légère accentuation des aigus (clarté des consonnes), puis égalisation du niveau
    b, a = s.butter(1, 2500 / (SR / 2), 'high'); x = x + 0.35 * s.lfilter(b, a, x)
    return x * 10 ** ((RMS - rms_db(x)) / 20)

def opus(x, out):
    with tempfile.NamedTemporaryFile(suffix='.wav') as t:
        w.write(t.name, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', t.name, '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', str(out)], check=True)

man = {'version': 2, 'voices': {}}
for key, name in pick.items():
    out = DST / key; out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('*'): old.unlink()
    trips, allx = {}, []
    for f in sorted((SRC / name).glob('*.flac')):
        x = prep(f)
        if np.abs(x).max() > .98: x *= .98 / np.abs(x).max()
        opus(x, out / f'{f.stem}.ogg'); trips[f.stem] = f'{key}/{f.stem}.ogg'; allx.append(x)
    fr, P = s.welch(np.concatenate(allx), SR, nperseg=4096)
    mag = np.convolve(np.sqrt(P), np.ones(9) / 9, 'same'); mag /= mag.max()
    fir = s.firwin2(4097, fr / (SR / 2), mag)
    nz = s.lfilter(fir, 1, rng.standard_normal(int(12.5 * SR)))[int(1.5 * SR):]
    L, X = int(10 * SR), int(.25 * SR); body = nz[:L].copy(); fade = np.linspace(0, 1, X)
    body[:X] = body[:X] * fade + nz[L:L + X] * (1 - fade)
    body *= 10 ** ((RMS - rms_db(body)) / 20)
    w.write(out / 'noise.wav', SR, (body * 32767).astype(np.int16))
    man['voices'][key] = {'triplets': trips, 'noise': f'{key}/noise.wav', 'speechRmsDb': RMS,
                          'noiseRmsDb': round(rms_db(body), 2), 'credit': CREDITS.get(name.split('_')[0], CREDITS.get(name, name)),
                          'source': name}
    print(key, name, len(trips), 'triplets')
(DST / 'manifest.json').write_text(json.dumps(man, indent=1, ensure_ascii=False))
