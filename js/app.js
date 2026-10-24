import { tcgdex, archiveHistory, ownHistory, fxRates, pool, workerInfo, japanesePrices } from './api.js';
import { getConfig, setConfig } from './config.js';
import { scanCard } from './scan.js';
import { identify, searchText } from './identify.js';
import { renderTimeline } from './timeline.js';
import {
  summarizePricing, referenceUsd, momentum, pickArchiveSeries, ownSeries, dropOutliers,
  yearly, weekly, spanishEstimate, median, fmt,
} from './logic.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const img = (base, q = 'low') => base ? `${base}/${q}.webp` : 'icons/card-back.svg';

// ---------- almacenamiento local ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('tasador:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tasador:' + k, JSON.stringify(v)); } catch { /* sin espacio */ } },
};

function remember(card) {
  const list = store.get('recent', []).filter(c => c.id !== card.id);
  list.unshift({ id: card.id, name: card.name, image: card.image });
  store.set('recent', list.slice(0, 12));
}

// ---------- router ----------
window.addEventListener('hashchange', route);
route();

function route() {
  const h = location.hash.slice(1) || '/';
  window.scrollTo(0, 0);
  if (h.startsWith('/carta/')) return viewCard(decodeURIComponent(h.slice(7)));
  if (h.startsWith('/buscar/')) return viewSearch(decodeURIComponent(h.slice(8)));
  if (h === '/seguimiento') return viewWatch();
  if (h === '/ajustes') return viewConfig();
  return viewHome();
}

function setBusy(msg) {
  app.innerHTML = `<div class="center"><div class="spinner"></div><p class="muted">${esc(msg)}</p></div>`;
}

function showError(err, retry) {
  app.innerHTML = `<div class="card-box error"><h2>Algo falló</h2><p>${esc(err.message || err)}</p>
    <p class="muted">Puede ser la conexión o que la fuente de datos no respondió. Inténtalo de nuevo en un momento.</p>
    <button class="btn" id="retry">Reintentar</button> <a class="btn ghost" href="#/">Inicio</a></div>`;
  $('#retry').onclick = retry;
}

// ---------- inicio ----------
function viewHome() {
  const recent = store.get('recent', []);
  app.innerHTML = `
    <section class="hero">
      <h1>¿Cuánto vale tu carta?</h1>
      <p class="muted">Sácale una foto de frente, con buena luz y sin reflejos. Se leen el nombre y el número de abajo (ej. 199/165).</p>
      <label class="btn big" for="photo">📷 Escanear carta</label>
      <input id="photo" type="file" accept="image/*" capture="environment" hidden>
      <form id="search" class="search">
        <input name="q" placeholder="O escribe: Charizard ex, 199/165…" autocomplete="off" enterkeyhint="search">
        <button class="btn" aria-label="Buscar">Buscar</button>
      </form>
    </section>
    ${recent.length ? `<h2>Vistas recientemente</h2><div class="grid">${recent.map(cardTile).join('')}</div>` : ''}
  `;
  $('#photo').onchange = e => e.target.files[0] && runScan(e.target.files[0]);
  $('#search').onsubmit = e => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    if (q) location.hash = '/buscar/' + encodeURIComponent(q);
  };
}

function cardTile(c) {
  return `<a class="tile" href="#/carta/${encodeURIComponent(c.id)}">
    <img loading="lazy" src="${img(c.image)}" alt="">
    <span>${esc(c.nameEs || c.name || c.id)}</span><small>${esc(c.id)}</small></a>`;
}

async function runScan(file) {
  app.innerHTML = `<div class="center"><img id="prev" class="scan-prev" alt="">
    <div class="progress"><i id="bar"></i></div><p id="msg" class="muted">Preparando el lector (la primera vez tarda un poco)…</p></div>`;
  const bar = $('#bar'), msg = $('#msg');
  try { $('#prev').src = URL.createObjectURL(file); } catch { /* sin vista previa */ }
  try {
    const read = await scanCard(file, (p, m) => { bar.style.width = `${Math.round(p * 100)}%`; if (m) msg.textContent = m; });
    msg.textContent = 'Buscando la carta…';
    const cands = await identify(read);
    renderCandidates(cands, read);
  } catch (err) {
    showError(err, () => runScan(file));
  }
}

