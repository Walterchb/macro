/** Comparable periods, explicit units and locally saved workspaces. */
import {finite, commonDates, pairs, correlation, isRate} from './math.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = d => typeof d === 'string' && DATE.test(d) && Number.isFinite(Date.parse(d+'T00:00:00Z')) && new Date(d+'T00:00:00Z').toISOString().slice(0,10) === d;
const LATAM = new Set(['PER','CHL','COL','BRA','MEX','ARG','ECU','URY','BOL','PRY']);
const METRICS = [
  ['NY.GDP.MKTP.KD.ZG','Crecimiento','PBI real, variación anual'],
  ['FP.CPI.TOTL.ZG','Inflación','Precios al consumidor, variación anual'],
  ['SL.UEM.TOTL.ZS','Desempleo','Estimación OIT, fuerza laboral'],
  ['NE.GDI.FTOT.ZS','Inversión','Formación bruta de capital fijo'],
  ['BN.CAB.XOKA.GD.ZS','Cuenta corriente','Saldo externo de bienes, servicios y rentas'],
  ['NY.GDP.PCAP.CD','PBI por habitante','Producción por habitante, US$ corrientes'],
];
const DEVELOPMENT = [
  ['SP.DYN.LE00.IN','Esperanza de vida','años'],
  ['IT.NET.USER.ZS','Uso de internet','% de la población'],
  ['SH.STA.BASS.ZS','Saneamiento básico','% de la población'],
  ['SL.GDP.PCAP.EM.KD','Productividad laboral','US$ PPA constantes de 2021'],
  ['SI.POV.UMIC','Pobreza bajo US$ 8,30 al día','% de la población · PPA 2021'],
];

/** Missing series participate in the coverage check instead of disappearing. */
export function exactCommonYears(series) {
  if (!series.length || series.some(s=>!s || s.frequency !== 'annual')) return [];
  return commonDates(series).sort();
}

export function median(values) {
  const sorted=values.filter(finite).sort((a,b)=>a-b), n=sorted.length;
  return n ? n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2 : null;
}

export function compareAtDates(s, start, end) {
  if (!s || !validDate(start) || !validDate(end) || start>=end) return null;
  const a=s.observations.find(o=>o.date===start && finite(o.value));
  const b=s.observations.find(o=>o.date===end && finite(o.value));
  if (!a || !b) return null;
  return {start, end, first:a.value, last:b.value, absolute:b.value-a.value,
    relative:a.value>0 ? (b.value/a.value-1)*100 : null,
    unit:isRate(s)?'pp':s.unit};
}

export function restrictWindow(groups, start='', end='') {
  if ((start && !validDate(start)) || (end && !validDate(end)) || (start && end && start>end)) return groups.map(g=>({...g,rows:[]}));
  return groups.map(g=>({...g,rows:g.rows.filter(o=>(!start||o.date>=start)&&(!end||o.date<=end))}));
}

/** Pairwise complete observations, never row-order matching or interpolation. */
export function pairwiseEvidence(groups, minimum=12) {
  return groups.map((left,i)=>groups.map((right,j)=>{
    if (left.s.frequency!==right.s.frequency) return {i,j,n:0,r:null,reason:'Frecuencias distintas'};
    if ((left.s.sourceCode==='SI.POV.NAHC'||right.s.sourceCode==='SI.POV.NAHC') && left.s.country!==right.s.country) return {i,j,n:0,r:null,reason:'Líneas nacionales distintas'};
    const aligned=pairs(left.rows,right.rows);
    const r=aligned.length>=minimum ? correlation(aligned) : null;
    return {i,j,n:aligned.length,r,first:aligned[0]?.date,last:aligned.at(-1)?.date,
      reason:aligned.length<minimum?`Se requieren ${minimum} pares`:r===null?'Varianza nula':''};
  }));
}

export function sanitizeSavedComparisons(value) {
  if (!Array.isArray(value)) return [];
  const ids=new Set();
  return value.filter(x=>x && typeof x.id==='string' && x.id.length<=80 && typeof x.name==='string' && Array.isArray(x.selected))
    .slice(0,12).flatMap(x=>{
      if (ids.has(x.id)) return []; ids.add(x.id);
      const selected=[...new Set(x.selected.filter(id=>typeof id==='string' && id.length<180))].slice(0,4);
      if (!selected.length) return [];
      const start=validDate(x.start)?x.start:'', end=validDate(x.end)?x.end:'';
      return [{id:x.id,name:x.name.trim().slice(0,60)||'Comparación',selected,
        mode:['level','index','yoy','diff'].includes(x.mode)?x.mode:'level',
        chartType:['line','bar','scatter'].includes(x.chartType)?x.chartType:'line',
        range:['3','5','10','all'].includes(x.range)?x.range:'10',
        start:start && end && start>end?'':start,end}];
    });
}

