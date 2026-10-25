// Tapa Pokémon: temas por tipo de energía, Pokémon de portada (arte oficial vía PokeAPI, normal o shiny)
// y sello de Poké Ball. Las imágenes vienen de PokeAPI; nada se dibuja a mano.
import { getJSON } from './api.js';

const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
export const artUrl = (dex, shiny = false) => `${SPR}/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${dex}.png`;
export const ballUrl = slug => `${SPR}/items/${slug}.png`;

export const POKE_TYPES = {
  fuego: { label: 'Fuego', icon: '🔥', color: '#c2410c', glow: '#fb923c' },
  agua: { label: 'Agua', icon: '💧', color: '#1d4ed8', glow: '#60a5fa' },
  planta: { label: 'Planta', icon: '🍃', color: '#15803d', glow: '#4ade80' },
  electrico: { label: 'Eléctrico', icon: '⚡', color: '#a16207', glow: '#facc15' },
  psiquico: { label: 'Psíquico', icon: '🔮', color: '#86198f', glow: '#e879f9' },
  lucha: { label: 'Lucha', icon: '👊', color: '#9a3412', glow: '#fdba74' },
  oscuridad: { label: 'Oscuridad', icon: '🌑', color: '#1e1b2e', glow: '#a78bfa' },
  metal: { label: 'Metal', icon: '⚙️', color: '#475569', glow: '#cbd5e1' },
  dragon: { label: 'Dragón', icon: '🐉', color: '#3730a3', glow: '#fbbf24' },
  hada: { label: 'Hada', icon: '✨', color: '#be185d', glow: '#f9a8d4' },
  incoloro: { label: 'Incoloro', icon: '⭐', color: '#78716c', glow: '#f5f5f4' },
};

