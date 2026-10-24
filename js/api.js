// Cliente de datos con caché en memoria + localStorage (respuestas rápidas y menos llamadas).
import { tcgdexBase, historyBase, getConfig } from './config.js';

const mem = new Map();
const PREFIX = 'tasador:c:';
const HOUR = 3600e3;

function readCache(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { t, ttl, v } = JSON.parse(raw);
    if (Date.now() - t > ttl) { localStorage.removeItem(PREFIX + key); return undefined; }
    mem.set(key, v);
    return v;
  } catch { return undefined; }
}

function writeCache(key, v, ttl) {
  mem.set(key, v);
  const payload = JSON.stringify({ t: Date.now(), ttl, v });
  try {
    localStorage.setItem(PREFIX + key, payload);
  } catch {
    // Memoria llena: borra la caché antigua y reintenta una vez.
    try {
      Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
      localStorage.setItem(PREFIX + key, payload);
    } catch { /* seguimos solo con memoria */ }
  }
}

const inflight = new Map();

/** GET JSON con caché. Devuelve null en 404. */
export async function getJSON(url, ttl = 6 * HOUR) {
  const cached = readCache(url);
  if (cached !== undefined) return cached;
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    const res = await fetch(url);
    if (res.status === 404) { writeCache(url, null, Math.min(ttl, 6 * HOUR)); return null; }
    if (!res.ok) throw new Error(`Error ${res.status} al consultar ${new URL(url).host}`);
    const data = await res.json();
    writeCache(url, data, ttl);
    return data;
  })();
  inflight.set(url, p);
  try { return await p; } finally { inflight.delete(url); }
}

export const tcgdex = {
  sets: (lang = 'en') => getJSON(`${tcgdexBase()}/${lang}/sets`, 7 * 24 * HOUR),
  card: (id, lang = 'en') => getJSON(`${tcgdexBase()}/${lang}/cards/${encodeURIComponent(id)}`, 6 * HOUR),
  search: (params, lang = 'en') => {
    const qs = new URLSearchParams(params).toString();
    return getJSON(`${tcgdexBase()}/${lang}/cards?${qs}`, 24 * HOUR).then(r => r || []);
  },
};

/** Archivo histórico público de TCGdex (TCGplayer, centavos USD, 2022-2024). */
export function archiveHistory(setId, localId) {
  const n = /^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId;
  return getJSON(`${historyBase()}/en/${setId}/${n}.tcgplayer.json`, 30 * 24 * HOUR).catch(() => null);
}

/** Historial propio que guarda GitHub Actions en data/history/. */
export async function ownHistory(cardId) {
  try {
    // El índice evita pedir archivos que no existen (cartas que aún no sigues).
    const index = await getJSON(new URL('data/history/index.json', document.baseURI).href, HOUR);
    if (!index?.cards?.some(c => c.id === cardId)) return null;
    const file = `data/history/${cardId.replace(/[^\w.-]/g, '_')}.json`;
    return await getJSON(new URL(file, document.baseURI).href, HOUR);
  } catch { return null; }
}

/** Estado del Worker opcional (precios japoneses, etc.). */
export async function workerInfo() {
  const w = getConfig().workerUrl.replace(/\/$/, '');
  if (!w) return null;
  try { return await getJSON(`${w}/`, HOUR); } catch { return null; }
}

export async function japanesePrices(name) {
  const w = getConfig().workerUrl.replace(/\/$/, '');
  if (!w) return null;
  return getJSON(`${w}/jp?search=${encodeURIComponent(name)}`, 12 * HOUR);
}

/** Tipo de cambio (USD base). Respeta el valor fijado a mano en Ajustes. */
export async function fxRates() {
  const o = getConfig().fxOverride;
  if (o && o.CLP && o.EUR) return { CLP: +o.CLP, EUR: +o.EUR, source: 'manual' };
  try {
    const d = await getJSON('https://open.er-api.com/v6/latest/USD', 12 * HOUR);
    if (d?.rates?.CLP && d?.rates?.EUR) return { CLP: d.rates.CLP, EUR: d.rates.EUR, source: 'open.er-api.com' };
  } catch { /* usa respaldo */ }
  return { CLP: 950, EUR: 0.92, source: 'aproximado (sin conexión)' };
}

/** Ejecuta fn sobre items con un máximo de n en paralelo. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}
