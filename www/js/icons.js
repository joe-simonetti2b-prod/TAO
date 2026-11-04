// Illustrations provisoires (seront remplacées par celles de Gemini)
const wave = (x, y, c) => `<path d="M${x} ${y-14} q10 14 0 28 M${x+10} ${y-24} q16 24 0 48" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;

export const ICONS = {
  corne: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#E8F1FB"/>
    <path d="M20 74h66l-10 18H32z" fill="#1D5FA8"/><rect x="46" y="48" width="22" height="26" rx="3" fill="#FFFFFF" stroke="#1D5FA8" stroke-width="4"/>
    <rect x="52" y="34" width="8" height="16" rx="2" fill="#C62828"/><path d="M14 98q12-8 24 0t24 0 24 0 24 0" fill="none" stroke="#5BA3E0" stroke-width="5" stroke-linecap="round"/>
    ${wave(76, 40, '#1D5FA8')}</svg>`,
  telephone: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#E8F1FB"/>
    <path d="M26 46q34-22 68 0l-6 12q-28-14-56 0z" fill="#12263A"/>
    <path d="M34 62h52l8 30H26z" fill="#1D5FA8"/><circle cx="60" cy="76" r="11" fill="#fff"/><circle cx="60" cy="76" r="4" fill="#1D5FA8"/>
    ${wave(96, 34, '#C62828')}</svg>`,
  clochette: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#FFF6E5"/>
    <path d="M60 24c-16 0-24 12-24 28v18l-8 10h64l-8-10V52c0-16-8-28-24-28z" fill="#E0A100"/>
    <circle cx="60" cy="88" r="7" fill="#B37E00"/><rect x="56" y="16" width="8" height="10" rx="3" fill="#B37E00"/>
    ${wave(94, 46, '#E0A100')}</svg>`,
  sifflet: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#E9F7F2"/>
    <circle cx="54" cy="70" r="22" fill="#0E8A6A"/><rect x="58" y="44" width="40" height="18" rx="5" fill="#0E8A6A"/>
    <circle cx="54" cy="70" r="8" fill="#E9F7F2"/><path d="M30 60q-14-10-8-24" fill="none" stroke="#12263A" stroke-width="4" stroke-linecap="round"/>
    ${wave(102, 40, '#0E8A6A')}</svg>`,
  oiseau: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#FDEFEF"/>
    <ellipse cx="56" cy="66" rx="26" ry="20" fill="#D9534F"/><circle cx="76" cy="50" r="13" fill="#D9534F"/>
    <path d="M88 48l12 4-12 5z" fill="#E0A100"/><circle cx="79" cy="47" r="3" fill="#12263A"/>
    <path d="M34 62q-12 4-16 16q14-2 22-8z" fill="#B33A36"/><path d="M48 62q8 14 24 8" fill="none" stroke="#F3B4B2" stroke-width="5" stroke-linecap="round"/>
    <path d="M52 86v10M62 86v10" stroke="#E0A100" stroke-width="4" stroke-linecap="round"/>
    ${wave(98, 30, '#D9534F')}</svg>`,
  headset: `<svg viewBox="0 0 240 200"><path d="M40 120V100a80 80 0 0 1 160 0v20" fill="none" stroke="#12263A" stroke-width="14" stroke-linecap="round"/>
    <rect x="18" y="104" width="46" height="74" rx="20" fill="#1565C0"/><rect x="176" y="104" width="46" height="74" rx="20" fill="#C62828"/>
    <text x="41" y="152" font-size="30" font-weight="900" fill="#fff" text-anchor="middle" font-family="sans-serif">G</text>
    <text x="199" y="152" font-size="30" font-weight="900" fill="#fff" text-anchor="middle" font-family="sans-serif">D</text></svg>`,
  ok: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#E3F4EE"/><path d="M34 62l18 18 36-38" fill="none" stroke="#0E8A6A" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ear: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#E8F1FB"/><path d="M44 50a18 18 0 1 1 34 8c-4 8-12 10-12 22a12 12 0 0 1-22 4" fill="none" stroke="#1D5FA8" stroke-width="9" stroke-linecap="round"/><path d="M56 52a6 6 0 1 1 10 4" fill="none" stroke="#1D5FA8" stroke-width="7" stroke-linecap="round"/></svg>`,
  logo: `<svg class="mark" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#1D5FA8"/><path d="M14 24a10 10 0 0 1 20 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M9 24a15 15 0 0 1 30 0" fill="none" stroke="#9CC5EE" stroke-width="3.5" stroke-linecap="round"/><circle cx="24" cy="28" r="4.5" fill="#fff"/></svg>`,
};

export function themeIcon(key) { return ICONS[key] || ICONS.ear; }
