// Funciones puras (sin red ni DOM) para que se puedan probar fácilmente.

// ---------- Texto ----------
export function normalize(s = '') {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Similitud 0..1 entre el nombre leído por OCR y un nombre real. */
export function similarity(guess, name) {
  const a = normalize(guess), b = normalize(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const ta = new Set(a.split(' ')), tb = b.split(' ');
  const tokens = tb.filter(t => t.length > 1 && ta.has(t)).length / Math.max(tb.length, 1);
  return Math.max(lev, tokens * 0.85);
}

// ---------- OCR ----------
const NOISE = new Set(['hp', 'ps', 'pv', 'kp', 'basic', 'basico', 'stage', 'fase', 'etapa', 'evoluciona', 'evolves', 'from', 'de', 'trainer', 'entrenador', 'pokemon', 'item', 'objeto', 'supporter', 'partidario']);

/**
 * Extrae número de colección y posible nombre del texto OCR.
 * @param {string} topText texto de la franja superior (nombre)
 * @param {string} bottomText texto de la franja inferior (número)
 */
export function parseOcr(topText = '', bottomText = '') {
  const all = `${bottomText}\n${topText}`;
  // OCR confunde "/" con l, I, | o 1 rodeado de espacios.
  const re = /([A-Z]{0,3})\s?0*(\d{1,3})\s*[\/|lI\\]\s*([A-Z]{0,3})?0*(\d{2,3})\b/g;
  const found = [];
  for (const m of all.matchAll(re)) {
    const local = parseInt(m[2], 10), total = parseInt(m[4], 10);
    if (!total || local === 0 || local > total + 150) continue;
    found.push({ prefix: m[1] || '', local, total, raw: m[0].trim() });
  }
  // Preferir el que aparece en el texto inferior.
  const number = found[0] || null;

  let nameGuess = '';
  const lines = topText.split(/\n+/).map(l => l.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' \-]/g, ' ').replace(/\s+/g, ' ').trim());
  for (const line of lines) {
    const words = line.split(' ').filter(w => w.length > 1 && !NOISE.has(normalize(w)));
    const candidate = words.join(' ');
    if (candidate.length > nameGuess.length && candidate.length <= 30) nameGuess = candidate;
  }
  // "ex", "V", "VMAX", "GX" suelen quedar pegados al nombre: se mantienen.
  return { number, nameGuess: nameGuess.trim() };
}

export function localIdVariants({ prefix = '', local }) {
  const s = String(local);
  const out = new Set([s, s.padStart(3, '0')]);
  if (prefix) { out.add(prefix + s.padStart(2, '0')); out.add(prefix + s.padStart(3, '0')); out.add(prefix + s); }
  return [...out];
}

export function setIdFromCardId(id) {
  return id.slice(0, id.lastIndexOf('-'));
}

// ---------- Precios ----------
const VARIANT_ES = {
  normal: 'Normal',
  holofoil: 'Holo',
  'reverse-holofoil': 'Reverse holo',
  '1st-edition-holofoil': '1ª edición holo',
  '1st-edition-normal': '1ª edición',
  '1st-edition': '1ª edición',
  unlimited: 'Ilimitada',
  'unlimited-holofoil': 'Ilimitada holo',
};
export const variantLabel = k => VARIANT_ES[k] || k.replace(/-/g, ' ');

/** Resume el objeto `pricing` de TCGdex. */
export function summarizePricing(pricing) {
  const tp = pricing?.tcgplayer || null;
  const cm = pricing?.cardmarket || null;
  const tcg = [];
  if (tp) {
    for (const [k, v] of Object.entries(tp)) {
      if (!v || typeof v !== 'object') continue;
      tcg.push({ variant: k, label: variantLabel(k), low: v.lowPrice ?? null, mid: v.midPrice ?? null, high: v.highPrice ?? null, market: v.marketPrice ?? v.midPrice ?? null });
    }
    const order = ['holofoil', 'normal', '1st-edition-holofoil', 'reverse-holofoil'];
    tcg.sort((a, b) => (order.indexOf(a.variant) + 99) % 99 - (order.indexOf(b.variant) + 99) % 99);
  }
  let cmOut = null;
  if (cm) {
    cmOut = {
      trend: cm.trend ?? null, avg: cm.avg ?? null, low: cm.low ?? null,
      avg1: cm.avg1 ?? null, avg7: cm.avg7 ?? null, avg30: cm.avg30 ?? null,
      holo: (cm['trend-holo'] != null || cm['avg-holo'] != null) ? {
        trend: cm['trend-holo'] ?? null, avg: cm['avg-holo'] ?? null, low: cm['low-holo'] ?? null,
        avg1: cm['avg1-holo'] ?? null, avg7: cm['avg7-holo'] ?? null, avg30: cm['avg30-holo'] ?? null,
      } : null,
      updated: cm.updated ?? null,
    };
  }
  const primary = tcg.find(v => v.market != null);
  return {
    tcg, cardmarket: cmOut,
    usd: primary ? primary.market : null,
    eur: cmOut ? (cmOut.trend ?? cmOut.avg ?? cmOut.holo?.trend ?? null) : null,
    tcgUpdated: tp?.updated ?? null,
  };
}

/** Valor de referencia en USD combinando TCGplayer y Cardmarket. */
export function referenceUsd(summary, fx) {
  if (summary.usd != null) return summary.usd;
  if (summary.eur != null && fx?.EUR) return summary.eur / fx.EUR;
  return null;
}

/** Tendencia de corto plazo según Cardmarket (promedio 1 día vs 30 días). */
export function momentum(cm) {
  if (!cm) return null;
  const now = cm.avg1 ?? cm.avg7 ?? cm.trend, base = cm.avg30;
  if (now == null || !base) return null;
  const pct = (now / base - 1) * 100;
  return { pct, label: pct > 5 ? 'Subiendo' : pct < -5 ? 'Bajando' : 'Estable' };
}

// ---------- Historial ----------
/** Elige la serie más útil del archivo TCGdex (prioriza Near Mint). Valores en centavos USD. */
export function pickArchiveSeries(archive) {
  const data = archive?.data;
  if (!data) return null;
  const entries = Object.entries(data).filter(([, v]) => v?.history && Object.keys(v.history).length);
  if (!entries.length) return null;
  const score = ([k, v]) => Object.keys(v.history).length * (k.endsWith('nearmint') ? 3 : k.endsWith('good') ? 2 : 1) * (k.startsWith('reverse') ? 0.5 : 1);
  entries.sort((a, b) => score(b) - score(a));
  const [key, v] = entries[0];
  const points = Object.entries(v.history)
    .map(([date, p]) => ({ date, usd: p.avg / 100 }))
    .filter(p => p.usd > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const [variant, condition] = key.split('-');
  const condEs = { nearmint: 'Near Mint', good: 'Buena', played: 'Jugada', used: 'Usada', poor: 'Mala' }[condition] || condition;
  return { label: `${variantLabel(variant === 'holo' ? 'holofoil' : variant === 'reverse' ? 'reverse-holofoil' : variant)} · ${condEs}`, points };
}

/** Convierte el historial propio (GitHub Actions) en serie USD. */
export function ownSeries(own, fx) {
  if (!own?.points?.length) return null;
  const points = own.points.map(p => {
    const vals = Object.values(p.tcgplayer || {}).filter(x => x != null);
    let usd = vals.length ? Math.max(...vals) : null;
    if (usd == null && p.cardmarket?.trend != null && fx?.EUR) usd = p.cardmarket.trend / fx.EUR;
    return { date: p.date, usd };
  }).filter(p => p.usd != null).sort((a, b) => a.date.localeCompare(b.date));
  return points.length ? { label: 'Tu historial diario', points } : null;
}

/** Quita valores atípicos (ventas sueltas muy fuera de rango) con la regla de la mediana. */
export function dropOutliers(points) {
  if (points.length < 6) return points;
  const vals = points.map(p => p.usd).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  return points.filter(p => p.usd <= med * 4 && p.usd >= med / 4);
}

/** Suaviza la serie para el gráfico: mediana por semana (las ventas sueltas varían mucho). */
export function weekly(points) {
  const by = new Map();
  for (const p of points) {
    const d = new Date(p.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const k = d.toISOString().slice(0, 10);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p.usd);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, usd: median(v) }));
}

/** Resumen por año: promedio, mínimo, máximo y variación vs el año anterior. */
export function yearly(points) {
  const by = new Map();
  for (const p of points) {
    const y = p.date.slice(0, 4);
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(p.usd);
  }
  const rows = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, vals]) => ({
    year, n: vals.length,
    avg: vals.reduce((s, v) => s + v, 0) / vals.length,
    min: Math.min(...vals), max: Math.max(...vals),
  }));
  rows.forEach((r, i) => { r.changePct = i ? (r.avg / rows[i - 1].avg - 1) * 100 : null; });
  return rows;
}

