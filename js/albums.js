// Álbumes: clasifica tus cartas en "Álbum A", "Álbum B"… con portada personalizable y páginas
// de 9 bolsillos que se dan vuelta como un álbum real. Se guardan en este celular (localStorage).
import { tcgdex, fxRates, pool } from './api.js';
import { summarizePricing, referenceUsd, fmt } from './logic.js';
import { cardPic, openViewer } from './photos.js';
import { tierOf } from './tiers.js';

const KEY = 'tasador:albums';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loadAlbums() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function saveAlbums(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); return true; }
  catch { alert('No hay espacio para guardar más. Borra algunas fotos temporales o álbumes.'); return false; }
}

/** Siguiente nombre libre: Álbum A, B, … Z, AA, AB… */
export function nextAlbumName(albums) {
  const used = new Set(albums.map(a => a.name));
  for (let i = 0; i < 702; i++) {
    const n = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (!used.has(`Álbum ${n}`)) return `Álbum ${n}`;
  }
  return `Álbum ${albums.length + 1}`;
}

export const SORTS = {
  'name-asc': { label: 'Nombre A → Z', fn: (a, b) => a.name.localeCompare(b.name, 'es') },
  'name-desc': { label: 'Nombre Z → A', fn: (a, b) => b.name.localeCompare(a.name, 'es') },
  'price-asc': { label: 'Precio menor → mayor', fn: (a, b) => (a.usd ?? Infinity) - (b.usd ?? Infinity) },
  'price-desc': { label: 'Precio mayor → menor', fn: (a, b) => (b.usd ?? -1) - (a.usd ?? -1) },
  'dex-asc': { label: 'Nº Pokédex menor → mayor', fn: (a, b) => (a.dex ?? Infinity) - (b.dex ?? Infinity) || a.name.localeCompare(b.name, 'es') },
  'dex-desc': { label: 'Nº Pokédex mayor → menor', fn: (a, b) => (b.dex ?? -1) - (a.dex ?? -1) || a.name.localeCompare(b.name, 'es') },
  'added-desc': { label: 'Agregadas recientemente', fn: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || '') },
};

/** Ordena una copia de las cartas según la clave elegida. */
export function sortCards(cards, key) {
  return [...cards].sort((SORTS[key] || SORTS['name-asc']).fn);
}

// ---------- Selector "Agregar a álbum" (desde la ficha de una carta) ----------
export function openAlbumPicker(card, fx, onChange = () => {}) {
  const entry = {
    id: card.id, name: card.nameEs || card.name, image: card.image, dex: (card.dexId || [])[0] ?? null,
    set: card.set?.name || '', localId: card.localId, rarity: card.rarity || '',
    usd: referenceUsd(summarizePricing(card.pricing), fx), addedAt: new Date().toISOString(),
  };
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const draw = () => {
    const albums = loadAlbums();
    sheet.innerHTML = `<div class="sheet-box" role="dialog" aria-label="Agregar a álbum">
      <h2>Agregar a tu álbum</h2>
      <p class="muted small">${esc(entry.name)} · ${esc(entry.set)} Nº ${esc(entry.localId)}</p>
      <div class="sheet-list">${albums.map(a => `
        <label class="sheet-row"><input type="checkbox" data-alb="${a.id}" ${a.cards.some(c => c.id === entry.id) ? 'checked' : ''}>
          <span>${esc(a.name)}</span><small>${a.cards.length}</small></label>`).join('') || '<p class="muted">Aún no tienes álbumes.</p>'}
      </div>
      <button class="btn ghost" data-new>+ Nuevo álbum (${esc(nextAlbumName(albums))})</button>
      <button class="btn" data-close>Listo</button>
    </div>`;
  };
  draw();
  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.closest('[data-close]')) { sheet.remove(); onChange(); return; }
    if (e.target.closest('[data-new]')) {
      const albums = loadAlbums();
      albums.push({ id: Date.now().toString(36), name: nextAlbumName(albums), cards: [entry], cover: defaultCover(albums.length) });
      saveAlbums(albums); draw();
    }
  });
  sheet.addEventListener('change', e => {
    const id = e.target.dataset.alb;
    if (!id) return;
    const albums = loadAlbums();
    const a = albums.find(x => x.id === id);
    if (!a) return;
    a.cards = a.cards.filter(c => c.id !== entry.id);
    if (e.target.checked) a.cards.push(entry);
    saveAlbums(albums); draw();
  });
  document.body.appendChild(sheet);
}

