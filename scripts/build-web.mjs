// Copie www → dist et obfusque le JavaScript (protection contre la copie du code)
import fs from 'fs';
import path from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const SRC = 'www', OUT = 'dist';
fs.rmSync(OUT, { recursive: true, force: true });
const banner = '/* TAO – © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés. Reproduction interdite. */\n';

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), o = path.join(OUT, path.relative(SRC, p));
    if (e.isDirectory()) { fs.mkdirSync(o, { recursive: true }); walk(p); continue; }
    if (p.endsWith('.js') && !p.includes('vendor') && !process.env.NO_OBFUSCATE) {
      const code = fs.readFileSync(p, 'utf8');
      const res = JavaScriptObfuscator.obfuscate(code, {
        compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.5,
        deadCodeInjection: true, deadCodeInjectionThreshold: 0.2,
        stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.8,
        identifierNamesGenerator: 'hexadecimal', renameGlobals: false, selfDefending: true,
        sourceType: 'module', target: 'browser',
      });
      fs.writeFileSync(o, banner + res.getObfuscatedCode());
    } else fs.copyFileSync(p, o);
  }
}
fs.mkdirSync(OUT, { recursive: true });
walk(SRC);
console.log('dist/ prêt' + (process.env.NO_OBFUSCATE ? ' (non obfusqué)' : ' (obfusqué)'));
