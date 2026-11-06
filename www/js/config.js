// TAO – Test Auditif Optique — configuration par défaut
// © Joseph-Marie Simonetti – Weave. Tous droits réservés.

export const APP = {
  name: 'TAO',
  fullName: 'Test Auditif Optique',
  version: '0.9.1',
  brand: 'Balbi Audition',
};

// Ordre de présentation classique : 1000 → 2000 → 3000 → 4000 → 500 Hz
export const FREQUENCIES = [1000, 2000, 3000, 4000, 500];
export const EARS = ['R', 'L']; // oreille droite puis gauche

export const EAR_LABEL = { R: 'droite', L: 'gauche' };

// Thèmes ludiques associés à chaque fréquence (sons à bande étroite)
export const THEMES = {
  500:  { key: 'corne',     label: 'Corne de brume', short: 'le bateau' },
  1000: { key: 'telephone', label: 'Téléphone',      short: 'le téléphone' },
  2000: { key: 'clochette', label: 'Clochette',      short: 'la clochette' },
  3000: { key: 'sifflet',   label: 'Sifflet',        short: 'le sifflet' },
  4000: { key: 'oiseau',    label: 'Oiseau',         short: "l'oiseau" },
};

// Réglages modifiables en mode Audioprothésiste
export const DEFAULT_SETTINGS = {
  storeName: 'Magasin',
  levelHL: 30,                 // niveau de dépistage choisi : 20 / 25 / 30 / 35 dB HL
  extra500: 5,                 // dB ajoutés à 500 Hz (bruit ambiant) : 0 / 5 / 10
  stimulusType: 'theme',       // 'theme' (sons ludiques) ou 'pulsed' (son pur pulsé)
  stimulusDuration: 2.0,       // secondes par présentation (1,5 à 3 s)
  responseWindowAfter: 1.5,    // s acceptées après la fin du son
  confirmEnabled: true,        // palier de confirmation sur les fréquences manquées
  confirmLevels: [50, 70],     // dB HL
  catchTrials: 3,              // essais muets
  maxFalsePositives: 1,        // au-delà → résultat non fiable
  isiMin: 1.5, isiMax: 4.0,    // intervalle aléatoire avant chaque son (s)
  noiseCheck: true,            // contrôle du bruit ambiant (micro)
  noiseMarginDb: 15,           // dB tolérés au-dessus du bruit de référence
  systemVolumeIndex: null,     // cran de volume média fixé par le natif (null = non défini)
  dailyCheck: true,            // contrôle d'écoute quotidien par le conseiller
  dinEnabled: true,            // module chiffres dans le bruit
  dinVoice: 'auto',            // 'homme' | 'femme' | 'auto' (alterne)
  dinAntiphasic: false,
  dinReferSrt: -7,             // seuil d'orientation provisoire (dB RSB) – à valider
  advisors: [],
  trialMode: false,            // mode essai (sans casque filaire) : désactivé par défaut                // conseillers (traçabilité)
};

export const LEVEL_PRESETS = [20, 25, 30, 35];
export const EXTRA500_PRESETS = [0, 5, 10];
export const DURATION_PRESETS = [1.5, 2.0, 2.5, 3.0];

// Sécurité : niveau numérique maximal autorisé (dBFS crête) — marge anti-saturation
export const MAX_DBFS = -1;

// Rappel de réétalonnage (jours)
export const RECAL_DAYS = 180;
