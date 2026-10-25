// Respaldo automático en GitHub: las cartas de tus álbumes se agregan solas a data/watchlist.json
// y GitHub Actions guarda su precio todos los días, aunque no abras la app.
// Necesita un token de GitHub con permiso SOLO sobre este repositorio (Contents: Read and write).
import { getConfig } from './config.js';
import { loadAlbums } from './albums.js';

const STATE = 'tasador:ghsync';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nada */ } };
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

/** Repositorio configurado, o el que se deduce del sitio (usuario.github.io/repo). */
export function repoOf(cfg = getConfig()) {
  if (cfg.githubRepo) return cfg.githubRepo;
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? `${m[1]}/${seg}` : '';
}

/** Cartas que deben tener historial diario: las de tus álbumes + las que marcaste "Seguir". */
export function wantedCards() {
  const ids = new Set();
  for (const a of loadAlbums()) for (const c of a.cards) ids.add(c.id);
  for (const w of read('tasador:watch', [])) ids.add(w.id);
  return [...ids].sort();
}

/** Une la lista del repositorio con la tuya (nunca quita cartas: así su historial sigue creciendo). */
export function mergeWatchlist(remote, wanted) {
  const merged = [...new Set([...(remote || []), ...wanted])];
  return { merged, added: merged.length - new Set(remote || []).size };
}

export const syncStatus = () => read(STATE, {});

let running = null;
export function syncWatchlist({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const cfg = getConfig(), repo = repoOf(cfg), token = (cfg.githubToken || '').trim();
    if (!repo || !token) return { ok: false, reason: 'config' };
    const wanted = wantedCards(), key = wanted.join(',');
    const st = syncStatus();
    if (!force && st.ok && st.key === key) return { ok: true, skipped: true, total: st.total };
    const url = `https://api.github.com/repos/${repo}/contents/data/watchlist.json`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const fail = reason => { write(STATE, { ...st, ok: false, reason, at: Date.now() }); return { ok: false, reason }; };
    let res;
    try { res = await fetch(url, { headers, cache: 'no-store' }); } catch { return fail('red'); }
    if (res.status === 401) return fail('token');
    if (res.status === 403) return fail('permiso');
    let sha, remote = [];
    if (res.ok) {
      const j = await res.json();
      sha = j.sha;
      try { remote = JSON.parse(unb64(j.content)).cards || []; } catch { remote = []; }
    } else if (res.status !== 404) return fail(`http ${res.status}`);
    const { merged, added } = mergeWatchlist(remote, wanted);
    if (added > 0) {
      const body = {
        message: `Seguimiento automático: +${added} ${added === 1 ? 'carta' : 'cartas'} de tus álbumes`,
        content: b64(JSON.stringify({ cards: merged }, null, 2) + '\n'),
        ...(sha ? { sha } : {}),
      };
      let put;
      try { put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) }); } catch { return fail('red'); }
      if (put.status === 401) return fail('token');
      if (put.status === 403 || put.status === 404) return fail('permiso');
      if (put.status === 409) { running = null; return syncWatchlist({ force: true }); } // cambió entre medio: reintenta
      if (!put.ok) return fail(`http ${put.status}`);
    }
    const out = { ok: true, key, total: merged.length, added, at: Date.now() };
    write(STATE, out);
    return out;
  })().finally(() => { running = null; });
  return running;
}

/** Explica el estado en palabras simples (pantalla Ajustes). */
export function describeSync(st = syncStatus(), cfg = getConfig()) {
  if (!cfg.githubToken) return 'Desactivado: falta el token de GitHub.';
  if (!st.at) return 'Aún no se ha sincronizado.';
  const when = new Date(st.at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
  if (st.ok) return `✓ Activo · ${st.total} ${st.total === 1 ? 'carta' : 'cartas'} con historial diario en GitHub · última revisión ${when}`;
  const why = { token: 'el token no es válido o venció', permiso: 'el token no tiene permiso de escritura sobre este repositorio', red: 'no hubo conexión' }[st.reason] || st.reason;
  return `✗ No se pudo sincronizar (${why}) · ${when}`;
}

/** Arranque: sincroniza al abrir, al volver a la app y cuando cambian tus álbumes. */
export function initCloudSync() {
  let t;
  const later = (ms = 2500) => { clearTimeout(t); t = setTimeout(() => syncWatchlist().catch(() => {}), ms); };
  later(3000);
  window.addEventListener('tasador:albums', () => later());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later(); });
}
