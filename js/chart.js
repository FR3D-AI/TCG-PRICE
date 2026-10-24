// Gráfico de línea en SVG, liviano y sin librerías.
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)'];

/**
 * @param {Array<{label:string, points:Array<{date:string, value:number}>}>} series
 * @param {(v:number)=>string} fmtValue
 */
export function lineChart(series, fmtValue) {
  const all = series.flatMap(s => s.points);
  if (all.length < 2) return '<p class="muted">No hay suficientes datos para graficar.</p>';
  const W = 640, H = 260, L = 64, R = 12, T = 12, B = 30;
  const t = d => new Date(d + 'T00:00:00Z').getTime();
  const xs = all.map(p => t(p.date)), ys = all.map(p => p.value);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.1 || y1 * 0.1 || 1; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = v => L + (v - x0) / Math.max(x1 - x0, 1) * (W - L - R);
  const Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

  let grid = `<text x="4" y="${T + 4}" class="axis">USD</text>`;
  for (let i = 0; i <= 4; i++) {
    const v = y0 + (y1 - y0) * i / 4, y = Y(v);
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="axis">${fmtValue(v)}</text>`;
  }
  const y0d = new Date(x0).getUTCFullYear(), y1d = new Date(x1).getUTCFullYear();
  let ticks = 0;
  for (let y = y0d; y <= y1d + 1; y++) {
    const ts = Date.UTC(y, 0, 1);
    if (ts < x0 || ts > x1) continue;
    ticks++;
    grid += `<line x1="${X(ts)}" x2="${X(ts)}" y1="${T}" y2="${H - B}" class="grid"/><text x="${X(ts)}" y="${H - 10}" text-anchor="middle" class="axis">${y}</text>`;
  }
  if (!ticks) {
    grid += `<text x="${L}" y="${H - 10}" class="axis">${new Date(x0).toISOString().slice(0, 7)}</text><text x="${W - R}" y="${H - 10}" text-anchor="end" class="axis">${new Date(x1).toISOString().slice(0, 7)}</text>`;
  }

  const lines = series.map((s, i) => {
    if (!s.points.length) return '';
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${X(t(p.date)).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
    const last = s.points[s.points.length - 1];
    return `<path d="${d}" fill="none" stroke="${COLORS[i % 3]}" stroke-width="2" stroke-linejoin="round"/>` +
      `<circle cx="${X(t(last.date))}" cy="${Y(last.value)}" r="3.5" fill="${COLORS[i % 3]}"/>`;
  }).join('');

  const legend = series.filter(s => s.points.length).map((s, i) =>
    `<span class="legend"><i style="background:${COLORS[i % 3]}"></i>${s.label}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolución del precio">${grid}${lines}</svg><div class="legends">${legend}</div>`;
}
