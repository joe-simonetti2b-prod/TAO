# Export : jeux complets des 2 meilleures voix par genre (FLAC) + échantillons d'écoute (MP3).
import json, pathlib, subprocess, shutil
OUT = pathlib.Path('out2'); RAW = pathlib.Path('raw')
rep = json.load(open(OUT / 'report.json'))
full = {n: r for n, r in rep.items() if '-8dB' in r}
def key(n): r = full[n]; return (r['-4dB']['score'], r['-8dB']['score'], r['propre']['score'])
def gender(n):
    if n.endswith('_M'): return 'M'
    if n.endswith('_F') or '_F_' in n: return 'F'
    return None
rank = {'M': sorted([n for n in full if gender(n) == 'M'], key=key, reverse=True),
        'F': sorted([n for n in full if gender(n) == 'F'], key=key, reverse=True)}
json.dump(rank, open(OUT / 'ranking.json', 'w'), indent=1)
print(json.dumps({g: [(n, key(n)) for n in v] for g, v in rank.items()}, indent=1))
for g, lst in rank.items():
    for n in lst[:2]:
        d = OUT / 'final' / n; d.mkdir(parents=True, exist_ok=True)
        for w in sorted((RAW / n).glob('*.wav')):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(w), str(d / (w.stem + '.flac'))], check=True)
for n in full:
    d = OUT / 'ecoute'; d.mkdir(exist_ok=True)
    ws = sorted((RAW / n).glob('*.wav'))[:3]
    lst = d / f'{n}.txt'; lst.write_text(''.join(f"file '{w.resolve()}'\n" for w in ws))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-af', 'apad=pad_dur=0.6',
                    '-b:a', '128k', str(d / f'{n}_propre.mp3')], check=False)
    lst.unlink()
# cartes de modèles (licences)
lic = OUT / 'licences'; lic.mkdir(exist_ok=True)
for c in pathlib.Path('models').glob('*.MODEL_CARD'): shutil.copy(c, lic / c.name)
