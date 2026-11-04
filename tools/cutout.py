# Détourage des visuels sur fond clair : remplissage depuis les bords + contour adouci
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

def cutout(src, dst, tol=14, size=512):
    im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    diff = np.abs(a - bg).max(axis=2)
    cand = diff <= tol
    lab, n = ndimage.label(cand)
    edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgmask = np.isin(lab, list(edge_labels))
    # trous intérieurs (ex. entre l'arceau du casque et la tête) : zones quasi blanches pures et assez grandes
    lab2, n2 = ndimage.label(diff <= 5)
    sizes = ndimage.sum(np.ones_like(diff), lab2, range(1, n2 + 1))
    for i, sz in enumerate(sizes, 1):
        if sz > 400: bgmask |= (lab2 == i)
    alpha = (~bgmask).astype(np.float32)
    alpha = ndimage.binary_opening(alpha > 0.5, iterations=1).astype(np.float32)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255.0
    rgba = np.dstack([a.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    out = Image.fromarray(rgba, 'RGBA')
    ys, xs = np.where(alpha > 0.05)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    out = out.crop(box)
    s = int(max(out.size) * 1.08)
    sq = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq.paste(out, ((s - out.size[0]) // 2, (s - out.size[1]) // 2), out)
    sq = sq.resize((size, size), Image.LANCZOS)
    sq.save(dst, optimize=True)

if __name__ == '__main__':
    cutout(sys.argv[1], sys.argv[2])
