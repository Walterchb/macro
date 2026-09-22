/** Evidence-led economic monitor. Rules describe observations; they are not forecasts. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const DAY = 86400000;
const MAX_AGE = {daily:10,weekly:28,monthly:100,quarterly:180,annual:730};
const fallbackEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validRows = s => (s?.observations || []).filter(o => finite(o.value) && /^\d{4}-\d{2}-\d{2}$/.test(o.date)).slice().sort((a,b)=>a.date.localeCompare(b.date));
function shiftedMonth(iso, amount) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth()+amount);
  return dt.toISOString().slice(0,10);
}

/** Age is measured from the END of the reference period, not its first-day storage key. */
export function monitorFreshness(series, observation, now = new Date()) {
  const today = new Date(now);
  if(!observation || !finite(observation.value) || !Number.isFinite(today.getTime())) return {state:'missing',ageDays:null,limitDays:MAX_AGE[series?.frequency] ?? 100};
  const dt = new Date(`${observation.date}T00:00:00Z`);
  const freq = series?.frequency;
  if(!Number.isFinite(dt.getTime()) || dt.getTime()>today.getTime()) return {state:'missing',ageDays:null,limitDays:MAX_AGE[freq] ?? 100};
  if(freq==='monthly') dt.setUTCMonth(dt.getUTCMonth()+1,0);
  else if(freq==='quarterly') dt.setUTCMonth(dt.getUTCMonth()+3,0);
  else if(freq==='annual') { dt.setUTCMonth(11,31); }
  const ageDays=Math.max(0,Math.floor((today-dt)/DAY));
  const limitDays=MAX_AGE[freq] ?? 100;
  return {state:ageDays>limitDays?'stale':series?.status==='retained'?'retained':'fresh',ageDays,limitDays};
}

/** Exact-period transformations: a missing comparison month is never replaced by a nearby row. */
export function monitorTransform(series, kind='level') {
  const rows=validRows(series), lookup=new Map(rows.map(o=>[o.date,o.value]));
  if(kind==='level') return rows;
  const frequency=series?.frequency;
  if(!['monthly','quarterly','annual'].includes(frequency)) return [];
  const stride=frequency==='quarterly'?3:frequency==='annual'?12:1;
  return rows.flatMap(o=>{
    let value=null;
    if(kind==='mean3diff' && frequency==='monthly') {
      // Mean of three monthly changes equals (level[t] - level[t-3]) / 3,
      // but all four monthly levels must exist to support the interpretation.
      const prior=[1,2,3].map(k=>lookup.get(shiftedMonth(o.date,-k)));
      if(prior.every(finite)) value=(o.value-prior[2])/3;
    } else {
      const lag=kind==='yoy'?12:kind==='change3'?3:stride;
      const previous=lookup.get(shiftedMonth(o.date,-lag));
      if(finite(previous)) {
        if(kind==='diff'||kind==='change3') value=o.value-previous;
        else if(kind==='yoy' && previous!==0) value=(o.value/previous-1)*100;
        else if(kind==='annualized' && frequency==='quarterly' && previous>0 && o.value>0) value=((o.value/previous)**4-1)*100;
      }
    }
    return finite(value)?[{date:o.date,value}]:[];
  });
}

export function classifySignal(value, rule) {
  if(!finite(value)) return {tone:'muted',label:'Sin dato',position:-1};
  if(rule==='inflation-pe') return value<1?{tone:'watch',label:'Bajo el rango',position:0}:value<=3?{tone:'good',label:'Dentro del rango',position:1}:{tone:'watch',label:'Sobre el rango',position:2};
  if(rule==='inflation-us') return value<2?{tone:'watch',label:'Por debajo de 2%',position:0}:value===2?{tone:'good',label:'En 2%',position:1}:{tone:'watch',label:'Por encima de 2%',position:2};
  if(rule==='nfci') return value<0?{tone:'good',label:'Más holgadas',position:0}:value===0?{tone:'neutral',label:'En el promedio',position:1}:{tone:'watch',label:'Más restrictivas',position:2};
  if(rule==='sahm') return value>=.5?{tone:'risk',label:'Umbral activado',position:2}:{tone:'neutral',label:'Bajo el umbral',position:0};
  if(rule==='cfnai') return value<-.7?{tone:'risk',label:'Umbral activado',position:0}:{tone:'neutral',label:'Sobre el umbral',position:2};
  if(rule==='confidence') return value<50?{tone:'watch',label:'Menos favorables',position:0}:value===50?{tone:'neutral',label:'Neutral',position:1}:{tone:'good',label:'Más favorables',position:2};
  return value<0?{tone:'watch',label:'Contracción',position:0}:value===0?{tone:'neutral',label:'Sin variación',position:1}:{tone:'good',label:'Expansión',position:2};
}