export function createComparisonLab(ctx) {
  const {esc,fmt,date,wb,series,countryNames,colors,css,theme,panel,chart,baseOption,chartRows,toast}=ctx;
  const q=s=>document.querySelector(s);
  const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
  const persist=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}};
  const initialWindow=load('macro:lab-window',{});
  let start=validDate(initialWindow.start)?initialWindow.start:'', end=validDate(initialWindow.end)?initialWindow.end:'';
  if(start && end && start>end){start='';end=''}
  let saved=sanitizeSavedComparisons(load('macro:saved-comparisons',[]));
  let lensYear='', baselineYear=null, development='SP.DYN.LE00.IN', developmentYear='';
  let chosenSaved='';
  const obs=(s,d)=>s?.observations.find(o=>o.date===d&&finite(o.value));
  const label=c=>countryNames[c]||c;
  const signed=(n,d=2)=>finite(n)?`${n>0?'+':''}${fmt(n,d)}`:'—';
  const shortUnit=s=>s?.sourceCode==='NY.GDP.PCAP.CD'?'US$':s?.unit||'';
  const selectedCountries=()=>[...new Set(ctx.countries())];
  const allYears=ss=>[...new Set(ss.filter(Boolean).flatMap(s=>s.observations.filter(o=>finite(o.value)).map(o=>o.date)))].sort();
  const optionYears=(dates,chosen)=>dates.slice().reverse().map(d=>`<option value="${d}" ${d===chosen?'selected':''}>${d.slice(0,4)}</option>`).join('');
  const safeName=s=>`${s.countryName||s.country} · ${s.name}`;

  function mountLatam() {
    q('#comparison-lens')?.remove();
    const head=q('#content .page-head'); if(!head)return;
    const countries=selectedCountries();
    const allSeries=METRICS.flatMap(([code])=>countries.map(c=>wb(c,code)));
    const common=exactCommonYears(allSeries), available=allYears(allSeries);
    if(!lensYear || !available.includes(lensYear))lensYear=common.at(-1)||available.at(-1)||'';
    const prior=common.filter(d=>d<lensYear), fallback=prior.filter(d=>Number(d.slice(0,4))<=Number(lensYear.slice(0,4))-5).at(-1)||prior[0]||'';
    if(baselineYear===null || (baselineYear && (baselineYear>=lensYear || !available.includes(baselineYear))))baselineYear=fallback;
    const extra=countries.filter(c=>!LATAM.has(c));
    const coverage=allSeries.filter(s=>obs(s,lensYear)).length;
    const dateLabel=lensYear.slice(0,4)||'—';
    const html=`<section id="comparison-lens" class="comparison-lens" aria-labelledby="lens-title">
      <div class="lab-section-heading"><div><span class="lab-eyebrow">COMPARACIÓN REGIONAL</span><h2 id="lens-title">Una fecha, seis perspectivas</h2><p>Perú frente a los países seleccionados. La mediana resume a los demás países, sin ponderación por tamaño.</p></div><span class="lab-coverage">${coverage} / ${allSeries.length} datos · ${dateLabel}</span></div>
      ${extra.length?`<p class="lab-notice">La selección incluye referentes fuera de Latinoamérica: ${extra.map(c=>esc(label(c))).join(', ')}.</p>`:''}
      <div id="lab-country-selection"><p class="lab-country-caption">Países de la comparación <span>Esta selección se aplica a toda la página.</span></p></div>
      <div class="lab-controls"><label>Año de comparación<select id="lens-year">${optionYears(available,lensYear)}</select></label><label>Cambio desde<select id="lens-baseline"><option value="">Sin periodo anterior</option>${optionYears(available.filter(d=>d<lensYear),baselineYear)}</select></label><button id="lens-common" ${common.length?'':'disabled'}>Último año con cobertura completa</button></div>
      ${!common.length?'<p class="lab-notice">No hay un año con las seis variables para todos los países seleccionados. Cada ausencia se muestra como «sin dato».</p>':''}
      <div class="lens-cards">${METRICS.map(([code,title,definition],i)=>{
        const pe=countries.includes('PER')?wb('PER',code):null, p=obs(pe,lensYear);
        const peers=countries.filter(c=>c!=='PER').map(c=>obs(wb(c,code),lensYear)?.value).filter(finite);
        const med=median(peers), change=compareAtDates(pe,baselineYear,lensYear), isMoney=code==='NY.GDP.PCAP.CD';
        const delta=change?(isMoney?change.relative:change.absolute):null, deltaUnit=isMoney?'% nominal':change?.unit;
        const scaleValues=countries.map(c=>obs(wb(c,code),lensYear)?.value).filter(finite);
        const low=scaleValues.length?Math.min(...scaleValues):null,high=scaleValues.length?Math.max(...scaleValues):null;
        const position=v=>high===low?50:Math.max(0,Math.min(100,(v-low)/(high-low)*100));
        return `<article class="lens-card" style="--lens-color:${colors[i%colors.length]}"><div class="lens-card-top"><h3>${title}</h3><span>${dateLabel}</span></div><p>${definition}</p><div class="lens-value"><strong>${p?fmt(p.value,isMoney?0:2):'—'}</strong><span>${isMoney?'US$':esc(pe?.unit||allSeries.find(s=>s?.sourceCode===code)?.unit||'')}</span></div><small>${countries.includes('PER')?'Perú':'Perú no está seleccionado'}</small>
          <div class="lens-scale" role="img" aria-label="Rango de países de ${fmt(low)} a ${fmt(high)}. Perú: ${fmt(p?.value)}. Mediana de pares: ${fmt(med)}">${finite(med)?`<i class="lens-peer" style="left:${position(med)}%"></i>`:''}${p?`<i class="lens-peru" style="left:${position(p.value)}%"></i>`:''}</div>
          <div class="lens-comparison"><span>Mediana de pares <b>${fmt(med,isMoney?0:2)}</b></span><span>${peers.length} países con dato</span></div>
          <div class="lens-change">${baselineYear?`${baselineYear.slice(0,4)} → ${dateLabel}: <b>${finite(delta)?signed(delta)+' '+esc(deltaUnit):'sin ambos datos'}</b>`:'Elige un año anterior para medir el cambio.'}</div>
          ${pe?`<button class="link-button" data-detail="${esc(pe.id)}">Ver serie de Perú ↗</button>`:''}</article>`;
      }).join('')}</div>
      <div class="lens-key"><span><i class="lens-key-peru"></i> Perú</span><span><i class="lens-key-peer"></i> Mediana de los demás países</span><span>Escala: mínimo y máximo de la selección · el color no califica el desempeño.</span></div>
      <details class="lab-matrix"><summary>Comparar los valores por país y sus cambios</summary><div class="table-scroll"><table><caption>Banco Mundial · mismo año ${dateLabel}${baselineYear?' y cambio frente a '+baselineYear.slice(0,4):''}. Cada indicador conserva su propia unidad.</caption><thead><tr><th>Indicador / unidad</th>${countries.map(c=>`<th class="numeric ${c==='PER'?'lab-peru-col':''}">${esc(label(c))}</th>`).join('')}</tr></thead><tbody>${METRICS.map(([code,title])=>`<tr><th scope="row">${title}<small>${esc(wb(countries[0],code)?.unit||'')}</small></th>${countries.map(c=>{const s=wb(c,code),o=obs(s,lensYear),d=compareAtDates(s,baselineYear,lensYear),money=code==='NY.GDP.PCAP.CD';return `<td class="numeric ${c==='PER'?'lab-peru-col':''}">${o?`<button class="link-button" data-detail="${esc(s.id)}">${fmt(o.value,money?0:2)}</button>`:'Sin dato'}${baselineYear?`<small>${d?signed(money?d.relative:d.absolute)+' '+esc(money?'% nominal':d.unit):'Sin ambos datos'}</small>`:''}</td>`}).join('')}</tr>`).join('')}</tbody></table></div></details>
      <details class="lab-scatter-disclosure" open><summary>Producción y bienestar: ¿cómo se relacionan?</summary><div class="lab-scatter-controls lab-controls"><label>Dimensión de bienestar<select id="lab-development">${DEVELOPMENT.filter(([c])=>series().some(s=>s.sourceCode===c)).map(([c,n])=>`<option value="${c}" ${c===development?'selected':''}>${n}</option>`).join('')}</select></label><label>Año de ambas variables<select id="lab-development-year"></select></label><span id="lab-development-coverage" class="lab-coverage"></span></div><div id="lab-scatter-host"></div></details>
    </section>`;
    head.insertAdjacentHTML('afterend',html);
    const countryButtons=q('#content .countries');if(countryButtons)q('#lab-country-selection').append(countryButtons);
    q('#lens-year').onchange=e=>{lensYear=e.target.value;baselineYear=null;ctx.rerender()};
    q('#lens-baseline').onchange=e=>{baselineYear=e.target.value;ctx.rerender()};
    q('#lens-common').onclick=()=>{lensYear=common.at(-1)||'';baselineYear=null;ctx.rerender()};
    q('#lab-development').onchange=e=>{development=e.target.value;developmentYear='';ctx.rerender()};
    q('#lab-development-year').onchange=e=>{developmentYear=e.target.value;ctx.rerender()};
    renderDevelopment(countries);
  }

  function renderDevelopment(countries) {
    const xcode='NY.GDP.PCAP.CD', specs=countries.flatMap(c=>[wb(c,xcode),wb(c,development)]), common=exactCommonYears(specs), available=allYears(specs);
    if(!developmentYear || !available.includes(developmentYear)) developmentYear=common.at(-1)||available.filter(d=>countries.filter(c=>obs(wb(c,xcode),d)&&obs(wb(c,development),d)).length>=2).at(-1)||available.at(-1)||'';
    q('#lab-development-year').innerHTML=optionYears(available,developmentYear);
    const points=countries.flatMap(c=>{const xs=wb(c,xcode),ys=wb(c,development),x=obs(xs,developmentYear),y=obs(ys,developmentYear);return x&&y?[{country:c,x:x.value,y:y.value,xs,ys}]:[]});
    q('#lab-development-coverage').textContent=`${points.length} / ${countries.length} países · ${developmentYear.slice(0,4)}`;
    const yname=DEVELOPMENT.find(([c])=>c===development)?.[1]||development, yunit=points[0]?.ys.unit||'';
    q('#lab-scatter-host').innerHTML=panel('lab-development-chart','PBI por habitante y '+yname.toLowerCase(),`Cada punto es un país · ${developmentYear.slice(0,4)} · Banco Mundial`,points.flatMap(p=>[p.xs,p.ys]),{wide:true,help:'Ambas variables pertenecen al mismo año. El PBI por habitante está en dólares corrientes: refleja precios y tipo de cambio, no poder adquisitivo comparable. La relación no demuestra causalidad.',note:'Ambas variables pertenecen al mismo año. PBI por habitante en US$ corrientes; no mide poder adquisitivo comparable.'})+`<p class="lab-method">${points.length<countries.length?'Sin ambos datos: '+countries.filter(c=>!points.some(p=>p.country===c)).map(c=>esc(label(c))).join(', ')+'. ':''}${development==='SI.POV.UMIC'?'Línea internacional común: US$ 8,30 por persona al día, PPA de 2021. No se utilizan líneas nacionales de pobreza. ':''}Los puntos tienen el mismo tamaño; Perú se distingue por su contorno.</p>`;
    const meta=chartRows.get('lab-development-chart');
    if(meta){meta.rows=points.flatMap(p=>[{s:p.xs,rows:[{date:developmentYear,value:p.x}]},{s:p.ys,rows:[{date:developmentYear,value:p.y}]}]);meta.scatterAxes=Object.fromEntries(points.flatMap(p=>[[p.xs.id,'X'],[p.ys.id,'Y']]))}
    if(!points.length){q('#lab-development-chart').innerHTML='<div class="empty">No hay pares del mismo año para la selección.</div>';return}
    const opts=baseOption();delete opts.dataZoom;delete opts.legend;
    opts.grid={left:70,right:62,top:40,bottom:62};
    opts.xAxis={type:'value',name:'PBI por habitante · US$ corrientes',nameLocation:'middle',nameGap:33,nameTextStyle:{color:css('--muted'),fontSize:10},axisLabel:{color:css('--muted'),formatter:n=>Math.abs(n)>=1000?fmt(n/1000,0)+' mil':fmt(n,0)},splitLine:{lineStyle:{color:css('--line'),type:'dashed'}}};
    opts.yAxis={type:'value',scale:true,name:yunit,nameTextStyle:{color:css('--muted'),fontSize:10},axisLabel:{color:css('--muted'),formatter:n=>fmt(n,Math.abs(n)>1000?0:1)},splitLine:{lineStyle:{color:css('--line'),type:'dashed'}}};
    opts.tooltip={...opts.tooltip,trigger:'item',formatter:p=>{const a=p.data;return `<b>${esc(label(a.country))} · ${developmentYear.slice(0,4)}</b><br>PBI por habitante: ${fmt(a.value[0],0)} US$<br>${esc(yname)}: ${fmt(a.value[1])} ${esc(yunit)}<br>Banco Mundial · WDI`}};
    const centerX=median(points.map(p=>p.x)),centerY=median(points.map(p=>p.y));
    opts.series=[{name:yname,type:'scatter',symbolSize:12,label:{show:true,position:'top',distance:8,color:css('--ink'),fontSize:11,formatter:p=>label(p.data.country)},labelLayout:{hideOverlap:true},emphasis:{scale:1.3,itemStyle:{shadowBlur:8,shadowColor:theme()?'#ffffff20':'#00000020'}},data:points.map(p=>({country:p.country,value:[p.x,p.y],itemStyle:{color:p.country==='PER'?colors[0]:colors[1],opacity:p.country==='PER'?1:.62,borderColor:p.country==='PER'?css('--ink'):css('--panel'),borderWidth:p.country==='PER'?2:1}})),markLine:{silent:true,symbol:'none',lineStyle:{color:css('--muted'),type:'dashed',opacity:.35},label:{show:false},data:[{xAxis:centerX},{yAxis:centerY}]}}];
    opts.graphic=[{type:'text',right:15,top:8,style:{text:'Líneas: medianas de los países con ambos datos',fill:css('--muted'),font:'10px Manrope'}}];
    chart('lab-development-chart',opts);
  }

  function mountExplorer() {
    q('#explorer-lab')?.remove();q('#explorer-evidence')?.remove();
    const main=q('.explorer-main');if(!main)return;
    main.insertAdjacentHTML('afterbegin',`<section id="explorer-lab" class="explorer-lab panel" aria-label="Guardar análisis y elegir periodo"><div class="lab-section-heading"><div><span class="lab-eyebrow">TU ESPACIO DE TRABAJO</span><h2>Conserva una comparación</h2></div><small>Guardada solo en este navegador</small></div><div class="lab-save-row"><label class="lab-save-name">Nombre<input id="lab-save-name" maxlength="60" placeholder="Ej. Inflación y política monetaria"></label><button id="lab-save">Guardar selección</button><label class="lab-saved-select">Mis comparaciones<select id="lab-saved"><option value="">${saved.length?'Elegir comparación ('+saved.length+')':'Aún no hay comparaciones'}</option>${saved.map(x=>`<option value="${esc(x.id)}" ${x.id===chosenSaved?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><button id="lab-delete" ${chosenSaved?'':'disabled'} aria-label="Eliminar la comparación guardada seleccionada">Eliminar</button></div><div class="lab-date-row"><label>Desde<input type="date" id="lab-start" value="${start}"></label><label>Hasta<input type="date" id="lab-end" value="${end}"></label><button id="lab-window">Aplicar fechas</button><button id="lab-window-clear">Quitar fechas</button><span id="lab-window-note" role="status">${start||end?'Ventana propia activa. ':''}Las fechas se combinan con el horizonte superior.</span></div></section>`);
    q('#explore-stats')?.insertAdjacentHTML('afterend','<div id="explorer-evidence" class="explorer-evidence"></div>');
    q('#lab-save').onclick=()=>{
      const state=ctx.getExplorer(),name=q('#lab-save-name').value.trim();
      if(!name){q('#lab-save-name').focus();toast('Escribe un nombre para esta comparación.');return}
      if(!state.selected?.length){toast('Selecciona al menos una serie.');return}
      const id='lab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
      const entry=sanitizeSavedComparisons([{...state,id,name,start,end}])[0];
      const next=[entry,...saved].slice(0,12);
      if(!persist('macro:saved-comparisons',next)){toast('El navegador no permite guardar esta comparación.');return}
      saved=next;chosenSaved=id;ctx.rerender();toast('Comparación guardada en este navegador.');
    };
    q('#lab-saved').onchange=e=>{
      chosenSaved=e.target.value;const entry=saved.find(x=>x.id===chosenSaved);if(!entry)return;
      const available=entry.selected.filter(id=>series().some(s=>s.id===id));
      if(!available.length){toast('Las series guardadas no están en esta publicación.');return}
      start=entry.start;end=entry.end;persist('macro:lab-window',{start,end});
      ctx.setExplorer({...entry,selected:available});ctx.rerender();
      if(available.length!==entry.selected.length)toast('Se restauraron las series disponibles; algunas ya no están en el catálogo.');
    };
    q('#lab-delete').onclick=()=>{
      const next=saved.filter(x=>x.id!==chosenSaved);
      if(!persist('macro:saved-comparisons',next)){toast('El navegador no permite modificar las comparaciones guardadas.');return}
      saved=next;chosenSaved='';ctx.rerender();toast('Comparación eliminada de este navegador.');
    };
    q('#lab-window').onclick=()=>{
      const a=q('#lab-start').value,b=q('#lab-end').value;
      if((a&&!validDate(a))||(b&&!validDate(b))||(a&&b&&a>b)){q('#lab-window-note').textContent='La fecha inicial debe ser anterior o igual a la final.';return}
      start=a;end=b;persist('macro:lab-window',{start,end});ctx.rerender();
    };
    q('#lab-window-clear').onclick=()=>{start='';end='';persist('macro:lab-window',{start,end});ctx.rerender()};
    const rows=chartRows.get('explore-chart')?.rows;
    if(rows)updateExplorerEvidence(rows,ctx.getExplorer().mode);
  }

  function commonBaseDate(ss,range) {
    return commonDates(ss,range).filter(d=>(!start||d>=start)&&(!end||d<=end))[0];
  }

  function clearExplorerEvidence(){const el=q('#explorer-evidence');if(el)el.innerHTML=''}

  function updateExplorerEvidence(groups,mode='level') {
    const el=q('#explorer-evidence');if(!el)return;
    const valid=groups.filter(g=>g.s&&g.rows.some(o=>finite(o.value)));
    if(valid.length<2){el.innerHTML='';return}
    const matrix=pairwiseEvidence(valid);
    el.innerHTML=`<section class="lab-correlation panel"><div class="lab-section-heading"><div><span class="lab-eyebrow">RELACIONES EN LA SELECCIÓN</span><h2>Cómo se mueven juntas</h2><p>Correlación de Pearson, solo en fechas coincidentes. Pulsa un par para ver su dispersión.</p></div></div><div class="lab-series-key">${valid.map((g,i)=>`<span><b>${i+1}</b>${esc(safeName(g.s))}</span>`).join('')}</div><div class="lab-correlation-grid" style="--lab-count:${valid.length}" role="table" aria-label="Matriz de correlaciones"><div role="row" class="lab-correlation-row"><span role="columnheader">Serie</span>${valid.map((g,i)=>`<span role="columnheader" title="${esc(safeName(g.s))}">${i+1}</span>`).join('')}</div>${matrix.map((row,i)=>`<div role="row" class="lab-correlation-row"><span role="rowheader" title="${esc(safeName(valid[i].s))}">${i+1}</span>${row.map(cell=>{
      const style=finite(cell.r)?`background:color-mix(in srgb, ${cell.r<0?'var(--cyan)':'var(--navy)'} ${Math.round(Math.abs(cell.r)*21)}%, var(--panel))`:'';
      const desc=`${safeName(valid[i].s)} / ${safeName(valid[cell.j].s)}. ${finite(cell.r)?'Correlación '+fmt(cell.r):cell.reason}. ${cell.n} pares${cell.first?', '+cell.first+' a '+cell.last:''}.`;
      return `<span role="cell"><button data-lab-pair="${i},${cell.j}" ${i===cell.j||cell.n<3?'disabled':''} style="${style}" title="${esc(desc)}" aria-label="${esc(desc)}"><strong>${finite(cell.r)?fmt(cell.r):'—'}</strong><small>${cell.n} pares</small></button></span>`;
    }).join('')}</div>`).join('')}</div><p class="lab-method">Se requieren al menos 12 pares y varianza distinta de cero. Cada celda puede tener una cobertura diferente; el detalle aparece al señalarla. ${mode==='level'||mode==='index'?'En niveles, una tendencia compartida puede generar correlaciones elevadas. ':''}Asociación no implica causalidad.</p></section>`;
    el.querySelectorAll('[data-lab-pair]').forEach(button=>button.onclick=()=>{
      const [i,j]=button.dataset.labPair.split(',').map(Number);
      const pair=matrix[i][j];
      if(pair.first&&pair.last){start=pair.first;end=pair.last;persist('macro:lab-window',{start,end})}
      ctx.setExplorer({...ctx.getExplorer(),selected:[valid[i].s.id,valid[j].s.id],chartType:'scatter'});ctx.rerender();
    });
  }

  return {mountLatam,mountExplorer,commonBaseDate,filterWindow:groups=>restrictWindow(groups,start,end),updateExplorerEvidence,clearExplorerEvidence};
}
