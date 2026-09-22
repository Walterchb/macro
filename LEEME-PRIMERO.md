# Treasury Macro Hub

Dashboard económico de Perú, Latinoamérica y el mundo, con la base visual de [data-sbs](https://walterchb.github.io/data-sbs/).

El proyecto está preparado para alojar **código, datos, fuentes tipográficas, iconos, gráficos y automatización en tu repositorio de GitHub**. GitHub Pages sirve la web y GitHub Actions consulta las fuentes, conserva los datos y publica las actualizaciones. La vista de Sites es una vista previa independiente: la web de GitHub no depende de ella.

**El ZIP no crea ni activa un repositorio en tu cuenta.** Completa los pasos siguientes para que la sincronización funcione en tu GitHub.

## Qué incluye

La entrega contiene **205 indicadores distintos**, **694 series configuradas**, **685 con datos**, **147 series de Perú** y **143.657 observaciones**. Los 78 gráficos temáticos se complementan con los panoramas, Latinoamérica y el Explorador. Estos conteos corresponden al catálogo nacional/internacional; el paquete regional se informa por separado. Los conteos corresponden a esta entrega y se actualizan en Fuentes.

La versión 6 sigue el orden **navegación → indicadores → Pulso → próximas citas → gráficos y tablas**. El Pulso muestra únicamente su lectura resumida; al pulsar una tarjeta se abre el detalle con evidencias, reglas y fuentes. Agenda es una pestaña principal y Proyecciones sustituye la antigua agenda dentro de Perú. Mantiene la cabecera y las medidas compartidas con SBS.

- **Pulso económico:** cinco lecturas para Perú y cinco para EE. UU. Cada tarjeta contrasta nivel, impulso y confirmación con cinco indicadores de respaldo. El medidor representa condiciones explícitas: señales divergentes se muestran como mixtas; datos insuficientes, como lectura parcial. Fuentes, evidencias y fórmulas se consultan en el modal de cada tarjeta. No son calificaciones oficiales ni probabilidades de recesión.
- **Perú:** actividad y sectores, precios e ingresos, trabajo y crédito, finanzas públicas, sector externo, desarrollo, tasas y moneda. La cobertura incorpora también producción minera, remesas, viajes, recaudación y demanda interna.
- **Mundo y mercados:** ciclo, inflación, empleo, riesgo, tasas, liquidez y materias primas. Las señales estadounidenses se identifican como tales; los agregados mundiales provienen del Banco Mundial.
- **Regiones del Perú:** mapa de 25 territorios, 17 indicadores, 424 series y 39.476 observaciones. La vista anual incorpora producción regional (VAB real y nominal, base real 2007), valores por habitante, población y estructura sectorial del INEI. La vista mensual conserva crédito, depósitos, tributos internos, inversión nacional/local, afiliados al SPP y electricidad. Lima no duplica Callao; VAB y población por habitante se emparejan por territorio y año. Los datos estimados y provisionales se identifican. VAB excluye los impuestos nacionales no asignados territorialmente; no se presenta como PBI a precios de mercado.
- **Población y poder adquisitivo:** ocho gráficos con población, PBI per cápita real y PPA, estructura de edad, dependencia demográfica y precios del consumo (EE. UU. = 100). Incluye el índice Big Mac de The Economist, simple y ajustado por ingreso, con datos de Perú y atribución CC BY 4.0. Son 143 series WDI y 428 registros Big Mac de las economías incluidas. PBI por habitante no es ingreso personal; los índices de precios no son un pronóstico cambiario.
- **Proyecciones del Perú:** 30 series oficiales del MEF, MMM 2027–2030 publicado el 28/08/2026, con proyecciones 2026–2030. Se distinguen histórico, proyección y supuestos del escenario. Incluye crecimiento, demanda, sectores, finanzas públicas, deuda y comercio. El PBI real conserva historia WDI hasta 2024; desde 2025 usa la edición MEF, con procedencia por observación. El índice 2025 = 100 es un cálculo compuesto, explicado y separado del nivel oficial del PBI.
- **Agenda:** pestaña principal con calendario mensual para todas las economías, flechas, Hoy, filtros por país/tema/fuente y detalle de cada fecha. Banderas SVG locales, sin emoji. Conserva un horizonte móvil de 120 días y exporta el mes filtrado a ICS. Los días anteriores al archivo o fuera de cobertura se identifican; no se interpretan como ausencia de acontecimientos. Los feriados conservan su ámbito nacional, bancario o TARGET.
- **Latinoamérica:** comparación del mismo indicador y año, trayectoria, mapa de crecimiento, lectura entre pares e indicadores de desarrollo. Los datos faltantes no se sustituyen por los de otro año.
- **Explorador:** búsqueda por economía, tema y fuente; hasta cuatro series; transformaciones; intervalo de fechas; comparaciones guardadas; dispersión y correlaciones calculadas sobre fechas coincidentes.
- **Gráficos:** ventanas 1A/3A/5A/Todo dentro del horizonte elegido, variaciones MOM/QOQ/YOY y fechas comparadas en el tooltip, medias móviles donde corresponde, etiquetas finales, leyendas con fechas, contexto histórico desplegable, referencias explícitas, mapas y dispersión, ocho vencimientos Treasury, bandas de recesión estadounidense. PNG con fuentes y CSV con unidades y definiciones.
- **Fuentes:** periodos económicos, fechas de descarga, cobertura, salud del conector y ficha original de cada serie. Diseño adaptable y tema claro/oscuro.

La cobertura y el número de observaciones se muestran en **Fuentes** y `data/manifest.json`. El catálogo puede incluir series sin cobertura en algunos países. No se usan datos simulados, y las ausencias se muestran expresamente. Ninguna fuente cubre por sí sola toda la economía; la herramienta distingue lo disponible de lo pendiente.

## Corregir tu repositorio actual Walterchb/macro

La web ahora está en la **raíz del repositorio**, igual que una web estática convencional. `index.html`, `assets/` y `data/` quedan juntos. Por eso abre en **https://walterchb.github.io/macro/** tanto con Pages desde rama como con Pages mediante Actions. Ya no debes entrar a `/macro/dist/`.

1. En GitHub Desktop selecciona **Walterchb/macro** y pulsa **Fetch origin → Pull origin**.
2. Abre **Repository → Show in Explorer**.
3. Descomprime esta entrega y copia **el contenido** a esa carpeta, aceptando reemplazar archivos. No copies la carpeta contenedora dentro de `macro`; `index.html` debe quedar en el primer nivel junto a `.github`, `assets`, `data`, `scripts`, `config` y `tests`.
4. Conserva la carpeta `.git` de tu repositorio. Incluye `.github` y `.nojekyll` de esta entrega. No necesitas borrar tu repositorio ni crear otro. Una carpeta `dist` antigua ya no interviene al abrir la raíz; puedes retirarla.
5. Haz **Commit to main** y **Push origin**.
6. En [Settings → Pages](https://github.com/Walterchb/macro/settings/pages), cualquiera de estas dos configuraciones funciona:
   - **Deploy from a branch → main → /(root)**: publica los archivos de la raíz.
   - **GitHub Actions**: el flujo genera y publica un paquete aislado de la misma web.
7. Revisa [Actions](https://github.com/Walterchb/macro/actions). El flujo **Sincronizar Treasury Macro Hub** identifica la configuración y usa el método correspondiente; no cambia tus Settings. Abre [la web](https://walterchb.github.io/macro/) cuando termine la publicación.

El ZIP no sube cambios a tu cuenta por sí solo. Estas instrucciones actualizan el repositorio que ya tienes.

## Publicación y actualización automática

**Subir código y abrir la web no dependen de que BCRP, FRED o Banco Mundial respondan en ese momento.** Un push a `main` valida y publica los datos incluidos. La ejecución manual hace lo mismo por defecto.

- Descarga automática: todos los días a las **12:35 UTC / 7:35 a. m. de Lima**.
- Descarga manual: **Actions → Sincronizar Treasury Macro Hub → Run workflow**, marca **Descargar datos nuevos antes de publicar**, selecciona `main` y ejecuta.
- Publicación manual sin descarga: deja esa casilla desmarcada. Es la opción más rápida para aplicar un cambio de diseño o corregir la publicación.
- Los nuevos datos se validan antes de guardarse en `data/` y publicarse. Si falla una parte de la descarga, conserva el último dato válido de cada serie afectada y muestra su estado real. Los indicadores, regiones, proyecciones, demografía y agenda se consultan de forma independiente: si una descarga completa falla, se puede publicar la otra conservando el archivo válido anterior y su fecha. Si todas fallan, esa ejecución se detiene sin publicar.
- El flujo soporta Pages desde rama: después del commit del bot solicita explícitamente un build de Pages y espera a que GitHub confirme la versión. Un commit realizado con `GITHUB_TOKEN` no dispara por sí solo ese build.
- En modo Actions, publica únicamente `index.html`, `assets/`, `data/` y `.nojekyll`, copiados a `dist` por el build. `dist` es una salida generada; no es la carpeta que debes editar.
- Permisos: **Settings → Actions → General → Workflow permissions → Read and write permissions**. Si GitHub pide habilitar workflows, acéptalo para activar la programación. Las reglas de protección de `main` también deben permitir los commits de datos del bot.
- Si `main` cambia mientras corre la actualización, el flujo se detiene para no publicar encima de un cambio más reciente. Reejecútalo sobre `main`.
- Las publicaciones se consultan independientemente cada cinco minutos mientras está visible y al volver a la pestaña. El botón **Actualizar** recarga la publicación; no ejecuta GitHub Actions.
- GitHub puede retrasar cron o suspenderlo en repositorios públicos tras 60 días sin actividad. Revisa Actions si la fecha de descarga deja de avanzar.

### Agenda económica

`scripts/sync_agenda.py` consulta calendarios publicados por los organismos y conserva una ventana móvil de 120 días. No inventa recurrencias ni fechas probables. Las fuentes que no responden quedan como no disponibles o conservadas; la vista muestra si existe cobertura confirmada de al menos un mes. Las fechas pueden cambiar en origen.

- El calendario del INEI se obtiene de su agenda oficial y de su feed público enlazado.
- La agenda internacional incluye BEA, Reserva Federal, BCE y BLS. Los feriados proceden de Gob.pe, New York Fed y BCE; un feriado bancario no se presenta como cierre de todas las bolsas. Cada evento permite abrir la fuente original.
- Se incorporaron lectores del programa monetario y del reporte de inflación del BCRP. En esta entrega su web bloqueó el acceso automatizado, de modo que figuran pendientes de verificación y se reintentan diariamente. No se publican fechas estimadas ni se inventan recurrencias. BLS conserva las fechas oficiales verificadas cuando su fuente no responde.
- Las publicaciones sin hora se muestran como tales. Las horas confirmadas se convierten a **America/Lima**, respetando el horario de verano del lugar de origen.
- El archivo ICS permite importar las fechas del mes y filtros elegidos (sin incluir los días adyacentes de otro mes visibles en la cuadrícula). Una importación de archivo no crea una suscripción que se actualice sola en el calendario personal; la agenda web sí se actualiza con GitHub Actions.
- El botón Actualizar consulta la agenda e invalida las copias locales de regiones, proyecciones y demografía aunque no cambie la versión del catálogo principal.

**No necesitas Supabase, servidor, API key ni mantener encendida tu PC.** Todo el código, los datos y los recursos visuales se sirven desde tu proyecto. Una descarga reciente no significa que una estadística anual también sea reciente: cada gráfico conserva su periodo de observación.

Antes de editar más adelante, usa **Fetch origin → Pull origin** para traer los commits automáticos de datos.

## Verlo en tu computadora

No abras `index.html` con doble clic: el navegador restringe la lectura JSON por `file://`.

**Con Python instalado:** abre una terminal en la carpeta del proyecto y ejecuta:

```bash
python -m http.server 8080
```

Luego abre `http://localhost:8080`.

**Con Node instalado:** `npm ci` y `npm run dev`; usa la URL que indique Vite. Vite es solo para desarrollo, no hace falta en producción ni para la sincronización.

## Agregar o corregir series

El catálogo es `config/series.json`. Cada entrada necesita id único, código oficial, provider (`BCRP`, `FRED` o `World Bank`), name, country ISO3, countryName, frequency, unit, category, description y sourceUrl. Copia una entrada compatible y verifica el código en la fuente. La próxima sincronización incorporará la serie al Explorador y Fuentes.

La UI no genera automáticamente un nuevo gráfico temático: sus composiciones están en `assets/app.js` y `assets/economic-views.js`. Mantén el significado y la escala al crear comparaciones. Para incorporar nuevas fuentes, añade un adaptador específico en `scripts/sync_data.py` y sus controles.

## Datos y metodología

- BCRP: API oficial pública. Inflación de Lima Metropolitana. PN01277PM es IPC **sin alimentos y energía**, no una sustitución genérica por otra definición de inflación subyacente.
- MEF: las proyecciones se obtienen directamente de los cuadros oficiales MMM/IAPM publicados en Gob.pe. Deuda histórica y estadísticas fiscales del catálogo se distribuyen por **BCRPData**. No se incluye un conector directo a Consulta Amigable ni ejecución presupuestal detallada; el portal directo probado no respondió con una API utilizable.
- Banco Mundial: WDI API; inflación anual de promedios, desempleo modelado OIT, PIB y sector externo. Los agregados Mundo y Latinoamérica provienen de la fuente; no se promedian países manualmente.
- FRED: exportación CSV pública. Conserva códigos y enlace a la ficha de cada serie; no requiere API key. Las condiciones de redistribución de cada serie pertenecen a su fuente original. No se copian datos ni código de JFPartners.
- Fechas ISO: inicio del periodo. Los trimestres se muestran como T1–T4; nunca se interpretan como fecha de publicación.
- Regional anual: Nivel y YOY; MOM/YTD solo se habilitan para las series mensuales. La población del INEI contiene estimaciones/proyecciones y se identifica como tal.
- Proyecciones: se conserva la fecha y edición del informe; una consulta diaria no convierte la proyección en un dato observado. La continuación del PBI une únicamente tasas anuales compatibles. No se añaden intervalos de confianza sin una fuente que los publique.
- Cambio de tasas/ratios: puntos porcentuales. En bases negativas se utiliza diferencia absoluta.
- Variación interanual: se busca el periodo calendario exacto de un año atrás, no la observación doce posiciones atrás.
- Base100: solo niveles positivos, misma frecuencia y fecha común. No admite tasas o saldos negativos.
- Faltantes: no se interpolan ni se reemplazan por cero. Se marcan huecos en series mensuales, trimestrales y anuales. En series diarias se unen las observaciones publicadas, incluidos saltos por días no hábiles.
- Curva UST: una misma fecha para todos los vencimientos; se compara con una fecha común de al menos 30 días antes. El eje muestra el plazo real de los ocho vencimientos disponibles, desde tres meses hasta treinta años; no representa la duración financiera de cada instrumento.
- Correlación: Pearson, fechas coincidentes, mínimo 12 pares y varianza positiva; no causalidad. Dos ejes tienen escalas independientes y se anuncian expresamente.
- No hay pronósticos generados ni alarmas de compra/venta. El historial refleja las revisiones más recientes, no una base para backtesting de información conocida en el pasado.

## Diseño compartido con SBS

La cabecera, navegación, tarjetas, paneles, tablas y pie usan una base extraída del CSS publicado de SBS, conservando sus medidas y reglas adaptables. Los estilos específicos de macro están separados para preparar una futura integración con SBS y TC Treasury Hub. Esa integración todavía no está realizada.

Consulta [UI-COMPATIBILIDAD.md](UI-COMPATIBILIDAD.md) antes de modificar componentes compartidos. El tema claro/oscuro utiliza la misma clave de preferencia que SBS y TC; compartirla entre webs requiere que estén en el mismo origen.

## Archivos principales

| Archivo | Uso |
|---|---|
| `index.html` | Entrada de la web en la raíz, compatible con main/(root) |
| `assets/app.js` | Vistas, controles y explorador |
| `assets/chart-engine.js` | Gráficos analíticos, percentiles y estadísticas |
| `assets/economic-views.js` | Paneles temáticos y sus definiciones |
| `assets/economic-monitor.js` | Señales, reglas y evidencia del Pulso económico |
| `assets/comparison-lab.js` | Comparaciones regionales y herramientas del Explorador |
| `assets/agenda.js` y `data/agenda.json` | Eventos, cobertura y estado de calendarios |
| `assets/treasury-core.css` | Base visual compartida extraída del CSS de SBS |
| `assets/macro.css` | Estilos exclusivos de esta herramienta |
| `assets/treasury-shell.js` y `mobile-topbar.js` | Altura de cabecera, tema y comportamiento móvil |
| `assets/fonts.css`, `fonts/`, `webfonts/` y `vendor/` | Manrope, iconos y ECharts locales, con sus licencias |
| `UI-COMPATIBILIDAD.md` | Medidas comunes y criterios para la futura unificación |
| `assets/math.js` | Cálculos |
| `data/snapshot.json` | Publicación atómica que consume toda la web |
| `data/health.json` | Control de cobertura y errores |
| `data/revisions.json` | Cambios en observaciones anteriores de la última ejecución |
| `config/series.json` | Catálogo editable |
| `scripts/refresh_publication.py` | Actualiza los cinco paquetes de fuentes de forma independiente |
| `scripts/sync_agenda.py` | Descarga y valida fechas de calendarios oficiales |
| `scripts/sync_regional.py` | Consulta BCRP e INEI; valida territorio, frecuencia, base de precios y estimaciones |
| `data/regional.json` | Paquete de 25 regiones, 17 indicadores anuales y mensuales |
| `scripts/sync_forecasts.py` | Descubre ediciones oficiales MMM/IAPM y valida sus cuadros |
| `data/forecasts.json` | Proyecciones con estado, edición y fuente por observación |
| `scripts/sync_demography.py` | WDI y Big Mac: consulta, validación y retención |
| `data/demography.json` | Población, ingreso por habitante, precios y Big Mac |
| `scripts/sync_data.py` | Descarga, normalización y preservación de datos en `data/` |
| `scripts/build_site.py` | Valida y copia solo archivos de producción a `dist/` |
| `.github/workflows/sync-macro.yml` | Programación, commit y publicación Pages |

## Verificaciones incluidas

```bash
python scripts/validate_data.py
python scripts/sync_agenda.py --validate
python scripts/sync_regional.py --validate
python scripts/sync_forecasts.py --validate
python scripts/sync_demography.py --validate
python -m unittest discover -s tests -p "test_*.py"
npm test
python scripts/build_site.py
```

Las series semanales muestran nivel o base 100; no se presenta una variación anual por fechas que no coinciden. La pobreza por línea nacional se excluye del ranking internacional porque los umbrales nacionales son distintos.

Los controles verifican fechas, duplicados, valores finitos, esquema, variaciones, puntos porcentuales, datos faltantes, base100 y correlación. Además concilian exportaciones − importaciones = balanza y la inflación con el índice de precios a doce meses.

## Si algo falla

- **404:** comprueba que `index.html` quedó directamente en el primer nivel de `Walterchb/macro`, no dentro de otra carpeta. En Pages usa `main` y `/(root)`, o `GitHub Actions`; no `/docs`. El despliegue nuevo debe haber terminado.
- **Workflow no aparece:** falta copiar `.github/workflows/sync-macro.yml` a la raíz del repositorio.
- **Actions muestra verde pero la raíz sigue vacía:** confirma que copiaste esta entrega completa; las versiones anteriores tenían la entrada únicamente dentro de `dist`. Esta versión elimina esa dependencia.
- **Permission denied al push:** revisa Read and write permissions, protección de `main` y reglas de tu organización. No fuerces pushes. Si tu organización prohíbe escritura del bot, un administrador debe habilitar el flujo o adaptar su publicación.
- **Fallo de proveedor:** el estado aparecerá en Fuentes y el detalle en Actions / `health.json`. Reejecuta después; no borres el último snapshot válido.
- **Versión vieja:** revisa la fecha de descarga, activa el workflow y recarga. Si aún no has activado Actions, el ZIP y la vista de demostración contienen la carga inicial, no un servicio de actualización ya conectado a tu cuenta.

## Documentación oficial

- [BCRPData API](https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/api)
- [Banco Mundial API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [FRED series](https://fred.stlouisfed.org/)
- [INEI: PBI por departamentos](https://www.inei.gob.pe/estadisticas/indice-tematico/producto-bruto-interno-por-departamentos-9089/)
- [MEF: MMM 2027–2030](https://www.gob.pe/institucion/mef/informes-publicaciones/8533022-marco-macroeconomico-multianual-2027-2030)
- [The Economist: Big Mac, datos y licencia](https://github.com/TheEconomist/big-mac-data)
- [GitHub Pages: publicación desde rama o Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Solicitud de build Pages desde el flujo](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)
- [GitHub Pages con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Programación de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
