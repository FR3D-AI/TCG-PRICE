// Notificaciones y seguimiento diario de las cartas de tus álbumes.
// Una vez al día (al abrir la app o al volver a ella) guarda el precio de cada carta de tus álbumes
// en este celular, arma tu propio historial y te avisa con la campana 🔔 si subió o bajó.
import { tcgdex, fxRates, pool } from './api.js';
import { summarizePricing, referenceUsd, fmt } from './logic.js';
import { loadAlbums } from './albums.js';

const LOG = 'tasador:pricelog', NOTES = 'tasador:notes', CFG = 'tasador:notifyCfg';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

/** Fecha local YYYY-MM-DD (hora de Chile si el celular está en Chile). */
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function getCfg() { return { threshold: 3, minUsd: 0.05, system: false, ...read(CFG, {}) }; }
export function setCfg(c) { write(CFG, { ...getCfg(), ...c }); }
export const loadLog = () => read(LOG, {});
export const loadNotes = () => read(NOTES, []);
export const unread = () => loadNotes().filter(n => !n.read).length;

/**
 * Registra el precio de hoy y decide si hay aviso. Función pura (se puede probar sin navegador).
 * @returns {{ entry: object, note: object|null }}
 */
export function recordPoint(entry, date, usd, cfg) {
  const pts = (entry?.pts || []).filter(p => p[0] !== date);
  const prev = pts.length ? pts[pts.length - 1] : null; // último día anterior a hoy
  pts.push([date, Math.round(usd * 100) / 100]);
  const out = { ...(entry || {}), pts: pts.slice(-400) };
  if (!prev || !(prev[1] > 0)) return { entry: out, note: null };
  const diff = usd - prev[1], pct = diff / prev[1] * 100;
  if (Math.abs(pct) < cfg.threshold || Math.abs(diff) < cfg.minUsd) return { entry: out, note: null };
  return { entry: out, note: { from: prev[1], fromDate: prev[0], to: usd, pct: Math.round(pct * 10) / 10, date } };
}

/** Cartas únicas de todos tus álbumes. */
function albumCards() {
  const m = new Map();
  for (const a of loadAlbums()) for (const c of a.cards) if (!m.has(c.id)) m.set(c.id, { ...c, albums: [a.name] }); else m.get(c.id).albums.push(a.name);
  return [...m.values()];
}

let running = null;
/**
 * Actualiza el precio de hoy de las cartas que aún no lo tienen. `force` vuelve a consultar todas.
 * Devuelve las notificaciones nuevas.
 */
export function dailyUpdate({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const date = today(), cfg = getCfg(), log = loadLog();
    const cards = albumCards().filter(c => force || log[c.id]?.pts?.at(-1)?.[0] !== date);
    if (!cards.length) return [];
    const fx = await fxRates();
    const fresh = await pool(cards.map(c => c.id), 4, id => tcgdex.card(id, 'en').catch(() => null));
    const notes = loadNotes(), added = [];
    cards.forEach((c, i) => {
      const card = fresh[i];
      if (!card) return;
      const usd = referenceUsd(summarizePricing(card.pricing), fx);
      if (usd == null) return;
      const { entry, note } = recordPoint(log[c.id], date, usd, cfg);
      log[c.id] = { ...entry, name: c.name, image: c.image || card.image };
      if (!note) return;
      const n = { id: `${c.id}|${date}`, cardId: c.id, name: c.name, image: c.image || card.image, ...note, ts: Date.now(), read: false };
      const old = notes.findIndex(x => x.id === n.id); // mismo día: se actualiza, no se duplica
      if (old >= 0 && Math.abs(notes[old].pct - n.pct) < 0.5) return; // ya avisado
      if (old >= 0) notes.splice(old, 1);
      notes.unshift(n); added.push(n);
    });
    write(LOG, log);
    write(NOTES, notes.slice(0, 300));
    updateBell();
    if (added.length && cfg.system) systemNotify(added, fx);
    return added;
  })().finally(() => { running = null; });
  return running;
}

async function systemNotify(list, fx) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const up = list.filter(n => n.pct > 0).length, down = list.length - up;
  const title = list.length === 1 ? `${list[0].name} ${list[0].pct > 0 ? 'subió' : 'bajó'} ${Math.abs(list[0].pct)}%` : `${list.length} cartas cambiaron de precio`;
  const body = list.length === 1 ? `${fmt.clp(list[0].from * fx.CLP)} → ${fmt.clp(list[0].to * fx.CLP)}` : `▲ ${up} subieron · ▼ ${down} bajaron`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'tasador-precios' });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch { /* nada */ }
}

