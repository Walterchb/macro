# Cartografía departamental del Perú

`peru-regions.geo.json` conserva 25 geometrías departamentales, incluida la Provincia Constitucional del Callao, descargadas del servicio público de la **Autoridad Nacional del Agua — Sistema Nacional de Información de Recursos Hídricos (SNIRH)**.

- Capa: <https://geosnirh.ana.gob.pe/server/rest/services/ONRH/Departamentos_PAQ/MapServer/0>
- Proyección: WGS 84, EPSG:4326.
- Consulta: `where=1=1&outFields=CODDEP,DEPARTAMEN,CAPITAL&returnGeometry=true&outSR=4326&maxAllowableOffset=0.006&geometryPrecision=4&f=geojson`.
- Transformación: simplificación de la propia API a 0,006 grados y cuatro decimales. Se renombraron los campos a `id`, `name` y `capital`; los códigos departamentales UBIGEO no cambian. Se normalizaron las tildes de los nombres.
- No se desplazó ni amplió el Callao ni otra región. El selector accesible y el acceso directo a Callao permiten seleccionar su polígono pequeño.
- Los metadatos públicos del servicio no declaran licencia específica. Se conserva la atribución institucional y el enlace a la fuente; no se presenta una licencia inventada.

Los límites son referenciales y se usan para visualización estadística, no para demarcación legal. La cartografía se sirve localmente; el visitante no depende de una consulta al servicio ArcGIS.