export function albumsOf(cardId) {
  return loadAlbums().filter(a => a.cards.some(c => c.id === cardId)).map(a => a.name);
}

// ---------- Portada personalizable ----------
export const COVER_COLORS = ['#1e3a8a', '#7f1d1d', '#14532d', '#4c1d95', '#111827', '#92400e', '#0f766e', '#be185d', '#a16207', '#334155'];
export const COVER_PATTERNS = { liso: 'Liso', puntos: 'Puntos', rayas: 'Rayas', cuero: 'Cuero', holo: 'Holográfico' };
export const COVER_EMBLEMS = ['', '⚡', '🔥', '💧', '🌿', '⭐', '👑', '🐉', '🌙', '💎', '🎴', '❤️'];
const defaultCover = (i = 0) => ({ color: COVER_COLORS[i % COVER_COLORS.length], pattern: 'cuero', emblem: '🎴', cardId: null });

/** Divide las cartas en páginas de 9 bolsillos (3×3), como un álbum real. */
export function toPages(cards, size = 9) {
  const pages = [];
  for (let i = 0; i < cards.length; i += size) pages.push(cards.slice(i, i + size));
  return pages.length ? pages : [[]];
}

function coverHtml(a, fx, { mini = false } = {}) {
  const c = { ...defaultCover(), ...(a.cover || {}) };
  const total = a.cards.reduce((s, x) => s + (x.usd || 0), 0);
  const feat = c.cardId ? a.cards.find(x => x.id === c.cardId) : null;
  return `<div class="cover ${mini ? 'mini' : ''} pat-${c.pattern}" style="--cover:${c.color}">
    <div class="cover-spine"><i></i><i></i><i></i></div>
    <div class="cover-face">
      ${feat ? `<div class="cover-card">${cardPic(feat.id, feat.image)}</div>` : (c.emblem ? `<div class="cover-emblem">${c.emblem}</div>` : '')}
      <div class="cover-title">${feat && c.emblem ? `${c.emblem} ` : ''}${esc(a.name)}</div>
      ${mini ? '' : `<div class="cover-meta">${a.cards.length} ${a.cards.length === 1 ? 'carta' : 'cartas'} · ${fmt.clp(total * fx.CLP)}</div>`}
    </div>
  </div>`;
}

// ---------- Pantalla: lista de álbumes ----------
export async function viewAlbums(app) {
  const albums = loadAlbums();
  const fx = await fxRates();
  app.innerHTML = `<h1>Mis álbumes</h1>
    <p class="muted">Toca un álbum para abrirlo. Para agregar cartas, usa <b>📁 Agregar a tu álbum</b> en cualquier carta escaneada o buscada.</p>
    <div class="albums">${albums.map(a => `<a class="album-shelf" href="#/album/${a.id}">${coverHtml(a, fx, { mini: true })}
      <small>${a.cards.length} ${a.cards.length === 1 ? 'carta' : 'cartas'} · ${fmt.clp(a.cards.reduce((s, c) => s + (c.usd || 0), 0) * fx.CLP)}</small></a>`).join('')}</div>
    <button class="btn" id="new-album">+ Nuevo álbum (${esc(nextAlbumName(albums))})</button>`;
  app.querySelector('#new-album').onclick = () => {
    const list = loadAlbums();
    list.push({ id: Date.now().toString(36), name: nextAlbumName(list), cards: [], cover: defaultCover(list.length) });
    saveAlbums(list); viewAlbums(app);
  };
}

