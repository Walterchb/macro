const DAY=86400000;
const FLAGS={'Perú':'pe','Estados Unidos':'us','Zona euro':'eu'};
const CATEGORIES={all:'Todos los temas',actividad:'Actividad',precios:'Precios',empleo:'Empleo',tasas:'Bancos centrales',externo:'Sector externo',bienestar:'Bienestar',feriados:'Feriados y cierres'};
const isoDay=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const plusDays=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
const dateFormatters=new Map();
const humanDay=(day,options={day:'numeric',month:'short'})=>{const key=JSON.stringify(options);if(!dateFormatters.has(key))dateFormatters.set(key,new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',...options}));return dateFormatters.get(key).format(new Date(day+'T12:00:00Z'));};
const fallbackEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function agendaEvents(data,region,{days=60,category='all',key=false,country='all',source='all',scope='all'}={},now=new Date()){
  const start=isoDay(now),end=plusDays(start,days);
  return (data?.events||[]).filter(e=>(region==='all'||e.region===region)&&(scope==='all'||e.region===scope)&&e.date>=start&&e.date<=end&&
    (category==='all'||e.category===category)&&(!key||e.key)&&(country==='all'||e.country===country)&&(source==='all'||e.sourceId===source))
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||a.title.localeCompare(b.title));
}
export function agendaSummary(data,region,now=new Date()){
  const events=agendaEvents(data,region,{},now).filter(e=>!e.startsAt||Date.parse(e.startsAt)>=now.getTime()),start=isoDay(now),monthEnd=plusDays(start,31);
  const sources=(data?.sources||[]).filter(s=>region==='all'||s.region===region);
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
const sortEvents=(a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99')||a.title.localeCompare(b.title);
export function shiftAgendaMonth(month,step=0){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Mes no válido');
  const [year,m]=month.split('-').map(Number);return new Date(Date.UTC(year,m-1+step,1,12)).toISOString().slice(0,7);
}
export function agendaMonthGrid(month,now=new Date()){
  const valid=shiftAgendaMonth(month),first=valid+'-01',next=shiftAgendaMonth(valid,1)+'-01';
  const offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7,start=plusDays(first,-offset);
  const days=Math.round((Date.parse(next)-Date.parse(first))/DAY),length=Math.ceil((offset+days)/7)*7,today=isoDay(now);
  return Array.from({length},(_,i)=>{const date=plusDays(start,i);return {date,number:Number(date.slice(8)),inMonth:date.startsWith(valid),today:date===today,weekend:i%7>=5};});
}
export function agendaMonthEvents(data,month,{scope='all',category='all',country='all',source='all',key=false,spillover=false}={}){
  const grid=agendaMonthGrid(month),start=spillover?grid[0].date:month+'-01',end=spillover?grid.at(-1).date:plusDays(shiftAgendaMonth(month,1)+'-01',-1);
  return (data?.events||[]).filter(e=>e.date>=start&&e.date<=end&&(scope==='all'||e.region===scope)&&
    (category==='all'||e.category===category)&&(country==='all'||e.country===country)&&(source==='all'||e.sourceId===source)&&(!key||e.key)).sort(sortEvents);
}

export function agendaPage(events,index=0,pageSize=4){
  const size=Math.max(1,Math.trunc(pageSize)||4),pages=Math.max(1,Math.ceil(events.length/size));
  const page=Math.max(0,Math.min(pages-1,Math.trunc(index)||0));
  return {page,pages,rows:events.slice(page*size,(page+1)*size),from:events.length?page*size+1:0,to:Math.min((page+1)*size,events.length),total:events.length};
}

export function createAgenda({getData,esc=fallbackEscape,showDialog}={}){
  const states=new Map(),previewPages=new Map();
  const stateFor=region=>{if(!states.has(region))states.set(region,{month:isoDay().slice(0,7),category:'all',key:false,country:'all',source:'all',scope:region==='all'?'all':region});return states.get(region);};
  const sourceDate=s=>s.lastSuccessAt?humanDay(isoDay(new Date(s.lastSuccessAt))):'Pendiente';
  const country=e=>`<span class="agenda-country">${FLAGS[e.country]?`<img class="agenda-flag" src="assets/flags/${FLAGS[e.country]}.svg" alt="" width="18" height="12">`:'<i class="fa-solid fa-globe" aria-hidden="true"></i>'}<span>${esc(e.country)}</span></span>`;
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
  function eventDetail(e){
    const explanation=[e.description&&e.description!==e.title?e.description:'',e.note].filter(Boolean).join(' ');
    return `<article class="agenda-modal-event ${e.kind==='holiday'?'is-holiday':''}">
      <div class="agenda-tags">${country(e)}<span>${esc(e.institution)}</span><span>${esc(CATEGORIES[e.category]||'Actividad')}</span>${e.key?'<span class="agenda-key-tag">Clave</span>':''}</div>
      <h3>${esc(e.title)}</h3><p class="agenda-modal-time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${humanDay(e.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${timing(e)}</p>
      ${e.jurisdiction?`<p>${esc(e.jurisdiction)}</p>`:''}${explanation?`<p>${esc(explanation)}</p>`:''}
      <div class="agenda-modal-footer"><a class="btn button" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">Fuente oficial <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a><span>${e.sourceStatus==='retained'?'Fecha conservada · ':''}Verificado: ${e.verifiedAt?humanDay(isoDay(new Date(e.verifiedAt)),{day:'numeric',month:'short',year:'numeric'}):'pendiente'}</span></div></article>`;
  }
  function openEvents(rows,title,covered=true){
    const html=`<div class="agenda-modal-events">${rows.map(eventDetail).join('')||`<p class="agenda-empty">${covered?'No hay citas registradas para este día y estos filtros.':'Día fuera de la cobertura del archivo actual. No se conserva un historial de citas para esta fecha.'}</p>`}</div>`;
    if(showDialog){showDialog(title,html);return;}
    const dialog=document.createElement('dialog');dialog.className='agenda-dialog';dialog.innerHTML=`<header><h2>${esc(title)}</h2><button class="btn iconbtn" type="button" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>${html}`;document.body.append(dialog);dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  }
  function renderSourceStatus(summary){
    return `<details class="agenda-source-status"><summary>Fuentes y cobertura <span>${summary.sources.filter(s=>s.status==='ok').length}/${summary.sources.length} actualizadas</span></summary><div class="agenda-sources">${summary.sources.map(s=>`<div><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.institution)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a><span class="${s.status==='ok'?'agenda-source-ok':'agenda-source-warn'}">${s.status==='ok'?'Consultada':s.status==='retained'?'Fechas conservadas':'Próximas fechas pendientes'}</span><p>${s.eventsInWindow||0} fechas · Verificación: ${sourceDate(s)}${s.publishedThrough?' · Hasta '+humanDay(s.publishedThrough,{day:'numeric',month:'short',year:'numeric'}):''}</p>${s.provenance?`<p>${esc(s.provenance)}</p>`:''}</div>`).join('')}</div><p>Fechas oficiales, sujetas a revisión. Las fuentes se consultan diariamente y, ante fallos, se conserva la última verificación. No se infieren fechas ni horarios. La exportación es una copia del mes filtrado, no una suscripción.</p><p>Feriados: Perú (Gob.pe), sistema de la Reserva Federal (EE. UU.) y cierres TARGET (zona euro). No representan cierres de todas las bolsas.</p></details>`;
  }
  function render(region='all',{compact:small=false}={}){
    const data=getData?.(),summary=agendaSummary(data,region);
    if(small)return compact(region,data,summary);
    const state=stateFor(region),today=isoDay(),firstMonth=(data?.windowStart||today).slice(0,7),lastMonth=(data?.windowEnd||plusDays(today,120)).slice(0,7);
    state.month=state.month<firstMonth?firstMonth:state.month>lastMonth?lastMonth:state.month;
    const month=state.month,events=agendaMonthEvents(data,month,state),gridEvents=agendaMonthEvents(data,month,{...state,spillover:true}),grid=agendaMonthGrid(month),byDay=new Map();
    for(const e of gridEvents){if(!byDay.has(e.date))byDay.set(e.date,[]);byDay.get(e.date).push(e);}
    const countries=[...new Set((data?.events||[]).map(e=>e.country))].sort((a,b)=>a==='Perú'?-1:b==='Perú'?1:a.localeCompare(b));
    const institutions=[...new Map((data?.sources||[]).map(s=>[s.id,s])).values()];
    const monthLabel=humanDay(month+'-01',{month:'long',year:'numeric'}),retained=summary.sources.filter(s=>s.status==='retained').length,pending=summary.sources.filter(s=>s.status==='unavailable').length;
    return `<section class="economic-agenda agenda-calendar" data-agenda-region="${region}" aria-label="Calendario económico mensual">
      <div class="agenda-calendar-head"><div class="agenda-month-title"><h2 aria-live="polite">${monthLabel}</h2><span>${events.length} citas · ${events.filter(e=>e.key).length} clave</span></div><div class="agenda-month-controls"><button type="button" class="btn" data-agenda-today>Hoy</button><button type="button" class="btn iconbtn agenda-arrow" data-agenda-month="-1" aria-label="Mes anterior" title="Mes anterior" ${month<=firstMonth?'disabled':''}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><button type="button" class="btn iconbtn agenda-arrow" data-agenda-month="1" aria-label="Mes siguiente" title="Mes siguiente" ${month>=lastMonth?'disabled':''}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div></div>
      <div class="agenda-toolbar">
        <label>Economía <select data-agenda-filter="country"><option value="all">Todas</option>${countries.map(c=>`<option value="${esc(c)}" ${state.country===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Tema <select data-agenda-filter="category">${Object.entries(CATEGORIES).map(([key,name])=>`<option value="${key}" ${key===state.category?'selected':''}>${name}</option>`).join('')}</select></label>
        <label>Fuente <select data-agenda-filter="source"><option value="all">Todas</option>${institutions.map(s=>`<option value="${esc(s.id)}" ${state.source===s.id?'selected':''}>${esc(s.institution)}</option>`).join('')}</select></label>
        <label class="agenda-essential"><input type="checkbox" data-agenda-filter="key" ${state.key?'checked':''}> Clave</label>
        ${(state.country!=='all'||state.category!=='all'||state.source!=='all'||state.key||state.scope!=='all')?'<button type="button" class="btn" data-agenda-reset>Limpiar</button>':''}<button type="button" class="btn" data-agenda-download title="Exportar las citas de este mes y filtros"><i class="fa-regular fa-calendar-plus" aria-hidden="true"></i> Exportar mes</button>
      </div>
      <div class="agenda-meta"><span><i class="fa-regular fa-clock" aria-hidden="true"></i> Hora de Lima · UTC−5</span><span>Fechas disponibles: ${humanDay(data?.windowStart||today)} – ${humanDay(data?.windowEnd||plusDays(today,120),{day:'numeric',month:'short',year:'numeric'})}</span><span class="agenda-calendar-key"><i aria-hidden="true"></i> Cita clave</span>${retained||pending?`<a href="#agenda-source-status">${[retained?retained+' fuente con fechas conservadas':'',pending?pending+' calendarios pendientes':''].filter(Boolean).join(' · ')}</a>`:''}</div>
      ${summary.stale?'<p class="agenda-warning">Actualización pendiente. Se muestran las últimas fechas verificadas.</p>':''}
      <div class="agenda-calendar-scroll" tabindex="0" role="region" aria-label="Calendario mensual; desplázate horizontalmente en pantallas pequeñas"><div class="agenda-month-grid" role="table" aria-label="${esc(monthLabel)}">
        <div class="agenda-weekday-row" role="row">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day=>`<div role="columnheader">${day}</div>`).join('')}</div>
        ${Array.from({length:grid.length/7},(_,i)=>`<div class="agenda-calendar-week" role="row">${grid.slice(i*7,i*7+7).map(day=>{
          const rows=byDay.get(day.date)||[],covered=day.date>=(data?.windowStart||today)&&day.date<=(data?.windowEnd||today),dateLabel=humanDay(day.date,{weekday:'long',day:'numeric',month:'long'});
          return `<div class="agenda-day ${day.inMonth?'':'is-adjacent'} ${day.today?'is-today':''} ${day.weekend?'is-weekend':''} ${!covered?'is-uncovered':''}" role="cell" ${day.today?'aria-current="date"':''}><button class="agenda-day-number" type="button" data-agenda-day="${day.date}" aria-label="${esc(dateLabel)}: ${covered?rows.length+' citas':'sin cobertura en el archivo actual'}" title="${covered?esc(dateLabel):'Fuera de cobertura publicada'}"><time datetime="${day.date}">${day.number}</time>${day.today?'<span>Hoy</span>':''}</button><div class="agenda-day-events">${rows.slice(0,3).map(e=>`<button type="button" class="agenda-calendar-event ${e.key?'is-key':''} ${e.kind==='holiday'?'is-holiday':''}" data-agenda-event="${esc(e.id)}" title="${esc(e.title+' · '+e.country+' · '+timing(e))}"><span class="agenda-calendar-event-meta">${FLAGS[e.country]?`<img class="agenda-flag" src="assets/flags/${FLAGS[e.country]}.svg" alt="${esc(e.country)}" width="18" height="12">`:''}<span>${e.time?esc(e.time):e.kind==='holiday'?'Feriado':'Sin hora'}</span><span class="agenda-calendar-institution">${esc(e.institution)}</span></span><strong>${esc(e.title)}</strong></button>`).join('')}${rows.length>3?`<button type="button" class="agenda-day-more" data-agenda-day="${day.date}" aria-label="Ver las ${rows.length} citas del ${esc(dateLabel)}">+${rows.length-3} más</button>`:''}</div></div>`;
        }).join('')}</div>`).join('')}
      </div></div>${events.length?'':'<p class="agenda-empty">Sin citas registradas para este mes y estos filtros.</p>'}
      <div id="agenda-source-status">${renderSourceStatus(summary)}</div></section>`;
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
  function bind(container,region='all'){
    bindCompact(container,region);
    const selector=`[data-agenda-region="${region}"]`;
    const section=container?.matches?.(selector)?container:container?.querySelector?.(selector);
    if(!section||section.dataset.agendaBound)return;
    section.dataset.agendaBound='true';
    function refresh(focusSelector){const parent=section.parentNode,box=document.createElement('div'),scroll=section.querySelector('.agenda-calendar-scroll')?.scrollLeft||0;box.innerHTML=render(region);const replacement=box.firstElementChild;section.replaceWith(replacement);bind(parent,region);const scroller=replacement.querySelector('.agenda-calendar-scroll');if(scroller)scroller.scrollLeft=scroll;if(focusSelector)replacement.querySelector(focusSelector)?.focus({preventScroll:true});}
    section.addEventListener('change',e=>{const key=e.target.dataset.agendaFilter;if(!key)return;stateFor(region)[key]=key==='key'?e.target.checked:e.target.value;if(key==='country')stateFor(region).scope='all';refresh(`[data-agenda-filter="${key}"]`);});
    section.addEventListener('click',e=>{
      const month=e.target.closest('[data-agenda-month]');if(month&&!month.disabled){stateFor(region).month=shiftAgendaMonth(stateFor(region).month,Number(month.dataset.agendaMonth));refresh(`[data-agenda-month="${month.dataset.agendaMonth}"]:not(:disabled)`);return;}
      if(e.target.closest('[data-agenda-today]')){stateFor(region).month=isoDay().slice(0,7);refresh('[data-agenda-today]');return;}
      if(e.target.closest('[data-agenda-reset]')){const month=stateFor(region).month;states.delete(region);stateFor(region).month=month;refresh('[data-agenda-filter="country"]');return;}
      const event=e.target.closest('[data-agenda-event]');if(event){const row=(getData?.()?.events||[]).find(r=>r.id===event.dataset.agendaEvent);if(row)openEvents([row],row.title);return;}
      const day=e.target.closest('[data-agenda-day]');if(day){const rows=agendaMonthEvents(getData?.(),stateFor(region).month,{...stateFor(region),spillover:true}).filter(row=>row.date===day.dataset.agendaDay);const data=getData?.(),covered=!!data?.windowStart&&day.dataset.agendaDay>=data.windowStart&&day.dataset.agendaDay<=data.windowEnd;openEvents(rows,humanDay(day.dataset.agendaDay,{weekday:'long',day:'numeric',month:'long',year:'numeric'}),covered);return;}
      const sourceLink=e.target.closest('a[href="#agenda-source-status"]');if(sourceLink){e.preventDefault();const sources=section.querySelector('.agenda-source-status');sources.open=true;sources.scrollIntoView({block:'nearest',behavior:'smooth'});return;}
      if(e.target.closest('[data-agenda-download]'))exportCalendar(region);
    });
  }
  function exportCalendar(region='all'){
    const state=stateFor(region),rows=agendaMonthEvents(getData?.(),state.month,state),blob=new Blob([agendaICS(rows)],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`agenda-${state.month}.ics`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function setScope(scope='all'){const state=stateFor('all');state.scope=['peru','world'].includes(scope)?scope:'all';state.country=scope==='peru'?'Perú':'all';state.source='all';state.category='all';state.key=false;}
  return {render,bind,bindCompact,setScope,exportCalendar,summary:region=>agendaSummary(getData?.(),region)};
}