export function createEconomicMonitor(ctx={}) {
  const esc=ctx.esc || fallbackEscape;
  const fmt=ctx.fmt || ((v,n=1)=>Number(v).toLocaleString('es-PE',{maximumFractionDigits:n,minimumFractionDigits:n}));
  const date=ctx.date || ((d,f)=>new Date(`${d}T00:00:00Z`).toLocaleDateString('es-PE',{timeZone:'UTC',month:'short',year:'numeric',...(['daily','weekly'].includes(f)?{day:'numeric'}:{})}));
  const now=()=>typeof ctx.now==='function'?ctx.now():new Date();
  const getSeries=()=>typeof ctx.getSeries==='function'?ctx.getSeries():ctx.series || [];

  function build(scope) {
    const ss=getSeries(), byCode=new Map(ss.map(s=>[`${s.provider}:${s.sourceCode}`,s]));
    const b=code=>byCode.get(`BCRP:${code}`), f=code=>byCode.get(`FRED:${code}`);
    const metric=(s,label,unit,kind='level',digits=1,rule=null)=>{
      const history=monitorTransform(s,kind),point=history.at(-1),freshness=monitorFreshness(s,point,now());
      return {series:s,id:s?.id,label,unit:unit ?? s?.unit ?? '',kind,digits,history,value:point?.value,date:point?.date,freshness,rule};
    };
    const usable=m=>finite(m?.value)&&m.freshness.state!=='stale'&&m.freshness.state!=='missing';
    const value=(m,signed=false)=>finite(m?.value)?`${signed&&m.value>0?'+':''}${fmt(m.value,m.digits)}${m.unit?' '+m.unit:''}`:'sin dato';
    const signLabels=['Contracción','Sin cambio','Expansión'];
    function card(config) {
      const primary=config.primary;
      let state=config.state || classifySignal(primary?.value,config.rule || 'growth');
      if(primary?.freshness.state==='stale') state={tone:'muted',label:'Dato antiguo',position:-1};
      else if((primary?.freshness.state==='missing'||!finite(primary?.value)) && !config.customHeadline) state={tone:'muted',label:'Sin dato reciente',position:-1};
      return {...config,state,scale:config.scale || signLabels};
    }
    if(scope==='peru') {
      const gdp=metric(b('PN01728AM'),'PBI real','% ia','level',1,'growth');
      const impulse=metric(b('PN01731AM'),'Impulso mensual','% m/m','level',1,'growth');
      const confidence=metric(b('PD38045AM'),'Economía a 3 meses','pts','level',1,'confidence');
      const prices=metric(b('PN01273PM'),'Inflación general','% ia','level',2,'inflation-pe');
      const core=metric(b('PN01277PM'),'Sin alimentos y energía','% ia','level',2);
      const food=metric(b('PN09822PM'),'Alimentos y bebidas','% ia','level',2);
      const jobs=metric(b('PN31880GM'),'Empleo formal total','% ia','level',1,'growth');
      const privateJobs=metric(b('PN31882GM'),'Empleo formal privado','% ia','level',1,'growth');
      const income=metric(b('PN37697PM'),'Ingreso real formal privado','% ia','yoy',1,'growth');
      const unemployment=metric(b('PN38063GM'),'Desempleo en Lima','%','level',1);
      const credit=metric(b('PN00539MM'),'Crédito total','% ia','level',1,'growth');
      const business=metric(b('PN00536MM'),'Crédito a empresas','% ia','level',1,'growth');
      const mortgage=metric(b('PN07848NM'),'Tasa hipotecaria en soles','% TEA','level',1);
      const reference=metric(b('PD04722MM'),'Referencia BCRP','%','level',2);
      const trade=metric(b('PN38723BM'),'Balanza de bienes','M US$','level',0);
      const exports=metric(b('PN38714BM'),'Exportaciones FOB','% ia','yoy',1,'growth');
      const reserves=metric(b('PN00027MM'),'Reservas netas','M US$','level',0);
      const terms=metric(b('PN38923BM'),'Términos de intercambio','% ia','yoy',1,'growth');
      const tradeState=classifySignal(trade.value,'growth');
      if(finite(trade.value)) tradeState.label=trade.value>0?'Superávit':trade.value<0?'Déficit':'Equilibrio';
      return [
        card({key:'growth',title:'Actividad',primary:gdp,heroLabel:'PBI real · variación interanual',evidence:[impulse,confidence],
          summary:usable(gdp)?`La producción ${gdp.value>0?'crece':gdp.value<0?'retrocede':'no varía'} frente al mismo mes del año anterior. El impulso mensual y la confianza completan la lectura.`:'La última lectura disponible se muestra con su fecha. Falta un dato reciente para describir el ciclo actual.',
          methodology:'La etiqueta sigue el signo del PBI interanual: negativo, cero o positivo. El PBI mensual está desestacionalizado. Las expectativas a 3 meses son un índice de difusión; 50 separa expectativas favorables y desfavorables. No se suman indicadores ni se estima el PBI futuro.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN01728AM/html'}),
        card({key:'prices',title:'Precios',primary:prices,rule:'inflation-pe',heroLabel:'Lima Metropolitana · inflación anual',evidence:[core,food],scale:['Menos de 1%','Rango 1–3%','Más de 3%'],
          summary:usable(prices)?`La inflación general está ${prices.value<1?'por debajo':prices.value>3?'por encima':'dentro'} del rango meta del BCRP. El indicador sin alimentos y energía ayuda a observar presiones persistentes.`:'No hay una lectura reciente para contrastar la inflación con el rango meta.',
          methodology:'La banda de 1%–3% corresponde a la meta de inflación general del BCRP. Los extremos 1% y 3% se incluyen en el rango. La banda no es una meta independiente para alimentos ni para la serie sin alimentos y energía. La cobertura de estas series es Lima Metropolitana.',source:'https://www.bcrp.gob.pe/politica-monetaria.html'}),
        card({key:'jobs',title:'Trabajo e ingresos',primary:jobs,heroLabel:'Empleo formal nacional · variación anual',evidence:[privateJobs,income,unemployment],
          summary:usable(jobs)?`El empleo formal ${jobs.value>0?'aumenta':jobs.value<0?'disminuye':'no cambia'} ${value(jobs)}. El ingreso real mide poder de compra; el desempleo mostrado corresponde a Lima.`:'La lectura del empleo formal requiere una observación reciente. Las fechas distinguen las coberturas disponibles.',
          methodology:'La etiqueta usa el crecimiento interanual del empleo formal nacional, no el empleo total del país. Ingreso real: (nivel del mes / nivel del mismo mes del año anterior − 1) × 100. El desempleo de Lima es una ventana móvil de 3 meses y no una tasa nacional.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN31880GM/html'}),
        card({key:'credit',title:'Crédito y tasas',primary:credit,heroLabel:'Crédito al sector privado · variación anual',evidence:[business,reference,mortgage],
          summary:usable(credit)?`El saldo de crédito ${credit.value>0?'se expande':credit.value<0?'se contrae':'permanece estable'} frente a un año antes. Las tasas muestran el precio del financiamiento, con sus propias fechas.`:'Sin un dato reciente de crédito no se asigna una lectura de expansión o contracción.',
          methodology:'La etiqueta describe únicamente el signo del crecimiento del saldo crediticio. Expandirse no implica por sí solo menor riesgo o mayor bienestar. La tasa hipotecaria es un promedio bancario en soles, expresado como TEA; no es la TCEA ni una oferta personalizada.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN00539MM/html'}),
        card({key:'external',title:'Sector externo',primary:trade,state:tradeState,heroLabel:'Saldo comercial de bienes · mes',evidence:[exports,reserves,terms],scale:['Déficit','Equilibrio','Superávit'],
          summary:usable(trade)?`Las exportaciones ${trade.value>0?'superan':trade.value<0?'son menores que':'igualan'} las importaciones de bienes. Reservas y precios de intercambio aportan contexto; no son componentes de ese saldo.`:'El saldo comercial se presenta como dato histórico hasta contar con una observación reciente.',
          methodology:'La etiqueta usa el signo de exportaciones FOB menos importaciones FOB del mes. No equivale a la cuenta corriente y no incluye servicios ni rentas. La variación de exportaciones y términos de intercambio exige el mismo mes del año anterior. Las reservas son un saldo.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN38723BM/html'})
      ];
    }
    const gdp=metric(f('GDPC1'),'PBI real trimestral','% anualiz.','annualized',1,'growth');
    const production=metric(f('INDPRO'),'Producción industrial','% ia','yoy',1,'growth');
    const consumption=metric(f('PCEC96'),'Consumo personal real','% ia','yoy',1,'growth');
    const pce=metric(f('PCEPI'),'Inflación PCE general','% ia','yoy',2,'inflation-us');
    const core=metric(f('PCEPILFE'),'PCE subyacente','% ia','yoy',2);
    const cpi=metric(f('CPIAUCSL'),'IPC general','% ia','yoy',2);
    const payroll=metric(f('PAYEMS'),'Nóminas · media de 3 meses','mil / mes','mean3diff',0,'growth');
    const unemployment=metric(f('UNRATE'),'Desempleo nacional','%','level',1);
    const jobsChange=metric(f('PAYEMS'),'Nóminas · último mes','mil','diff',0,'growth');
    const claims=metric(f('ICSA'),'Peticiones iniciales','personas','level',0);
    const nfci=metric(f('NFCI'),'Condiciones financieras NFCI','índice','level',2,'nfci');
    const vix=metric(f('VIXCLS'),'Volatilidad VIX','pts','level',1);
    const highYield=metric(f('BAMLH0A0HYM2'),'Diferencial high yield','pp','level',2);
    const sahm=metric(f('SAHMREALTIME'),'Sahm · umbral ≥ 0,50','pp','level',2,'sahm');
    const cfnai=metric(f('CFNAIMA3'),'CFNAI 3m · umbral < −0,70','índice','level',2,'cfnai');
    const curve=metric(f('T10Y3M') || f('T10Y2Y'),f('T10Y3M')?'Curva 10 años − 3 meses':'Curva 10 años − 2 años','pp','level',2);
    const available=[sahm,cfnai].filter(usable),count=available.filter(m=>classifySignal(m.value,m.rule).tone==='risk').length;
    const cycleState=available.length<2?{tone:'muted',label:'Cobertura parcial',position:-1}:count===0?{tone:'neutral',label:'Sin umbrales activos',position:0}:count===1?{tone:'watch',label:'Una señal activa',position:1}:{tone:'risk',label:'Dos señales activas',position:2};
    return [
      card({key:'growth',title:'Actividad',primary:gdp,heroLabel:'PBI real · trimestre anualizado',evidence:[production,consumption],
        summary:usable(gdp)?`La economía ${gdp.value>0?'crece':gdp.value<0?'se contrae':'no varía'} respecto del trimestre previo. Producción y consumo ofrecen una lectura mensual más reciente.`:'El crecimiento trimestral se conserva con su fecha; falta un dato reciente para calificar el ciclo actual.',
        methodology:'PBI: ((nivel trimestral / nivel del trimestre anterior)^4 − 1) × 100. Es una tasa trimestral anualizada, no interanual. Producción y consumo: variación respecto del mismo mes del año anterior. La etiqueta sigue el signo del PBI trimestral anualizado.',source:'https://fred.stlouisfed.org/series/GDPC1'}),
      card({key:'prices',title:'Inflación',primary:pce,rule:'inflation-us',heroLabel:'PCE general · variación interanual',evidence:[core,cpi],scale:['Menos de 2%','2%','Más de 2%'],
        summary:usable(pce)?`La lectura PCE ${pce.value>2?'supera':pce.value<2?'está por debajo de':'coincide con'} el 2% de referencia de largo plazo de la Fed. El IPC tiene una canasta y ponderaciones distintas.`:'Se requiere un PCE reciente y su nivel de hace 12 meses para contrastar la inflación con el 2%.',
        methodology:'La Fed define su objetivo de largo plazo sobre la variación anual del PCE general, no sobre el IPC ni sobre el PCE subyacente. Variación: (índice / índice del mismo mes del año anterior − 1) × 100. El umbral se evalúa antes de redondear y no constituye una banda de tolerancia.',source:'https://www.federalreserve.gov/faqs/economy_14400.htm'}),
      card({key:'jobs',title:'Empleo',primary:payroll,heroLabel:'Creación media de empleo · últimos 3 meses',evidence:[jobsChange,unemployment,claims],
        summary:usable(payroll)?`Las nóminas ${payroll.value>0?'añaden':payroll.value<0?'pierden':'no añaden'} empleo neto en promedio. Las peticiones de subsidio son semanales y no equivalen al total de desempleados.`:'El promedio necesita cuatro niveles mensuales consecutivos; no se reemplazan los meses ausentes.',
        methodology:'Promedio de las tres últimas variaciones mensuales de PAYEMS: (nivel actual − nivel de hace 3 meses) / 3. Se exigen los cuatro niveles mensuales consecutivos. La etiqueta usa el signo de ese promedio. Nóminas en miles de puestos; peticiones iniciales en personas.',source:'https://fred.stlouisfed.org/series/PAYEMS'}),
      card({key:'finance',title:'Condiciones financieras',primary:nfci,rule:'nfci',heroLabel:'NFCI · frente al promedio histórico',evidence:[vix,highYield],scale:['Más holgadas','Promedio','Más restrictivas'],
        summary:usable(nfci)?`Las condiciones son ${nfci.value<0?'más holgadas que':nfci.value>0?'más restrictivas que':'similares a'} su promedio histórico según Chicago Fed. VIX y crédito describen dimensiones distintas del riesgo.`:'La etiqueta se mantiene neutral mientras no haya un NFCI reciente.',
        methodology:'NFCI menor que cero: condiciones más holgadas que su promedio histórico; mayor que cero: más restrictivas. Es un índice semanal, no una tasa ni una probabilidad. VIX y diferencial high yield se muestran sin umbrales inventados; 1 pp de spread equivale a 100 puntos básicos.',source:'https://www.chicagofed.org/research/data/nfci/about'}),
      card({key:'cycle',title:'Señales del ciclo',primary:null,customHeadline:`${count} / ${available.length}`,customHeroLabel:'umbrales activos · indicadores disponibles',state:cycleState,evidence:[sahm,cfnai,curve],scale:['Ninguno','Uno','Dos'],
        summary:available.length===2?`Se contrastan dos reglas publicadas de empleo y actividad. La curva aporta contexto adelantado; este recuento no estima la probabilidad de una recesión.`:'La cobertura es incompleta o antigua. El recuento usa solamente indicadores recientes y no permite descartar riesgos.',
        methodology:'Sahm en tiempo real: umbral ≥ 0,50 pp según la serie publicada por FRED. CFNAI-MA3: después de una expansión, un valor inferior a −0,70 se ha asociado históricamente con mayor probabilidad de recesión. Se cuentan reglas activadas, sin ponderar ni asignar probabilidades. Una pendiente negativa de la curva se muestra aparte y no entra en el recuento. No sustituye la datación de recesiones del NBER.',source:'https://fred.stlouisfed.org/series/SAHMREALTIME',extraSource:'https://www.chicagofed.org/research/data/cfnai/current-data'})
    ];
  }

  function formatMetric(m) { return finite(m?.value)?`${fmt(m.value,m.digits)}${m.unit?' '+m.unit:''}`:'Sin dato'; }
  function freshnessLabel(m) {
    if(m.freshness.state==='stale') return ` · dato antiguo (${m.freshness.ageDays} días desde el fin del periodo)`;
    if(m.freshness.state==='retained') return ' · última descarga válida';
    return '';
  }
  function evidenceHTML(m) {
    let tone=m.rule?classifySignal(m.value,m.rule).tone:'neutral';
    if(['missing','stale'].includes(m.freshness.state)) tone='muted';
    const body=`<span class="pulse-evidence-label"><i class="pulse-dot ${tone}" aria-hidden="true"></i>${esc(m.label)}</span><strong>${esc(formatMetric(m))}</strong><span class="pulse-evidence-date">${m.date?esc(date(m.date,m.series?.frequency)):'Sin observaciones'}${esc(freshnessLabel(m))}</span>`;
    return m.id?`<button type="button" class="pulse-evidence" data-detail="${esc(m.id)}" title="Ver definición, historia y fuente: ${esc(m.label)}">${body}<span class="pulse-evidence-arrow" aria-hidden="true">↗</span></button>`:`<div class="pulse-evidence pulse-evidence-missing">${body}</div>`;
  }
  function sparkHTML(m) {
    if(!m?.history?.length) return '';
    const rows=m.history.slice(-18);if(rows.length<3)return '';
    const lo=Math.min(...rows.map(o=>o.value)),hi=Math.max(...rows.map(o=>o.value)),span=hi-lo || 1;
    const path=rows.map((o,i)=>`${i?'L':'M'}${(i/(rows.length-1)*94+3).toFixed(2)},${(25-(o.value-lo)/span*21).toFixed(2)}`).join(' ');
    const lastY=25-(rows.at(-1).value-lo)/span*21;
    return `<div class="pulse-spark" title="Trayectoria de las ${rows.length} últimas observaciones · escala propia"><svg viewBox="0 0 100 29" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round" stroke-linecap="round"/><circle cx="97" cy="${lastY.toFixed(2)}" r="2.4" fill="currentColor"/></svg><small>${rows.length} observaciones · escala propia</small></div>`;
  }
  function renderCard(c) {
    const primary=c.primary, state=c.state;
    const primaryDate=primary?.date?`${date(primary.date,primary.series?.frequency)}${freshnessLabel(primary)}`:'';
    const methodSources=`<a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">Consultar fuente</a>${c.extraSource?` · <a href="${esc(c.extraSource)}" target="_blank" rel="noopener noreferrer">Regla CFNAI</a>`:''}`;
    const primaryValue=`<strong>${esc(c.customHeadline ?? formatMetric(primary))}</strong>`;
    const primaryHTML=primary?.id?`<button class="pulse-primary-value" type="button" data-detail="${esc(primary.id)}" title="Ver definición, historia y fuente: ${esc(primary.label)}">${primaryValue}</button>`:primaryValue;
    return `<article class="pulse-card pulse-${state.tone}"><div class="pulse-card-top"><h3>${esc(c.title)}</h3><span class="pulse-status">${esc(state.label)}</span></div><div class="pulse-headline"><div>${primaryHTML}<span>${esc(c.customHeroLabel || c.heroLabel)}</span></div>${sparkHTML(primary)}</div>${primaryDate?`<p class="pulse-primary-date">${esc(primaryDate)}${primary?.series?.provider?` · ${esc(primary.series.provider)}`:''}</p>`:'<p class="pulse-primary-date">EE. UU. · reglas de empleo y actividad</p>'}<div class="pulse-scale" role="img" aria-label="${esc(c.scale.join(' · '))}. ${esc(state.label)}">${c.scale.map((label,i)=>`<span class="${i===state.position?'is-active':''}"><i></i><small>${esc(label)}</small></span>`).join('')}</div><p class="pulse-reading">${esc(c.summary)}</p><div class="pulse-evidence-list">${c.evidence.map(evidenceHTML).join('')}</div><details class="pulse-method"><summary>Cómo se interpreta</summary><p>${esc(c.methodology)}</p><p>${methodSources}</p></details></article>`;
  }
  function render(scope='peru') {
    const world=scope==='world',cards=build(world?'world':'peru');
    return `<section class="economic-pulse" aria-labelledby="pulse-title-${world?'world':'peru'}"><div class="pulse-section-head"><div><span class="pulse-eyebrow">Lectura en un minuto</span><h2 id="pulse-title-${world?'world':'peru'}">${world?'Pulso de EE. UU. · transmisión global':'Pulso económico del Perú'}</h2><p>${world?'Cinco lecturas de Estados Unidos, por su peso en el ciclo y los mercados globales. Los gráficos siguientes amplían la mirada al mundo.':'Cinco lecturas complementarias, con el dato, la fecha y la regla a la vista.'}</p></div><span class="pulse-rules-note">Señales descriptivas<br>sin puntaje agregado</span></div><div class="pulse-grid">${cards.map(renderCard).join('')}</div><details class="pulse-freshness"><summary>Fechas, cobertura y actualización</summary><p>Las tarjetas se recalculan con cada publicación del repositorio. Cada indicador conserva su periodo de referencia; las frecuencias y fechas pueden diferir. Un dato se atenúa al superar, desde el fin de su periodo, 10 días para series diarias, 28 para semanales, 100 para mensuales, 180 para trimestrales o 730 para anuales. Son reglas de vigencia de esta herramienta, no calendarios oficiales. Una descarga fallida conserva y señala la última observación válida. «ia» significa interanual; «pp», puntos porcentuales. Las etiquetas resumen reglas visibles y no constituyen un pronóstico ni una evaluación oficial.</p></details></section>`;
  }
  return {render,build};
}
