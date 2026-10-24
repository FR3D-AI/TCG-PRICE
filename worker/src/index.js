// API de Tasador TCG en Cloudflare Workers (plan gratis: 100.000 consultas/día).
// - /tcgdex/...   proxy con caché en el borde hacia api.tcgdex.net
// - /history/...  proxy con caché hacia el archivo histórico público de TCGdex
// - /jp?search=   precios japoneses vía PokemonPriceTracker (requiere el secreto PPT_KEY)
// - /             estado de la API

const ROUTES = [
  { prefix: '/tcgdex/', upstream: 'https://api.tcgdex.net/', ttl: p => (/\/sets(\?|$)/.test(p) ? 86400 : 21600) },
  { prefix: '/history/', upstream: 'https://raw.githubusercontent.com/tcgdex/price-history/master/', ttl: () => 604800 },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(res, extra = {}) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...CORS, ...extra })) out.headers.set(k, v);
  return out;
}

const json = (data, status = 200) => withCors(new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
}));

async function cached(ctx, upstreamUrl, ttl, init) {
  const cache = caches.default;
  const key = new Request(upstreamUrl, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return withCors(hit, { 'X-Cache': 'HIT' });

  const res = await fetch(upstreamUrl, init);
  if (!res.ok) return withCors(res, { 'X-Cache': 'MISS' });
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', `public, max-age=${ttl}`);
  out.headers.delete('Set-Cookie');
  ctx.waitUntil(cache.put(key, out.clone()));
  return withCors(out, { 'X-Cache': 'MISS' });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (request.method !== 'GET') return json({ error: 'Solo GET' }, 405);
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return json({ name: 'Tasador TCG API', ok: true, jp: Boolean(env.PPT_KEY) });
    }

    for (const r of ROUTES) {
      if (url.pathname.startsWith(r.prefix)) {
        const rest = url.pathname.slice(r.prefix.length);
        if (rest.includes('..')) return json({ error: 'Ruta inválida' }, 400);
        return cached(ctx, r.upstream + rest + url.search, r.ttl(url.pathname + url.search));
      }
    }

    if (url.pathname === '/jp') {
      if (!env.PPT_KEY) return json({ error: 'Falta configurar PPT_KEY' }, 501);
      const q = (url.searchParams.get('search') || '').trim().slice(0, 60);
      if (!q) return json({ error: 'Falta ?search=' }, 400);
      const upstream = `https://www.pokemonpricetracker.com/api/v2/cards?language=japanese&limit=20&search=${encodeURIComponent(q)}`;
      // La clave va en la cabecera; la caché se guarda por URL (sin la clave).
      return cached(ctx, upstream, 43200, { headers: { Authorization: `Bearer ${env.PPT_KEY}` } });
    }

    return json({ error: 'No encontrado' }, 404);
  },
};
