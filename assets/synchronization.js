/** Latest observations remain intact; comparisons explicitly use a common date. */
const finite = x => typeof x === 'number' && Number.isFinite(x);
const rows = s => (s?.observations || []).filter(x => finite(x.value)).slice().sort((a,b)=>a.date.localeCompare(b.date));
export function commonObservation(series) {
  if (!series.length || series.some(s=>!s)) return null;
  const lists=series.map(rows), maps=lists.map(rs=>new Map(rs.map(r=>[r.date,r.value])));
  const date=lists[0].map(r=>r.date).filter(d=>maps.every(m=>m.has(d))).at(-1);
  return date ? {date,values:maps.map(m=>m.get(date)),latest:lists.map(rs=>rs.at(-1)),mixed:lists.some(rs=>rs.at(-1)?.date!==date)} : null;
}
export function seriesCheck(s, now=new Date()) {
  const stamp=s?.lastCheckedAt||s?.latestVerifiedAt||s?.fetchedAt;
  const age=stamp?Math.max(0,(new Date(now)-new Date(stamp))/3600000):null;
  return {stamp:stamp||null,overdue:age===null||!Number.isFinite(age)||age>30,verified:!!s?.latestVerifiedAt,observation:rows(s).at(-1)?.date||null};
}
export function synchronizationHTML(series,status,esc=x=>String(x),now=new Date()) {
  const fred=series.filter(s=>s.provider==='FRED'),checks=fred.map(s=>seriesCheck(s,now));
  const stamps=checks.map(c=>c.stamp).filter(Boolean).sort();
  const format=s=>s&&Number.isFinite(new Date(s).getTime())?new Intl.DateTimeFormat('es-PE',{dateStyle:'short',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(s)):'sin comprobar';
  const overdue=checks.filter(c=>c.overdue).length;
  const failed=status?.outcome==='failed';
  const partial=status?.outcome==='succeeded-with-warnings';
  const latest=commonObservation(['DGS10','DGS2','T10Y2Y'].map(c=>fred.find(s=>s.sourceCode===c)));
  const comparison=latest?`Comparación Treasury en fecha común ${esc(latest.date)}: 10a ${latest.values[0].toFixed(2)}%, 2a ${latest.values[1].toFixed(2)}%; diferencia ${(latest.values[0]-latest.values[1]).toFixed(2)} pp y pendiente publicada ${latest.values[2].toFixed(2)} pp.${latest.mixed?' Hay fechas distintas en los últimos valores: no restar KPI de fechas diferentes.':''}`:'Comparación Treasury sin fecha común disponible.';
  return `<section class="reading" aria-label="Estado de actualización"><strong>Última consulta y corte de comparación</strong><p>Consulta de series FRED: ${esc(format(stamps[0]))}${stamps.at(-1)!==stamps[0]?' — '+esc(format(stamps.at(-1))):''} Lima. Cada indicador conserva su último dato y fecha propios; consultar no significa que el origen haya publicado una observación nueva.</p>${failed?`<p>Último intento falló (${esc(format(status.completedAt||status.attemptAt))} Lima). Se conserva la publicación validada anterior; no se afirma actualización completa.</p>`:''}${partial?`<p>Consulta parcial (${esc(format(status.completedAt||status.attemptAt))} Lima): FRED actualizado; módulos conservados sin actualización: ${esc((status.failedModules||[]).join(', ')||'auxiliares')}. No equivale a revisión completa.</p>`:''}${overdue?`<p>${overdue} series llevan más de 30 horas sin consulta registrada o no tienen registro: actualización pendiente de comprobar.</p>`:''}<p>${comparison}</p><p>Revisión completa prevista 07:35 Lima; FRED adicional 12:35 y 17:35 Lima (12:35, 17:35 y 22:35 UTC). GitHub y las fuentes pueden retrasarse. El botón actualizar consulta esta publicación, no ejecuta una descarga de los proveedores. <a href="https://github.com/Walterchb/macro/actions/workflows/sync-macro.yml" target="_blank" rel="noopener noreferrer">Estado de las ejecuciones</a>.</p></section>`;
}
