// Fotos de cartas: imagen oficial, foto sustituta ("+" cuando no hay oficial) y visor en pantalla completa.
// La foto sustituta se guarda en este celular: una miniatura rápida (localStorage) y la versión
// en alta resolución hasta Full HD (IndexedDB). Se borra sola cuando aparece la imagen oficial.
import { TIERS } from './tiers.js';

const KEY = 'tasador:foto:';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getPhoto(id) { try { return localStorage.getItem(KEY + id); } catch { return null; } }
function setPhoto(id, data) { localStorage.setItem(KEY + id, data); }
function removePhoto(id) { try { localStorage.removeItem(KEY + id); } catch { /* nada */ } idb('delete', id).catch(() => {}); }

// ---------- IndexedDB para la foto en alta resolución ----------
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('tasador-fotos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('full');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(op, key, val) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('full', op === 'get' ? 'readonly' : 'readwrite');
    const st = tx.objectStore('full');
    const r = op === 'get' ? st.get(key) : op === 'put' ? st.put(val, key) : st.delete(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function placeholder(id, big) {
  const sub = getPhoto(id);
  if (sub) {
    return `<span class="pic sub ${big ? 'big' : ''}" data-pic="${esc(id)}"><img src="${sub}" alt="Foto temporal" ${big ? `data-photo-full="${esc(id)}"` : ''}><em>Foto temporal</em>` +
      (big ? `<button type="button" class="pic-btn full" data-photo-full="${esc(id)}" aria-label="Ver en pantalla completa">⛶</button><button type="button" class="pic-btn" data-photo-add="${esc(id)}" aria-label="Cambiar foto">✎</button><button type="button" class="pic-btn del" data-photo-del="${esc(id)}" aria-label="Quitar foto">×</button>` : '') +
      '</span>';
  }
  return `<span class="pic none ${big ? 'big' : ''}" data-pic="${esc(id)}"><button type="button" class="pic-add" data-photo-add="${esc(id)}" aria-label="Agregar foto"><b>+</b><small>Agregar foto</small></button></span>`;
}

/**
 * HTML de la imagen de una carta. Si no hay imagen oficial, muestra la foto temporal o el botón "+".
 * @param {string} id id de la carta
 * @param {string|undefined} base URL base de imagen TCGdex (sin calidad ni extensión)
 * @param {'low'|'high'} q calidad
 */
export function cardPic(id, base, q = 'low') {
  const big = q === 'high';
  if (!base) return placeholder(id, big);
  return `<span class="pic ${big ? 'big' : ''}" data-pic="${esc(id)}"><img ${big ? `data-photo-full="${esc(id)}" data-base="${esc(base)}"` : 'loading="lazy"'} src="${esc(base)}/${q}.webp" data-card-id="${esc(id)}" data-q="${q}" alt="">` +
    (big ? `<button type="button" class="pic-btn full" data-photo-full="${esc(id)}" data-base="${esc(base)}" aria-label="Ver en pantalla completa">⛶</button>` : '') + '</span>';
}

function refresh(id) {
  document.querySelectorAll(`[data-pic="${CSS.escape(id)}"]`).forEach(el => {
    if (el.querySelector('img[data-card-id]')) return; // la oficial ya está
    el.outerHTML = placeholder(id, el.classList.contains('big'));
  });
}

async function shrink(file, max, quality) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

let input;
function pick(id) {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.hidden = true; // sin "capture": el celular ofrece cámara o álbum
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      setPhoto(id, await shrink(f, 500, 0.78));
      // Alta resolución (hasta Full HD 1920 px) para el visor; si falla, queda la miniatura.
      try { await idb('put', id, await shrink(f, 1920, 0.9)); } catch { /* sin IndexedDB */ }
      refresh(id);
    } catch { alert('No se pudo guardar la foto. Puede que el celular no tenga espacio para más fotos.'); }
  };
  input.click();
}

