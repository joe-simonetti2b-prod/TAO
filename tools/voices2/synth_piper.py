# Synthèse des triplets avec Piper (énoncé naturel d'un seul tenant, débit ralenti)
import json, wave, pathlib, urllib.request, sys
from common import TRIPLETS, SCREEN, text
from piper import PiperVoice
BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
RAW = pathlib.Path('raw'); RAW.mkdir(exist_ok=True)
M = pathlib.Path('models'); M.mkdir(exist_ok=True)
def model(path):
    stem = path.split('/')[-1]
    for ext in ['.onnx', '.onnx.json']:
        d = M / (stem + ext)
        if not d.exists(): urllib.request.urlretrieve(BASE + path + ext, d)
    card = M / (stem + '.MODEL_CARD')
    try:
        if not card.exists(): urllib.request.urlretrieve(BASE + '/'.join(path.split('/')[:-1]) + '/MODEL_CARD', card)
    except Exception: pass
    return str(M / (stem + '.onnx')), str(M / (stem + '.onnx.json'))

def synth(name, path, speaker=None, trips=TRIPLETS, ls=1.15):
    onnx, cfg = model(path)
    conf = json.load(open(cfg))
    sid = conf.get('speaker_id_map', {}).get(speaker) if speaker is not None else None
    if isinstance(speaker, int): sid = speaker
    v = PiperVoice.load(onnx, config_path=cfg)
    d = RAW / name; d.mkdir(exist_ok=True)
    for t in trips:
        with wave.open(str(d / f'{t}.wav'), 'wb') as wf:
            v.synthesize(text(t), wf, speaker_id=sid, length_scale=ls, noise_scale=0.45, noise_w=0.6)
    return conf

MLS = 'fr/fr_FR/mls/medium/fr_FR-mls-medium'
if __name__ == '__main__' and sys.argv[1] == 'base':
    synth('piper_siwis_F', 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium')
    synth('piper_upmc_jessica_F', 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'jessica')
    synth('piper_upmc_pierre_M', 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'pierre')
    # Voix multi-locuteurs MLS (LibriVox, CC-BY 4.0) : présélection de 24 locuteurs
    try:
        conf = synth('_probe', MLS, 0, trips=SCREEN[:1])
        n = conf.get('num_speakers', 1)
        for i in range(min(n, 24)):
            synth(f'mls_{i:03d}', MLS, i, trips=SCREEN)
    except Exception as e:
        print('MLS indisponible', e)
if __name__ == '__main__' and sys.argv[1] == 'mls_full':
    sel = json.load(open('out2/mls_best.json'))
    for g, names in sel.items():
        for n in names:
            synth(f'{n}_{g}', MLS, int(n.split('_')[1]))
