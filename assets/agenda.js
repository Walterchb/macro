const DAY=86400000;
const CATEGORIES={all:'Todos los temas',actividad:'Actividad',precios:'Precios',empleo:'Empleo',tasas:'Bancos centrales',externo:'Sector externo',bienestar:'Bienestar'};
const isoDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const plusDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
const humanDay=(day,options={day:'numeric',month:'short'})=>new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',...options}).format(new Date(day+'T12:00:00Z'));
const fallbackEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function agendaEvents(data,region,{days=60,category='all',key=false,country='all'}={},now=new Date()){
  const start=isoDay(now),end=plusDays(start,days);
  return (data?.events||[]).filter(e=>e.region===region&&e.date>=start&&e.date<=end&&
    (category==='all'||e.category===category)&&(!key||e.key)&&(country==='all'||e.country===country))
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||a.title.localeCompare(b.title));
}
export function agendaSummary(data,region,now=new Date()){
  const events=agendaEvents(data,region,{},now).filter(e=>!e.startsAt||Date.parse(e.startsAt)>=now.getTime()),start=isoDay(now),monthEnd=plusDays(start,31);
  const sources=(data?.sources||[]).filter(s=>s.region===region);
  return {events,next:events[0]||null,total:events.length,week:events.filter(e=>e.date<=plusDays(start,7)).length,
    sources,covered: sources.some(s=>s.publishedThrough&&s.publishedThrough>=monthEnd),
    stale:!data?.fetchedAt||(now.getTime()-Date.parse(data.fetchedAt))>2*DAY,
    start,end:data?.windowEnd||plusDays(start,60),updatedAt:data?.fetchedAt||null};
}
const icsEscape=s=>String(s??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
const icsStamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function foldICS(line){
  const chunks=[];let chunk='',size=0;
  for(const char of line){const n=new TextEncoder().encode(char).length;if(size+n>73){chunks.push(chunk);chunk=' '+char;size=n+1;}else{chunk+=char;size+=n;}}
  chunks.push(chunk);return chunks.join('\r\n');
}
export function agendaICS(events,now=new Date()){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Treasury Macro Hub//Agenda económica//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Agenda económica | Treasury Macro Hub','X-WR-TIMEZONE:America/Lima'];
  for(const e of events){
    lines.push('BEGIN:VEVENT','UID:'+icsEscape(e.id)+'@treasury-macro-hub','DTSTAMP:'+icsStamp(now));
    if(e.precision==='time'&&e.startsAt)lines.push('DTSTART:'+icsStamp(e.startsAt));
    else lines.push('DTSTART;VALUE=DATE:'+e.date.replace(/-/g,''),'DTEND;VALUE=DATE:'+plusDays(e.date,1).replace(/-/g,''));
    lines.push('SUMMARY:'+icsEscape(e.title),'DESCRIPTION:'+icsEscape([e.institution,e.country,e.description,e.note,'Fuente: '+e.sourceUrl].filter(Boolean).join('\n')),'URL:'+icsEscape(e.sourceUrl),'STATUS:TENTATIVE','TRANSP:TRANSPARENT','END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(foldICS).join('\r\n')+'\r\n';
}
function weekStart(day){const d=new Date(day+'T12:00:00Z'),weekday=(d.getUTCDay()+6)%7;return plusDays(day,-weekday);}

export function createAgenda({getData,esc=fallbackEscape}={}){
  const states=new Map();
  const stateFor=region=>{if(!states.has(region))states.set(region,{days:60,category:'all',key:false,country:'all'});return states.get(region);};
  const sourceDate=s=>s.lastSuccessAt?humanDay(isoDay(new Date(s.lastSuccessAt))):'Sin verificación';
  function compact(region,data,summary){
    const upcoming=summary.events.filter(e=>e.key).slice(0,4);
    const rows=upcoming.length?upcoming:summary.events.slice(0,4);
    return `<section class="agenda-preview" aria-label="Próximos acontecimientos de ${region==='peru'?'Perú':'Mundo y Mercados'}"><div class="agenda-preview-head"><span><i class="fa-regular fa-calendar" aria-hidden="true"></i> Próximas citas</span><button type="button" class="link-button" data-agenda-open="${region}">Ver agenda · ${summary.total} eventos <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div><div class="agenda-preview-grid">${rows.map(e=>`<a class="agenda-mini" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer"><time datetime="${e.date}">${humanDay(e.date)}</time><strong>${esc(e.title)}</strong><small>${esc(e.institution)} · ${e.time?esc(e.time)+' Lima':'Hora no publicada'}${e.sourceStatus==='retained'?' · Fecha conservada':''}</small></a>`).join('')||'<p class="agenda-empty">No hay nuevas fechas verificadas. Consulta el estado de las fuentes en la agenda.</p>'}</div>${summary.stale?'<p class="agenda-warning">La agenda necesita una nueva actualización.</p>':''}</section>`;
  }
  function render(region,{compact:small=false}={}){
    const data=getData?.(),summary=agendaSummary(data,region);
    if(small)return compact(region,data,summary);
    const state=stateFor(region),events=agendaEvents(data,region,state),weeks=new Map();
    for(const e of events){const key=weekStart(e.date);if(!weeks.has(key))weeks.set(key,[]);weeks.get(key).push(e);}
    const countries=[...new Set(summary.events.map(e=>e.country))];
    const retained=summary.sources.filter(s=>s.status!=='ok');
    const alerts=[retained.length?`${retained.map(s=>s.institution).join(', ')}: consulta automática pendiente. Las fechas conservadas mantienen su última verificación y pueden haber cambiado.`:'',summary.stale?'La agenda necesita una nueva consulta automática. Las fechas conservan su última verificación.':'',!summary.covered?'Las fuentes todavía no publican un mes completo hacia adelante. Se muestran únicamente fechas disponibles.':''].filter(Boolean);
    return `<section class="economic-agenda" data-agenda-region="${region}" aria-label="Agenda económica"><div class="agenda-intro"><div><div class="agenda-eyebrow">LO QUE VIENE</div><h2>Agenda económica</h2><p>${region==='peru'?'Las próximas publicaciones oficiales para entender el Perú.':'Decisiones monetarias y publicaciones que mueven la economía mundial.'} Fechas y horarios de las instituciones.</p></div><div class="agenda-counters"><div><strong>${summary.total}</strong><span>próximos eventos</span></div><div><strong>${summary.week}</strong><span>en 7 días</span></div><div><strong>60</strong><span>días de horizonte</span></div></div></div><div class="agenda-toolbar"><label>Horizonte <select data-agenda-filter="days"><option value="31" ${state.days===31?'selected':''}>Próximo mes</option><option value="60" ${state.days===60?'selected':''}>Próximos 60 días</option></select></label><label>Tema <select data-agenda-filter="category">${Object.entries(CATEGORIES).filter(([key])=>key==='all'||summary.events.some(e=>e.category===key)).map(([key,name])=>`<option value="${key}" ${key===state.category?'selected':''}>${name}</option>`).join('')}</select></label>${countries.length>1?`<label>Economía <select data-agenda-filter="country"><option value="all">Todas</option>${countries.map(c=>`<option value="${esc(c)}" ${state.country===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>`:''}<label class="agenda-essential"><input type="checkbox" data-agenda-filter="key" ${state.key?'checked':''}> Publicaciones clave</label><button type="button" data-agenda-download><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Exportar calendario</button></div><div class="agenda-meta"><span><i class="fa-regular fa-clock" aria-hidden="true"></i> Horas de Lima · UTC−5</span><span>${events.length} eventos en esta vista</span><span>Consulta: ${summary.updatedAt?humanDay(isoDay(new Date(summary.updatedAt))):'Pendiente'} · Ventana hasta ${humanDay(summary.end)}</span></div>${alerts.map(a=>`<p class="agenda-warning">${a}</p>`).join('')}<div class="agenda-weeks">${[...weeks].map(([start,rows])=>`<section class="agenda-week"><div class="agenda-week-head"><h3>${humanDay(start)} — ${humanDay(plusDays(start,6))}</h3><span>${rows.length} ${rows.length===1?'evento':'eventos'}</span></div><ol>${rows.map(e=>`<li class="agenda-event ${e.key?'is-key':''}"><div class="agenda-date"><time datetime="${e.startsAt||e.date}"><b>${Number(e.date.slice(8))}</b><span>${humanDay(e.date,{weekday:'short'})}</span></time><small>${e.time?esc(e.time):'Sin hora'}</small></div><div class="agenda-event-body"><div class="agenda-tags"><span>${esc(e.institution)}</span><span>${esc(CATEGORIES[e.category]||'Actividad')}</span>${e.sourceStatus==='retained'?'<span class="agenda-retained">Fecha conservada</span>':''}${e.startsAt&&Date.parse(e.startsAt)<Date.now()?'<span>Hora programada transcurrida</span>':''}</div><a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.title)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a><p>${esc(e.description)}</p>${e.note?`<small>${esc(e.note)}</small>`:''}<div class="agenda-event-foot">${esc(e.country)} · Verificado ${e.verifiedAt?humanDay(isoDay(new Date(e.verifiedAt))):'sin fecha'}</div></div></li>`).join('')}</ol></section>`).join('')||'<div class="agenda-empty"><i class="fa-regular fa-calendar" aria-hidden="true"></i><p>No hay eventos que coincidan con estos filtros.</p><button type="button" data-agenda-reset>Restablecer filtros</button></div>'}</div><details class="agenda-source-status"><summary>Fuentes, actualización y alcance <span>${summary.sources.filter(s=>s.status==='ok').length}/${summary.sources.length} consultadas en el último ciclo</span></summary><div class="agenda-sources">${summary.sources.map(s=>`<div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.institution)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a><span class="${s.status==='ok'?'agenda-source-ok':'agenda-source-warn'}">${s.status==='ok'?'Consulta completa':s.status==='retained'?'Última agenda conservada':'Consulta pendiente'}</span><p>${s.eventsInWindow||0} eventos · Última verificación: ${sourceDate(s)}${s.publishedThrough?' · Fechas publicadas hasta '+humanDay(s.publishedThrough,{day:'numeric',month:'short',year:'numeric'}):''}.</p>${s.provenance?`<p>${esc(s.provenance)}</p>`:''}${s.status!=='ok'?'<p>La fuente no respondió a la consulta automática. Se vuelve a intentar diariamente; una fecha conservada puede haber cambiado.</p>':''}</div>`).join('')}</div><p>Actualización diaria. Cada consulta reemplaza las fechas de las fuentes disponibles; si una institución no responde, se retiene su última agenda verificada. Los eventos sin hora publicada conservan solo la fecha. No se generan fechas mediante patrones de meses anteriores. El calendario exportado es una copia de esta vista, no una suscripción.</p><p>La cobertura de Perú corresponde al calendario oficial del INEI. Mundo y Mercados integra BLS, BEA, Reserva Federal y BCE. No incluye todos los países ni todos los acontecimientos económicos.</p></details></section>`;
  }
  function bind(container,region){
    const section=container?.matches?.(`[data-agenda-region="${region}"]`)?container:container?.querySelector?.(`[data-agenda-region="${region}"]`);
    if(!section||section.dataset.agendaBound)return;
    section.dataset.agendaBound='true';
    function refresh(){const parent=section.parentNode,box=document.createElement('div');box.innerHTML=render(region);section.replaceWith(box.firstElementChild);bind(parent,region);}
    section.addEventListener('change',e=>{const key=e.target.dataset.agendaFilter;if(!key)return;stateFor(region)[key]=key==='key'?e.target.checked:key==='days'?Number(e.target.value):e.target.value;refresh();});
    section.addEventListener('click',e=>{
      if(e.target.closest('[data-agenda-reset]')){states.delete(region);refresh();return;}
      if(e.target.closest('[data-agenda-download]')){const rows=agendaEvents(getData?.(),region,stateFor(region)),blob=new Blob([agendaICS(rows)],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`agenda-${region}-${isoDay()}.ics`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    });
  }
  return {render,bind,summary:region=>agendaSummary(getData?.(),region)};
}