// ---------- Visor en pantalla completa ----------
export async function openViewer(id, base, tier, opts = {}) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="viewer-bar"><span class="viewer-note">Cargando…</span><button type="button" class="viewer-close" aria-label="Cerrar">×</button></div>
    <div class="viewer-stage"><div class="viewer-tilt ${tier ? 'has-tier' : ''}">
      <i class="vt-edge" style="--z:-1px"></i><i class="vt-edge" style="--z:-2px"></i><i class="vt-edge" style="--z:-3px"></i><i class="vt-edge" style="--z:-4px"></i><i class="vt-edge" style="--z:-5px"></i>
      <div class="viewer-back" aria-hidden="true"><div class="vb-inner"><b>Tasador</b><small>TCG</small></div></div>
      <div class="viewer-frame ${tier ? `tier-wrap tier-${tier}` : ''}"><span class="pic viewer-pic"><img alt="Carta en pantalla completa" draggable="false"></span></div>
      <i class="vt-glare"></i>
    </div></div>
    ${opts.caption ? `<p class="viewer-cap">${esc(opts.caption)}</p>` : ''}
    <p class="viewer-hint">Arrastra para girar la carta · <button type="button" class="viewer-spin">↻ Girar</button> · toca dos veces para acercar${opts.link ? ` · <a href="${esc(opts.link)}" class="viewer-link">Ver ficha completa ›</a>` : ''}</p>`;
  document.body.appendChild(v);
  document.documentElement.classList.add('no-scroll');
  const img = v.querySelector('img'), note = v.querySelector('.viewer-note'), stage = v.querySelector('.viewer-stage');
  let raf = 0;
  const close = () => { cancelAnimationFrame(raf); v.remove(); document.documentElement.classList.remove('no-scroll'); };
  v.querySelector('.viewer-close').onclick = close;
  v.querySelector('.viewer-link')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

  if (base) {
    img.src = `${base}/high.png`; // la mayor resolución que publica TCGdex
    img.onerror = () => { img.onerror = null; img.src = `${base}/high.webp`; };
    note.textContent = 'Imagen oficial · máxima calidad disponible';
  } else {
    let full = null;
    try { full = await idb('get', id); } catch { /* nada */ }
    img.src = full || getPhoto(id);
    note.textContent = full ? 'Tu foto · alta resolución' : 'Tu foto';
  }
  img.onload = () => { note.textContent += ` · ${img.naturalWidth}×${img.naturalHeight}`; };
  if (tier && TIERS[tier]) note.insertAdjacentHTML('beforebegin', `<span class="tier-badge tb-${tier} viewer-tier">${TIERS[tier].icon} ${TIERS[tier].label}</span>`);

  // Giro 3D: arrastra con un dedo (o el mouse) para inclinar y dar vuelta la carta.
  const tilt = v.querySelector('.viewer-tilt');
  let rx = 0, ry = 0, vx = 0, vy = 0, drag = null, spinning = false;
  const paint = () => {
    tilt.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    const a = ((ry % 360) + 360) % 360;
    tilt.style.setProperty('--gx', `${50 - Math.sin(ry * Math.PI / 180) * 60}%`);
    tilt.style.setProperty('--gy', `${50 + Math.sin(rx * Math.PI / 180) * 70}%`);
    tilt.style.setProperty('--gl', String(Math.min(1, (Math.abs(Math.sin(ry * Math.PI / 180)) + Math.abs(Math.sin(rx * Math.PI / 180))) * 1.4)));
    tilt.classList.toggle('flipped', a > 90 && a < 270);
  };
  const settle = () => {
    cancelAnimationFrame(raf);
    const target = Math.round(ry / 180) * 180;
    const step = () => {
      vy = (vy + (target - ry) * 0.06) * 0.82;
      vx = (vx + (0 - rx) * 0.06) * 0.82;
      ry += vy; rx += vx;
      if (Math.abs(target - ry) < 0.05 && Math.abs(rx) < 0.05 && Math.abs(vy) < 0.05) {
        ry = ((target % 360) + 360) % 360; rx = 0; vx = vy = 0; paint(); return;
      }
      paint(); raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  const pointers = new Set();
  stage.addEventListener('pointerdown', e => {
    pointers.add(e.pointerId);
    if (zoomed || pointers.size > 1 || spinning) { drag = null; return; }
    cancelAnimationFrame(raf);
    drag = { x: e.clientX, y: e.clientY, rx, ry, t: e.timeStamp, lx: e.clientX, ly: e.clientY, moved: false };
    vx = vy = 0;
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || zoomed || pointers.size > 1) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; try { stage.setPointerCapture(e.pointerId); } catch { /* nada */ } }
    const w = Math.max(240, tilt.offsetWidth);
    const nry = drag.ry + dx / w * 200;
    const nrx = Math.max(-65, Math.min(65, drag.rx - dy / w * 160));
    vy = nry - ry; vx = nrx - rx; drag.lt = e.timeStamp;
    ry = nry; rx = nrx;
    paint();
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (!drag) return;
    const moved = drag.moved, still = e.timeStamp - (drag.lt || 0) > 70; drag = null;
    if (!moved) return;
    if (still) { vx = vy = 0; settle(); return; } // soltó sin mover: vuelve suave a la cara más cercana
    vy *= 0.6; vx *= 0.6;
    // Inercia: un movimiento rápido sigue girando antes de asentarse.
    let n = 0;
    const coast = () => {
      ry += vy; rx = Math.max(-65, Math.min(65, rx + vx));
      vy *= 0.93; vx *= 0.85; paint();
      if (Math.abs(vy) > 0.6 && n++ < 90) raf = requestAnimationFrame(coast); else settle();
    };
    raf = requestAnimationFrame(coast);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  v.querySelector('.viewer-spin').onclick = () => {
    if (zoomed || spinning) return;
    cancelAnimationFrame(raf); spinning = true;
    const from = ry, t0 = performance.now();
    const go = now => {
      const k = Math.min(1, (now - t0) / 1600), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      ry = from + 360 * e; rx = Math.sin(k * Math.PI) * 12; paint();
      if (k < 1) raf = requestAnimationFrame(go); else { spinning = false; ry = ((ry % 360) + 360) % 360; rx = 0; paint(); }
    };
    raf = requestAnimationFrame(go);
  };
  paint();

  // Doble toque: alterna zoom 2.5x centrado donde tocaste.
  let zoomed = false, last = 0;
  const toggle = (x, y) => {
    zoomed = !zoomed;
    cancelAnimationFrame(raf); rx = 0; ry = 0; vx = vy = 0; paint();
    stage.classList.toggle('zoomed', zoomed);
    if (zoomed) {
      const r = img.getBoundingClientRect();
      requestAnimationFrame(() => {
        stage.scrollLeft = (x - r.left) / r.width * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = (y - r.top) / r.height * stage.scrollHeight - stage.clientHeight / 2;
      });
    }
  };
  tilt.addEventListener('dblclick', e => toggle(e.clientX, e.clientY));
  tilt.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - last < 300 && e.changedTouches[0]) { e.preventDefault(); toggle(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }
    last = now;
  });
}

export function initPhotos() {
  // Imagen oficial que no existe (404) → foto temporal o botón "+".
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.dataset.cardId) return;
    const wrap = img.closest('[data-pic]');
    if (wrap) wrap.outerHTML = placeholder(img.dataset.cardId, wrap.classList.contains('big'));
  }, true);
  // Apareció la imagen oficial → ya no hace falta la temporal.
  document.addEventListener('load', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.cardId && getPhoto(img.dataset.cardId)) removePhoto(img.dataset.cardId);
  }, true);
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-photo-add]');
    const del = e.target.closest('[data-photo-del]');
    const full = e.target.closest('[data-photo-full]');
    if (!add && !del && !full) return;
    e.preventDefault(); e.stopPropagation();
    if (add) pick(add.dataset.photoAdd);
    else if (del) { removePhoto(del.dataset.photoDel); refresh(del.dataset.photoDel); }
    else {
      const tw = full.closest('.tier-wrap');
      const tier = tw ? [...tw.classList].find(c => c.startsWith('tier-') && c !== 'tier-wrap')?.slice(5) : null;
      openViewer(full.dataset.photoFull, full.dataset.base, tier);
    }
  }, true);
}
