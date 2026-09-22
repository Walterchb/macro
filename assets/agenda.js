const DAY=86400000;
const CATEGORIES={all:'Todos los temas',actividad:'Actividad',precios:'Precios',empleo:'Empleo',tasas:'Bancos centrales',externo:'Sector externo',bienestar:'Bienestar',feriados:'Feriados y cierres'};
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
    lines.push('SUMMARY:'+icsEscape(e.title),'DESCRIPTION:'+icsEscape([e.institution,e.country,e.jurisdiction,e.description,e.note,'Fuente: '+e.sourceUrl].filter(Boolean).join('\n')),'URL:'+icsEscape(e.sourceUrl),e.kind==='holiday'?'STATUS:CONFIRMED':'STATUS:TENTATIVE','TRANSP:TRANSPARENT','END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(foldICS).join('\r\n')+'\r\n';
}
function weekStart(day){const d=new Date(day+'T12:00:00Z'),weekday=(d.getUTCDay()+6)%7;return plusDays(day,-weekday);}

export function agendaPage(events,index=0,pageSize=4){
  const size=Math.max(1,Math.trunc(pageSize)||4),pages=Math.max(1,Math.ceil(events.length/size));
  const page=Math.max(0,Math.min(pages-1,Math.trunc(index)||0));
  return {page,pages,rows:events.slice(page*size,(page+1)*size),from:events.length?page*size+1:0,to:Math.min((page+1)*size,events.length),total:events.length};
}

