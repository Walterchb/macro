# Compatibilidad visual con Treasury Hub

La referencia es [Información SBS](https://walterchb.github.io/data-sbs/), del repositorio [Walterchb/data-sbs](https://github.com/Walterchb/data-sbs). La finalidad es mantener la misma estructura y escala al cambiar de herramienta.

## Base compartida

| Archivo | Responsabilidad |
|---|---|
| `assets/treasury-core.css` | Declaraciones compartidas extraídas del CSS de SBS: colores, tipografía, cabecera, navegación, controles, tarjetas, paneles, tablas, pie y reglas adaptables. Conserva el orden de sus reglas y su cascada. |
| `assets/macro.css` | Componentes y necesidades propias del análisis macroeconómico. No sustituye las medidas de la estructura compartida. |
| `assets/treasury-shell.js` | Aplica el tema, sincroniza su preferencia entre pestañas y mide la altura real de la cabecera para posicionar los controles fijos. |
| `assets/mobile-topbar.js` | Comportamiento de la cabecera móvil, copiado de SBS. |
| `assets/fonts.css`, `fonts/`, `webfonts/` y `vendor/` | Manrope, Font Awesome y ECharts servidos desde el propio proyecto. Sus licencias se incluyen en `vendor/`. |

El CSS fuente utilizado tiene SHA-256 `b176151b428b354861e07590d70fc46ec6a9b7fadfd4a0985c046ca619f0c14c`. La extracción es una copia versionada; no descarga estilos de SBS al abrir la web. Si SBS cambia su diseño, hay que revisar y trasladar esos cambios a esta base.

## Medidas comunes

Las alturas corresponden al diseño normal con la tipografía cargada, sin ampliación del navegador. En móviles, la cabecera puede desplazarse al hacer scroll, siguiendo el comportamiento de SBS.

| Elemento | Escritorio | Móvil, hasta 760 px |
|---|---|---|
| Cabecera | 63 px | 104 px |
| Ancho máximo de cabecera y contenido | 1.500 px | Ancho disponible |
| Relleno de cabecera | 11 px verticales, 18 px laterales | 10 px verticales, 12 px laterales |
| Logo | 38 × 38 px | 38 × 38 px |
| Controles de cabecera | 34 px de alto | 34 px de alto |
| Contenido principal | 14 px arriba, 18 px laterales, 24 px abajo | 12 px |
| Navegación | Botones de al menos 32 px | Misma escala, desplazamiento horizontal |
| Tarjetas de indicadores | 6 columnas; 3 hasta 1.260 px | 2 columnas |
| Separación entre tarjetas | 10 px | 8 px |
| Alto mínimo de tarjeta | 88 px | 88 px |
| Gráfico temático | 342 px | 286 px |
| Radio de tarjetas y paneles | 7 px | 7 px |
| Pie de página | Mínimo 82 px | Mínimo 74 px |

Los títulos, fechas y unidades pueden ocupar más espacio según su contenido. Mantener etiquetas breves evita que el texto introduzca diferencias de altura. Los gráficos del explorador y los diálogos pueden necesitar dimensiones distintas de las del panel temático.

## Preferencia de tema

La clave común es `sbs_tc_theme_treasuryhub`. Macro lee y escribe esa clave y escucha cambios desde otras pestañas del mismo origen.

Dos webs bajo `https://walterchb.github.io/`, aunque tengan rutas diferentes como `/data-sbs/` y `/macro/`, comparten ese almacenamiento. `https://tc.treasuryhub.app/` tiene otro origen y **no comparte localStorage** con GitHub Pages. La futura integración deberá servir las herramientas bajo el mismo origen o definir un mecanismo explícito de sincronización entre dominios.

## Preparación para unificar

Esta entrega separa la estructura común de las vistas macro y añade enlaces para cambiar de herramienta. No modifica SBS ni TC, ni afirma que las tres aplicaciones ya estén unificadas.

Para unificarlas, conviene mantener una sola versión de los estilos y del módulo de cabecera, conservar sus clases y variables, y dejar los gráficos y datos de cada aplicación en módulos propios. Los ajustes comunes deben verificarse en ambas anchuras antes de distribuirse a todas las webs.

Todo lo necesario para publicar Macro está dentro del proyecto y se sube a GitHub. Pages puede servir directamente `index.html`, `assets/` y `data/` desde `main` y `/(root)`. En modo Actions, `scripts/build_site.py` copia esos mismos archivos a un `dist` generado para publicar. El flujo reconoce ambos modos y mantiene el snapshot económico; una subida de diseño no fuerza una descarga de datos. La vista de Sites permite revisar esta entrega y no interviene en ese funcionamiento.
