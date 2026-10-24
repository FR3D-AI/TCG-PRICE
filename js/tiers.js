// Clasificación visual por rareza: cada nivel tiene su color y una animación sutil alrededor de la carta.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// De menor a mayor valor.
export const TIERS = {
  muycomun: { label: 'Muy común', icon: '·', desc: 'Cartas de relleno: energías básicas y comunes de muy bajo valor (menos de US$0,10).', anim: 'Sin brillo, solo un borde gris.' },
  comun: { label: 'Común', icon: '●', desc: 'Símbolo de círculo abajo a la derecha. Vienen varias en cada sobre.', anim: 'Resplandor gris muy suave.' },
  pococomun: { label: 'Poco común', icon: '◆', desc: 'Símbolo de rombo. Salen menos que las comunes en cada sobre.', anim: 'Resplandor verde que respira.' },
  rara: { label: 'Rara', icon: '★', desc: 'Símbolo de estrella, sin efecto holográfico. Al menos una por sobre.', anim: 'Resplandor azul.' },
  muyrara: { label: 'Muy rara', icon: '✦', desc: 'Estrella con ilustración holográfica (Rare Holo).', anim: 'Borde plateado con un destello que cruza la carta.' },
  epica: { label: 'Épica', icon: '✧', desc: 'Ilustración rara, Shiny, Radiant, Amazing, ACE SPEC, Prism ★, BREAK, LV.X, Prime o LEGEND.', anim: 'Resplandor morado con destello.' },
  ultra: { label: 'Ultra', icon: '◈', desc: 'Doble rara (ex), Ultra rara, Full Art y Pokémon EX, GX o V.', anim: 'Borde dorado que gira.' },
  vmax: { label: 'VMAX', icon: '▲', desc: 'Pokémon VMAX y VSTAR: las formas gigantes y estelares de la era Espada y Escudo.', anim: 'Borde de fuego rojo y naranja que gira y late.' },
  coleccion: { label: 'Muy buscada por coleccionistas', icon: '♛', desc: 'Ilustración especial, Hiperrara (dorada), Arcoíris, Secreta, Corona, o cualquier carta que valga más de US$100.', anim: 'Borde arcoíris holográfico con brillo y destellos.' },
};
export const TIER_ORDER = Object.keys(TIERS);

/**
 * Nivel de la carta según su rareza (inglés o español), nombre y precio.
 * @param {{rarity?:string, name?:string, usd?:number|null, category?:string}} c
 */
export function tierOf({ rarity = '', name = '', usd = null, category = '' } = {}) {
  const r = String(rarity || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  if (/special illustration|ilustraci[oó]n especial|hyper rare|hiperrara|hiper rara|rainbow|arco[ií]ris|secret|secreta|gold|dorada|crown|corona|mega hyper|shiny ultra|shiny super/.test(r) || (usd != null && usd >= 100)) return 'coleccion';
  if (/\bv(max|star)\b|v-union/.test(n) || /vmax|vstar/.test(r)) return 'vmax';
  if (/ultra|double rare|doble|full art|holo (v|ex|gx)\b|rare (ex|gx)\b/.test(r) || (/(\s|-)(ex|gx|v)$/.test(n) && !/common|com[uú]n/.test(r))) return 'ultra';
  if (/illustration|ilustraci[oó]n|shiny|radiant|radiante|amazing|asombros|ace spec|prism|prisma|break|lv\.?x|prime|legend|leyenda|star\b|estrella/.test(r)) return 'epica';
  if (/holo/.test(r)) return 'muyrara';
  if (/uncommon|poco com[uú]n/.test(r)) return 'pococomun';
  if (/rare|rara/.test(r)) return 'rara';
  if (/common|com[uú]n/.test(r)) return usd != null && usd < 0.1 ? 'muycomun' : 'comun';
  if (category === 'Energy' || /energ/.test(n) || !r || r === 'none' || r === 'ninguno') return 'muycomun';
  return 'comun';
}

/** Insignia con el nombre del nivel; al tocarla muestra sus especificaciones. */
export function tierBadge(tier) {
  const t = TIERS[tier];
  return `<button type="button" class="tier-badge tb-${tier}" data-tier-info aria-expanded="false"><span>${t.icon}</span> ${esc(t.label)}</button>
    <div class="tier-info" hidden>
      <p><b>${esc(t.label)}:</b> ${esc(t.desc)}</p>
      <p class="muted small">Animación: ${esc(t.anim)}</p>
      <details><summary>Ver todas las categorías</summary>
        <ol class="tier-legend">${TIER_ORDER.map(k => `<li class="${k === tier ? 'on' : ''}"><span class="tier-wrap small tier-${k}"><span class="swatch"></span></span><div><b>${esc(TIERS[k].label)}</b><small>${esc(TIERS[k].desc)}</small></div></li>`).join('')}</ol>
      </details>
    </div>`;
}

export function initTierBadges() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-tier-info]');
    if (!b) return;
    const info = b.nextElementSibling;
    if (!info) return;
    info.hidden = !info.hidden;
    b.setAttribute('aria-expanded', String(!info.hidden));
  });
}
