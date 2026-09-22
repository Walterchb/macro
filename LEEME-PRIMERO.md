# Treasury Macro Hub

Dashboard económico de Perú, Latinoamérica y el mundo, con la base visual de [data-sbs](https://walterchb.github.io/data-sbs/).

El proyecto está preparado para alojar **código, datos, fuentes tipográficas, iconos, gráficos y automatización en tu repositorio de GitHub**. GitHub Pages sirve la web y GitHub Actions consulta las fuentes, conserva los datos y publica las actualizaciones. La vista de Sites es una vista previa independiente: la web de GitHub no depende de ella.

**El ZIP no crea ni activa un repositorio en tu cuenta.** Completa los pasos siguientes para que la sincronización funcione en tu GitHub.

## Qué incluye

- **Perú:** PBI real, inflación de Lima, IPC sin alimentos y energía, tasa BCRP, USD/PEN, comercio, fiscal, deuda, reservas y materias primas.
- **Latinoamérica:** comparación por año, trayectorias y mapa de crecimiento; selección de países; agregados mundiales oficiales en la vista global.
- **Mundo y mercados:** Fed, rendimientos y curva UST 2/10/30 años, IPC, empleo, dólar amplio, WTI, VIX y breakeven.
- **Explorador:** catálogo de 214 series, comparación de hasta cuatro, base 100, cambio interanual o absoluto, dispersión y correlación, zoom, modal, tablas, CSV y PNG.
- **Fuentes:** observación, descarga, periodicidad, cobertura, estado y enlaces originales por serie.
- Diseño adaptable, modo claro/oscuro, controles de lectura, actualización al volver a la pestaña y cada cinco minutos.

La primera carga contiene 205 series con datos y 50.268 observaciones; nueve combinaciones del Banco Mundial no tienen cobertura. No se usan datos simulados. Las cifras pueden cambiar al ejecutar la sincronización.

## Publicarlo con GitHub Desktop — paso a paso

### 1. Crear el repositorio

1. Descomprime el ZIP.
2. En **GitHub Desktop → File → New repository**, crea `data-macro` con rama `main`.
3. Abre su carpeta con **Repository → Show in Explorer**.
4. Copia **el contenido** de la carpeta descomprimida a esa carpeta. Deben quedar `dist`, `scripts`, `config`, `tests`, `.github`, `package.json` y este documento en el primer nivel. Copia también la carpeta `.github`, aunque Windows la muestre de forma diferente.
5. No reemplaces ni uses el repositorio `data-sbs`; este es un proyecto independiente.
6. En GitHub Desktop escribe “Crear Treasury Macro Hub”, pulsa **Commit to main** y **Publish repository**.
7. Para GitHub Pages gratuito, publica este repositorio como **público**. Todos los datos incluidos son públicos, pero revisa tu decisión antes de añadir archivos privados en el futuro.

### 2. Activar Pages y permisos

1. En la web del nuevo repositorio abre **Settings → Pages**.
2. En **Build and deployment → Source**, selecciona **GitHub Actions**. No selecciones una carpeta de rama: este flujo publica `dist` mediante Actions.
3. Abre **Settings → Actions → General → Workflow permissions**.
4. Selecciona **Read and write permissions** y guarda. Esto permite que el bot conserve datos nuevos en tu repositorio.
5. Si GitHub pregunta si permites los workflows del repositorio, habilítalos.

### 3. Ejecutar la primera sincronización

1. Abre **Actions → Sincronizar Treasury Macro Hub → Run workflow**.
2. Selecciona `main` y pulsa **Run workflow**.
3. Espera a que terminen en verde **sync** y **deploy**.
4. Abre la URL que aparece en `deploy` o **Settings → Pages**. Habitualmente será `https://TU-USUARIO.github.io/data-macro/`.
5. Revisa **Fuentes** dentro de la web: ahí verás la fecha de descarga y el último periodo de cada indicador.

**No necesitas Supabase, servidor, base de datos, API key ni mantener encendida tu PC.** No hay credenciales dentro del navegador. Esta aplicación publica estadísticas públicas y guarda tus preferencias visuales en el navegador.

### 4. Actualización automática

- Programación: diariamente a las **12:35 UTC / 7:35 a. m. de Lima**.
- También se ejecuta manualmente o al enviar cambios a `main`.
- El flujo vuelve a consultar la historia completa (BCRP/FRED desde 2010, Banco Mundial desde 2000), valida y recoge revisiones.
- Si falla una serie, conserva sus observaciones anteriores y marca “Último válido”; no cambia su fecha de descarga a una fecha falsa.
- Si todas las solicitudes fallan, no cambia ni vuelve a publicar la web.
- La web revisa el archivo publicado cada cinco minutos mientras está visible y al volver a ella. El botón ↻ **recarga la publicación**; no ejecuta el proceso de GitHub.
- Los jobs cron pueden retrasarse. En repositorios públicos GitHub puede suspender cron después de 60 días sin actividad; revisa Actions y reactívalo cuando corresponda. Estas condiciones las controla GitHub, no la web.
- El dato económico se publica con rezago y se revisa. Una descarga de hoy no convierte un dato anual de 2024 en un dato actual.

### 5. Trabajar después con GitHub Desktop

Antes de editar, pulsa **Fetch origin → Pull origin** para traer los commits automáticos de datos. Después edita, realiza Commit y Push. Si subes código mientras se sincronizan las fuentes, el flujo detecta que `main` cambió y se detiene; reejecútalo sobre la versión nueva.

## Verlo en tu computadora

No abras `index.html` con doble clic: el navegador restringe la lectura JSON por `file://`.

**Con Python instalado:** abre una terminal en la carpeta del proyecto y ejecuta:

```bash
python -m http.server 8080 --directory dist
```

Luego abre `http://localhost:8080`.

**Con Node instalado:** `npm ci` y `npm run dev`; usa la URL que indique Vite. Vite es solo para desarrollo, no hace falta en producción ni para la sincronización.

## Agregar o corregir series

El catálogo es `config/series.json`. Cada entrada necesita id único, código oficial, provider (`BCRP`, `FRED` o `World Bank`), name, country ISO3, countryName, frequency, unit, category, description y sourceUrl. Copia una entrada compatible y verifica el código en la fuente. La próxima sincronización incorporará la serie al Explorador y Fuentes.

La UI no genera automáticamente un nuevo gráfico temático: sus composiciones están en `dist/assets/app.js`. Mantén el significado y la escala al crear comparaciones. Para incorporar nuevas fuentes, añade un adaptador específico en `scripts/sync_data.py` y sus controles.

## Datos y metodología

- BCRP: API oficial pública. Inflación de Lima Metropolitana. PN01277PM es IPC **sin alimentos y energía**, no una sustitución genérica por otra definición de inflación subyacente.
- MEF: deuda y estadísticas fiscales **distribuidas por BCRPData**. No se incluye un conector directo a Consulta Amigable ni ejecución presupuestal detallada; el portal directo probado no respondió con una API utilizable.
- Banco Mundial: WDI API; inflación anual de promedios, desempleo modelado OIT, PIB y sector externo. Los agregados Mundo y Latinoamérica provienen de la fuente; no se promedian países manualmente.
- FRED: exportación CSV pública. Conserva códigos y enlace a la ficha de cada serie; no requiere API key. Las condiciones de redistribución de cada serie pertenecen a su fuente original. No se copian datos ni código de JFPartners.
- Fechas ISO: inicio del periodo. Los trimestres se muestran como T1–T4; nunca se interpretan como fecha de publicación.
- Cambio de tasas/ratios: puntos porcentuales. En bases negativas se utiliza diferencia absoluta.
- Variación interanual: se busca el periodo calendario exacto de un año atrás, no la observación doce posiciones atrás.
- Base100: solo niveles positivos, misma frecuencia y fecha común. No admite tasas o saldos negativos.
- Faltantes: no se interpolan ni se reemplazan por cero. Se marcan huecos en series mensuales, trimestrales y anuales. En series diarias se unen las observaciones publicadas, incluidos saltos por días no hábiles.
- Curva UST: una misma fecha para todos los vencimientos; se compara con una fecha común de al menos 30 días antes. El eje muestra los tres vencimientos disponibles como categorías, no una escala continua de duración.
- Correlación: Pearson, fechas coincidentes, mínimo 12 pares y varianza positiva; no causalidad. Dos ejes tienen escalas independientes y se anuncian expresamente.
- No hay pronósticos generados ni alarmas de compra/venta. El historial refleja las revisiones más recientes, no una base para backtesting de información conocida en el pasado.

## Diseño compartido con SBS

La cabecera, navegación, tarjetas, paneles, tablas y pie usan una base extraída del CSS publicado de SBS, conservando sus medidas y reglas adaptables. Los estilos específicos de macro están separados para preparar una futura integración con SBS y TC Treasury Hub. Esa integración todavía no está realizada.

Consulta [UI-COMPATIBILIDAD.md](UI-COMPATIBILIDAD.md) antes de modificar componentes compartidos. El tema claro/oscuro utiliza la misma clave de preferencia que SBS y TC; compartirla entre webs requiere que estén en el mismo origen.

## Archivos principales

| Archivo | Uso |
|---|---|
| `dist/index.html` | Web publicada |
| `dist/assets/app.js` | Vistas, controles y gráficos macroeconómicos |
| `dist/assets/treasury-core.css` | Base visual compartida extraída del CSS de SBS |
| `dist/assets/macro.css` | Estilos exclusivos de esta herramienta |
| `dist/assets/treasury-shell.js` y `mobile-topbar.js` | Altura de cabecera, tema y comportamiento móvil |
| `dist/assets/fonts.css`, `fonts/`, `webfonts/` y `vendor/` | Manrope, iconos y ECharts locales, con sus licencias |
| `UI-COMPATIBILIDAD.md` | Medidas comunes y criterios para la futura unificación |
| `dist/assets/math.js` | Cálculos |
| `dist/data/snapshot.json` | Publicación atómica que consume toda la web |
| `dist/data/health.json` | Control de cobertura y errores |
| `dist/data/revisions.json` | Cambios en observaciones anteriores de la última ejecución |
| `config/series.json` | Catálogo editable |
| `scripts/sync_data.py` | Descarga, normalización y preservación de datos |
| `.github/workflows/sync-macro.yml` | Programación, commit y publicación Pages |

## Verificaciones incluidas

```bash
python scripts/validate_data.py
python -m unittest discover -s tests -p "test_*.py"
npm test
```

Los controles verifican fechas, duplicados, valores finitos, esquema, variaciones, puntos porcentuales, datos faltantes, base100 y correlación. Además concilian exportaciones − importaciones = balanza y la inflación con el índice de precios a doce meses.

## Si algo falla

- **404:** confirma Source = GitHub Actions y que `deploy` terminó en verde.
- **Permission denied al push:** revisa Read and write permissions, protección de `main` y reglas de tu organización. No fuerces pushes. Si tu organización prohíbe escritura del bot, un administrador debe habilitar el flujo o adaptar su publicación.
- **Fallo de proveedor:** el estado aparecerá en Fuentes y el detalle en Actions / `health.json`. Reejecuta después; no borres el último snapshot válido.
- **Versión vieja:** revisa la fecha de descarga, activa el workflow y recarga. Si aún no has activado Actions, el ZIP y la vista de demostración contienen la carga inicial, no un servicio de actualización ya conectado a tu cuenta.

## Documentación oficial

- [BCRPData API](https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/api)
- [Banco Mundial API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [FRED series](https://fred.stlouisfed.org/)
- [GitHub Pages con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Programación de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