function renderCandidates(cands, read) {
  const leido = read ? `<p class="muted">Leí: <b>${esc(read.nameGuess || '¿nombre?')}</b> · <b>${esc(read.number ? `${read.number.prefix}${read.number.local}/${read.number.total}` : '¿número?')}</b></p>` : '';
  if (cands.length === 1 && cands[0].score >= 1.6) { location.hash = '/carta/' + encodeURIComponent(cands[0].id); return; }
  app.innerHTML = `
    <h1>${cands.length ? '¿Cuál es tu carta?' : 'No la encontré'}</h1>
    ${leido}
    ${cands.length ? `<div class="grid">${cands.map(cardTile).join('')}</div>` :
      `<p>Prueba otra foto (más cerca y sin reflejos) o escribe el nombre o el número.</p>`}
    <form id="search" class="search"><input name="q" value="${esc(read?.nameGuess || '')}" placeholder="Nombre o número"><button class="btn">Buscar</button></form>
    <label class="btn ghost" for="photo">📷 Otra foto</label><input id="photo" type="file" accept="image/*" capture="environment" hidden>`;
  $('#search').onsubmit = e => { e.preventDefault(); const q = new FormData(e.target).get('q').trim(); if (q) location.hash = '/buscar/' + encodeURIComponent(q); };
  $('#photo').onchange = e => e.target.files[0] && runScan(e.target.files[0]);
}

async function viewSearch(q) {
  setBusy(`Buscando “${q}”…`);
  try { renderCandidates(await searchText(q), null); }
  catch (err) { showError(err, () => viewSearch(q)); }
}

