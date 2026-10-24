// Guarda una "foto" diaria del precio de cada carta en data/watchlist.json.
// Lo ejecuta GitHub Actions (ver .github/workflows/snapshot.yml). Node 20+, sin dependencias.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const API = 'https://api.tcgdex.net/v2/en/cards/';
const today = new Date().toISOString().slice(0, 10);
const { cards = [] } = JSON.parse(await readFile('data/watchlist.json', 'utf8'));
await mkdir('data/history', { recursive: true });

const index = [];
for (const id of [...new Set(cards)]) {
  const file = `data/history/${id.replace(/[^\w.-]/g, '_')}.json`;
  let card;
  try {
    const res = await fetch(API + encodeURIComponent(id));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    card = await res.json();
  } catch (err) {
    console.warn(`✗ ${id}: ${err.message}`);
    continue;
  }

  const tp = card.pricing?.tcgplayer || {};
  const cm = card.pricing?.cardmarket || {};
  const tcgplayer = {};
  for (const [k, v] of Object.entries(tp)) {
    if (v && typeof v === 'object') tcgplayer[k] = v.marketPrice ?? v.midPrice ?? null;
  }
  const point = {
    date: today,
    tcgplayer,
    cardmarket: { trend: cm.trend ?? null, avg30: cm.avg30 ?? null, trendHolo: cm['trend-holo'] ?? null },
  };

  let hist = { id, name: card.name, set: card.set?.name, points: [] };
  try { hist = JSON.parse(await readFile(file, 'utf8')); } catch { /* archivo nuevo */ }
  hist.points = hist.points.filter(p => p.date !== today);
  hist.points.push(point);
  hist.points.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(file, JSON.stringify(hist) + '\n');
  index.push({ id, name: card.name, updated: today, points: hist.points.length });
  console.log(`✓ ${id} ${card.name}`, JSON.stringify(point));
  await new Promise(r => setTimeout(r, 300)); // ser amable con la API
}

await writeFile('data/history/index.json', JSON.stringify({ updated: today, cards: index }, null, 2) + '\n');
