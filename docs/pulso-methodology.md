# Pulso económico: criterios de lectura y mantenimiento

## Vigencia de los datos

`assets/data-freshness.js` es la política común de **Fuentes** y **Pulso**. No confundir fecha de descarga, periodo económico y fecha de publicación. Las claves mensuales/trimestrales/anuales guardan el inicio del periodo; la antigüedad se calcula desde su **fin**.

Si no consta una publicación posterior de origen, la alerta orientativa se activa al superar 10 días (diaria), 28 (semanal), 100 (mensual), 180 (trimestral) o 730 (anual). Estos límites de revisión son heurísticos, no plazos oficiales ni garantía de que no exista un dato más reciente. Los datos conservados tras un fallo de descarga siguen identificados como `retained`, incluso si también hay rezago. Valores ausentes, fechas inválidas o periodos futuros nunca producen una señal disponible.

### Registro manual de evidencia de publicación

`VERIFIED_ORIGIN_RELEASES` contiene únicamente publicaciones comprobadas. **No es un calendario en tiempo real, exhaustivo ni actualizado automáticamente.** Su cobertura inicial, verificada el **21/10/2026**, es la producción nacional de **agosto de 2026**, publicada por INEI el **15/10/2026**, frente a la serie mensual BCRP `PN01728AM`. [Informe original INEI](https://www.inei.gob.pe/media/MenuRecursivo/boletines/10-informe-tecnico-produccion-nacional-agosto-2026.pdf).

Cada entrada conserva proveedor/serie, organismo de origen, periodo publicado, fecha de publicación, fecha de verificación y URL oficial. No contiene valores económicos: una discrepancia entre origen y distribuidor **advierte**, no reemplaza datos ni empalma metodologías/versiones.

Para mantener el registro:

1. Comprobar la publicación efectiva en la fuente oficial; no deducirla del paso del tiempo, de una fecha programada o de un titular sin documento.
2. Confirmar que definición, cobertura y periodo corresponden a la serie afectada. Registrar fechas y enlace exactos; no extender automáticamente una evidencia a otras series.
3. Incorporar la entrada sólo después de verificarla y añadir una prueba con fechas anteriores/posteriores a su publicación.
4. La advertencia por origen desaparece automáticamente cuando el dato del proveedor alcanza o supera ese periodo. La regla de edad continúa aplicándose: alcanzar una edición conocida no garantiza vigencia indefinida.
5. Una consulta futura no inventa nuevas publicaciones. Puede advertir antigüedad sin afirmar haber comprobado una edición posterior. El registro histórico puede conservarse como trazabilidad.

La clasificación de actividad pierde cobertura cuando una condición depende de un periodo superado por una publicación comprobada; la cifra retenida sigue visible con su fecha. Esto no declara contracción económica: declara una limitación de actualidad de la evidencia disponible en la web.

## Filtro operativo de cambios 3M (sólo Perú)

Se aplica únicamente a Δ3M del IPC general, IPC sin alimentos y energía y tasa preferencial corporativa PEN. No modifica metas oficiales, difusión50, amplitud sectorial ni el significado descriptivo del cero en crecimiento/saldos.

- Banda por indicador: percentil20 interpolado de |Δ3M| de60meses calendario anteriores, mínimo36 observaciones mensuales distintas; actual y futuras excluidas. Piso: media unidad de la precisión mostrada (0.005pp para2decimales).
- Es una **convención operativa** que neutraliza el quinto inferior histórico, no umbral validado de relevancia económica, intervalo de confianza ni modelo predictivo. No se optimizó contra resultados futuros.
- Sensibilidad:p10 y p30. Si cambian la clasificación de p20, se informa neutral/indeterminada, no una dirección robusta. La magnitud original siempre permanece visible.
- Persistencia reconstruye la clasificación de cada fecha con su propia ventana anterior. Neutral incluye indeterminación y no significa que la tasa no cambió. Las ventanas3M se solapan; cortes consecutivos no son evidencia independiente. Historial con revisiones actuales, no backtest en tiempo real.
- Menos36 observaciones válidas: señal no evaluable, nunca cero imputado. Huecos interrumpen persistencia. Duplicados rechazan la calibración.

## Definiciones y alcance

PN01277PM se mantiene y se llama **IPC sin alimentos y energía**; no equivale al IPC subyacente PN01279PM. Media3M de tasasYOY no es crecimiento trimestral ni aceleración secuencial. Impulso3M desestacionalizado conserva composición de tasasMOM. Fechas mixtas se explicitan: no nowcast sincronizado. No se cambian cifras originales ni se incorporan datos INEI automáticamente. No se alteran filtros EEUU.
