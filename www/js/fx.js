// Motion design : transitions d'écrans, ondulation des boutons, confettis.
// Règle : aucune animation n'est déclenchée au moment où un son de test est joué
// (cela donnerait un indice visuel au client).

let current = null;
let lastTap = null;
document.addEventListener('pointerdown', e => { lastTap = { x: e.clientX, y: e.clientY, t: performance.now() }; },
  { passive: true, capture: true });

const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
const EASE_ZOOM = 'cubic-bezier(.65,0,.25,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Change d'écran.
 * - Après un toucher : la nouvelle page « s'ouvre » depuis le doigt (révélation circulaire + léger zoom),
 *   l'ancienne recule en profondeur (réduction + flou).
 * - Sinon : glissement doux.
 */
export function showScreen(id) {
  const next = document.getElementById(id);
  if (!next || next === current) return;
  const prev = current;
  const tap = lastTap && performance.now() - lastTap.t < 900 ? lastTap : null;
  const motion = !reduced() && !!next.animate;

  if (prev) {
    prev.classList.remove('active', 'enter', 'enter-zoom');
    prev.classList.add('leave');
    if (motion) {
      prev.getAnimations?.().forEach(a => a.cancel());
      const a = prev.animate(
        [{ transform: 'none', filter: 'none', opacity: 1 },
         { transform: 'scale(.93)', filter: 'blur(6px)', opacity: 0 }],
        { duration: tap ? 560 : 380, easing: EASE_OUT, fill: 'forwards' });
      a.onfinish = () => { prev.classList.remove('leave'); a.cancel(); };
    } else setTimeout(() => prev.classList.remove('leave'), 330);
  }

  next.classList.remove('leave');
  next.getAnimations?.().forEach(a => a.cancel());
  if (motion && tap) {
    next.classList.add('active', 'enter-zoom');
    const R = Math.hypot(Math.max(tap.x, innerWidth - tap.x), Math.max(tap.y, innerHeight - tap.y));
    next.animate(
      [{ clipPath: `circle(0px at ${tap.x}px ${tap.y}px)`, transform: 'scale(1.06)', transformOrigin: `${tap.x}px ${tap.y}px` },
       { clipPath: `circle(${R}px at ${tap.x}px ${tap.y}px)`, transform: 'none', transformOrigin: `${tap.x}px ${tap.y}px` }],
      { duration: 680, easing: EASE_ZOOM });
    setTimeout(() => next.classList.remove('enter-zoom'), 1100);
  } else {
    next.classList.add('active', 'enter');
    setTimeout(() => next.classList.remove('enter'), 900);
  }
  current = next;
}

// Ondulation au toucher sur tous les boutons
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn, .pad button');
  if (!b) return;
  const r = b.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.style.overflow = 'hidden';
  b.appendChild(s);
  setTimeout(() => s.remove(), 650);
}, { passive: true });

// Confettis légers (canvas, ~2 s)
export function confetti({ count = 140, duration = 2200 } = {}) {
  const cv = document.getElementById('confetti');
  if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const colors = ['#2CC09C', '#4D8FDB', '#F08A73', '#F3C969', '#9CCBF2', '#A9E6D3'];
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * innerWidth * .3, y: innerHeight * .38,
    vx: (Math.random() - .5) * 15, vy: -Math.random() * 16 - 5, r: 5 + Math.random() * 7,
    rot: Math.random() * 6, vr: (Math.random() - .5) * .35, c: colors[(Math.random() * colors.length) | 0],
    shape: Math.random() < .5 ? 0 : 1,
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / duration;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      g.save(); g.globalAlpha = Math.max(0, 1 - k * k); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c;
      if (p.shape) g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); else { g.beginPath(); g.arc(0, 0, p.r / 2.4, 0, 7); g.fill(); }
      g.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else g.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}
