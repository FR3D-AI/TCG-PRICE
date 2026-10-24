// Identifica la carta a partir de lo que leyó el OCR (número + nombre) o de una búsqueda escrita.
import { tcgdex } from './api.js';
import { localIdVariants, setIdFromCardId, similarity, parseOcr } from './logic.js';

/**
 * @param {{number?:{prefix,local,total}, nameGuess?:string}} read
 * @returns {Promise<Array<{id,name,nameEs,image,setId,score}>>} candidatos ordenados
 */
export async function identify(read) {
  const { number, nameGuess = '' } = read;
  const byId = new Map();
  const add = (brief, lang) => {
    const cur = byId.get(brief.id) || { id: brief.id, setId: setIdFromCardId(brief.id), localId: brief.localId, image: brief.image };
    if (lang === 'en') cur.name = brief.name; else cur.nameEs = brief.name;
    cur.image = cur.image || brief.image;
    byId.set(brief.id, cur);
  };

  if (number) {
    const locals = localIdVariants(number);
    const [sets, ...lists] = await Promise.all([
      tcgdex.sets('en').catch(() => []),
      ...locals.map(l => tcgdex.search({ localId: `eq:${l}` }, 'en')),
      ...locals.map(l => tcgdex.search({ localId: `eq:${l}` }, 'es')),
    ]);
    lists.forEach((list, i) => list.forEach(b => add(b, i < locals.length ? 'en' : 'es')));
    const matchingSets = new Set((sets || [])
      .filter(s => s.cardCount && (s.cardCount.official === number.total || s.cardCount.total === number.total))
      .map(s => s.id));
    for (const c of byId.values()) {
      const nameScore = nameGuess ? Math.max(similarity(nameGuess, c.name || ''), similarity(nameGuess, c.nameEs || '')) : 0;
      c.setMatch = matchingSets.has(c.setId);
      c.score = (c.setMatch ? 1 : 0) + nameScore;
    }
    let list = [...byId.values()];
    // Si alguna coincide con el total del set, descartamos el resto.
    if (list.some(c => c.setMatch)) list = list.filter(c => c.setMatch);
    // Sin coincidencias de set: deja solo las que se parecen al nombre.
    else if (nameGuess) list = list.filter(c => c.score > 0.45);
    if (list.length) return list.sort((a, b) => b.score - a.score).slice(0, 12);
  }

  if (nameGuess) return searchByName(nameGuess);
  return [];
}

/** Búsqueda por texto: acepta "Charizard", "Charizard ex 199/165" o solo "199/165". */
export async function searchText(q) {
  const parsed = parseOcr(q, q);
  const name = q.replace(parsed.number?.raw || '', '').trim();
  if (parsed.number) return identify({ number: parsed.number, nameGuess: name });
  return searchByName(name);
}

async function searchByName(name) {
  const [en, es] = await Promise.all([
    tcgdex.search({ name, 'pagination:itemsPerPage': 60 }, 'en'),
    tcgdex.search({ name, 'pagination:itemsPerPage': 60 }, 'es'),
  ]);
  const byId = new Map();
  for (const b of en) byId.set(b.id, { id: b.id, setId: setIdFromCardId(b.id), localId: b.localId, name: b.name, image: b.image });
  for (const b of es) {
    const cur = byId.get(b.id) || { id: b.id, setId: setIdFromCardId(b.id), localId: b.localId, image: b.image };
    cur.nameEs = b.name; cur.image = cur.image || b.image;
    byId.set(b.id, cur);
  }
  const list = [...byId.values()];
  list.forEach(c => { c.score = Math.max(similarity(name, c.name || ''), similarity(name, c.nameEs || '')); });
  return list.sort((a, b) => b.score - a.score).slice(0, 40);
}
