// Escaneo por foto: OCR en el dispositivo con Tesseract.js (la foto no sale del celular).
import { parseOcr } from './logic.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let ocrWorker = null;
let progressCb = () => {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar el lector OCR. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
}

function getWorker() {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng', 1, {
        logger: m => { if (m.status === 'recognizing text') progressCb(m.progress); },
      });
    })().catch(err => { ocrWorker = null; throw err; });
  }
  return ocrWorker;
}

async function toBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return await createImageBitmap(file); }
}

/** Recorta una franja (fracciones 0..1), agranda y aumenta contraste para el OCR. */
function crop(bmp, [x, y, w, h], targetW = 1400) {
  const sx = bmp.width * x, sy = bmp.height * y, sw = bmp.width * w, sh = bmp.height * h;
  const scale = targetW / sw;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Lee la carta. Intenta con la foto completa como respaldo si no encuentra el número.
 * @returns {Promise<{number, nameGuess, preview:string}>}
 */
export async function scanCard(file, onProgress = () => {}) {
  progressCb = p => onProgress(p);
  const worker = await getWorker();
  const bmp = await toBitmap(file);
  // Si la foto es horizontal, la carta probablemente está girada: no la giramos, pero leemos todo.
  const top = crop(bmp, [0.04, 0.02, 0.92, 0.14]);
  const bottom = crop(bmp, [0, 0.84, 1, 0.16]);
  onProgress(0.05, 'Leyendo el nombre…');
  const topText = (await worker.recognize(top)).data.text;
  onProgress(0.5, 'Leyendo el número…');
  const bottomText = (await worker.recognize(bottom)).data.text;
  let parsed = parseOcr(topText, bottomText);
  if (!parsed.number) {
    onProgress(0.8, 'Revisando la foto completa…');
    const full = crop(bmp, [0, 0, 1, 1], 1600);
    const fullText = (await worker.recognize(full)).data.text;
    const again = parseOcr(topText, fullText);
    parsed = { number: again.number, nameGuess: parsed.nameGuess || again.nameGuess };
  }
  const prev = document.createElement('canvas');
  const s = 360 / bmp.width;
  prev.width = 360; prev.height = Math.round(bmp.height * s);
  prev.getContext('2d').drawImage(bmp, 0, 0, prev.width, prev.height);
  return { ...parsed, preview: prev.toDataURL('image/jpeg', 0.7), debug: { topText, bottomText } };
}
