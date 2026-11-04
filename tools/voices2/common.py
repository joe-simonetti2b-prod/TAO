import random
WORDS = {'0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre',
         '5': 'cinq', '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf'}
random.seed(20261104)
_all = [a + b + c for a in '0123456789' for b in '0123456789' for c in '0123456789' if len({a, b, c}) == 3]
random.shuffle(_all)
TRIPLETS = _all[:150]      # jeu complet par voix
EVAL = TRIPLETS[:40]        # sous-ensemble d'évaluation
SCREEN = TRIPLETS[:12]      # présélection rapide (voix multi-locuteurs)
def text(t): return ', '.join(WORDS[d] for d in t) + '.'
