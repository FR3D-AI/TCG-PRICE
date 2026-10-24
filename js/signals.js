// Señales a futuro: cruza próximas versiones del mismo Pokémon, la reacción histórica de esta carta,
// la tendencia actual, su ciclo de vida y la rotación. No es una predicción garantizada: es una lectura de patrones.
import { getJSON } from './api.js';
import { tcgdexBase } from './config.js';
import { median, fmt, setIdFromCardId } from './logic.js';

const DAY = 864e5;
const ts = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = d => `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

// Próximas rotaciones conocidas o estimadas del formato Standard.
const NEXT_ROTATION = { G: '2026-04-10', H: '2027-04-09', I: '2028-04-07' };
// Pokémon con demanda de coleccionistas muy estable.
const ICONIC = new Set([6, 25, 150, 151, 133, 134, 135, 136, 196, 197, 470, 471, 700, 94, 448, 384, 249, 250, 382, 383, 487, 493, 643, 644, 658, 445]);
const COLLECTOR = /illustration|special|secret|hyper|gold|rainbow|alt|art|shiny|crown|star|ultra|rara ilustr|secreta/i;

/**
 * Lógica pura: combina las señales en un veredicto.
 * @returns {{verdict:'up'|'down'|'neutral', label:string, score:number, confidence:string, signals:Array}}
 */
export function computeSignals({ card, today, releaseDate, upcoming, analog, momentumPct }) {
  const signals = [];
  const now = ts(today);
  const ageDays = releaseDate ? (now - ts(releaseDate)) / DAY : null;
  const iconic = (card.dexId || []).some(d => ICONIC.has(d));
  const collector = COLLECTOR.test(card.rarity || '');

  // 1) Reacción histórica de ESTA carta cuando salieron otras versiones del mismo Pokémon.
  if (analog && analog.n >= 1 && Math.abs(analog.avgPct) >= 5) {
    signals.push({
      tone: analog.avgPct > 0 ? 'up' : 'down', weight: 2,
      confidence: analog.n >= 4 ? 'alta' : analog.n >= 2 ? 'media' : 'baja',
      title: `Cuando salieron otras versiones, ${analog.avgPct > 0 ? 'subió' : 'bajó'} ${fmt.pct(analog.avgPct)} en promedio`,
      text: `Medido en ${analog.n} ${analog.n === 1 ? 'caso' : 'casos'} con datos: precio del mes previo vs. los 2 meses siguientes a cada lanzamiento.`,
    });
  } else if (analog && analog.n >= 1) {
    signals.push({ tone: 'neutral', weight: 0, confidence: 'media', title: 'Antes no reaccionó mucho a versiones nuevas', text: `En ${analog.n} ${analog.n === 1 ? 'caso' : 'casos'} su precio se movió menos de 5%.` });
  }

  // 2) Próximas versiones del mismo Pokémon (Japón sale primero; en inglés/español llega 2-4 meses después).
  if (upcoming.length) {
    const u = upcoming[0];
    const tone = analog && Math.abs(analog.avgPct) >= 5 ? (analog.avgPct > 0 ? 'up' : 'down')
      : (ageDays != null && ageDays > 5 * 365) || iconic ? 'up' : 'down';
    signals.push({
      tone, weight: 1, confidence: analog && analog.n >= 2 ? 'media' : 'baja',
      title: `Viene una versión nueva: ${u.name}`,
      text: `${u.jp ? `Salió en Japón (${u.set}, ${monthLabel(u.date)}); suele llegar a inglés y español 2 a 4 meses después.` : `Set ${u.set}, ${monthLabel(u.date)}.`} ` +
        (tone === 'up'
          ? 'En cartas clásicas o de Pokémon muy populares, una versión nueva suele renovar el interés.'
          : 'En cartas recientes, una alternativa nueva del mismo Pokémon suele competir por los mismos compradores.') +
        (upcoming.length > 1 ? ` (+${upcoming.length - 1} más)` : ''),
    });
  }

  // 3) Tendencia actual (Cardmarket, último día vs. promedio de 30 días).
  if (momentumPct != null && Math.abs(momentumPct) >= 5) {
    signals.push({
      tone: momentumPct > 0 ? 'up' : 'down', weight: 1, confidence: 'media',
      title: `Tendencia de 30 días: ${fmt.pct(momentumPct)}`,
      text: 'Los movimientos de corto plazo a veces continúan unas semanas, pero también se revierten.',
    });
  }

  // 4) Ciclo de vida desde el lanzamiento.
  if (ageDays != null && ageDays >= 0 && ageDays < 180) {
    signals.push({ tone: 'down', weight: 1.5, confidence: 'media', title: 'Set reciente (menos de 6 meses)', text: 'En los primeros meses se siguen abriendo muchos sobres y el precio tiende a bajar hasta estabilizarse.' });
  } else if (ageDays != null && ageDays >= 180 && ageDays < 540) {
    signals.push({ tone: 'up', weight: 0.5, confidence: 'baja', title: 'Pasó la etapa de lanzamiento', text: 'Entre 6 y 18 meses suele estabilizarse; cuando el set deja de imprimirse, las cartas buscadas pueden recuperar valor.' });
  }

  // 5) Rotación del formato Standard.
  const rot = NEXT_ROTATION[card.regulationMark];
  if (rot) {
    const days = (ts(rot) - now) / DAY;
    if (days > 0 && days < 365) {
      signals.push({
        tone: collector ? 'neutral' : 'down', weight: collector ? 0 : 1, confidence: 'media',
        title: `Rotación en ${monthLabel(rot)} (aprox.)`,
        text: collector ? 'Es una carta de colección: la rotación le afecta poco.' : 'Deja de jugarse en torneos Standard; las cartas de juego suelen bajar alrededor de esa fecha.',
      });
    }
  }

  // 6) Pokémon icónico.
  if (iconic) {
    signals.push({ tone: 'up', weight: 0.5, confidence: 'baja', title: 'Pokémon con demanda constante', text: 'Los coleccionistas lo buscan siempre: suele resistir mejor las bajas que otros.' });
  }

  const conf = { alta: 1, media: 0.75, baja: 0.5 };
  const score = signals.reduce((s, x) => s + (x.tone === 'up' ? 1 : x.tone === 'down' ? -1 : 0) * x.weight * conf[x.confidence], 0);
  const verdict = score >= 0.75 ? 'up' : score <= -0.75 ? 'down' : 'neutral';
  const strong = signals.filter(s => s.weight >= 1).length;
  const confidence = analog && analog.n >= 2 && strong >= 2 ? 'media' : 'baja';
  const label = { up: 'Posible alza', down: 'Posible baja', neutral: 'Sin señal clara' }[verdict];
  return { verdict, label, score, confidence, signals };
}

/** Reacción histórica: precio el mes previo vs. 2 meses después de cada versión nueva. */
export function analogReaction(points, eventDates) {
  const cases = [];
  for (const d of eventDates) {
    const t = ts(d);
    const before = points.filter(p => ts(p.date) >= t - 30 * DAY && ts(p.date) < t).map(p => p.usd);
    const after = points.filter(p => ts(p.date) >= t + 15 * DAY && ts(p.date) <= t + 75 * DAY).map(p => p.usd);
    if (before.length >= 2 && after.length >= 2) cases.push((median(after) / median(before) - 1) * 100);
  }
  return cases.length ? { n: cases.length, avgPct: cases.reduce((s, x) => s + x, 0) / cases.length } : null;
}

async function safe(url, ttl) { try { return await getJSON(url, ttl); } catch { return null; } }
const WEEK = 7 * 24 * 36e5;

/** Junta los datos (red) y dibuja la sección. */
export async function renderSignals(el, card, fx, series, nowUsd) {
  el.innerHTML = '<h2>Señales a futuro</h2><div class="center"><div class="spinner"></div><p class="muted">Revisando próximos sets y casos parecidos…</p></div>';
  const today = new Date().toISOString().slice(0, 10);
  const dex = (card.dexId || [])[0];
  const base = tcgdexBase();
  const own = card.set?.id ? await safe(`${base}/en/sets/${card.set.id}`, WEEK) : null;
  const releaseDate = own?.releaseDate || null;

  // Otras versiones en inglés (para casos históricos y sets futuros ya anunciados).
  let enEvents = [], upcoming = [];
  if (dex) {
    const [en, ja] = await Promise.all([
      safe(`${base}/en/cards?dexId=eq:${dex}`, 24 * 36e5),
      safe(`${base}/ja/cards?dexId=eq:${dex}`, 24 * 36e5),
    ]);
    const enSets = [...new Set((en || []).map(b => setIdFromCardId(b.id)))].filter(s => s !== card.set?.id && !/^(A\d+[a-z]?|P-A)$/.test(s)).slice(0, 40);
    const enInfo = (await Promise.all(enSets.map(s => safe(`${base}/en/sets/${s}`, WEEK)))).filter(Boolean);
    enEvents = enInfo.filter(s => s.releaseDate && (!releaseDate || s.releaseDate > releaseDate)).map(s => ({ date: s.releaseDate, set: s.name }));
    for (const s of enInfo) {
      if (s.releaseDate && s.releaseDate > today) {
        const c = (en || []).find(b => setIdFromCardId(b.id) === s.id);
        upcoming.push({ date: s.releaseDate, set: s.name, name: c?.name || card.name, jp: false });
      }
    }
    // Japón: sets de los últimos 6 meses con este Pokémon.
    const jaSets = [...new Set((ja || []).map(b => setIdFromCardId(b.id)))].slice(-30);
    const jaInfo = (await Promise.all(jaSets.map(s => safe(`${base}/ja/sets/${s}`, WEEK)))).filter(Boolean);
    for (const s of jaInfo) {
      if (s.releaseDate && ts(today) - ts(s.releaseDate) < 180 * DAY && ts(s.releaseDate) - ts(today) < 120 * DAY) {
        const c = (ja || []).find(b => setIdFromCardId(b.id) === s.id);
        upcoming.push({ date: s.releaseDate, set: s.name, name: c?.name || '', jp: true });
      }
    }
    upcoming.sort((a, b) => b.date.localeCompare(a.date));
  }

  const points = series.flatMap(s => s.points);
  const analog = analogReaction(points, enEvents.map(e => e.date));
  const cm = card.pricing?.cardmarket;
  const nowCm = cm?.avg1 ?? cm?.avg7 ?? cm?.trend;
  const momentumPct = nowCm && cm?.avg30 ? (nowCm / cm.avg30 - 1) * 100 : null;
  const r = computeSignals({ card, today, releaseDate, upcoming, analog, momentumPct });

  const arrow = { up: '↑', down: '↓', neutral: '→' };
  // Medidor: -3 (baja) … +3 (alza)
  const pos = Math.max(0, Math.min(100, 50 + r.score / 3 * 50));
  el.innerHTML = `<h2>Señales a futuro</h2>
    <div class="sig-verdict ${r.verdict}">
      <span class="sig-arrow">${arrow[r.verdict]}</span>
      <div><strong>${r.label}</strong><small>Próximos meses · confianza ${r.confidence}</small></div>
    </div>
    <div class="sig-gauge" aria-hidden="true"><i style="left:${pos}%"></i></div>
    <div class="sig-scale"><span>Baja</span><span>Neutral</span><span>Alza</span></div>
    <div class="sig-list">${r.signals.map(s => `
      <div class="sig ${s.tone}">
        <span class="sig-ico">${arrow[s.tone]}</span>
        <div><b>${esc(s.title)}</b><p>${esc(s.text)}</p><small>Peso ${s.weight} · confianza ${s.confidence}</small></div>
      </div>`).join('') || '<p class="muted">No hay suficientes datos para generar señales sobre esta carta.</p>'}</div>
    <div class="sig-legend"><span class="up">↑ alza</span><span class="down">↓ baja</span><span class="neutral">→ neutral</span></div>
    <p class="note">Lectura de patrones con datos públicos, no una predicción garantizada ni consejo de inversión. El mercado de cartas cambia por factores que no están en los datos (influencers, reimpresiones sorpresa, torneos).</p>`;
}
