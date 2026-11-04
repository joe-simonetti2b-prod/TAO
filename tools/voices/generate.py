# Génère les chiffres 0-9 en voix de synthèse (Piper) pour le test « chiffres dans le bruit ».
# Exécuté sur GitHub Actions (accès Internet). Résultats poussés sur la branche voices-raw.
import json, os, sys, wave, urllib.request, pathlib, traceback

BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
VOICES = {
    'femme_siwis':        ('fr/fr_FR/siwis/medium/fr_FR-siwis-medium', None),
    'femme_upmc_jessica': ('fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'jessica'),
    'homme_upmc_pierre':  ('fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'pierre'),
    'homme_tom':          ('fr/fr_FR/tom/medium/fr_FR-tom-medium', None),
    'homme_gilles':       ('fr/fr_FR/gilles/low/fr_FR-gilles-low', None),
}
DIGITS = {'0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre',
          '5': 'cinq', '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf'}
VARIANTS = [(0.50, 0.60), (0.667, 0.80), (0.80, 1.00)]  # (noise_scale, noise_w)
PHRASE = "Bonjour. Vous allez entendre trois chiffres au milieu d'un bruit de fond. Tapez les chiffres entendus."

out = pathlib.Path('out'); out.mkdir(exist_ok=True)
cache = pathlib.Path('models'); cache.mkdir(exist_ok=True)

def fetch(url, dest):
    if not dest.exists():
        urllib.request.urlretrieve(url, dest)
    return dest

from piper import PiperVoice
report = {}
for name, (path, speaker) in VOICES.items():
    try:
        stem = path.split('/')[-1]
        onnx = fetch(BASE + path + '.onnx', cache / f'{stem}.onnx')
        cfg = fetch(BASE + path + '.onnx.json', cache / f'{stem}.onnx.json')
        d = out / name; d.mkdir(exist_ok=True)
        try:
            fetch(BASE + '/'.join(path.split('/')[:-1]) + '/MODEL_CARD', d / 'MODEL_CARD.txt')
        except Exception as e:
            (d / 'MODEL_CARD.txt').write_text(f'MODEL_CARD indisponible : {e}')
        conf = json.loads(cfg.read_text())
        sid = None
        if speaker is not None:
            sid = conf.get('speaker_id_map', {}).get(speaker)
        voice = PiperVoice.load(str(onnx), config_path=str(cfg))
        for dg, txt in DIGITS.items():
            for k, (ns, nw) in enumerate(VARIANTS):
                with wave.open(str(d / f'{dg}_{k}.wav'), 'wb') as wf:
                    voice.synthesize(txt, wf, speaker_id=sid, length_scale=1.0, noise_scale=ns, noise_w=nw)
        with wave.open(str(d / 'phrase.wav'), 'wb') as wf:
            voice.synthesize(PHRASE, wf, speaker_id=sid)
        report[name] = {'ok': True, 'speaker_id': sid, 'sample_rate': conf.get('audio', {}).get('sample_rate'),
                        'speakers': list(conf.get('speaker_id_map', {}).keys())}
    except Exception:
        report[name] = {'ok': False, 'error': traceback.format_exc()[-1500:]}
(out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps(report, indent=2, ensure_ascii=False))