// ---------- Pantalla: un álbum (portada → páginas que se dan vuelta) ----------
export async function viewAlbum(app, id) {
  if (!loadAlbums().some(a => a.id === id)) { location.hash = '/albumes'; return; }
  const fx = await fxRates();
  let sortKey = localStorage.getItem('tasador:albumSort') || 'name-asc';
  let mode = sessionStorage.getItem('tasador:albumMode:' + id) || 'cover'; // cover | binder | list
  let page = 0;
  const album = () => loadAlbums().find(x => x.id === id);
  const setMode = m => { mode = m; try { sessionStorage.setItem('tasador:albumMode:' + id, m); } catch { /* nada */ } };

  const shell = () => {
    const a = album();
    if (!a) return;
    app.innerHTML = `<p class="album-nav"><a href="#/albumes">← Mis álbumes</a>
        <span><button class="btn ghost small" id="custom">🎨 Personalizar</button></span></p>
      <div class="album-tools">
        <select id="sort" aria-label="Ordenar">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === sortKey ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        <div class="seg">
          <button data-mode="cover" class="${mode === 'cover' ? 'on' : ''}">Portada</button>
          <button data-mode="binder" class="${mode === 'binder' ? 'on' : ''}">Álbum</button>
          <button data-mode="list" class="${mode === 'list' ? 'on' : ''}">Lista</button>
        </div>
      </div>
      <div id="stage"></div>`;
    app.querySelector('#sort').onchange = e => { sortKey = e.target.value; localStorage.setItem('tasador:albumSort', sortKey); page = 0; render(); };
    app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { setMode(b.dataset.mode); page = 0; shell(); });
    app.querySelector('#custom').onclick = () => customize(id, () => { shell(); });
    render();
  };

  const render = () => {
    const a = album(); const st = app.querySelector('#stage');
    if (!a || !st) return;
    if (mode === 'cover') renderCover(st, a);
    else if (mode === 'binder') renderBinder(st, a);
    else renderList(st, a);
  };

  // --- Portada ---
  const renderCover = (st, a) => {
    st.innerHTML = `<div class="cover-stage">${coverHtml(a, fx)}</div>
      <button class="btn big" id="open">📖 Abrir álbum</button>`;
    const open = () => {
      const cv = st.querySelector('.cover');
      cv.classList.add('opening');
      setTimeout(() => { setMode('binder'); page = 0; shell(); }, 650);
    };
    st.querySelector('#open').onclick = open;
    st.querySelector('.cover').onclick = open;
  };

  // --- Páginas del álbum (3×3) ---
  const pocketHtml = c => c
    ? `<button type="button" class="pocket" data-card="${esc(c.id)}">
        <span class="tier-wrap small tier-${tierOf({ rarity: c.rarity, name: c.name, usd: c.usd })}">${cardPic(c.id, c.image)}</span>
        <span class="pocket-tag">${fmt.clp(c.usd != null ? c.usd * fx.CLP : null)}</span></button>`
    : '<span class="pocket empty"></span>';
  const pageHtml = (cards, n, total) => `<div class="pockets">${Array.from({ length: 9 }, (_, i) => pocketHtml(cards[i])).join('')}</div>
    <div class="page-num">${n + 1} / ${total}</div>`;

  const renderBinder = (st, a) => {
    const pages = toPages(sortCards(a.cards, sortKey));
    page = Math.min(page, pages.length - 1);
    st.innerHTML = `<div class="binder" tabindex="0" aria-label="Páginas del álbum">
        <div class="binder-rings"><i></i><i></i><i></i></div>
        <div class="binder-page" id="bpage">${pageHtml(pages[page], page, pages.length)}</div>
      </div>
      <div class="binder-ctrl">
        <button class="btn ghost" id="prev" ${page === 0 ? 'disabled' : ''}>‹ Anterior</button>
        <button class="btn ghost small" id="close">Cerrar álbum</button>
        <button class="btn ghost" id="next" ${page >= pages.length - 1 ? 'disabled' : ''}>Siguiente ›</button>
      </div>
      <p class="note">Desliza hacia los lados para pasar la página. Toca una carta para verla en grande con su animación.</p>
      ${a.cards.length ? '' : '<p class="muted">Este álbum está vacío. Toca <b>📁 Agregar a tu álbum</b> en cualquier carta.</p>'}`;
    const bpage = st.querySelector('#bpage');
    let busy = false;
    const turn = dir => {
      const to = page + dir;
      if (busy || to < 0 || to >= pages.length) return;
      busy = true;
      const flip = document.createElement('div');
      flip.className = 'binder-flip ' + (dir > 0 ? 'fwd' : 'back');
      if (dir > 0) { flip.innerHTML = bpage.innerHTML; bpage.innerHTML = pageHtml(pages[to], to, pages.length); }
      else flip.innerHTML = pageHtml(pages[to], to, pages.length);
      st.querySelector('.binder').appendChild(flip);
      requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add('go')));
      setTimeout(() => {
        if (dir < 0) bpage.innerHTML = flip.innerHTML;
        flip.remove(); page = to; busy = false;
        st.querySelector('#prev').disabled = page === 0;
        st.querySelector('#next').disabled = page >= pages.length - 1;
      }, 620);
    };
    st.querySelector('#prev').onclick = () => turn(-1);
    st.querySelector('#next').onclick = () => turn(1);
    st.querySelector('#close').onclick = () => { setMode('cover'); shell(); };
    const binder = st.querySelector('.binder');
    let x0 = null;
    binder.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    binder.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 45) turn(dx < 0 ? 1 : -1);
    });
    binder.addEventListener('keydown', e => { if (e.key === 'ArrowRight') turn(1); if (e.key === 'ArrowLeft') turn(-1); });
    binder.addEventListener('click', e => {
      const p = e.target.closest('[data-card]');
      if (!p) return;
      const c = a.cards.find(x => x.id === p.dataset.card);
      if (!c) return;
      openViewer(c.id, c.image, tierOf({ rarity: c.rarity, name: c.name, usd: c.usd }), {
        link: `#/carta/${encodeURIComponent(c.id)}`,
        caption: `${c.name} · ${c.set} ${c.localId} · ${fmt.clp(c.usd != null ? c.usd * fx.CLP : null)}`,
      });
    });
  };

  // --- Lista (para quitar cartas) ---
  const renderList = (st, a) => {
    const cards = sortCards(a.cards, sortKey);
    const total = a.cards.reduce((s, c) => s + (c.usd || 0), 0);
    st.innerHTML = `<p class="muted">${a.cards.length} ${a.cards.length === 1 ? 'carta' : 'cartas'} · valor total <b>${fmt.clp(total * fx.CLP)}</b> (${fmt.usd(total)})</p>
      ${cards.length ? `<div class="album-cards">${cards.map(c => `
        <div class="acard">
          <a href="#/carta/${encodeURIComponent(c.id)}"><span class="tier-wrap small tier-${tierOf({ rarity: c.rarity, name: c.name, usd: c.usd })}">${cardPic(c.id, c.image)}</span></a>
          <div class="acard-info">
            <b>${esc(c.name)}</b>
            <small>${c.dex ? `#${String(c.dex).padStart(4, '0')} · ` : ''}${esc(c.set)} ${esc(c.localId)}</small>
            <span class="acard-price">${fmt.clp(c.usd != null ? c.usd * fx.CLP : null)}</span>
          </div>
          <button class="acard-del" data-del="${esc(c.id)}" aria-label="Quitar del álbum">×</button>
        </div>`).join('')}</div>` : '<p class="muted">Este álbum está vacío. Toca <b>📁 Agregar a tu álbum</b> en cualquier carta.</p>'}
      <button class="btn ghost small danger" id="del-album">Borrar álbum</button>
      <p class="note">Los precios se actualizan solos al abrir el álbum.</p>`;
    st.querySelector('#del-album').onclick = () => {
      if (!confirm(`¿Borrar "${a.name}"? Las cartas no se borran de la app, solo de este álbum.`)) return;
      saveAlbums(loadAlbums().filter(x => x.id !== id)); location.hash = '/albumes';
    };
    st.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const list = loadAlbums(); const x = list.find(y => y.id === id);
      x.cards = x.cards.filter(c => c.id !== b.dataset.del); saveAlbums(list); render();
    });
  };

  shell();

  // Actualiza precios en segundo plano (usa la caché de la app).
  const ids = (album()?.cards || []).map(c => c.id);
  const fresh = await pool(ids, 4, cid => tcgdex.card(cid, 'en'));
  const list = loadAlbums(); const x = list.find(y => y.id === id);
  if (!x) return;
  let changed = false;
  fresh.forEach((card, i) => {
    if (!card) return;
    const c = x.cards.find(y => y.id === ids[i]);
    if (!c) return;
    const usd = referenceUsd(summarizePricing(card.pricing), fx);
    if (usd != null && usd !== c.usd) { c.usd = usd; changed = true; }
    if (!c.image && card.image) { c.image = card.image; changed = true; }
    if (c.dex == null && card.dexId?.[0]) { c.dex = card.dexId[0]; changed = true; }
    if (!c.rarity && card.rarity) { c.rarity = card.rarity; changed = true; }
  });
  if (changed && saveAlbums(list) && location.hash === `#/album/${id}` && mode !== 'binder') render();
}

// ---------- Personalizar portada ----------
function customize(id, done) {
  const list = loadAlbums(); const a = list.find(x => x.id === id);
  if (!a) return;
  const c = { ...defaultCover(), ...(a.cover || {}) };
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-box" role="dialog" aria-label="Personalizar álbum">
      <h2>Personalizar portada</h2>
      <div class="cust-preview">${coverHtml({ ...a, cover: c }, { CLP: 0 }, { mini: true })}</div>
      <label class="cust-label">Nombre<input id="c-name" value="${esc(a.name)}" maxlength="40"></label>
      <p class="cust-label">Color</p>
      <div class="cust-colors">${COVER_COLORS.map(col => `<button type="button" data-color="${col}" style="background:${col}" class="${col === c.color ? 'on' : ''}" aria-label="Color ${col}"></button>`).join('')}</div>
      <p class="cust-label">Textura</p>
      <div class="cust-chips">${Object.entries(COVER_PATTERNS).map(([k, v]) => `<button type="button" data-pattern="${k}" class="chip ${k === c.pattern ? 'on' : ''}">${v}</button>`).join('')}</div>
      <p class="cust-label">Emblema</p>
      <div class="cust-chips">${COVER_EMBLEMS.map(e => `<button type="button" data-emblem="${e}" class="chip ${e === c.emblem ? 'on' : ''}">${e || 'Ninguno'}</button>`).join('')}</div>
      <p class="cust-label">Carta de portada</p>
      <select id="c-card"><option value="">Sin carta (usar emblema)</option>${a.cards.map(x => `<option value="${esc(x.id)}" ${x.id === c.cardId ? 'selected' : ''}>${esc(x.name)} · ${esc(x.set)} ${esc(x.localId)}</option>`).join('')}</select>
      <button class="btn" data-save>Guardar</button>
      <button class="btn ghost" data-close>Cancelar</button>
    </div>`;
  };
  draw();
  sheet.addEventListener('click', e => {
    const t = e.target;
    if (t === sheet || t.closest('[data-close]')) { sheet.remove(); return; }
    const col = t.closest('[data-color]'), pat = t.closest('[data-pattern]'), emb = t.closest('[data-emblem]');
    const name = sheet.querySelector('#c-name').value, card = sheet.querySelector('#c-card').value;
    if (col) c.color = col.dataset.color;
    if (pat) c.pattern = pat.dataset.pattern;
    if (emb) c.emblem = emb.dataset.emblem;
    if (col || pat || emb) { c.cardId = card || null; a.name = name; draw(); return; }
    if (t.closest('[data-save]')) {
      c.cardId = card || null;
      const fresh = loadAlbums(); const x = fresh.find(y => y.id === id);
      if (x) { x.cover = c; x.name = (name || '').trim().slice(0, 40) || x.name; saveAlbums(fresh); }
      sheet.remove(); done();
    }
  });
  sheet.addEventListener('change', e => { if (e.target.id === 'c-card') { c.cardId = e.target.value || null; a.name = sheet.querySelector('#c-name').value; draw(); } });
  document.body.appendChild(sheet);
}
