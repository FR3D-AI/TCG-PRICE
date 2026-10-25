// Configuración guardada en el navegador (pantalla "Ajustes").
const KEY = 'tasador:config';

const DEFAULTS = {
  workerUrl: '',        // ej. https://tasador-api.tu-usuario.workers.dev (opcional)
  githubRepo: '',       // ej. tu-usuario/tasador-tcg (para el historial diario)
  githubToken: '',      // token fine-grained solo para ese repositorio (Contents: Read and write)
  fxOverride: null,     // { CLP: 950, EUR: 0.92 } si quieres fijar el cambio a mano
};

export function getConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  return next;
}

export function tcgdexBase() {
  const w = getConfig().workerUrl.replace(/\/$/, '');
  return w ? `${w}/tcgdex/v2` : 'https://api.tcgdex.net/v2';
}

export function historyBase() {
  const w = getConfig().workerUrl.replace(/\/$/, '');
  return w ? `${w}/history` : 'https://raw.githubusercontent.com/tcgdex/price-history/master';
}
