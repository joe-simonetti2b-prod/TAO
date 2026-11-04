# Synthèse finale des triplets pour les voix retenues après évaluation (voices-v2, run 1) :
#   homme : Piper « Pierre » (UPMC)  – 87,5 % de triplets reconnus au calme
#   femme : Piper « SIWIS »          – 92,5 % au calme (CC-BY 4.0)
#   femme (alternative) : Piper « Jessica » (UPMC) – 87,5 % au calme, meilleure dans le bruit
import sys, pathlib, subprocess, shutil
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'voices2'))
import os; os.chdir(pathlib.Path(__file__).resolve().parent.parent / 'voices2')
from synth_piper import synth, M, RAW

CHOICE = [
    ('piper_upmc_pierre_M', 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'pierre'),
    ('piper_siwis_F', 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium', None),
    ('piper_upmc_jessica_F', 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', 'jessica'),
]
OUT = pathlib.Path('out3'); OUT.mkdir(exist_ok=True)
for name, path, spk in CHOICE:
    synth(name, path, spk)
    d = OUT / 'final' / name; d.mkdir(parents=True, exist_ok=True)
    for w in sorted((RAW / name).glob('*.wav')):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(w), str(d / (w.stem + '.flac'))], check=True)
    print(name, len(list(d.glob('*.flac'))), 'triplets')
lic = OUT / 'licences'; lic.mkdir(exist_ok=True)
for c in M.glob('*.MODEL_CARD'): shutil.copy(c, lic / c.name)