export function updateBell() {
  const n = unread();
  document.querySelectorAll('.bell').forEach(b => {
    const s = b.querySelector('.bell-n');
    s.textContent = n > 99 ? '99+' : String(n);
    s.hidden = !n;
    b.classList.toggle('ring', n > 0);
    b.setAttribute('aria-label', n ? `Notificaciones (${n} sin leer)` : 'Notificaciones');
  });
}

/** Mini gráfico de línea (SVG) de tu historial diario. */
export function sparkline(pts, w = 120, h = 34) {
  if (!pts || pts.length < 2) return '<span class="spark-empty">—</span>';
  const ys = pts.map(p => p[1]), min = Math.min(...ys), max = Math.max(...ys), r = max - min || 1;
  const xy = pts.map((p, i) => `${(i / (pts.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (p[1] - min) / r * (h - 6)).toFixed(1)}`);
  const up = ys.at(-1) >= ys[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${xy.join(' ')}"/><circle r="2.6" cx="${xy.at(-1).split(',')[0]}" cy="${xy.at(-1).split(',')[1]}"/></svg>`;
}

const dayLabel = d => {
  const t = today(), y = today(new Date(Date.now() - 864e5));
  if (d === t) return 'Hoy';
  if (d === y) return 'Ayer';
  const [Y, M, D] = d.split('-').map(Number);
  return new Date(Y, M - 1, D).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
};
const thumb = (image, name) => image ? `<img class="nt-img" loading="lazy" src="${esc(image)}/low.webp" alt="${esc(name)}">` : '<span class="nt-img none">🎴</span>';

// ---------- Pantalla: Notificaciones ----------
export async function viewNotifications(app) {
  const fx = await fxRates();
  const draw = (status = '') => {
    const notes = loadNotes(), log = loadLog(), cfg = getCfg(), cards = albumCards();
    const groups = {};
    notes.forEach(n => (groups[n.date] ||= []).push(n));
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    app.innerHTML = `<div class="nt-head"><h1>🔔 Notificaciones</h1>
        <button class="btn ghost small" id="nt-refresh">↻ Actualizar ahora</button></div>
      ${status ? `<p class="note">${status}</p>` : ''}
      ${notes.length ? `<p class="nt-actions"><button class="btn ghost small" id="nt-read" ${notes.some(n => !n.read) ? '' : 'disabled'}>Marcar todo como leído</button>
        <button class="btn ghost small" id="nt-clear">Borrar avisos</button></p>` : ''}
      ${notes.length ? Object.entries(groups).map(([d, list]) => `<h3 class="nt-day">${esc(dayLabel(d))}</h3>
        <div class="nt-list">${list.map(n => `<a class="nt ${n.pct > 0 ? 'nt-up' : 'nt-down'} ${n.read ? '' : 'new'}" href="#/carta/${encodeURIComponent(n.cardId)}" data-note="${esc(n.id)}">
          ${thumb(n.image, n.name)}
          <span class="nt-body"><b>${esc(n.name)}</b>
            <span>${n.pct > 0 ? '▲ Subió' : '▼ Bajó'} <b class="nt-pct">${n.pct > 0 ? '+' : ''}${n.pct}%</b></span>
            <small>${fmt.clp(n.from * fx.CLP)} → <b>${fmt.clp(n.to * fx.CLP)}</b> · ${fmt.usd(n.from)} → ${fmt.usd(n.to)}</small></span>
          ${n.read ? '' : '<i class="nt-dot" aria-label="Sin leer"></i>'}</a>`).join('')}</div>`).join('')
      : `<div class="card-box nt-empty"><p><b>Aún no hay avisos.</b></p><p class="muted">Cada día guardo el precio de las cartas de tus álbumes. Cuando una suba o baje ${cfg.threshold}% o más respecto del día anterior, aparece aquí.</p></div>`}

      <section class="card-box">
        <h2>Seguimiento de tus cartas</h2>
        <p class="muted">${cards.length ? `${cards.length} ${cards.length === 1 ? 'carta' : 'cartas'} de tus álbumes · precio guardado una vez al día en este celular.` : 'Agrega cartas a un álbum con <b>📁 Agregar a tu álbum</b> para empezar su historial.'}</p>
        <div class="trk-list">${cards.map(c => {
          const pts = log[c.id]?.pts || [], last = pts.at(-1), first = pts[0];
          const ch = last && first && first[1] > 0 && pts.length > 1 ? (last[1] - first[1]) / first[1] * 100 : null;
          return `<a class="trk" href="#/carta/${encodeURIComponent(c.id)}">${thumb(c.image, c.name)}
            <span class="trk-info"><b>${esc(c.name)}</b><small>${pts.length ? `${pts.length} ${pts.length === 1 ? 'día' : 'días'} registrados · desde ${esc(first[0])}` : 'Sin registro aún'}</small></span>
            <span class="trk-right">${sparkline(pts, 90, 30)}
              <span class="trk-val">${last ? fmt.clp(last[1] * fx.CLP) : '—'}${ch != null ? ` <em class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%</em>` : ''}</span></span></a>`;
        }).join('')}</div>
      </section>

      <section class="card-box">
        <h2>Ajustes de avisos</h2>
        <label class="nt-set">Avisarme cuando el precio cambie
          <select id="nt-th">${[1, 2, 3, 5, 10, 20].map(v => `<option value="${v}" ${v === cfg.threshold ? 'selected' : ''}>${v}% o más</option>`).join('')}</select></label>
        <label class="sheet-row nt-sys"><input type="checkbox" id="nt-sys" ${cfg.system && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}>
          <span>También avisar con notificación del celular</span></label>
        <p class="note">${perm === 'denied' ? 'Bloqueaste las notificaciones para este sitio; actívalas en los ajustes del navegador.' : perm === 'unsupported' ? 'Este navegador no permite notificaciones. En iPhone, agrega la app a la pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde ahí.' : 'Los precios se revisan al abrir la app (una vez al día). Si la app está cerrada varios días, al abrirla registra el precio de hoy y te avisa si cambió desde la última vez.'}</p>
      </section>`;

    app.querySelector('#nt-refresh').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Revisando precios…';
      const added = await dailyUpdate({ force: true }).catch(() => null);
      draw(added == null ? 'No se pudo revisar ahora. Revisa tu conexión.' : added.length ? `${added.length} ${added.length === 1 ? 'aviso nuevo' : 'avisos nuevos'}.` : 'Listo. Sin cambios importantes desde el último registro.');
    };
    app.querySelector('#nt-read')?.addEventListener('click', () => { write(NOTES, loadNotes().map(n => ({ ...n, read: true }))); updateBell(); draw(); });
    app.querySelector('#nt-clear')?.addEventListener('click', () => { if (confirm('¿Borrar todos los avisos? Tu historial de precios se mantiene.')) { write(NOTES, []); updateBell(); draw(); } });
    app.querySelectorAll('[data-note]').forEach(a => a.addEventListener('click', () => {
      write(NOTES, loadNotes().map(n => n.id === a.dataset.note ? { ...n, read: true } : n)); updateBell();
    }));
    app.querySelector('#nt-th').onchange = e => setCfg({ threshold: +e.target.value });
    app.querySelector('#nt-sys').onchange = async e => {
      if (e.target.checked && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission().catch(() => 'denied');
        if (p !== 'granted') { e.target.checked = false; setCfg({ system: false }); draw(); return; }
      }
      setCfg({ system: e.target.checked });
    };
  };
  draw();
}

