// Línea de tiempo horizontal: historial completo desde la salida del set, con anotaciones
// automáticas (lanzamiento, nuevas versiones, rotación, subidas y bajadas) y botón para investigar con Claude.
import { getJSON } from './api.js';
import { tcgdexBase } from './config.js';
import { median, fmt, setIdFromCardId } from './logic.js';

const DAY = 864e5;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const monthLabel = d => `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const ts = d => new Date(d.slice(0, 10) + 'T00:00:00Z').getTime();
const iso = t => new Date(t).toISOString().slice(0, 10);

// Rotaciones del formato Standard (sale de torneos la marca indicada).
export const ROTATIONS = {
  D: { date: '2023-04-14', approx: true },
  E: { date: '2024-04-05', approx: false },
  F: { date: '2025-04-11', approx: false },
  G: { date: '2026-04-10', approx: true },
};

/** Mediana por mes: suaviza ventas sueltas para detectar tendencias reales. */
export function monthly(points) {
  const by = new Map();
  for (const p of points) {
    const k = p.date.slice(0, 7);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p.usd);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => ({ date: m + '-15', usd: median(v), n: v.length }));
}

/**
 * Detecta subidas/bajadas fuertes comparando cada mes con el de 2 meses antes.
 * Incluye el salto entre el último dato y hoy cuando hay un hueco.
 */
export function detectMoves(points, nowUsd, today = iso(Date.now())) {
  const m = monthly(points);
  const moves = [];
  let skipUntil = -1;
  for (let i = 2; i < m.length; i++) {
    if (i <= skipUntil) continue;
    // Solo compara meses consecutivos reales (sin huecos grandes).
    if (ts(m[i].date) - ts(m[i - 2].date) > 100 * DAY) continue;
    const pct = (m[i].usd / m[i - 2].usd - 1) * 100;
    if (pct >= 30 || pct <= -25) {
      // Extiende mientras siga en la misma dirección.
      let j = i;
      while (j + 1 < m.length && ts(m[j + 1].date) - ts(m[j].date) < 50 * DAY &&
        Math.sign(m[j + 1].usd - m[j].usd) === Math.sign(pct)) j++;
      const total = (m[j].usd / m[i - 2].usd - 1) * 100;
      moves.push({ from: m[i - 2].date, to: m[j].date, fromUsd: m[i - 2].usd, toUsd: m[j].usd, pct: total, dir: total > 0 ? 'up' : 'down' });
      skipUntil = j + 1;
    }
  }
  // Saltos a través de períodos sin datos (incluye el último dato → hoy).
  const seq = [...m];
  if (nowUsd != null && (!seq.length || seq[seq.length - 1].date < today)) seq.push({ date: today, usd: nowUsd });
  for (let i = 1; i < seq.length; i++) {
    if (ts(seq[i].date) - ts(seq[i - 1].date) <= 120 * DAY) continue;
    const pct = (seq[i].usd / seq[i - 1].usd - 1) * 100;
    if (Math.abs(pct) >= 20) moves.push({ from: seq[i - 1].date, to: seq[i].date, fromUsd: seq[i - 1].usd, toUsd: seq[i].usd, pct, dir: pct > 0 ? 'up' : 'down', gap: true });
  }
  return moves.sort((x, y) => x.to.localeCompare(y.to));
}

/** Busca la causa más probable entre los eventos cercanos a una subida o bajada. */
export function explainMove(move, events, releaseDate) {
  const a = ts(move.from) - 75 * DAY, b = ts(move.to) + 30 * DAY;
  const near = events.filter(e => ts(e.date) >= a && ts(e.date) <= b);
  const rot = near.find(e => e.type === 'rotation');
  const reps = near.filter(e => e.type === 'reprint');
  const months = Math.round((ts(move.to) - ts(move.from)) / (30 * DAY));
  const span = move.gap ? `entre ${monthLabel(move.from)} y ${move.to === iso(Date.now()) ? 'hoy' : monthLabel(move.to)}` : `en ${Math.max(months, 1)} ${months === 1 ? 'mes' : 'meses'}`;
  const head = `${move.dir === 'up' ? 'Subió' : 'Bajó'} ${fmt.pct(move.pct)} ${span}`;
  const reasons = [];
  if (releaseDate && move.dir === 'down' && ts(move.from) - ts(releaseDate) < 200 * DAY) {
    reasons.push('Es normal tras el lanzamiento: se abren muchos sobres y aparecen más copias a la venta.');
  }
  if (releaseDate && move.dir === 'up' && ts(move.from) - ts(releaseDate) < 200 * DAY) {
    reasons.push('El set dejó de estar en preventa y bajó la oferta de copias nuevas: suele recuperar valor a los meses del lanzamiento.');
  }
  if (rot) reasons.push(move.dir === 'down'
    ? 'Coincide con la rotación del formato Standard: deja de usarse en torneos y baja la demanda de jugadores.'
    : 'Coincide con una rotación del formato Standard, que cambia qué cartas se juegan en torneos.');
  if (reps.length) reasons.push(move.dir === 'down'
    ? `Coincide con nuevas versiones del mismo Pokémon (${reps.map(r => r.set).slice(0, 2).join(', ')}): más alternativas suelen bajar el precio.`
    : `Coincide con nuevas versiones del mismo Pokémon (${reps.map(r => r.set).slice(0, 2).join(', ')}), que pueden renovar el interés por el personaje.`);
  if (!reasons.length) reasons.push(move.dir === 'up'
    ? 'Sin un evento claro en los datos: suele deberse a demanda de coleccionistas, popularidad del Pokémon o menos copias disponibles.'
    : 'Sin un evento claro en los datos: suele deberse a más copias a la venta o menor interés.');
  if (move.gap) reasons.push('No hay datos gratuitos de ese período, así que el cambio se ve como un salto.');
  return { head, text: reasons.join(' ') };
}

export function claudeUrl(prompt) {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function investigatePrompt(card, move) {
  const what = `la carta Pokémon "${card.name}" (${card.set?.name || ''} ${card.localId}${card.set?.cardCount?.official ? '/' + card.set.cardCount.official : ''}, rareza ${card.rarity || '?'})`;
  if (!move) return `Investiga el historial de precio de ${what} desde su lanzamiento hasta hoy. Explica en español, breve y con fechas, qué eventos hicieron subir o bajar su valor (reimpresiones, rotación, torneos, noticias, tendencias de coleccionistas, influencers).`;
  return `Investiga por qué el precio de ${what} ${move.dir === 'up' ? 'subió' : 'bajó'} ${Math.abs(Math.round(move.pct))}% entre ${monthLabel(move.from)} y ${move.to === iso(Date.now()) ? 'hoy' : monthLabel(move.to)} (de ${fmt.usd(move.fromUsd)} a ${fmt.usd(move.toUsd)}). Considera reimpresiones, rotación de formato, torneos, noticias y tendencias de coleccionistas. Responde en español, breve.`;
}

async function setInfo(id) {
  try { return await getJSON(`${tcgdexBase()}/en/sets/${encodeURIComponent(id)}`, 7 * 24 * 36e5); } catch { return null; }
}

/** Eventos conocidos: salida del set, nuevas versiones del mismo Pokémon y rotación. */
async function loadEvents(card) {
  const own = card.set?.id ? await setInfo(card.set.id) : null;
  const release = own?.releaseDate || null;
  const events = [];
  if (release) events.push({ type: 'release', date: release, title: `Sale el set ${card.set?.name || ''}` });
  try {
    const briefs = await getJSON(`${tcgdexBase()}/en/cards?name=${encodeURIComponent('eq:' + card.name)}`, 24 * 36e5) || [];
    const setIds = [...new Set(briefs.map(b => setIdFromCardId(b.id)))]
      .filter(s => s !== card.set?.id && !/^(A\d+[a-z]?|P-A)$/.test(s)).slice(0, 25);
    const infos = await Promise.all(setIds.map(setInfo));
    for (const s of infos) {
      if (s?.releaseDate && release && s.releaseDate > release) {
        events.push({ type: 'reprint', date: s.releaseDate, set: s.name, title: `Nueva versión en ${s.name}` });
      }
    }
  } catch { /* sin versiones */ }
  const rot = ROTATIONS[card.regulationMark];
  if (rot && (!release || rot.date > release)) {
    events.push({ type: 'rotation', date: rot.date, title: `Rotación: la marca ${card.regulationMark} sale del formato Standard${rot.approx ? ' (fecha aprox.)' : ''}` });
  }
  return { release, events: events.filter(e => e.date <= iso(Date.now())).sort((a, b) => a.date.localeCompare(b.date)) };
}

const COLORS = { release: 'var(--accent)', reprint: 'var(--c2)', rotation: 'var(--c3)', up: 'var(--up)', down: 'var(--down)' };

/**
 * @param {HTMLElement} el contenedor
 * @param {object} card carta TCGdex (en)
 * @param {{CLP:number, EUR:number}} fx
 * @param {Array<{label:string, points:Array<{date:string, usd:number}>}>} series
 * @param {number|null} nowUsd precio de hoy
 */
export async function renderTimeline(el, card, fx, series, nowUsd) {
  el.innerHTML = '<div class="center"><div class="spinner"></div><p class="muted">Armando la línea de tiempo…</p></div>';
  const { release, events } = await loadEvents(card);
  const today = iso(Date.now());

  const lines = series.map(s => ({ label: s.label, kind: 'tcg', points: weeklyMedian(s.points) }));
  const cm = card.pricing?.cardmarket;
  if (cm && fx?.EUR) {
    const t0 = Date.now();
    const pts = [[cm.avg30, 15], [cm.avg7, 3], [cm.avg1 ?? cm.trend, 0]]
      .filter(([v]) => v > 0).map(([v, d]) => ({ date: iso(t0 - d * DAY), usd: v / fx.EUR }));
    if (pts.length) lines.push({ label: 'Cardmarket (últimos 30 días, en USD)', kind: 'cm', points: pts });
  }
  const tcgPoints = series.flatMap(s => s.points);
  const moves = detectMoves(tcgPoints, nowUsd, today);

  const all = lines.flatMap(l => l.points);
  if (nowUsd != null) all.push({ date: today, usd: nowUsd });
  if (!all.length && !release) {
    el.innerHTML = '<p class="muted">Aún no hay datos para la línea de tiempo.</p>';
    return;
  }

  // ---- Geometría (ancho según cantidad de meses → se desplaza horizontalmente) ----
  const start = release || all.map(p => p.date).sort()[0];
  const x0 = ts(start) - 15 * DAY, x1 = ts(today) + 20 * DAY;
  const monthsSpan = (x1 - x0) / (30.4 * DAY);
  const W = Math.max(640, Math.round(monthsSpan * (monthsSpan > 120 ? 14 : 34))), H = 300, L = 8, R = 16, T = 36, B = 34;
  const vals = all.map(p => p.usd);
  let y0 = vals.length ? Math.min(...vals) : 0, y1 = vals.length ? Math.max(...vals) : 1;
  const pad = (y1 - y0) * 0.12 || y1 * 0.1 || 1; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = t => L + (t - x0) / (x1 - x0) * (W - L - R);
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

  let svg = '';
  // Meses y años
  const d = new Date(x0); d.setUTCDate(1);
  for (let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); t < x1; ) {
    const dt = new Date(t), month = dt.getUTCMonth();
    const x = X(t);
    if (month === 0) svg += `<line x1="${x}" x2="${x}" y1="${T - 8}" y2="${H - B}" class="tl-year"/><text x="${x + 4}" y="${H - 8}" class="tl-yeartext">${dt.getUTCFullYear()}</text>`;
    else if (monthsSpan < 40 || (monthsSpan <= 120 && month % 3 === 0)) svg += `<text x="${x}" y="${H - 14}" text-anchor="middle" class="axis">${MONTHS[month]}</text>`;
    t = Date.UTC(dt.getUTCFullYear(), month + 1, 1);
  }
  // Guías de precio (etiquetas a la izquierda, fijas en el contenedor)
  const ticks = [0, 1, 2, 3, 4].map(i => y0 + (y1 - y0) * i / 4);
  for (const v of ticks) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>`;

  // Huecos sin datos
  const dates = all.map(p => ts(p.date)).sort((a, b) => a - b);
  const gaps = [];
  if (release && dates.length && dates[0] - ts(release) > 45 * DAY) gaps.push([ts(release), dates[0]]);
  for (let i = 1; i < dates.length; i++) if (dates[i] - dates[i - 1] > 75 * DAY) gaps.push([dates[i - 1], dates[i]]);
  if (!dates.length && release) gaps.push([ts(release), ts(today)]);
  for (const [a, b] of gaps) {
    const w = X(b) - X(a);
    svg += `<rect x="${X(a)}" y="${T}" width="${w}" height="${H - T - B}" class="tl-gap"/>`;
    if (w > 70) svg += `<text x="${(X(a) + X(b)) / 2}" y="${(T + H - B) / 2}" text-anchor="middle" class="tl-gaptext">sin datos gratis</text>`;
  }

  // Zonas de subida / bajada
  moves.filter(m => !m.gap).forEach(m => {
    svg += `<rect x="${X(ts(m.from))}" y="${T}" width="${Math.max(3, X(ts(m.to)) - X(ts(m.from)))}" height="${H - T - B}" class="tl-move ${m.dir}"/>`;
  });

  // Líneas de precio
  const lineColor = { tcg: 'var(--c1)', cm: 'var(--c2)' };
  lines.forEach(l => {
    if (!l.points.length) return;
    const dd = l.points.map((p, j) => `${j && ts(p.date) - ts(l.points[j - 1].date) < 75 * DAY ? 'L' : 'M'}${X(ts(p.date)).toFixed(1)},${Y(p.usd).toFixed(1)}`).join('');
    svg += `<path d="${dd}" fill="none" stroke="${lineColor[l.kind]}" stroke-width="2" stroke-linejoin="round" ${l.kind === 'cm' ? 'stroke-dasharray="5 4"' : ''}/>`;
  });
  if (nowUsd != null) {
    svg += `<circle cx="${X(ts(today))}" cy="${Y(nowUsd)}" r="5" fill="var(--c1)" stroke="var(--panel)" stroke-width="2"/>` +
      `<text x="${X(ts(today)) - 8}" y="${Y(nowUsd) - 10}" text-anchor="end" class="tl-now">Hoy ${fmt.usd(nowUsd)}</text>`;
  }

  // Marcas numeradas (eventos + movimientos), ordenadas por fecha
  const notes = [
    ...events.map(e => ({ date: e.date, kind: e.type, title: e.title, text: eventText(e) })),
    ...moves.map(m => { const ex = explainMove(m, events, release); return { date: m.to, kind: m.dir, title: ex.head, text: ex.text, move: m }; }),
  ].sort((a, b) => a.date.localeCompare(b.date));
  notes.forEach((n, i) => {
    const x = X(ts(n.date));
    svg += `<line x1="${x}" x2="${x}" y1="${T - 6}" y2="${H - B}" stroke="${COLORS[n.kind]}" stroke-dasharray="3 3" stroke-width="1.2"/>` +
      `<circle cx="${x}" cy="${T - 16}" r="10" fill="${COLORS[n.kind]}"/><text x="${x}" y="${T - 12}" text-anchor="middle" class="tl-pin">${i + 1}</text>`;
  });

  const yLabels = ticks.map(v => `<span style="top:${Y(v) - 8}px">${v >= 100 ? '$' + Math.round(v) : '$' + v.toFixed(1)}</span>`).join('');
  const legend = lines.filter(l => l.points.length).map(l =>
    `<span class="legend"><i style="background:${lineColor[l.kind]}"></i>${esc(l.label)}</span>`).join('');

  el.innerHTML = `
    <div class="tl-wrap">
      <div class="tl-y" style="height:${H}px"><b>USD</b>${yLabels}</div>
      <div class="tl-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="tl-svg" role="img" aria-label="Línea de tiempo del precio">${svg}</svg></div>
    </div>
    <div class="legends">${legend}<span class="legend"><i class="tl-gapkey"></i>sin datos gratis</span></div>
    <p class="note">Desliza el gráfico hacia los lados para ver toda la historia${release ? ` desde ${monthLabel(release)}` : ''}.</p>
    <ol class="tl-notes">${notes.map(n => `
      <li class="${n.kind}"><div><b>${esc(n.title)}</b> <small>${monthLabel(n.date)}</small></div>
        <p>${esc(n.text)}</p>
        ${n.move ? `<a class="small" target="_blank" rel="noopener" href="${claudeUrl(investigatePrompt(card, n.move))}">Investigar con Claude ↗</a>` : ''}
      </li>`).join('')}</ol>
    ${notes.length ? '' : '<p class="muted">No se detectaron cambios fuertes ni eventos en el período con datos.</p>'}
    <a class="btn ghost" target="_blank" rel="noopener" href="${claudeUrl(investigatePrompt(card))}">Investigar toda su historia con Claude ↗</a>`;
  const sc = el.querySelector('.tl-scroll');
  sc.scrollLeft = sc.scrollWidth;
}

function eventText(e) {
  if (e.type === 'release') return 'Primer día a la venta. Al principio el precio suele ser alto y luego baja a medida que se abren sobres.';
  if (e.type === 'reprint') return 'Sale otra carta del mismo Pokémon. Puede bajar el precio de esta (más alternativas) o subirlo (más interés en el personaje).';
  if (e.type === 'rotation') return 'Deja de ser legal en torneos del formato Standard. Si se usaba para jugar, su demanda suele bajar; las cartas de colección se afectan menos.';
  return '';
}

function weeklyMedian(points) {
  const by = new Map();
  for (const p of points) {
    const d = new Date(p.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const k = iso(d.getTime());
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(p.usd);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, usd: median(v) }));
}