export const BALLS = {
  'poke-ball': 'Poké Ball', 'great-ball': 'Super Ball', 'ultra-ball': 'Ultra Ball', 'master-ball': 'Master Ball',
  'premier-ball': 'Honor Ball', 'luxury-ball': 'Lujo Ball', 'dusk-ball': 'Ocaso Ball', 'quick-ball': 'Veloz Ball',
  'heal-ball': 'Sana Ball', 'net-ball': 'Malla Ball', 'beast-ball': 'Ente Ball', 'cherish-ball': 'Gloria Ball',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** Fondo repetido con el ícono del tipo (SVG en data-URI). */
export function energyBg(type) {
  const t = POKE_TYPES[type];
  if (!t) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><text x="4" y="20" font-size="14" opacity=".22">${t.icon}</text><text x="26" y="40" font-size="14" opacity=".22">${t.icon}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Lista de especies (nombre + número), guardada en caché 30 días. */
let speciesP;
export function species() {
  if (!speciesP) speciesP = getJSON('https://pokeapi.co/api/v2/pokemon-species?limit=1100', 30 * 24 * 3600e3)
    .then(r => (r.results || []).map(s => ({ name: s.name, dex: +s.url.match(/\/(\d+)\/?$/)[1] })))
    .catch(() => []);
  return speciesP;
}

/** Busca por nombre (inglés/español suelen coincidir) o por número de Pokédex. */
export function findSpecies(list, q) {
  const n = norm(q);
  if (!n) return [];
  if (/^\d+$/.test(n)) {
    const d = +n;
    if (d < 1 || d > 1025) return [];
    return [list.find(s => s.dex === d) || { name: '', dex: d }];
  }
  return list.filter(s => norm(s.name).startsWith(n)).concat(list.filter(s => !norm(s.name).startsWith(n) && norm(s.name).includes(n))).slice(0, 12);
}

const title = s => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/**
 * Hoja "Tapa Pokémon". `a` es el álbum, `c` la portada (se modifica), `preview(c)` devuelve el HTML de vista previa.
 * Llama a `save(c)` al guardar.
 */
export function openPokeCover(a, cover, preview, save) {
  const c = { ...cover };
  const fromAlbum = [...new Map(a.cards.filter(x => x.dex).map(x => [x.dex, x])).values()].slice(0, 18);
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  let q = '', results = [];
  const tile = (dex, label) => `<button type="button" class="pk-tile ${c.poke === dex ? 'on' : ''}" data-poke="${dex}" aria-label="${esc(label)}">
      <img loading="lazy" src="${artUrl(dex)}" alt=""><small>${esc(label)}</small></button>`;
  const drawResults = () => {
    const box = sheet.querySelector('#pk-results');
    if (box) box.innerHTML = results.length ? results.map(s => tile(s.dex, `#${s.dex} ${title(s.name)}`.trim())).join('') : (q ? '<p class="muted small">Sin resultados. Prueba con el nombre en inglés o el número.</p>' : '');
  };
  const draw = () => {
    sheet.innerHTML = `<div class="sheet-box pk-sheet" role="dialog" aria-label="Tapa Pokémon">
      <h2>🔴 Tapa Pokémon</h2>
      <div class="cust-preview">${preview(c)}</div>

      <p class="cust-label">Tipo de energía</p>
      <div class="pk-types">${Object.entries(POKE_TYPES).map(([k, t]) => `<button type="button" data-type="${k}" class="pk-type ${c.type === k ? 'on' : ''}" style="--t:${t.color};--g:${t.glow}"><span>${t.icon}</span>${t.label}</button>`).join('')}
        <button type="button" data-type="" class="pk-type ${!c.type ? 'on' : ''}" style="--t:#334155;--g:#94a3b8"><span>✖</span>Ninguno</button></div>

      <p class="cust-label">Pokémon de portada</p>
      ${fromAlbum.length ? `<p class="muted small">De tu álbum</p><div class="pk-grid">${fromAlbum.map(x => tile(x.dex, x.name)).join('')}</div>` : ''}
      <input id="pk-q" type="search" placeholder="Buscar por nombre o Nº Pokédex (ej. charizard, 25)" value="${esc(q)}" autocomplete="off">
      <div class="pk-grid" id="pk-results"></div>
      <div class="pk-opts">
        <label class="sheet-row"><input type="checkbox" id="pk-shiny" ${c.shiny ? 'checked' : ''}><span>Versión shiny ✨</span></label>
        ${c.poke ? '<button type="button" class="btn ghost small" data-nopoke>Quitar Pokémon</button>' : ''}
      </div>

      <p class="cust-label">Sello de Poké Ball</p>
      <div class="pk-balls">${Object.entries(BALLS).map(([k, v]) => `<button type="button" data-ball="${k}" class="pk-ball ${c.ball === k ? 'on' : ''}" title="${v}"><img src="${ballUrl(k)}" alt=""><small>${v}</small></button>`).join('')}
        <button type="button" data-ball="" class="pk-ball ${!c.ball ? 'on' : ''}"><span>✖</span><small>Ninguno</small></button></div>

      <p class="note">Si eliges una carta de portada en 🎨 Personalizar, la carta se muestra en vez del Pokémon.</p>
      <button class="btn" data-save>Guardar</button>
      <button class="btn ghost" data-close>Cancelar</button>
    </div>`;
    drawResults();
    const inp = sheet.querySelector('#pk-q');
    inp.addEventListener('input', async () => {
      q = inp.value;
      const list = await species();
      results = findSpecies(list, q);
      drawResults();
    });
  };
  draw();
  const keepScroll = fn => { const b = sheet.querySelector('.sheet-box'); const y = b.scrollTop; fn(); sheet.querySelector('.sheet-box').scrollTop = y; };
  sheet.addEventListener('click', e => {
    const t = e.target;
    if (t === sheet || t.closest('[data-close]')) { sheet.remove(); return; }
    const ty = t.closest('[data-type]'), pk = t.closest('[data-poke]'), bl = t.closest('[data-ball]');
    if (ty) { c.type = ty.dataset.type || null; if (c.type) { c.color = POKE_TYPES[c.type].color; c.pattern = 'energia'; c.emblem = POKE_TYPES[c.type].icon; } else if (c.pattern === 'energia') c.pattern = 'cuero'; }
    else if (pk) { c.poke = +pk.dataset.poke; c.cardId = null; }
    else if (bl) c.ball = bl.dataset.ball || null;
    else if (t.closest('[data-nopoke]')) c.poke = null;
    else if (t.closest('[data-save]')) { sheet.remove(); save(c); return; }
    else return;
    keepScroll(draw);
  });
  sheet.addEventListener('change', e => { if (e.target.id === 'pk-shiny') { c.shiny = e.target.checked; keepScroll(draw); } });
  document.body.appendChild(sheet);
}
