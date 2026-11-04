# Synthèse des triplets avec Kokoro (voix française ff_siwis, modèle Apache 2.0)
import pathlib, numpy as np, soundfile as sf
from common import TRIPLETS, text
from kokoro import KPipeline
pipe = KPipeline(lang_code='f')
for speed, tag in [(0.9, '090'), (1.0, '100')]:
    d = pathlib.Path('raw') / f'kokoro_siwis_F_{tag}'; d.mkdir(parents=True, exist_ok=True)
    for t in TRIPLETS:
        chunks = [a for _, _, a in pipe(text(t), voice='ff_siwis', speed=speed)]
        a = np.concatenate([c.numpy() if hasattr(c, 'numpy') else np.asarray(c) for c in chunks])
        sf.write(d / f'{t}.wav', a, 24000, subtype='PCM_16')