// ---------- Valor en español ----------
export function median(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Estima el valor de la versión en español en CLP.
 * Prioridad (peso): MercadoLibre 3, Cardmarket español 2, foros 1.
 * @param {{ml:number[], cmEs:number[], foros:number[]}} entries ml y foros en CLP, cmEs en EUR
 * @param {{CLP:number, EUR:number}} fx
 * @param {number|null} globalUsd referencia global si no hay datos en español
 */
export function spanishEstimate(entries, fx, globalUsd) {
  const eurToClp = fx.CLP / fx.EUR;
  const sources = [
    { key: 'ml', label: 'MercadoLibre Chile', weight: 3, value: median(entries.ml || []), n: (entries.ml || []).length },
    { key: 'cmEs', label: 'Cardmarket (español)', weight: 2, value: median((entries.cmEs || []).map(e => e * eurToClp)), n: (entries.cmEs || []).length },
    { key: 'foros', label: 'Foros', weight: 1, value: median(entries.foros || []), n: (entries.foros || []).length },
  ];
  const used = sources.filter(s => s.value != null);
  if (used.length) {
    const w = used.reduce((s, x) => s + x.weight * Math.min(x.n, 5), 0);
    const value = used.reduce((s, x) => s + x.value * x.weight * Math.min(x.n, 5), 0) / w;
    const n = used.reduce((s, x) => s + x.n, 0);
    return { value, confidence: n >= 6 ? 'alta' : n >= 3 ? 'media' : 'baja', sources, fallback: false };
  }
  return {
    value: globalUsd != null ? globalUsd * fx.CLP : null,
    confidence: 'referencial', sources, fallback: true,
  };
}

// ---------- Formato ----------
export const fmt = {
  usd: v => v == null ? '—' : `$${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
  eur: v => v == null ? '—' : `€${v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`,
  clp: v => v == null ? '—' : `$${Math.round(v).toLocaleString('es-CL')} CLP`,
  pct: v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
};
