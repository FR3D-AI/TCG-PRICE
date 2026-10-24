// Pruebas de la lógica pura: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOcr, similarity, localIdVariants, summarizePricing, momentum, pickArchiveSeries,
  yearly, spanishEstimate, median, dropOutliers, setIdFromCardId,
} from '../js/logic.js';

test('OCR: número normal y confusiones típicas', () => {
  assert.deepEqual(parseOcr('Charizard ex 330', '199/165 SAR').number, { prefix: '', local: 199, total: 165, raw: '199/165' });
  assert.equal(parseOcr('', 'illus. 025 l 165').number.local, 25);
  assert.equal(parseOcr('', '6 | 165').number.total, 165);
  assert.equal(parseOcr('', 'TG05/TG30').number.prefix, 'TG');
  assert.equal(parseOcr('', 'nada que ver 12345').number, null);
});

test('OCR: nombre sin ruido', () => {
  assert.equal(parseOcr('BÁSICO  Pikachu  PS 60\n', '').nameGuess, 'Pikachu');
  assert.equal(parseOcr('STAGE2 Charizard ex HP330', '').nameGuess, 'Charizard ex');
});

test('similitud de nombres', () => {
  assert.ok(similarity('Charizard ex', 'Charizard ex') === 1);
  assert.ok(similarity('Charlzard', 'Charizard') > 0.8);
  assert.ok(similarity('Pikachu', 'Charizard') < 0.4);
  assert.ok(similarity('Raichú', 'Raichu') === 1);
});

test('variantes de número local e id de set', () => {
  assert.deepEqual(localIdVariants({ local: 6 }), ['6', '006']);
  assert.ok(localIdVariants({ prefix: 'TG', local: 5 }).includes('TG05'));
  assert.equal(setIdFromCardId('sv03.5-199'), 'sv03.5');
  assert.equal(setIdFromCardId('swshp-SWSH001'), 'swshp');
});

const pricing = {
  cardmarket: { updated: '2026-10-24', unit: 'EUR', idProduct: 1, avg: 230, low: 180, trend: 240, avg1: 260, avg7: 245, avg30: 220, 'trend-holo': 300 },
  tcgplayer: { unit: 'USD', updated: '2026-10-24', 'reverse-holofoil': { lowPrice: 1, midPrice: 2, highPrice: 3, marketPrice: 2.5 }, holofoil: { lowPrice: 200, midPrice: 260, highPrice: 400, marketPrice: 255 } },
};

test('resumen de precios TCGdex', () => {
  const s = summarizePricing(pricing);
  assert.equal(s.usd, 255);
  assert.equal(s.tcg[0].variant, 'holofoil');
  assert.equal(s.eur, 240);
  assert.equal(s.cardmarket.holo.trend, 300);
  assert.equal(summarizePricing(null).usd, null);
  assert.equal(momentum(s.cardmarket).label, 'Subiendo');
});

test('archivo histórico: elige Near Mint y pasa centavos a USD', () => {
  const a = { data: {
    'holo-good': { history: { '2023-01-01': { avg: 10000 }, '2023-02-01': { avg: 11000 } } },
    'holo-nearmint': { history: { '2023-01-01': { avg: 20000 }, '2024-01-01': { avg: 30000 } } },
  } };
  const s = pickArchiveSeries(a);
  assert.match(s.label, /Near Mint/);
  assert.deepEqual(s.points.map(p => p.usd), [200, 300]);
  const rows = yearly(s.points);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].changePct, 50);
});

test('descarta ventas atípicas', () => {
  const pts = [10, 11, 9, 10, 12, 500, 10].map((usd, i) => ({ date: `2023-01-0${i + 1}`, usd }));
  assert.equal(dropOutliers(pts).length, 6);
});

test('valor en español: prioridad y respaldo', () => {
  const fx = { CLP: 1000, EUR: 0.9 };
  assert.equal(median([3, 1, 2]), 2);
  const onlyMl = spanishEstimate({ ml: [100000, 120000], cmEs: [], foros: [] }, fx, 50);
  assert.equal(onlyMl.value, 110000);
  assert.equal(onlyMl.fallback, false);
  const mixed = spanishEstimate({ ml: [100000], cmEs: [90], foros: [70000] }, fx, 50);
  // ML (100.000×3) + CM (90€→100.000×2) + foros (70.000×1) / 6
  assert.equal(Math.round(mixed.value), 95000);
  const none = spanishEstimate({ ml: [], cmEs: [], foros: [] }, fx, 50);
  assert.equal(none.fallback, true);
  assert.equal(none.value, 50000);
});

import { detectMoves, explainMove, monthly } from '../js/timeline.js';

test('línea de tiempo: detecta subidas, bajadas y el salto hasta hoy', () => {
  const pts = [];
  const months = ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07'];
  const vals = [100, 98, 60, 55, 54, 90, 95];
  months.forEach((m, i) => pts.push({ date: `${m}-10`, usd: vals[i] }));
  assert.equal(monthly(pts).length, 7);
  const moves = detectMoves(pts, 300, '2026-10-24');
  assert.equal(moves[0].dir, 'down');
  assert.ok(moves.some(m => m.dir === 'up' && !m.gap));
  assert.ok(moves.some(m => m.gap && m.dir === 'up'));
  const ex = explainMove(moves[0], [{ type: 'reprint', date: '2023-03-01', set: 'Set X' }], '2022-12-01');
  assert.match(ex.head, /^Bajó/);
  assert.match(ex.text, /lanzamiento/);
  assert.match(ex.text, /Set X/);
});

import { computeSignals, analogReaction } from '../js/signals.js';

test('señales: reacción histórica y veredicto con colores', () => {
  const pts = [
    { date: '2024-01-05', usd: 100 }, { date: '2024-01-15', usd: 102 },
    { date: '2024-02-15', usd: 80 }, { date: '2024-03-10', usd: 78 },
  ];
  const an = analogReaction(pts, ['2024-01-26']);
  assert.equal(an.n, 1);
  assert.ok(an.avgPct < -15);
  const recent = computeSignals({ card: { dexId: [999], rarity: 'Double rare', regulationMark: 'I' }, today: '2026-10-24', releaseDate: '2026-08-01', upcoming: [], analog: null, momentumPct: -12 });
  assert.equal(recent.verdict, 'down');
  const iconic = computeSignals({ card: { dexId: [6], rarity: 'Rare Holo' }, today: '2026-10-24', releaseDate: '1999-01-09', upcoming: [{ date: '2026-09-01', set: 'X', name: 'Charizard', jp: true }], analog: { n: 3, avgPct: 12 }, momentumPct: 8 });
  assert.equal(iconic.verdict, 'up');
  assert.equal(iconic.label, 'Posible alza');
});
