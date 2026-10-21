/** Shared freshness policy for Fuentes and Pulso. These are review alarms, not
 * release schedules: age is measured from reference-period END. A documented
 * newer origin release takes precedence over this frequency-only fallback. */
export const FRESHNESS_LIMIT_DAYS = Object.freeze({daily:10,weekly:28,monthly:100,quarterly:180,annual:730});
const DAY = 86400000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;

/** Verified release evidence, not a live release calendar or a replacement
 * observation. Never splice providers/vintages from this register. Extend only
 * after checking the origin publication. Once the provider catches up this
 * evidence no longer marks its observation stale. No future releases inferred. */
export const VERIFIED_ORIGIN_RELEASES = Object.freeze([
  Object.freeze({provider:'BCRP',sourceCode:'PN01728AM',origin:'INEI',referenceDate:'2026-08-01',publicationDate:'2026-10-15',verifiedAt:'2026-10-21',
    url:'https://www.inei.gob.pe/media/MenuRecursivo/boletines/10-informe-tecnico-produccion-nacional-agosto-2026.pdf',
    title:'Producción Nacional · agosto 2026'}),
  ...['DGS10','DGS2','DFII10'].map(sourceCode=>Object.freeze({provider:'FRED',sourceCode,origin:'Federal Reserve H.15',referenceDate:'2026-10-19',publicationDate:'2026-10-20',verifiedAt:'2026-10-21',url:'https://www.federalreserve.gov/releases/h15/',title:'Selected Interest Rates · H.15'}))
]);

export function seriesFreshness(series, observation, now = new Date()) {
  const today = new Date(now), frequency=series?.frequency;
  const limitDays=FRESHNESS_LIMIT_DAYS[frequency] ?? 100;
  const base={ageDays:null,limitDays,retained:series?.status==='retained'};
  if(!observation || !finite(observation.value) || !isoDate(observation.date) || !Number.isFinite(today.getTime())) return {...base,state:'missing',reason:'missing'};
  const end=new Date(`${observation.date}T00:00:00Z`);
  if(end>today) return {...base,state:'missing',reason:'future'};
  if(frequency==='monthly') end.setUTCMonth(end.getUTCMonth()+1,0);
  else if(frequency==='quarterly') end.setUTCMonth(end.getUTCMonth()+3,0);
  else if(frequency==='annual') end.setUTCMonth(11,31);
  const ageDays=Math.max(0,Math.floor((today-end)/DAY));
  const todayISO=today.toISOString().slice(0,10);
  const sourceRelease=VERIFIED_ORIGIN_RELEASES.filter(r=>r.provider===series?.provider && r.sourceCode===series?.sourceCode && r.publicationDate<=todayISO && r.referenceDate>observation.date).sort((a,b)=>b.referenceDate.localeCompare(a.referenceDate))[0];
  if(sourceRelease) return {...base,ageDays,state:'stale',reason:'origin-release',sourceRelease};
  return {...base,ageDays,state:ageDays>limitDays?'stale':base.retained?'retained':'fresh',reason:ageDays>limitDays?'age':base.retained?'retained':'within-age-limit'};
}