export function createAgenda({getData,esc=fallbackEscape}={}){
  const states=new Map(),previewPages=new Map();
  const stateFor=region=>{if(!states.has(region))states.set(region,{days:60,category:'all',key:false,country:'all'});return states.get(region);};
  const sourceDate=s=>s.lastSuccessAt?humanDay(isoDay(new Date(s.lastSuccessAt))):'Pendiente';
  const country=e=>`<span class="agenda-country"><i class="fa-solid fa-flag" aria-hidden="true"></i> ${esc(e.country)}</span>`;
  const timing=e=>e.time?`${esc(e.time)} Lima`:e.kind==='holiday'?'Todo el día':'Hora por confirmar';
  function compact(region,data,summary){
    const page=agendaPage(summary.events,previewPages.get(region));
    previewPages.set(region,page.page);
    return `<section class="agenda-preview" data-agenda-preview="${region}" aria-label="Próximas citas de ${region==='peru'?'Perú':'Mundo y Mercados'}">
      <div class="agenda-preview-head"><span><i class="fa-regular fa-calendar" aria-hidden="true"></i> Próximas citas</span>
        <div class="agenda-preview-actions"><span class="agenda-page-count" aria-live="polite">${page.from}–${page.to} / ${page.total}</span>
          <button type="button" class="btn iconbtn agenda-arrow" data-agenda-page="-1" aria-label="Citas anteriores" title="Citas anteriores" ${page.page===0?'disabled':''}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
          <button type="button" class="btn iconbtn agenda-arrow" data-agenda-page="1" aria-label="Siguientes citas" title="Siguientes citas" ${page.page===page.pages-1?'disabled':''}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
          <button type="button" class="btn" data-agenda-open="${region}">Ver agenda <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        </div>
      </div><div class="agenda-preview-grid">${page.rows.map(e=>`<a class="agenda-mini ${e.kind==='holiday'?'is-holiday':''}" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer"><div class="agenda-mini-date"><time datetime="${e.date}">${humanDay(e.date)}</time>${country(e)}</div><strong>${esc(e.title)}</strong><small>${esc(e.institution)} · ${timing(e)}${e.sourceStatus==='retained'?' · Fecha conservada':''}</small></a>`).join('')||'<p class="agenda-empty">Sin próximas fechas verificadas.</p>'}</div>${summary.stale?'<p class="agenda-warning">Actualización pendiente.</p>':''}</section>`;
  }
  function renderEvent(e){
    const explanation=[e.description&&e.description!==e.title?e.description:'',e.note].filter(Boolean).join(' ');
    return `<li class="agenda-event ${e.key?'is-key':''} ${e.kind==='holiday'?'is-holiday':''}"><div class="agenda-date"><time datetime="${e.startsAt||e.date}"><b>${Number(e.date.slice(8))}</b><span>${humanDay(e.date,{weekday:'short'})}</span></time><small>${e.time?esc(e.time):e.kind==='holiday'?'Día completo':'Sin hora'}</small></div><div class="agenda-event-body"><div class="agenda-tags">${country(e)}<span>${esc(e.institution)}</span><span>${esc(CATEGORIES[e.category]||'Actividad')}</span>${e.sourceStatus==='retained'?'<span class="agenda-retained">Fecha conservada</span>':''}${e.startsAt&&Date.parse(e.startsAt)<Date.now()?'<span>Hora transcurrida</span>':''}</div><a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(e.title)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>${e.jurisdiction?`<p>${esc(e.jurisdiction)}</p>`:''}${explanation?`<details class="agenda-event-detail"><summary>Detalle</summary><p>${esc(explanation)}</p><span>Verificado: ${e.verifiedAt?humanDay(isoDay(new Date(e.verifiedAt))):'pendiente'}</span></details>`:''}</div></li>`;
  }
  function render(region,{compact:small=false}={}){
    const data=getData?.(),summary=agendaSummary(data,region);
    if(small)return compact(region,data,summary);
    const state=stateFor(region),events=agendaEvents(data,region,state),weeks=new Map();
    for(const e of events){const key=weekStart(e.date);if(!weeks.has(key))weeks.set(key,[]);weeks.get(key).push(e);}
    const countries=[...new Set(agendaEvents(data,region,{days:data?.horizonDays||60}).map(e=>e.country))];
    const retained=summary.sources.filter(s=>s.status==='retained'),unavailable=summary.sources.filter(s=>s.status==='unavailable');
    const pendingBcrp=unavailable.filter(s=>s.id.startsWith('bcrp-'));
    const otherUnavailable=unavailable.filter(s=>!s.id.startsWith('bcrp-'));
    const alerts=[retained.length?`Fechas conservadas: ${retained.map(s=>s.institution).join(', ')}.`:'',otherUnavailable.length?`Próximas fechas pendientes: ${otherUnavailable.map(s=>s.institution).join(', ')}.`:'',summary.stale?'Actualización pendiente.':'',!summary.covered?'Las fuentes aún no cubren el próximo mes completo.':''].filter(Boolean);
    return `<section class="economic-agenda" data-agenda-region="${region}" aria-label="Agenda económica">
      <div class="agenda-intro"><h2>Agenda económica</h2><div class="agenda-counters"><span><strong>${events.length}</strong> eventos</span><span><strong>${summary.week}</strong> en 7 días</span></div></div>
      <div class="agenda-toolbar"><label>Horizonte <select data-agenda-filter="days">${[[31,'Próximo mes'],[60,'60 días'],...(data?.horizonDays>=120?[[120,'120 días']]:[])].map(([v,label])=>`<option value="${v}" ${state.days===v?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Tema <select data-agenda-filter="category">${Object.entries(CATEGORIES).map(([key,name])=>`<option value="${key}" ${key===state.category?'selected':''}>${name}</option>`).join('')}</select></label>
      ${countries.length>1?`<label>Economía <select data-agenda-filter="country"><option value="all">Todas</option>${countries.map(c=>`<option value="${esc(c)}" ${state.country===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>`:''}
      <label class="agenda-essential"><input type="checkbox" data-agenda-filter="key" ${state.key?'checked':''}> Clave</label><button type="button" class="btn" data-agenda-download><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Exportar</button></div>
      <div class="agenda-meta"><span><i class="fa-regular fa-clock" aria-hidden="true"></i> Hora de Lima · UTC−5</span><span>Consulta: ${summary.updatedAt?humanDay(isoDay(new Date(summary.updatedAt))):'pendiente'}</span></div>
      ${alerts.length?`<p class="agenda-warning">${esc(alerts.join(' '))}</p>`:''}
      ${pendingBcrp.length?`<div class="agenda-pending" aria-label="Calendarios BCRP pendientes de verificación">${pendingBcrp.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="Consulta automática diaria; aún no se pudo verificar una próxima fecha"><i class="fa-solid fa-building-columns" aria-hidden="true"></i><span><strong>${s.id==='bcrp-policy'?'BCRP · Tasa de referencia':'BCRP · Reporte de Inflación'}</strong><small>Próxima fecha por verificar · consulta diaria</small></span><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`).join('')}</div>`:''}
      <div class="agenda-weeks">${[...weeks].map(([start,rows])=>`<section class="agenda-week"><div class="agenda-week-head"><h3>${humanDay(start)} — ${humanDay(plusDays(start,6))}</h3><span>${rows.length}</span></div><ol>${rows.map(renderEvent).join('')}</ol></section>`).join('')||'<div class="agenda-empty"><p>Sin eventos para estos filtros.</p><button type="button" class="btn" data-agenda-reset>Restablecer</button></div>'}</div>
      <details class="agenda-source-status"><summary>Fuentes y cobertura <span>${summary.sources.filter(s=>s.status==='ok').length}/${summary.sources.length} actualizadas</span></summary><div class="agenda-sources">${summary.sources.map(s=>`<div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.institution)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a><span class="${s.status==='ok'?'agenda-source-ok':'agenda-source-warn'}">${s.status==='ok'?'Consultada':s.status==='retained'?'Fechas conservadas':'Pendiente'}</span><p>${s.eventsInWindow||0} fechas · Verificación: ${sourceDate(s)}${s.publishedThrough?' · Publicadas hasta '+humanDay(s.publishedThrough,{day:'numeric',month:'short',year:'numeric'}):''}</p>${s.provenance?`<p>${esc(s.provenance)}</p>`:''}</div>`).join('')}</div><p>Consulta diaria de fechas oficiales, sujetas a revisión. Ante fallos se mantiene la última verificación; no se infieren publicaciones ni horarios. El archivo exportado es una copia, no una suscripción.</p><p>${region==='peru'?'INEI, BCRP y feriados nacionales de Gob.pe.':'BLS, BEA, Fed y BCE. Los feriados corresponden a la Reserva Federal y los cierres TARGET; no representan el cierre de todas las bolsas o países.'}</p></details></section>`;
  }
  function bindCompact(container,region){
    const selector=`[data-agenda-preview="${region}"]`;
    const section=container?.matches?.(selector)?container:container?.querySelector?.(selector);
    if(!section||section.dataset.agendaBound)return;
    section.dataset.agendaBound='true';
    section.addEventListener('click',e=>{
      const arrow=e.target.closest('[data-agenda-page]');if(!arrow||arrow.disabled)return;
      const step=Number(arrow.dataset.agendaPage),summary=agendaSummary(getData?.(),region),page=agendaPage(summary.events,(previewPages.get(region)||0)+step);
      previewPages.set(region,page.page);
      const box=document.createElement('div');box.innerHTML=render(region,{compact:true});const replacement=box.firstElementChild;
      section.replaceWith(replacement);bindCompact(replacement,region);
      const active=replacement.querySelector(`[data-agenda-page="${step}"]:not(:disabled)`)||replacement.querySelector('[data-agenda-page]:not(:disabled)');
      active?.focus({preventScroll:true});
    });
  }
  function bind(container,region){
    bindCompact(container,region);
    const selector=`[data-agenda-region="${region}"]`;
    const section=container?.matches?.(selector)?container:container?.querySelector?.(selector);
    if(!section||section.dataset.agendaBound)return;
    section.dataset.agendaBound='true';
    function refresh(){const parent=section.parentNode,box=document.createElement('div');box.innerHTML=render(region);section.replaceWith(box.firstElementChild);bind(parent,region);}
    section.addEventListener('change',e=>{const key=e.target.dataset.agendaFilter;if(!key)return;stateFor(region)[key]=key==='key'?e.target.checked:key==='days'?Number(e.target.value):e.target.value;refresh();});
    section.addEventListener('click',e=>{
      if(e.target.closest('[data-agenda-reset]')){states.delete(region);refresh();return;}
      if(e.target.closest('[data-agenda-download]')){const rows=agendaEvents(getData?.(),region,stateFor(region)),blob=new Blob([agendaICS(rows)],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`agenda-${region}-${isoDay()}.ics`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    });
  }
  return {render,bind,bindCompact,summary:region=>agendaSummary(getData?.(),region)};
}
