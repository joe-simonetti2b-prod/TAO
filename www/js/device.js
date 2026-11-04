// Pont vers le module natif Android « TaoDevice » (volume, sortie audio, kiosque).
// Hors tablette (navigateur), des valeurs de repli permettent de tester l'interface.

function plugin() {
  try { return window.Capacitor?.Plugins?.TaoDevice || null; } catch { return null; }
}

export function isNative() {
  try { return !!window.Capacitor?.isNativePlatform?.() && !!plugin(); } catch { return false; }
}

// { native, wired, bluetooth, route, volumeIndex, volumeMax }
export async function getStatus() {
  const p = plugin();
  if (!p) return { native: false, wired: null, bluetooth: null, route: 'inconnue', volumeIndex: null, volumeMax: null };
  try { return { native: true, ...(await p.getStatus()) }; }
  catch (e) { return { native: true, error: String(e), wired: null, bluetooth: null, route: 'erreur' }; }
}

// Fixe le volume média et le maintient (touches et changements extérieurs neutralisés)
export async function lockVolume(index) {
  const p = plugin(); if (!p) return { ok: false, native: false };
  try { return { ok: true, ...(await p.lockVolume({ index })) }; }
  catch (e) { return { ok: false, error: String(e) }; }
}
export async function unlockVolume() {
  const p = plugin(); if (!p) return;
  try { await p.unlockVolume(); } catch {}
}
export async function setVolume(index) {
  const p = plugin(); if (!p) return { ok: false };
  try { return { ok: true, ...(await p.setVolume({ index })) }; } catch (e) { return { ok: false, error: String(e) }; }
}
export async function keepAwake(on) {
  const p = plugin(); if (!p) return;
  try { await p.keepAwake({ on }); } catch {}
}
export async function startKiosk() {
  const p = plugin(); if (!p) return;
  try { await p.startKiosk(); } catch {}
}
export async function stopKiosk() {
  const p = plugin(); if (!p) return;
  try { await p.stopKiosk(); } catch {}
}

// Écoute des branchements / débranchements du casque
export function onRouteChange(cb) {
  const p = plugin(); if (!p || !p.addListener) return () => {};
  let handle = null;
  Promise.resolve(p.addListener('routeChange', cb)).then(h => { handle = h; }).catch(() => {});
  return () => { try { handle?.remove?.(); } catch {} };
}

// Le test client n'est autorisé que si la sortie est le casque filaire.
// Hors tablette : autorisé en mode démonstration uniquement.
export async function audioRouteOk() {
  const s = await getStatus();
  if (!s.native) return { ok: true, demo: true, status: s };
  if (s.bluetooth) return { ok: false, reason: 'Un appareil Bluetooth audio est connecté. Désactivez le Bluetooth.', status: s };
  if (!s.wired) return { ok: false, reason: 'Le casque filaire n’est pas branché.', status: s };
  return { ok: true, demo: false, status: s };
}
