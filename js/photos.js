// Fotos sustitutas: si una carta no tiene imagen oficial (o no carga), muestra un "+" para
// agregar una foto propia. Se guarda solo en este celular y se borra sola cuando aparece la oficial.
const KEY = 'tasador:foto:';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function getPhoto(id) { try { return localStorage.getItem(KEY + id); } catch { return null; } }
function setPhoto(id, data) { localStorage.setItem(KEY + id, data); }
function removePhoto(id) { try { localStorage.removeItem(KEY + id); } catch { /* nada */ } }

function placeholder(id, big) {
  const sub = getPhoto(id);
  if (sub) {
    return `<span class="pic sub ${big ? 'big' : ''}" data-pic="${esc(id)}"><img src="${sub}" alt="Foto temporal"><em>Foto temporal</em>` +
      (big ? `<button type="button" class="pic-btn" data-photo-add="${esc(id)}" aria-label="Cambiar foto">✎</button><button type="button" class="pic-btn del" data-photo-del="${esc(id)}" aria-label="Quitar foto">×</button>` : '') +
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
  return `<span class="pic ${big ? 'big' : ''}" data-pic="${esc(id)}"><img ${big ? '' : 'loading="lazy"'} src="${esc(base)}/${q}.webp" data-card-id="${esc(id)}" data-q="${q}" alt=""></span>`;
}

function refresh(id) {
  document.querySelectorAll(`[data-pic="${CSS.escape(id)}"]`).forEach(el => {
    if (el.querySelector('img[data-card-id]')) return; // la oficial ya está
    el.outerHTML = placeholder(id, el.classList.contains('big'));
  });
}

async function shrink(file, max = 500) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(file); }
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}

let input;
function pick(id) {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.hidden = true;
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try { setPhoto(id, await shrink(f)); refresh(id); }
    catch { alert('No se pudo guardar la foto. Puede que el celular no tenga espacio para más fotos.'); }
  };
  input.click();
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
    if (!add && !del) return;
    e.preventDefault(); e.stopPropagation();
    if (add) pick(add.dataset.photoAdd);
    else { removePhoto(del.dataset.photoDel); refresh(del.dataset.photoDel); }
  }, true);
}