/** Bloque "Tu historial diario" para la ficha de una carta. */
export function myLogHtml(cardId, fx) {
  const pts = loadLog()[cardId]?.pts || [];
  if (!pts.length) return '<p class="muted small">Agrégala a un álbum y guardaré su precio cada día para armar tu propio historial.</p>';
  const rows = pts.slice(-7).reverse();
  return `<div class="mylog">${sparkline(pts, 300, 60)}
    <table class="mylog-t"><tbody>${rows.map((p, i) => {
      const prev = pts[pts.length - 1 - i - 1];
      const ch = prev && prev[1] > 0 ? (p[1] - prev[1]) / prev[1] * 100 : null;
      return `<tr><td>${esc(dayLabel(p[0]))}</td><td>${fmt.clp(p[1] * fx.CLP)}</td><td class="${ch == null ? '' : ch >= 0 ? 'up' : 'down'}">${ch == null ? '' : `${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="note">${pts.length} ${pts.length === 1 ? 'día registrado' : 'días registrados'} desde ${esc(pts[0][0])}.</p></div>`;
}

/** Arranque: campana + revisión diaria al abrir y al volver a la app. */
export function initNotify() {
  updateBell();
  const run = () => dailyUpdate().then(a => { if (a.length && location.hash === '#/notificaciones') window.dispatchEvent(new HashChangeEvent('hashchange')); }).catch(() => {});
  setTimeout(run, 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
  window.addEventListener('storage', e => { if (e.key === NOTES) updateBell(); });
}