// ---------- ficha de la carta ----------
async function viewCard(id) {
  setBusy('Cargando precios…');
  let en, es, fx;
  try {
    [en, es, fx] = await Promise.all([tcgdex.card(id, 'en'), tcgdex.card(id, 'es').catch(() => null), fxRates()]);
  } catch (err) { return showError(err, () => viewCard(id)); }
  const card = en || es;
  if (!card) return showError(new Error('No encontré esa carta.'), () => viewCard(id));
  remember({ id, name: es?.name || card.name, image: card.image });

  const sum = summarizePricing(en?.pricing || card.pricing);
  const ref = referenceUsd(sum, fx);
  const mom = momentum(sum.cardmarket);
  const eurClp = fx.CLP / fx.EUR;
  const watched = store.get('watch', []).some(w => w.id === id);

  app.innerHTML = `
    <article class="card-view">
      <header class="card-head">
        <img src="${img(card.image, 'high')}" alt="${esc(card.name)}">
        <div>
          <h1>${esc(es?.name || card.name)}</h1>
          ${es && es.name !== card.name ? `<p class="muted">${esc(card.name)} (inglés)</p>` : ''}
          <p>${esc(card.set?.name || '')} · Nº ${esc(card.localId)}${card.set?.cardCount?.official ? '/' + card.set.cardCount.official : ''}</p>
          <p><span class="chip">${esc(es?.rarity || card.rarity || 'Rareza ?')}</span> ${es ? '<span class="chip ok">Existe en español</span>' : '<span class="chip">Sin datos en español</span>'}</p>
          <div class="big-price">
            <small>Valor de mercado (referencia)</small>
            <strong>${fmt.clp(ref != null ? ref * fx.CLP : null)}</strong>
            <span class="muted">${fmt.usd(ref)}${mom ? ` · <b class="${mom.pct > 5 ? 'up' : mom.pct < -5 ? 'down' : ''}">${mom.label} ${fmt.pct(mom.pct)}</b> (30 días)` : ''}</span>
          </div>
        </div>
      </header>

      <section class="card-box">
        <h2>Precios actuales por versión</h2>
        ${sum.tcg.length ? `<table><thead><tr><th>TCGplayer (EE.UU.)</th><th>Mercado</th><th>Bajo</th><th>Alto</th></tr></thead><tbody>
          ${sum.tcg.map(v => `<tr><td>${esc(v.label)}</td><td><b>${fmt.usd(v.market)}</b><br><small>${fmt.clp(v.market != null ? v.market * fx.CLP : null)}</small></td><td>${fmt.usd(v.low)}</td><td>${fmt.usd(v.high)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Sin precios de TCGplayer para esta carta.</p>'}
        ${sum.cardmarket ? `<table><thead><tr><th>Cardmarket (Europa)</th><th>Tendencia</th><th>Prom. 7d</th><th>Prom. 30d</th></tr></thead><tbody>
          <tr><td>Normal</td><td><b>${fmt.eur(sum.cardmarket.trend)}</b><br><small>${fmt.clp(sum.cardmarket.trend != null ? sum.cardmarket.trend * eurClp : null)}</small></td><td>${fmt.eur(sum.cardmarket.avg7)}</td><td>${fmt.eur(sum.cardmarket.avg30)}</td></tr>
          ${sum.cardmarket.holo ? `<tr><td>Holo / reverse</td><td><b>${fmt.eur(sum.cardmarket.holo.trend)}</b><br><small>${fmt.clp(sum.cardmarket.holo.trend != null ? sum.cardmarket.holo.trend * eurClp : null)}</small></td><td>${fmt.eur(sum.cardmarket.holo.avg7)}</td><td>${fmt.eur(sum.cardmarket.holo.avg30)}</td></tr>` : ''}
        </tbody></table>
        <p class="note">Cardmarket mezcla todos los idiomas en este promedio. Para el precio en español mira la sección de abajo.</p>` : ''}
        <p class="note">1 USD = ${fmt.clp(fx.CLP)} · 1 EUR = ${fmt.clp(eurClp)} (${esc(fx.source)})</p>
      </section>

      <section class="card-box" id="hist"><h2>Cómo ha cambiado su valor</h2><div class="center"><div class="spinner"></div></div></section>
      <section class="card-box" id="es-box"></section>
      <section class="card-box" id="versions"><h2>Todas sus versiones</h2><div class="center"><div class="spinner"></div><p class="muted">Buscando otras impresiones…</p></div></section>
      <section class="card-box" id="jp" hidden></section>

      <section class="card-box">
        <h2>Seguimiento diario</h2>
        <p class="muted">Guarda su precio cada día en tu repositorio de GitHub para armar tu propio historial.</p>
        <button class="btn ${watched ? 'ghost' : ''}" id="watch">${watched ? '✓ En seguimiento' : '+ Seguir esta carta'}</button>
      </section>
    </article>`;

  $('#watch').onclick = () => toggleWatch({ id, name: es?.name || card.name, image: card.image }, $('#watch'));
  renderSpanish(id, card, es, ref, fx);
  loadHistory(card, fx);
  loadVersions(card, fx);
  loadJapanese(card, fx);
}

// ---------- historial ----------
async function loadHistory(card, fx) {
  const box = $('#hist');
  const [archive, own] = await Promise.all([
    card.set?.id ? archiveHistory(card.set.id, card.localId) : null,
    ownHistory(card.id),
  ]);
  const a = pickArchiveSeries(archive);
  const o = ownSeries(own, fx);
  const series = [];
  if (a) series.push({ label: `Archivo TCGplayer · ${a.label}`, points: dropOutliers(a.points) });
  if (o) series.push(o);
  const now = referenceUsd(summarizePricing(card.pricing), fx);
  if (!series.length) {
    box.innerHTML = `<h2>Cómo ha cambiado su valor</h2><div id="timeline"></div>
      <p>Todavía no hay historial gratuito de ventas para esta carta. El archivo público cubre sets en inglés hasta septiembre 2024.</p>
      <p class="muted">Síguela (botón de abajo) y la app guardará su precio cada día desde hoy.</p>`;
    renderTimeline($('#timeline'), card, fx, series, now);
    return;
  }
  const points = series.flatMap(s => s.points);
  const rows = yearly(points);
  const lastYear = rows[rows.length - 1];
  const vsNow = now != null && lastYear ? (now / lastYear.avg - 1) * 100 : null;
  box.innerHTML = `<h2>Cómo ha cambiado su valor</h2>
    <div id="timeline"></div>
    <h3>Resumen por año</h3>
    <table><thead><tr><th>Año</th><th>Promedio</th><th>Mín – Máx</th><th>Cambio</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.year}</td><td><b>${fmt.usd(r.avg)}</b></td><td>${fmt.usd(r.min)} – ${fmt.usd(r.max)}</td><td class="${r.changePct > 0 ? 'up' : r.changePct < 0 ? 'down' : ''}">${fmt.pct(r.changePct)}</td></tr>`).join('')}
      ${now != null ? `<tr class="now"><td>Hoy</td><td><b>${fmt.usd(now)}</b></td><td>mercado actual</td><td class="${vsNow > 0 ? 'up' : vsNow < 0 ? 'down' : ''}">${fmt.pct(vsNow)}</td></tr>` : ''}
    </tbody></table>
    <p class="note">Precios en USD de ventas en TCGplayer. Se descartan ventas sueltas muy fuera de rango. El archivo público llega hasta sep 2024; desde que la sigues, se suma tu historial diario.</p>`;
  renderTimeline($('#timeline'), card, fx, series, now);
}

// ---------- valor en español ----------
function renderSpanish(id, card, es, refUsd, fx) {
  const box = $('#es-box');
  const key = 'es:' + id;
  const data = store.get(key, { ml: [], cmEs: [], foros: [] });
  const nameEs = es?.name || card.name;
  const num = `${card.localId}${card.set?.cardCount?.official ? '/' + card.set.cardCount.official : ''}`;
  const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const links = {
    ml: `https://listado.mercadolibre.cl/${slug(`carta pokemon ${nameEs} ${num}`)}`,
    cmEs: `https://www.cardmarket.com/es/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`,
    foros: `https://www.google.com/search?q=${encodeURIComponent(`"${nameEs}" ${num} precio carta pokemon (foro OR reddit OR facebook OR grupo) chile OR argentina OR mexico`)}`,
  };
  const help = {
    ml: 'Abre la búsqueda, mira 2 a 5 publicaciones de la carta en español y anota sus precios en CLP.',
    cmEs: 'En la página de la carta usa el filtro Idioma → Español y anota los precios más bajos en EUR.',
    foros: 'Busca ventas o tasaciones en foros y grupos latinos y anota los precios en CLP.',
  };
  const est = spanishEstimate({
    ml: data.ml.map(e => e.v), cmEs: data.cmEs.map(e => e.v), foros: data.foros.map(e => e.v),
  }, fx, refUsd);

  box.innerHTML = `<h2>Valor de la versión en español</h2>
    <div class="big-price ${est.fallback ? 'soft' : ''}">
      <small>${est.fallback ? 'Sin datos en español aún · referencia global' : `Estimado en español · confianza ${est.confidence}`}</small>
      <strong>${fmt.clp(est.value)}</strong>
      ${est.fallback ? '<span class="muted">Anota algunos precios abajo para afinarlo.</span>' : ''}
    </div>
    ${est.sources.map((s, i) => `
      <div class="source">
        <div class="source-head"><b>${i + 1}. ${s.label}</b><span>${s.value != null ? fmt.clp(s.value) + ` <small>(${s.n})</small>` : '<small class="muted">sin datos</small>'}</span></div>
        <p class="muted small">${help[s.key]}</p>
        <a class="btn ghost small" href="${links[s.key]}" target="_blank" rel="noopener">Abrir búsqueda ↗</a>
        <form class="add" data-k="${s.key}"><input inputmode="decimal" name="v" placeholder="${s.key === 'cmEs' ? 'Precio en €' : 'Precio en $ CLP'}"><button class="btn small">Anotar</button></form>
        <div class="entries">${data[s.key].map((e, j) => `<span class="chip">${s.key === 'cmEs' ? fmt.eur(e.v) : fmt.clp(e.v)} <button data-k="${s.key}" data-j="${j}" aria-label="Borrar">×</button></span>`).join('')}</div>
      </div>`).join('')}
    <p class="note">Los precios que anotas se guardan solo en este celular. MercadoLibre pesa más, luego Cardmarket en español y después los foros. Los precios publicados suelen ser algo más altos que los de venta real.</p>`;

  box.querySelectorAll('form.add').forEach(f => f.onsubmit = e => {
    e.preventDefault();
    const raw = new FormData(f).get('v').trim();
    const k = f.dataset.k;
    // En CLP "12.500" es doce mil quinientos; en EUR "12,50" usa coma decimal.
    const v = k === 'cmEs'
      ? parseFloat(raw.includes(',') ? raw.replace(/[.\s€]/g, '').replace(',', '.') : raw.replace(/[\s€]/g, ''))
      : parseFloat(raw.replace(/[.\s$]/g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    data[k].push({ v, d: new Date().toISOString().slice(0, 10) });
    store.set(key, data);
    renderSpanish(id, card, es, refUsd, fx);
  });
  box.querySelectorAll('.entries button').forEach(b => b.onclick = () => {
    data[b.dataset.k].splice(+b.dataset.j, 1);
    store.set(key, data);
    renderSpanish(id, card, es, refUsd, fx);
  });
}

// ---------- todas las versiones ----------
async function loadVersions(card, fx) {
  const box = $('#versions');
  try {
    const briefs = (await tcgdex.search({ name: `eq:${card.name}` }, 'en')).slice(0, 60);
    const details = await pool(briefs, 6, b => tcgdex.card(b.id, 'en'));
    const rows = details.filter(Boolean).map(c => {
      const s = summarizePricing(c.pricing);
      return { id: c.id, set: c.set?.name || '', localId: c.localId, rarity: c.rarity || '—', image: c.image, usd: referenceUsd(s, fx) };
    }).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
    if (rows.length <= 1) {
      box.innerHTML = '<h2>Todas sus versiones</h2><p class="muted">No encontré otras impresiones con el mismo nombre.</p>';
      return;
    }
    const byRarity = new Map();
    rows.forEach(r => { if (r.usd != null) { if (!byRarity.has(r.rarity)) byRarity.set(r.rarity, []); byRarity.get(r.rarity).push(r.usd); } });
    const rar = [...byRarity.entries()].map(([k, v]) => ({ k, n: v.length, med: median(v), max: Math.max(...v) })).sort((a, b) => b.med - a.med);
    box.innerHTML = `<h2>Todas sus versiones <small class="muted">(${rows.length})</small></h2>
      <h3>Por rareza</h3>
      <table><thead><tr><th>Rareza</th><th>Mediana</th><th>Máx</th><th>#</th></tr></thead><tbody>
        ${rar.map(r => `<tr><td>${esc(r.k)}</td><td><b>${fmt.clp(r.med * fx.CLP)}</b><br><small>${fmt.usd(r.med)}</small></td><td>${fmt.usd(r.max)}</td><td>${r.n}</td></tr>`).join('')}
      </tbody></table>
      <h3>Cada impresión</h3>
      <div class="versions">${rows.map(r => `
        <a class="version ${r.id === card.id ? 'current' : ''}" href="#/carta/${encodeURIComponent(r.id)}">
          <img loading="lazy" src="${img(r.image)}" alt="">
          <div><b>${esc(r.set)}</b><small>Nº ${esc(r.localId)} · ${esc(r.rarity)}</small></div>
          <span>${fmt.clp(r.usd != null ? r.usd * fx.CLP : null)}<small>${fmt.usd(r.usd)}</small></span>
        </a>`).join('')}</div>
      <p class="note">Versiones en inglés/internacionales. Las cartas exclusivas de Japón aparecen abajo si activas la API opcional.</p>`;
  } catch (err) {
    box.innerHTML = `<h2>Todas sus versiones</h2><p class="muted">No pude cargar las versiones (${esc(err.message)}).</p>`;
  }
}

async function loadJapanese(card, fx) {
  const info = await workerInfo();
  if (!info?.jp) return;
  const box = $('#jp');
  box.hidden = false;
  box.innerHTML = '<h2>Versiones japonesas</h2><div class="center"><div class="spinner"></div></div>';
  try {
    const res = await japanesePrices(card.name);
    const list = (res?.data || []).map(c => ({ name: c.name, set: c.setName, num: c.cardNumber, rarity: c.rarity, usd: c.prices?.market ?? null, image: c.imageCdnUrl200 }))
      .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
    box.innerHTML = `<h2>Versiones japonesas <small class="muted">(${list.length})</small></h2>
      ${list.length ? `<div class="versions">${list.map(r => `<div class="version"><img loading="lazy" src="${esc(r.image || 'icons/card-back.svg')}" alt=""><div><b>${esc(r.set)}</b><small>Nº ${esc(r.num)} · ${esc(r.rarity || '—')}</small></div><span>${fmt.clp(r.usd != null ? r.usd * fx.CLP : null)}<small>${fmt.usd(r.usd)}</small></span></div>`).join('')}</div>` : '<p class="muted">Sin resultados japoneses.</p>'}
      <p class="note">Fuente: PokemonPriceTracker (plan gratis).</p>`;
  } catch (err) {
    box.innerHTML = `<h2>Versiones japonesas</h2><p class="muted">No disponible ahora (${esc(err.message)}).</p>`;
  }
}

// ---------- seguimiento ----------
function toggleWatch(c, btn) {
  let list = store.get('watch', []);
  if (list.some(w => w.id === c.id)) list = list.filter(w => w.id !== c.id);
  else list.push(c);
  store.set('watch', list);
  const on = list.some(w => w.id === c.id);
  btn.textContent = on ? '✓ En seguimiento' : '+ Seguir esta carta';
  btn.classList.toggle('ghost', on);
  if (on && !getConfig().githubRepo) toast('Guardada. Para el historial diario, conecta tu repositorio en Ajustes.');
  else if (on) toast('Guardada. Sincronízala en “Seguimiento”.');
}

function viewWatch() {
  const list = store.get('watch', []);
  const repo = getConfig().githubRepo;
  const json = JSON.stringify({ cards: list.map(w => w.id) }, null, 2);
  app.innerHTML = `<h1>Seguimiento</h1>
    ${list.length ? `<div class="grid">${list.map(cardTile).join('')}</div>` : '<p class="muted">Aún no sigues cartas. Ábrelas y toca “Seguir esta carta”.</p>'}
    <section class="card-box">
      <h2>Historial diario en GitHub</h2>
      <p class="muted">GitHub Actions guarda el precio de estas cartas una vez al día en tu repositorio, gratis. Para actualizar la lista: copia el texto y pégalo en <code>data/watchlist.json</code>.</p>
      <textarea readonly rows="6">${esc(json)}</textarea>
      <button class="btn" id="copy">Copiar lista</button>
      ${repo ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://github.com/${esc(repo)}/edit/main/data/watchlist.json">Abrir en GitHub ↗</a>` : '<p class="note">Configura tu repositorio en <a href="#/ajustes">Ajustes</a> para tener el botón directo.</p>'}
    </section>`;
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(json); toast('Copiado'); } catch { $('textarea').select(); }
  };
}

// ---------- ajustes ----------
function viewConfig() {
  const c = getConfig();
  app.innerHTML = `<h1>Ajustes</h1>
    <form id="cfg" class="card-box form">
      <label>Repositorio de GitHub<input name="githubRepo" placeholder="tu-usuario/tasador-tcg" value="${esc(c.githubRepo)}"></label>
      <label>URL de tu API (Cloudflare Worker, opcional)<input name="workerUrl" placeholder="https://tasador-api.tu-usuario.workers.dev" value="${esc(c.workerUrl)}"></label>
      <fieldset><legend>Tipo de cambio manual (opcional)</legend>
        <label>CLP por 1 USD<input name="CLP" inputmode="decimal" value="${esc(c.fxOverride?.CLP ?? '')}"></label>
        <label>EUR por 1 USD<input name="EUR" inputmode="decimal" value="${esc(c.fxOverride?.EUR ?? '')}"></label>
      </fieldset>
      <button class="btn">Guardar</button>
      <button type="button" class="btn ghost" id="clear">Borrar caché de precios</button>
    </form>`;
  $('#cfg').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const CLP = parseFloat(f.get('CLP')), EUR = parseFloat(f.get('EUR'));
    setConfig({
      githubRepo: f.get('githubRepo').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''),
      workerUrl: f.get('workerUrl').trim(),
      fxOverride: CLP > 0 && EUR > 0 ? { CLP, EUR } : null,
    });
    toast('Guardado');
  };
  $('#clear').onclick = () => {
    Object.keys(localStorage).filter(k => k.startsWith('tasador:c:')).forEach(k => localStorage.removeItem(k));
    toast('Caché borrada');
  };
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
