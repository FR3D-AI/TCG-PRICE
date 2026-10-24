# Tasador TCG

App web para el celular: le sacas una foto a una carta Pokémon y te muestra sus precios en todas sus versiones, cómo ha cambiado su valor por año, si va subiendo o bajando, y un valor estimado para la versión en español en pesos chilenos.

Todo funciona con servicios gratuitos. No necesita servidor propio ni claves.

## Qué hace

| Función | Cómo | Fuente |
|---|---|---|
| Escanear con foto | OCR en el mismo celular (la foto no se sube a ningún lado). Lee el nombre y el número de abajo (ej. `199/165`) | Tesseract.js |
| Identificar la carta | Cruza el número con el total del set y el nombre leído | TCGdex |
| Precios actuales por variante | Normal, holo, reverse, 1ª edición… en USD y CLP | TCGplayer y Cardmarket vía TCGdex |
| Todas sus versiones | Todas las impresiones con el mismo nombre, ordenadas por precio y agrupadas por rareza | TCGdex |
| Historial por año | Gráfico + tabla por año (promedio, mín, máx, % de cambio) y comparación con hoy | Archivo público de TCGdex (nov 2022 – sep 2024) + tu historial diario |
| Tendencia actual | Promedio de 1 día vs 30 días en Cardmarket | Cardmarket |
| Valor en español | Estimado en CLP: MercadoLibre Chile (peso 3) → Cardmarket en español (peso 2) → foros (peso 1) | Lo que anotas desde cada búsqueda |
| Versiones japonesas (opcional) | Precios de impresiones japonesas | PokemonPriceTracker (plan gratis) vía tu API |

### Limitaciones honestas
- **MercadoLibre cerró su API de búsqueda pública.** La app te abre la búsqueda ya armada y tú anotas 2–5 precios que veas; con eso calcula la mediana. Lo mismo para Cardmarket en español y foros.
- El archivo histórico gratuito termina en **septiembre 2024** y solo cubre sets en inglés. Desde el día en que sigues una carta, GitHub Actions guarda su precio diario y el gráfico se completa solo.
- El OCR funciona mejor con la carta de frente, buena luz y sin reflejos. Si falla, puedes escribir el nombre o el número (`Charizard 199/165`).
- Los precios de Cardmarket en TCGdex mezclan todos los idiomas.

## Publicarla en GitHub (gratis)

1. Crea un repositorio nuevo en GitHub, por ejemplo `tasador-tcg`.
2. Sube todos los archivos de esta carpeta (botón **Add file → Upload files**, arrastra la carpeta completa, incluida `.github`).
3. Ve a **Settings → Pages**, en *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guarda.
4. Ve a **Settings → Actions → General → Workflow permissions** y marca **Read and write permissions** (para que pueda guardar el historial).
5. En un par de minutos tu app queda en `https://TU-USUARIO.github.io/tasador-tcg/`.
6. Ábrela en el celular y usa **Compartir → Agregar a pantalla de inicio**: queda como una app.
7. En la app, entra a **Ajustes** y escribe tu repositorio (`TU-USUARIO/tasador-tcg`).

### Historial diario
- Abre una carta y toca **Seguir esta carta**.
- En **Seguimiento**, copia la lista y pégala en `data/watchlist.json` (hay un botón que abre el archivo en GitHub).
- Al guardar, GitHub Actions toma el precio de inmediato y luego todos los días ~08:23 (hora de Chile). Puedes forzarlo en **Actions → Historial diario de precios → Run workflow**.

## Tu API rápida (opcional, gratis)

La carpeta `worker/` es una API en Cloudflare Workers (100.000 consultas/día gratis) que:
- guarda en caché las consultas de precios cerca de ti (cargas casi instantáneas),
- agrega precios de cartas **japonesas** si le das una clave gratis de PokemonPriceTracker (100 consultas/día).

Para instalarla necesitas un computador con Node.js:

```bash
cd worker
npx wrangler login
npx wrangler deploy                 # te da una URL tipo https://tasador-api.TU-USUARIO.workers.dev
npx wrangler secret put PPT_KEY     # opcional: pega tu clave de pokemonpricetracker.com
```

Luego pega esa URL en **Ajustes → URL de tu API** en la app.

Rutas de la API:
- `GET /` → estado (`{"jp": true}` si hay clave japonesa)
- `GET /tcgdex/v2/{es|en|ja}/cards/{id}` → carta con precios (caché 6 h)
- `GET /tcgdex/v2/{lang}/cards?name=...` → búsqueda
- `GET /history/en/{set}/{número}.tcgplayer.json` → archivo histórico (caché 7 días)
- `GET /jp?search=charizard` → versiones japonesas (caché 12 h)

## Estructura

```
index.html, styles.css, sw.js, manifest.webmanifest   app (sin compilación)
js/app.js        pantallas
js/scan.js       foto → texto (OCR)
js/identify.js   texto → carta
js/logic.js      cálculos puros (precios, historial, estimado en español)
js/api.js        fuentes de datos con caché
data/            lista a seguir + historial diario
scripts/         script que corre GitHub Actions
worker/          API opcional en Cloudflare
tests/           pruebas: npm test
```

## Ideas para la siguiente versión
- Escaneo con IA (más preciso que el OCR) usando un servicio de reconocimiento de imágenes.
- Colección con valor total y alertas cuando una carta sube X%.
- Precios de MercadoLibre automáticos si en algún momento abren de nuevo su API.

Proyecto personal no oficial. Pokémon y sus marcas pertenecen a sus dueños. Los precios son referenciales.
