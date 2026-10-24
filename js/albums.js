// Álbumes: clasifica tus cartas en "Álbum A", "Álbum B"… y ordénalas por nombre, precio o Nº de Pokédex.
// Se guardan en este celular (localStorage).
import { tcgdex, fxRates, pool } from './api.js';
import { summarizePricing, referenceUsd, fmt } from './logic.js';
import { cardPic } from './photos.js';
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
      albums.push({ id: Date.now().toString(36), name: nextAlbumName(albums), cards: [entry] });
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

// ---------- Pantalla: lista de álbumes ----------
export async function viewAlbums(app) {
  const albums = loadAlbums();
  const fx = await fxRates();
  app.innerHTML = `<h1>Mis álbumes</h1>
    <p class="muted">Clasifica tus cartas. Para agregar una, toca <b>📁 Agregar a tu álbum</b> en cualquier carta escaneada o buscada.</p>
    <div class="albums">${albums.map(a => {
      const total = a.cards.reduce((s, c) => s + (c.usd || 0), 0);
      const covers = a.cards.slice(0, 3).map(c => cardPic(c.id, c.image)).join('');
      return `<a class="album" href="#/album/${a.id}">
        <div class="album-covers">${covers || '<span class="album-empty">Vacío</span>'}</div>
        <b>${esc(a.name)}</b><small>${a.cards.length} ${a.cards.length === 1 ? 'carta' : 'cartas'} · ${fmt.clp(total * fx.CLP)}</small></a>`;
    }).join('')}</div>
    <button class="btn" id="new-album">+ Nuevo álbum (${esc(nextAlbumName(albums))})</button>`;
  app.querySelector('#new-album').onclick = () => {
    const list = loadAlbums();
    list.push({ id: Date.now().toString(36), name: nextAlbumName(list), cards: [] });
    saveAlbums(list); viewAlbums(app);
  };
}

// ---------- Pantalla: un álbum ----------
export async function viewAlbum(app, id) {
  const albums = loadAlbums();
  const album = albums.find(a => a.id === id);
  if (!album) { location.hash = '/albumes'; return; }
  const fx = await fxRates();
  let sortKey = localStorage.getItem('tasador:albumSort') || 'name-asc';

  const draw = () => {
    const a = loadAlbums().find(x => x.id === id);
    if (!a) return;
    const cards = sortCards(a.cards, sortKey);
    const total = a.cards.reduce((s, c) => s + (c.usd || 0), 0);
    app.innerHTML = `<p><a href="#/albumes">← Mis álbumes</a></p>
      <div class="album-head">
        <h1>${esc(a.name)}</h1>
        <button class="btn ghost small" id="rename">✎ Renombrar</button>
      </div>
      <p class="muted">${a.cards.length} ${a.cards.length === 1 ? 'carta' : 'cartas'} · valor total <b>${fmt.clp(total * fx.CLP)}</b> (${fmt.usd(total)})</p>
      <label class="sort">Ordenar por
        <select id="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === sortKey ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </label>
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
    app.querySelector('#sort').onchange = e => { sortKey = e.target.value; localStorage.setItem('tasador:albumSort', sortKey); draw(); };
    app.querySelector('#rename').onclick = () => {
      const name = prompt('Nuevo nombre del álbum', a.name);
      if (!name || !name.trim()) return;
      const list = loadAlbums(); list.find(x => x.id === id).name = name.trim().slice(0, 40); saveAlbums(list); draw();
    };
    app.querySelector('#del-album').onclick = () => {
      if (!confirm(`¿Borrar "${a.name}"? Las cartas no se borran de la app, solo de este álbum.`)) return;
      saveAlbums(loadAlbums().filter(x => x.id !== id)); location.hash = '/albumes';
    };
    app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const list = loadAlbums(); const x = list.find(y => y.id === id);
      x.cards = x.cards.filter(c => c.id !== b.dataset.del); saveAlbums(list); draw();
    });
  };
  draw();

  // Actualiza precios en segundo plano (usa la caché de la app).
  const ids = album.cards.map(c => c.id);
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
  });
  if (changed && saveAlbums(list) && location.hash === `#/album/${id}`) draw();
}
