import {monthlyRollingMeanRows,weeklyRollingMeanRows,monthlyAnnualizedRows,spreadRows} from './chart-engine.js';

/** Thematic economic views. All values come from the current validated snapshot. */
export const peruTopics = [
  ['actividad','Actividad y sectores'], ['produccion','Minería y energía'], ['hogares','Precios e ingresos'],
  ['trabajo','Trabajo y crédito'], ['fiscal','Finanzas públicas'],
  ['externo','Comercio exterior'], ['pagos','Balanza de pagos'], ['mercado','Tasas y moneda'], ['desarrollo','Desarrollo y bienestar']
];
export const worldTopics = [
  ['actividad','Actividad global'], ['precios','Inflación y política'],
  ['empleo','Empleo de EE. UU.'], ['riesgo','Riesgo financiero'],
  ['liquidez','Tasas y liquidez'], ['materias','Materias primas']
];

export function createEconomicViews(ctx) {
  const {$,esc,fmt,date,b,f,wb,last,panel,timeChart,chart,baseOption,chartRows,
    colors,css,theme,derived,cut,commonDates} = ctx;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const present = s => s && s.observations?.some(o => finite(o.value));
  const clean = ss => ss.filter(present);
  const range = () => typeof ctx.range === 'function' ? ctx.range() : ctx.range || '5';
  const y = (s,name) => present(s) ? derived(s,'yoy',name || `${s.name} · YOY`,'% YOY') : null;
  const d = (s,name) => present(s) ? derived(s,'diff',name || `${s.name} · Δ MOM`,s.unit) : null;
  const pe = code => wb('PER',code);
  const seriesCodes = codes => codes.map(b);
  const fredCodes = codes => codes.map(f);
  const sectors = [
    ['PN01713AM','Agropecuario'],['PN01716AM','Pesca'],['PN01717AM','Minería e hidrocarburos'],
    ['PN01720AM','Manufactura'],['PN01723AM','Electricidad y agua'],['PN01724AM','Construcción'],
    ['PN01725AM','Comercio'],['PN01726AM','Otros servicios']
  ];
  function rolling12(s,name) {
    if (!present(s) || s.frequency !== 'monthly') return null;
    const values = new Map(s.observations.map(o => [o.date,o.value]));
    const observations = s.observations.map(o => {
      const dt = new Date(o.date+'T00:00:00Z'); let total=0;
      for(let k=0;k<12;k++) {
        const value=values.get(dt.toISOString().slice(0,10));
        if(!finite(value)) return {date:o.date,value:null};
        total+=value; dt.setUTCMonth(dt.getUTCMonth()-1);
      }
      return {date:o.date,value:total};
    });
    return {...s,name,derived:'sum12',observations,
      description:`${s.description || s.name}. Cálculo: suma de 12 meses consecutivos; exige los 12 valores.`};
  }
  function convert(s,divisor,name,unit) {
    return present(s) ? {...s,name,unit,derived:'scaled',
      description:`${s.description || s.name}. Escala: valor original / ${divisor}.`,
      observations:s.observations.map(o=>({...o,value:finite(o.value)?o.value/divisor:null}))} : null;
  }
  function average(s,months,name) {
    return present(s)&&s.frequency==='monthly'?{...s,name,derived:`mean${months}`,
      description:`${s.description||s.name}. Cálculo: media de ${months} meses consecutivos; no se completan meses ausentes.`,
      observations:monthlyRollingMeanRows(s.observations,months)}:null;
  }
  function weeklyAverage(s,weeks,name) {
    return present(s)&&s.frequency==='weekly'?{...s,name,derived:`weeklyMean${weeks}`,
      description:`${s.description||s.name}. Media de ${weeks} semanas consecutivas; requiere cada observación semanal.`,
      observations:weeklyRollingMeanRows(s.observations,weeks)}:null;
  }
  function annualized(s,months,name) {
    return present(s)&&s.frequency==='monthly'?{...s,name,unit:months===12?'% YOY':'% SAAR',derived:`annualized${months}`,
      description:`${s.description||s.name}. Cálculo: ((índice t / índice t−${months})^(12/${months})−1)×100. Requiere una secuencia mensual completa. No es un pronóstico.`,
      observations:monthlyAnnualizedRows(s.observations,months)}:null;
  }
  function difference(a,bb,name,unit='Puntos porcentuales') {
    return present(a)&&present(bb)?{...a,id:`derived_${a.id}_${bb.id}`,name,unit,derived:'difference',
      description:`Cálculo propio: ${a.name} (${a.sourceCode}) menos ${bb.name} (${bb.sourceCode}), únicamente en fechas coincidentes. Segunda fuente: ${bb.sourceUrl}.`,
      observations:spreadRows(a.observations,bb.observations)}:null;
  }
  function ratio(a,bb,name,unit='Veces') {
    if(!present(a)||!present(bb))return null;
    const map=new Map(bb.observations.map(o=>[o.date,o.value]));
    return {...a,id:`derived_${a.id}_${bb.id}`,name,unit,derived:'ratio',
      description:`Cálculo propio: ${a.name} (${a.sourceCode}) / ${bb.name} (${bb.sourceCode}), en fechas coincidentes y con ambas series en la misma escala. Segunda fuente: ${bb.sourceUrl}.`,
      observations:a.observations.map(o=>({date:o.date,value:finite(o.value)&&finite(map.get(o.date))&&map.get(o.date)>0?o.value/map.get(o.date):null}))};
  }
  function times(id,title,subtitle,ss,options={},help='') {
    const names=options.names || [];
    const pairs=ss.map((s,i)=>({s,name:names[i],type:options.types?.[i]})).filter(x=>present(x.s));
    if(options.stacked&&pairs.length!==ss.length)return null;
    return {id,title,subtitle,ss:pairs.map(x=>x.s),help,
      draw:()=>timeChart(id,pairs.map(x=>x.s),{...options,names:pairs.map(x=>x.name||x.s.name),types:pairs.map(x=>x.type||'line')})};
  }
  function topic(title,description,specs) {
    const target=$('#economic-topic'); if(!target) return;
    const ready=specs.filter(s=>s&&clean(s.ss).length&&(!s.requireAll||s.ss.every(present)));
    const ss=[...new Map(ready.flatMap(s=>clean(s.ss)).map(s=>[s.id,s])).values()];
    const retained=ss.filter(s=>s.status==='retained').length;
    target.innerHTML=`<div class="economic-intro"><div><h2>${esc(title)}</h2></div><div class="economic-coverage">${retained?`<span>${retained} con última descarga válida</span>`:''}</div></div>`+
      (ready.length?`<div class="economic-grid">${ready.map(s=>panel(s.id,s.title,s.subtitle,clean(s.ss),{wide:s.wide,help:s.help,note:s.note})).join('')}</div>`:
      '<div class="reading">Esta publicación aún no contiene observaciones para este tema. Consulta Fuentes para ver la cobertura disponible.</div>');
    ready.forEach(s=>s.draw());
  }
  function rankingSectors() {
    const ss=clean(sectors.map(([code])=>b(code)));
    const period=commonDates(ss,'all').at(-1);
    if(!period)return null;
    const rows=ss.map(s=>({s,value:s.observations.find(o=>o.date===period)?.value,
      name:sectors.find(([code])=>code===s.sourceCode)?.[1] || s.name})).filter(x=>finite(x.value)).sort((a,b)=>a.value-b.value);
    const id='pe-sector-ranking';
    return {id,title:'Crecimiento por sector',subtitle:`${date(period)} · YOY (%) · mismo mes para todos`,ss,
      help:'Tasas de crecimiento, <strong>no contribuciones al PBI</strong>: un sector pequeño puede crecer mucho y aportar poco al agregado. El ranking usa el último mes con datos para todos los sectores incluidos.',
      draw(){
        const opt=baseOption(); delete opt.dataZoom; delete opt.legend;
        opt.grid={left:145,right:52,top:20,bottom:32};
        opt.tooltip={...opt.tooltip,trigger:'item',formatter:p=>`${esc(p.name)}<br>${date(period)}: <strong>${fmt(p.value)}%</strong>`};
        opt.xAxis={type:'value',axisLabel:{color:css('--muted'),fontSize:11,formatter:v=>`${v}%`},splitLine:{lineStyle:{color:css('--grid')}}};
        opt.yAxis={type:'category',data:rows.map(r=>r.name),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:css('--muted'),fontSize:11,width:132,overflow:'truncate'}};
        opt.series=[{type:'bar',barMaxWidth:24,data:rows.map(r=>({value:r.value,itemStyle:{color:r.value<0?colors[4]:colors[0],borderRadius:r.value<0?[3,0,0,3]:[0,3,3,0]}})),label:{show:true,position:'right',color:css('--ink'),fontSize:11,formatter:p=>fmt(p.value,1)},markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:css('--muted'),opacity:.5},data:[{xAxis:0}]}}];
        chartRows.get(id).rows=rows.map(r=>({s:r.s,rows:[{date:period,value:r.value}]})); chart(id,opt);
      }};
  }
  function sectorHeatmap() {
    const ss=clean(sectors.map(([code])=>b(code)));if(!ss.length)return null;
    const allDates=[...new Set(ss.flatMap(s=>s.observations.filter(o=>finite(o.value)).map(o=>o.date)))].sort();
    const months=allDates.slice(-36),cells=[];
    ss.forEach((s,i)=>{const m=new Map(s.observations.map(o=>[o.date,o.value]));months.forEach((date,j)=>{if(finite(m.get(date)))cells.push([j,i,m.get(date)]);});});
    const id='pe-sector-heatmap';
    return {id,title:'Ciclo sectorial',subtitle:'Últimos 36 meses publicados · PBI sectorial YOY (%)',ss,wide:true,
      help:'Cada celda es un sector y un mes. Rojo indica contracción y verde crecimiento. Los valores extremos saturan el color en ±15%; el tooltip conserva el valor exacto. <strong>Una celda vacía significa que falta el dato.</strong>',
      draw(){const opt=baseOption();delete opt.legend;delete opt.dataZoom;
        opt.grid={left:145,right:22,top:12,bottom:75};
        opt.tooltip={...opt.tooltip,trigger:'item',formatter:p=>`${esc(sectors.find(([c])=>c===ss[p.value[1]].sourceCode)?.[1]||ss[p.value[1]].name)} · ${date(months[p.value[0]])}<br><strong>${fmt(p.value[2])}%</strong>`};
        opt.xAxis={type:'category',data:months,axisLine:{show:false},axisTick:{show:false},axisLabel:{interval:2,rotate:0,color:css('--muted'),fontSize:11,formatter:v=>date(v).replace('.','')}};
        opt.yAxis={type:'category',data:ss.map(s=>sectors.find(([c])=>c===s.sourceCode)?.[1]||s.name),inverse:true,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:css('--muted'),fontSize:11,width:130,overflow:'truncate'}};
        opt.visualMap={min:-15,max:15,orient:'horizontal',left:'center',bottom:3,itemWidth:10,itemHeight:140,text:['≥ 15%','≤ −15%'],textStyle:{color:css('--muted'),fontSize:11},inRange:{color:['#bd4c53',theme()?'#172d3d':'#eef2f5','#078c8c']}};
        opt.series=[{type:'heatmap',data:cells,label:{show:false},emphasis:{itemStyle:{borderColor:css('--ink'),borderWidth:1}},itemStyle:{borderWidth:2,borderColor:css('--panel')}}];
        chartRows.get(id).rows=ss.map(s=>({s,rows:s.observations.filter(o=>months.includes(o.date))}));chart(id,opt);
      }};
  }
  function riskScatter() {
    const a=f('VIXCLS'),bb=f('BAMLH0A0HYM2');if(!present(a)||!present(bb))return null;
    const lookup=new Map(cut(bb,range()).map(o=>[o.date,o.value]));
    const rows=cut(a,range()).filter(o=>finite(o.value)&&finite(lookup.get(o.date))).map(o=>({date:o.date,x:o.value,y:lookup.get(o.date)}));
    if(rows.length<12)return null;
    const recent=rows.at(-1),recentRows=rows.slice(-60),median=values=>{const s=values.slice().sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
    const mx=median(rows.map(r=>r.x)),my=median(rows.map(r=>r.y));
    const id='world-risk-map';
    return {id,title:'Volatilidad frente a riesgo de crédito',subtitle:`VIX y spread HY · ${date(rows[0].date,'daily')}–${date(recent.date,'daily')} · ${rows.length.toLocaleString('es-PE')} días`,ss:[a,bb],
      note:'Gris: historia de la ventana · azul: últimos 60 días con ambos datos · círculo: último día común.',
      help:'Cada punto representa un día con ambos datos. Las guías son las medianas de la ventana mostrada; el punto destacado es el último día común. <strong>La asociación histórica no demuestra causalidad ni anticipa por sí sola una crisis.</strong>',
      draw(){const opt=baseOption();delete opt.legend;delete opt.dataZoom;
        opt.grid={left:67,right:28,top:24,bottom:50};
        opt.xAxis={type:'value',name:'VIX · puntos',nameLocation:'middle',nameGap:31,axisLabel:{color:css('--muted'),fontSize:11},nameTextStyle:{color:css('--muted'),fontSize:11},splitLine:{lineStyle:{color:css('--grid')}}};
        opt.yAxis={type:'value',name:'Spread HY · pp',nameTextStyle:{color:css('--muted'),fontSize:11},axisLabel:{color:css('--muted'),fontSize:11},splitLine:{lineStyle:{color:css('--grid')}}};
        opt.tooltip={...opt.tooltip,trigger:'item',formatter:p=>`${date(p.value[2],'daily')}<br>VIX: <strong>${fmt(p.value[0])}</strong><br>Spread HY: <strong>${fmt(p.value[1])} pp</strong>`};
        opt.series=[{type:'scatter',symbolSize:4,data:rows.map(r=>[r.x,r.y,r.date]),itemStyle:{color:css('--muted'),opacity:.19},markLine:{silent:true,symbol:'none',lineStyle:{type:'dashed',color:css('--muted'),opacity:.5},label:{show:false},data:[{xAxis:mx},{yAxis:my}]}},{type:'scatter',symbolSize:4.5,data:recentRows.map(r=>[r.x,r.y,r.date]),itemStyle:{color:theme()?'#71d2dd':css('--navy3'),opacity:.7}},{type:'scatter',symbolSize:12,data:[[recent.x,recent.y,recent.date]],itemStyle:{color:colors[0],borderWidth:2,borderColor:css('--panel')},label:{show:true,formatter:`Último · ${date(recent.date,'daily')}`,position:'top',fontSize:11,color:css('--ink')}}];
        chartRows.get(id).rows=[{s:a,rows:rows.map(r=>({date:r.date,value:r.x}))},{s:bb,rows:rows.map(r=>({date:r.date,value:r.y}))}];chart(id,opt);
      }};
  }
  function renderPeruTopic(name) {
    if(name==='actividad')return topic('Producción, sectores y expectativas','Distingue el crecimiento anual del impulso mensual y de las expectativas empresariales.',[
      rankingSectors(),sectorHeatmap(),
      times('pe-domestic-demand','Consumo e inversión privada','Perú · crecimiento real · YOY (%)',[y(b('PN02529AQ'),'Consumo privado real · YOY'),y(b('PN02533AQ'),'Inversión privada real · YOY')],{names:['Consumo privado','Inversión privada'],zero:true},'Cálculo sobre niveles a precios constantes de 2007: trimestre actual frente al mismo trimestre del año anterior. No es una tasa trimestral anualizada. Las series capturan componentes distintos de la demanda interna.'),
      times('pe-short-cycle','Impulso mensual del PBI','PBI desestacionalizado · MOM (%) y media de 3 meses',[b('PN01731AM'),average(b('PN01731AM'),3,'PBI MOM · media de 3 meses')],{names:['PBI MOM','Media de 3 meses'],types:['bar','line'],zero:true,signColors:true,stats:false},'MOM: variación frente al mes anterior. La línea es la media aritmética de tres variaciones mensuales consecutivas; no equivale al crecimiento acumulado trimestral. Series desestacionalizadas, sujetas a revisión.'),
      times('pe-expectations','Expectativas empresariales','Economía y demanda: horizontes de 3 y 12 meses · índice 0–100',seriesCodes(['PD38045AM','PD38047AM','PD37981AM','PD39751AM']),{names:['Economía 3 meses','Demanda 3 meses','Economía 12 meses','Demanda 12 meses'],target:{min:50,max:50,label:'Umbral de 50 puntos'}},'Índices de difusión de la encuesta del BCRP: por encima de 50 predomina una expectativa favorable; por debajo, desfavorable. <strong>Son expectativas, no crecimiento observado.</strong>')
    ]);
    if(name==='produccion')return topic('Minería y energía: producción física','Distingue cuánto se produce de cuánto valen los productos. Series primarias de INEI y MINEM distribuidas por BCRP.',[
      times('pe-copper-output','Producción de cobre','Miles de toneladas recuperables · dato mensual y media de tres meses',[b('PN01873AM'),average(b('PN01873AM'),3,'Cobre · media de 3 meses')],{names:['Producción mensual','Media de 3 meses'],types:['bar','line'],stats:false},'Se muestran cantidades físicas recuperables de la estadística minera, no exportaciones ni ingresos. La media de tres meses suaviza fluctuaciones, pero no elimina por sí misma la estacionalidad.'),
      times('pe-mining-volume','Producción minera','Producción física · base 100 en la primera fecha común',seriesCodes(['PN01873AM','PN01876AM','PN01879AM']),{names:['Cobre','Oro','Zinc'],index:true},'La indexación permite comparar cantidades publicadas en unidades diferentes. Un nivel 120 significa 20% más producción que en el mes base; no implica que un mineral tenga mayor volumen o valor que otro.'),
      times('pe-energy-volume','Producción de hidrocarburos','Petróleo y gas natural · base 100 en la primera fecha común',seriesCodes(['PN01882AM','PN01884AM']),{names:['Petróleo crudo','Gas natural'],index:true},'Petróleo y gas se miden originalmente en barriles y pies cúbicos. Esta vista compara cambios relativos; no suma energía equivalente, valor económico ni emisiones.')
    ]);
    if(name==='hogares')return topic('Precios, ingresos y poder de compra','La inflación mide el cambio de precios; el ingreso real ayuda a entender cuánto pueden comprar los salarios.',[
      times('pe-household-prices','Inflación y componentes','Lima Metropolitana · YOY (%)',seriesCodes(['PN01273PM','PN01277PM','PN09822PM']),{names:['Inflación general','Sin alimentos y energía','Alimentos y bebidas'],target:true},'La inflación sin alimentos y energía excluye esos componentes para observar presiones más persistentes. La banda de 1%–3% corresponde a la meta de inflación general.'),
      times('pe-price-divergence','Alimentos, energía e inflación subyacente','Lima Metropolitana · YOY (%)',seriesCodes(['PN09819PM','PN01277PM']),{names:['Alimentos y energía','Sin alimentos y energía'],zero:true},'Contrasta el bloque más expuesto a choques de oferta con la inflación que lo excluye. Las dos tasas tienen ponderaciones distintas y no se suman para obtener la inflación general.'),
      times('pe-price-level','Nivel de precios','IPC Lima Metropolitana · base 100 en el inicio de la selección',[b('PN38705PM')],{names:['Nivel de precios'],index:true},'Una inflación menor significa que los precios suben más lentamente; no que regresen a su nivel anterior. Aquí 110 representa un nivel 10% mayor al de la fecha base.'),
      times('pe-real-income','Ingreso real del empleo formal privado','Sector formal privado · ingreso real promedio · soles de 2009',[b('PN37697PM')],{names:['Ingreso real formal privado'],area:true},'Ingreso promedio del empleo formal privado, expresado en soles constantes de 2009. <strong>No representa el ingreso de todos los trabajadores ni la mediana salarial.</strong>'),
      times('pe-savings-rate','Tasas de depósitos a plazo','Depósitos bancarios a 181–360 días · tasas efectivas anuales (%)',seriesCodes(['PN07814NM','PN07834NM']),{names:['Depósitos en soles','Depósitos en dólares']},'Promedios de tasas de depósitos por moneda y plazo. No son ofertas vigentes de una entidad. <strong>Para comparar poder adquisitivo deben considerarse inflación, moneda y condiciones del depósito.</strong>'),
      times('pe-income-minimum','Ingreso formal y remuneración mínima','Soles corrientes por mes',seriesCodes(['PN37696PM','PN02124PM']),{names:['Ingreso promedio formal privado','Remuneración mínima vital']},'Compara un ingreso promedio observado con un piso normativo. El promedio depende de la composición de trabajadores; no mide por sí solo el aumento salarial de una misma persona.')
    ]);
    if(name==='trabajo')return topic('Empleo y financiamiento','Coberturas explícitas: empleo formal nacional, mercado laboral de Lima y crédito del sistema financiero.',[
      times('pe-formal-jobs','Empleo formal','YOY (%) · total y sector privado',seriesCodes(['PN31880GM','PN31882GM']),{names:['Empleo formal total','Empleo formal privado'],zero:true},'El empleo formal comprende puestos declarados en planilla. No equivale al empleo total del país ni incorpora todo el trabajo informal.'),
      times('pe-lima-unemployment','Desempleo en Lima Metropolitana','Porcentaje de la PEA · promedio móvil de tres meses',[b('PN38063GM')],{names:['Desempleo Lima Metropolitana']},'Cobertura: Lima Metropolitana. Cada observación resume tres meses móviles; las ventanas consecutivas se superponen. <strong>No es una tasa nacional ni un dato mensual independiente.</strong>'),
      times('pe-youth-work','Desempleo juvenil','Lima Metropolitana · tasas de desempleo (%) · trimestres móviles',seriesCodes(['PN38063GM','PN38066GM']),{names:['Desempleo total','Jóvenes de 14–24 años']},'La cobertura es Lima Metropolitana, no todo el país. La tasa juvenil usa como denominador la PEA de 14–24 años. Las observaciones son trimestres móviles superpuestos.'),
      times('pe-credit-growth','Crecimiento del crédito','Crédito al sector privado · YOY (%)',seriesCodes(['PN00536MM','PN00537MM','PN00538MM','PN00539MM']),{names:['Empresas','Consumo','Hipotecario','Total'],zero:true},'Las tasas corresponden a las series oficiales por tipo de crédito. Son saldos de financiamiento, no desembolsos del mes ni tasas de interés.'),
      times('pe-household-borrowing','Tasas de crédito a hogares','Promedios bancarios · tasas efectivas anuales (%)',seriesCodes(['PN07845NM','PN07847NM','PN07848NM']),{names:['Tarjeta de crédito','Consumo > 360 días','Hipotecario']},'Promedios de tasas de interés por modalidad. <strong>No son la TCEA ni ofertas personalizadas:</strong> los seguros, comisiones y perfiles de riesgo pueden cambiar el costo final.'),
      times('pe-corporate-borrowing','Tasas corporativas por moneda','Preferencial corporativa a 90 días · tasas efectivas anuales (%)',seriesCodes(['PN07809NM','PN07829NM']),{names:['Soles','Dólares']},'Compara tasas en monedas distintas. Una tasa menor en dólares <strong>no garantiza un financiamiento más barato en soles</strong>: importan la variación cambiaria y el costo de cobertura.'),
      times('pe-bank-deposits','Depósitos por moneda','Depósitos del sector privado en bancos · YOY (%)',[y(b('PN00281MM'),'Depósitos en soles · YOY'),y(b('PN00389MM'),'Depósitos en dólares · YOY')],{names:['Depósitos en soles','Depósitos en dólares'],zero:true},'Cada saldo crece en su moneda original; no se convierte con el tipo de cambio. La comparación <strong>no es una participación ni una medida de dolarización</strong>.'),
      times('pe-credit-composition','Composición del crédito','Crédito por destino · millones de soles · áreas apiladas',seriesCodes(['PN00532MM','PN00533MM','PN00534MM']),{names:['Empresas','Consumo','Hipotecario'],stacked:true,zero:true,stats:false},'Saldos de crédito a empresas, consumo e hipotecario. La altura de cada área representa su saldo; la suma permite observar el tamaño de la cartera agregada. Los porcentajes de crecimiento se consultan en el panel de crecimiento del crédito.')
    ]);
    if(name==='fiscal')return topic('Las cuentas del Estado','Ingresos, gasto, déficit y deuda tienen unidades y horizontes distintos: los paneles los separan.',[
      times('pe-fiscal-flows','Ingresos y gasto público','Gobierno general · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02204FM'),'Ingresos corrientes · 12 meses'),rolling12(b('PN02207FM'),'Gasto no financiero · 12 meses')],{names:['Ingresos corrientes','Gasto no financiero']},'Se suman 12 meses completos para reducir la estacionalidad. <strong>La diferencia entre estas dos líneas no es el resultado económico del SPNF:</strong> cambian la cobertura y otros componentes, incluidos intereses.'),
      times('pe-tax-composition','Composición de la recaudación','Gobierno central · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02296FM'),'Impuesto a la renta · 12 meses'),rolling12(b('PN02301FM'),'IGV · 12 meses'),rolling12(b('PN02304FM'),'ISC · 12 meses')],{names:['Impuesto a la renta','IGV','ISC']},'Rubros tributarios seleccionados; no suman toda la recaudación. Las devoluciones se publican por separado. Se usan 12 meses completos para reducir el efecto del calendario tributario.'),
      times('pe-tax-cycle','Recaudación tributaria','Gobierno general · YOY nominal (%)',[y(b('PN02205FM'),'Ingresos tributarios · YOY'),y(b('PN02204FM'),'Ingresos corrientes · YOY')],{names:['Ingresos tributarios','Ingresos corrientes'],zero:true},'Compara cada flujo con el mismo mes del año anterior. Las variaciones son nominales: incluyen precios, actividad, cambios normativos y pagos extraordinarios; no equivalen al crecimiento de la base tributaria.'),
      times('pe-fiscal-balance','Resultado fiscal','Resultado económico SPNF · acumulado 12 meses · % del PBI',[b('PN39524FM')],{names:['Resultado económico SPNF'],zero:true,area:true},'Negativo: déficit; positivo: superávit. La fuente publica directamente este acumulado como porcentaje del PBI; no se suman porcentajes mensuales.'),
      times('pe-fiscal-debt','Deuda pública','Deuda pública del SPNF · porcentaje del PBI',[b('PN03432FQ')],{names:['Deuda pública SPNF']},'La deuda es un saldo al cierre del trimestre. No tiene la misma cobertura que la deuda del gobierno central de otras fuentes. Estadística primaria del MEF, distribuida por BCRPData.'),
      times('pe-public-investment','Inversión pública por nivel de gobierno','Formación bruta de capital · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02211FM'),'Gobierno nacional · 12 meses'),rolling12(b('PN02212FM'),'Gobiernos regionales · 12 meses'),rolling12(b('PN02213FM'),'Gobiernos locales · 12 meses')],{names:['Gobierno nacional','Gobiernos regionales','Gobiernos locales']},'Flujos de formación bruta de capital por nivel de gobierno. La ventana de 12 meses exige todos los meses disponibles. <strong>No mide avance frente al PIM ni calidad del gasto.</strong>'),
      times('pe-fiscal-spending','Gasto corriente y de capital','Gobierno general · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02208FM'),'Gasto corriente · 12 meses'),rolling12(b('PN02209FM'),'Gasto de capital · 12 meses')],{names:['Gasto corriente','Gasto de capital']},'El gasto de capital incluye componentes adicionales a la inversión física. <strong>No equivale a porcentaje de ejecución del presupuesto:</strong> aquí se muestran flujos realizados de las cuentas fiscales.')
    ]);
    if(name==='externo')return topic('Perú y el resto del mundo','Exportaciones, saldo comercial, reservas y precios relativos: canales de transmisión de la economía global.',[
      times('pe-export-structure','Composición de las exportaciones','FOB · millones de US$',seriesCodes(['PN38738BM','PN38743BM']),{names:['Tradicionales','No tradicionales']},'Clasificación oficial por tipo de exportación. Las exportaciones tradicionales no son exclusivamente minerales; las no tradicionales incluyen varios sectores productivos.'),
      times('pe-export-drivers','Minería y exportaciones no tradicionales','FOB · millones de US$',seriesCodes(['PN38741BM','PN38744BM','PN38746BM']),{names:['Productos mineros','Agropecuarios no tradicionales','Textiles no tradicionales']},'Rubros seleccionados de exportación: <strong>no representan el total</strong>. Los valores reflejan conjuntamente precios y volúmenes; no permiten atribuir el cambio a uno de esos factores por separado.'),
      times('pe-external-balance','Balanza comercial','Balanza de bienes FOB · millones de US$',[b('PN38723BM')],{names:['Exportaciones menos importaciones'],types:['bar'],zero:true},'Mide el saldo del comercio de bienes. <strong>No incluye servicios, rentas ni transferencias</strong>; por ello no es la cuenta corriente.'),
      times('pe-reserve-buffer','Reservas internacionales netas','Reservas internacionales netas · millones de US$',[b('PN00027MM')],{names:['RIN'],area:true},'Activos y pasivos externos incluidos en la definición de reservas netas del BCRP. Un cambio puede reflejar transacciones y valorizaciones; no se interpreta automáticamente como intervención cambiaria.'),
      times('pe-export-import-prices','Precios de exportación e importación','Precios de exportación e importación · índices 2007=100',seriesCodes(['PN38915BM','PN38919BM']),{names:['Precios de exportación','Precios de importación']},'Ambos índices comparten año base; se comparan trayectorias, no precios en dólares. Su cociente determina los términos de intercambio. Un aumento de precios no implica por sí solo mayor volumen de comercio.'),
      times('pe-terms-of-trade','Términos de intercambio','Términos de intercambio · índice 2007=100',[b('PN38923BM')],{names:['Términos de intercambio']},'Un aumento indica una mejora de los precios de exportación relativos a los de importación. <strong>No mide cantidades exportadas ni el saldo comercial.</strong>')
    ]);
    if(name==='pagos')return topic('Las conexiones financieras y de servicios con el exterior','Cuenta corriente, remesas y viajes complementan el comercio de bienes. Datos trimestrales de balanza de pagos.',[
      times('pe-current-account','Cuenta corriente','Saldo de la cuenta corriente · porcentaje del PBI',[b('PN39002BQ')],{names:['Cuenta corriente / PBI'],zero:true},'Incluye bienes, servicios, ingreso primario e ingreso secundario. Negativo indica déficit; positivo, superávit. Se presenta la proporción publicada por BCRP, sin convertir ni sumar porcentajes.'),
      times('pe-remittances','Remesas del exterior','Remesas del exterior · millones de US$ por trimestre',[b('PN38986BQ')],{names:['Remesas recibidas'],types:['bar']},'Transferencias de remesas registradas en balanza de pagos. No son exportaciones, inversión extranjera ni todos los ingresos de personas peruanas residentes fuera del país.'),
      times('pe-travel-services','Servicios de viajes','Balanza de servicios de viajes · millones de US$ por trimestre',seriesCodes(['PN39244BQ','PN39245BQ']),{names:['Ingresos de viajes','Egresos de viajes']},'Los viajes abarcan bienes y servicios adquiridos por viajeros de acuerdo con la definición de balanza de pagos. No equivalen al número de turistas ni al aporte total del turismo al PBI.')
    ]);
    if(name==='mercado')return topic('Tasas de interés y moneda','Conecta decisiones monetarias, financiamiento soberano y mercado cambiario; cada instrumento mantiene su definición.',[
      times('pe-policy-transmission','Transmisión de la tasa de política','Perú · porcentaje anual · datos mensuales',seriesCodes(['PD04722MM','PN07819NM','PN07809NM']),{names:['Referencia BCRP','Interbancaria en soles','Corporativa 90 días en soles']},'Las tasas corresponden a instrumentos, promedios y riesgos diferentes. La tasa preferencial corporativa no representa el costo de crédito para todas las empresas.'),
      times('pe-sovereign-curves','Rendimientos soberanos por moneda','Bonos del Perú a 10 años · porcentaje anual',seriesCodes(['PD31895MM','PD31896MM']),{names:['Bono en soles','Bono en dólares']},'Los rendimientos en monedas distintas incorporan inflación, riesgo cambiario, liquidez y condiciones de cada mercado. Su diferencia no equivale al riesgo país ni a una expectativa cambiaria pura.'),
      times('pe-fx-history','Tipo de cambio USDPEN','Tipo de cambio interbancario promedio · soles por US$',[b('PN01207PM')],{names:['Soles por dólar'],area:true},'Un aumento indica depreciación del sol frente al dólar; una caída, apreciación. Es un promedio mensual interbancario, no una cotización de compra o venta disponible en este momento.'),
      times('pe-fx-rate-gap','Diferencial corporativo PEN–USD','Preferencial corporativa a 90 días · soles menos dólares · pp',[difference(b('PN07809NM'),b('PN07829NM'),'Diferencial corporativo soles − dólares')],{names:['Diferencial de tasas'],zero:true},'Diferencia exacta de las dos tasas promedio en un mismo mes. No incorpora la variación del tipo de cambio, seguros ni el costo de cubrir el riesgo cambiario.')
    ]);
    if(name==='desarrollo')return topic('Desarrollo y bienestar','Indicadores anuales para observar cambios estructurales. Su fecha de referencia puede ser anterior a la de las series mensuales.',[
      times('pe-national-poverty','Pobreza monetaria nacional','Porcentaje de la población · definición nacional',[pe('SI.POV.NAHC')],{names:['Pobreza monetaria nacional']},'La línea de pobreza nacional responde al costo local de necesidades básicas. <strong>No se compara directamente con líneas nacionales de otros países.</strong> Las actualizaciones dependen de encuestas de hogares.'),
      times('pe-inequality','Desigualdad del ingreso','Índice de Gini · escala 0–100',[pe('SI.POV.GINI')],{names:['Gini']},'Cero representa igualdad perfecta y 100 desigualdad máxima. El indicador depende de la encuesta y de la metodología; no sustituye al nivel de ingreso ni a la pobreza.'),
      times('pe-life','Esperanza de vida al nacer','Años · población total',[pe('SP.DYN.LE00.IN')],{names:['Esperanza de vida']},'Resume la mortalidad del periodo. No predice la edad exacta que alcanzará una persona y puede reflejar perturbaciones sanitarias.'),
      times('pe-access','Acceso a servicios esenciales','Porcentaje de la población',[pe('EG.ELC.ACCS.ZS'),pe('SH.H2O.BASW.ZS'),pe('IT.NET.USER.ZS')],{names:['Electricidad','Agua al menos básica','Usuarios de internet']},'Los tres indicadores tienen definiciones propias: acceso eléctrico, servicio de agua al menos básico y uso de internet. Los huecos no se interpolan; sus últimas fechas pueden diferir.'),
      times('pe-school','Cobertura de educación secundaria','Matrícula bruta · porcentaje de la población en edad oficial',[pe('SE.SEC.ENRR')],{names:['Matrícula secundaria bruta']},'La matrícula bruta incluye alumnos de edades distintas a la oficial y puede superar 100%. <strong>No mide asistencia efectiva, finalización ni calidad educativa.</strong>'),
      times('pe-investment','La inversión que amplía capacidad productiva','Formación bruta de capital fijo · porcentaje del PBI',[pe('NE.GDI.FTOT.ZS')],{names:['Formación bruta de capital fijo']},'Incluye inversión pública y privada en activos fijos. Es inversión bruta: no descuenta depreciación y no equivale al presupuesto de inversión pública.')
    ]);
    topic('Tema económico','Selecciona una de las áreas disponibles.',[]);
  }
  function renderWorldTopic(name) {
    if(name==='actividad')return topic('El ciclo de las grandes economías','Compara el crecimiento mundial anual con señales más frecuentes de Estados Unidos, sin mezclar sus horizontes.',[
      times('world-growth-comparison','Grandes economías: crecimiento real','PBI real · variación anual (%) · Banco Mundial',['USA','CHN','DEU','IND','WLD'].map(c=>wb(c,'NY.GDP.MKTP.KD.ZG')),{names:['EE. UU.','China','Alemania','India','Mundo'],zero:true},'Todas las economías usan la misma definición anual. Mundo es el agregado oficial del Banco Mundial; no un promedio simple de los países graficados.'),
      times('world-transatlantic-cycle','PBI real: EE. UU. y zona euro','PBI real desestacionalizado · YOY (%)',[y(f('GDPC1'),'PBI real EE. UU. · YOY'),y(f('CLVMNACSCAB1GQEA19'),'PBI real zona euro 19 · YOY')],{names:['Estados Unidos','Zona euro · 19 países'],zero:true},'Trimestre actual frente al mismo trimestre del año anterior, a precios constantes. La serie europea mantiene una composición fija de 19 países, que no incluye todas las incorporaciones posteriores a la zona euro. Aunque los niveles originales usan monedas distintas, aquí se comparan sus tasas; no su tamaño económico.'),
      times('us-broad-activity','Actividad nacional de EE. UU.','Chicago Fed CFNAI · media móvil de 3 meses',[f('CFNAIMA3')],{names:['Actividad nacional CFNAI-MA3'],zero:true,recession:f('USREC')},'El índice resume múltiples indicadores de actividad. Cero representa el ritmo de crecimiento tendencial histórico; un valor negativo indica crecimiento por debajo de esa tendencia, no necesariamente una caída del PBI.'),
      times('us-production-consumption','Producción industrial y consumo real','EE. UU. · YOY (%) · series desestacionalizadas',[y(f('INDPRO'),'Producción industrial · YOY'),y(f('PCEC96'),'Consumo personal real · YOY')],{names:['Producción industrial','Consumo personal real'],zero:true},'Cálculo: nivel del mes frente al mismo mes del año anterior. El consumo se mide en términos reales; la producción es un índice de volumen. Sus tasas no se suman.'),
      times('us-retail-demand','Ventas minoristas','Ventas minoristas y servicios de alimentos · YOY (%)',[y(f('RSAFS'),'Ventas minoristas · YOY')],{names:['Ventas minoristas nominales'],zero:true},'Ventas desestacionalizadas a precios corrientes. Su aumento puede reflejar precios y cantidades; <strong>no es crecimiento del consumo real</strong> ni cubre todos los servicios.'),
      times('us-housing-cycle','Permisos e inicios de viviendas','EE. UU. · miles de unidades · SAAR',fredCodes(['PERMIT','HOUST']),{names:['Permisos de construcción','Viviendas iniciadas']},'Los permisos y los inicios son etapas distintas del ciclo. Las series son tasas anuales desestacionalizadas (SAAR), <strong>no unidades efectivamente construidas en el mes</strong>.')
    ]);
    if(name==='precios')return topic('Inflación y política monetaria','Separa inflación anual, impulso reciente y compensación de mercado. Cada panel muestra su horizonte.',[
      times('world-consumer-inflation','Inflación por economía','Precios al consumidor · variación anual (%) · Banco Mundial',['USA','CHN','DEU','IND','WLD'].map(c=>wb(c,'FP.CPI.TOTL.ZG')),{names:['EE. UU.','China','Alemania','India','Mundo'],zero:true},'Comparación anual de la misma familia estadística. Las canastas y metodologías nacionales difieren. El agregado mundial sigue la metodología del Banco Mundial; no es el promedio simple de estas economías.'),
      times('us-inflation-pce','Inflación PCE general y subyacente','EE. UU. · PCE general y subyacente · YOY (%)',[y(f('PCEPI'),'PCE general · YOY'),y(f('PCEPILFE'),'PCE subyacente · YOY')],{names:['PCE general','PCE sin alimentos y energía'],referenceLines:[{value:2,label:'Objetivo de largo plazo · PCE general: 2%'}],recession:f('USREC')},'Variación del índice frente al mismo mes del año anterior. El <a href="https://www.federalreserve.gov/faqs/economy_14400.htm" target="_blank" rel="noopener noreferrer">objetivo de la Fed</a> se refiere a la inflación PCE general a largo plazo; no a mantener cada observación mensual exactamente en 2%.'),
      times('us-inflation-momentum','Impulso de la inflación PCE','PCE subyacente · 3M SAAR, 6M SAAR y YOY',[annualized(f('PCEPILFE'),3,'PCE subyacente · 3M SAAR'),annualized(f('PCEPILFE'),6,'PCE subyacente · 6M SAAR'),annualized(f('PCEPILFE'),12,'PCE subyacente · YOY')],{names:['3M SAAR','6M SAAR','YOY'],lineStyles:['solid','dashed','dotted'],zero:true,stats:false},'Cálculo: ((índice actual / índice de hace n meses)^(12/n) − 1) × 100. Los tres ritmos usan el mismo índice desestacionalizado. La anualización expresa qué pasaría si ese ritmo persistiera; no es una previsión.'),
      times('us-cpi-composition','IPC general y subyacente','EE. UU. · YOY (%) · datos desestacionalizados',[y(f('CPIAUCSL'),'IPC general · YOY'),y(f('CPILFESL'),'IPC subyacente · YOY')],{names:['IPC general','IPC sin alimentos y energía'],zero:true,recession:f('USREC')},'El IPC y el PCE usan coberturas y ponderaciones diferentes. Por eso este panel no sustituye al PCE ni aplica al IPC el objetivo de 2% de la Fed.'),
      times('eurozone-inflation','Inflación de la zona euro','Índice armonizado de precios al consumidor · YOY (%)',[y(f('CP0000EZ19M086NEST'),'IPCA zona euro 19 · YOY')],{names:['IPCA zona euro · 19 países'],zero:true},'YOY del índice armonizado no desestacionalizado, con una composición de 19 países; no incluye todas las incorporaciones posteriores a la zona euro. Su cobertura y metodología difieren del IPC y del PCE estadounidenses; la comparación internacional exige mantener esas diferencias presentes.'),
      times('world-inflation-compensation','Inflación implícita en bonos','Inflación implícita Treasury/TIPS · porcentaje anual',fredCodes(['T5YIE','T10YIE']),{names:['Breakeven 5 años','Breakeven 10 años']},'La diferencia entre rendimientos nominales y reales incorpora expectativas de inflación, primas de riesgo y liquidez. No es una previsión pura ni la inflación ya observada.')
    ]);
    if(name==='empleo')return topic('El mercado laboral estadounidense','Cantidad de empleo, holgura y salarios: señales complementarias con sus periodos de referencia.',[
      times('us-labor-unemployment','Desempleo de EE. UU.','EE. UU. · porcentaje de la fuerza laboral · desestacionalizado',[f('UNRATE')],{names:['Tasa de desempleo'],recession:f('USREC')},'Personas desempleadas que buscan trabajo como proporción de la fuerza laboral. No incluye a todas las personas que están fuera de la fuerza laboral.'),
      times('us-sahm-rule','Indicador Sahm','Indicador Sahm en tiempo real · puntos porcentuales',[f('SAHMREALTIME')],{names:['Indicador Sahm'],referenceLines:[{value:.5,label:'Umbral Sahm · 0,5 pp'}],zero:true,recession:f('USREC')},'Serie oficial distribuida por FRED: media de tres meses del desempleo menos el mínimo de esas medias en los 12 meses previos. Alcanzar 0,5 pp activa una señal histórica; no es una probabilidad de recesión ni una declaración del NBER.'),
      times('us-wage-inflation','Salarios por hora e inflación','EE. UU. · YOY (%) · series desestacionalizadas',[y(f('CES0500000003'),'Salario privado por hora · YOY'),y(f('CPIAUCSL'),'IPC · YOY')],{names:['Salario nominal por hora','IPC general'],zero:true},'Salario promedio por hora del sector privado no agrícola. El cambio refleja remuneraciones y composición del empleo; la diferencia entre tasas no es exactamente el crecimiento del salario real, que se calcula mediante el cociente de índices.'),
      times('us-vacancies-pressure','Vacantes por desempleado','EE. UU. · ofertas de empleo / personas desempleadas',[ratio(f('JTSJOL'),f('UNEMPLOY'),'Vacantes por desempleado')],{names:['Vacantes / desempleados'],referenceLines:[{value:1,label:'Una vacante por desempleado'}]},'Cociente de vacantes JOLTS y desempleados de la encuesta de hogares, ambos en miles y desestacionalizados, con el mismo mes de referencia. Son encuestas distintas: no implica que cada vacante sea accesible a cada desempleado.'),
      times('us-initial-claims','Solicitudes iniciales de desempleo','EE. UU. · personas · desestacionalizado y media de 4 semanas',[f('ICSA'),weeklyAverage(f('ICSA'),4,'Solicitudes iniciales · media de 4 semanas')],{names:['Solicitudes semanales','Media de 4 semanas'],lineStyles:['dotted','solid'],stats:false},'Solicitudes iniciales semanales desestacionalizadas. La media exige cuatro semanas consecutivas y reduce la volatilidad semanal. Se cuentan solicitudes nuevas, no el total de desempleados.'),
      times('us-payroll-momentum','Creación de empleo no agrícola','EE. UU. · Δ MOM · miles de puestos · desestacionalizado',[d(f('PAYEMS'),'Empleo no agrícola · Δ MOM'),average(d(f('PAYEMS'),'Nóminas Δ MOM'),3,'Nóminas Δ MOM · media de 3 meses')],{names:['Nóminas Δ MOM','Media de 3 meses'],types:['bar','line'],zero:true,signColors:true,stats:false},'Diferencia mensual del empleo no agrícola y media de tres cambios mensuales consecutivos. Un valor negativo indica destrucción neta de puestos. Estimaciones sujetas a revisión.')
    ]);
    if(name==='riesgo')return topic('El termómetro del riesgo financiero','Señales complementarias: volatilidad implícita, compensación por riesgo de crédito y su relación histórica.',[
      times('world-credit-risk','Spreads de crédito','EE. UU. · spread ajustado por opciones · puntos porcentuales',fredCodes(['BAMLH0A0HYM2','BAMLC0A0CM']),{names:['High yield','Grado de inversión']},'Diferencial ajustado por opciones de índices ICE BofA frente a la curva del Tesoro. <strong>1 punto porcentual son 100 puntos básicos.</strong> No es un rendimiento total ni una probabilidad de impago. La descarga pública de estas series ICE está limitada a aproximadamente tres años de historia.'),
      times('world-vix-risk','Volatilidad implícita: VIX','CBOE VIX · índice de volatilidad implícita',[f('VIXCLS')],{names:['VIX'],area:true},'El VIX refleja volatilidad implícita esperada a 30 días a partir de opciones del S&P 500. No pronostica la dirección de la bolsa ni mide una probabilidad de recesión.'),
      times('world-financial-conditions','Condiciones financieras: NFCI','Chicago Fed NFCI · índice semanal',[f('NFCI')],{names:['Condiciones financieras NFCI'],zero:true},'Un valor positivo indica condiciones más restrictivas que el promedio histórico; uno negativo, más holgadas. Combina información de riesgo, crédito y apalancamiento. <strong>No es una probabilidad de recesión.</strong>'),
      riskScatter()
    ]);
    if(name==='liquidez')return topic('Tasas, dinero y liquidez global','Del balance de la Reserva Federal al costo hipotecario: distintas medidas de las condiciones financieras.',[
      times('world-curve-slopes','Pendientes de la curva Treasury','EE. UU. · rendimiento largo menos rendimiento corto · puntos porcentuales',fredCodes(['T10Y2Y','T10Y3M']),{names:['10 años − 2 años','10 años − 3 meses'],zero:true,recession:f('USREC')},'Una lectura negativa indica inversión de la curva. Históricamente se ha asociado con riesgos del ciclo, pero no fija la fecha de una recesión ni ofrece una probabilidad por sí sola.'),
      times('world-fed-balance','Balance de la Reserva Federal','Activos totales · miles de millones de US$', [convert(f('WALCL'),1000,'Activos totales de la Fed','Miles de millones USD')],{names:['Balance de la Fed'],area:true},'Balance semanal de la Reserva Federal, convertido de millones a miles de millones de dólares. <strong>No equivale al dinero en manos de hogares ni a la liquidez total del mercado.</strong>'),
      times('world-money-growth','Oferta monetaria M2','M2 de EE. UU. · YOY (%)',[y(f('M2SL'),'M2 · YOY')],{names:['Crecimiento de M2'],zero:true},'M2 es un agregado monetario definido por la Reserva Federal. Su crecimiento no se convierte mecánicamente en inflación: también importan la demanda de dinero, la producción y la velocidad de circulación.'),
      times('world-real-yield','Treasury nominal, TIPS y breakeven','Treasury a 10 años · porcentaje anual',fredCodes(['DGS10','DFII10','T10YIE']),{names:['Treasury nominal 10a','TIPS real 10a','Inflación implícita 10a'],zero:true},'El rendimiento real corresponde a TIPS. La inflación implícita incorpora expectativas y primas de riesgo y liquidez; <strong>no es un pronóstico puro de inflación.</strong>'),
      times('world-mortgage-rate','Tasa hipotecaria a 30 años','Tasa hipotecaria fija a 30 años · porcentaje anual',[f('MORTGAGE30US')],{names:['Hipoteca fija 30 años']},'Promedio semanal de Freddie Mac. La tasa de una hipoteca concreta depende del prestatario, comisiones, condiciones y momento de originación; no es la tasa de la Fed.')
    ]);
    if(name==='materias')return topic('Materias primas y la conexión con Perú','El petróleo transmite costos; los metales influyen en exportaciones y términos de intercambio.',[
      times('world-oil-benchmarks','Petróleo WTI y Brent','Precios spot · US$ por barril',fredCodes(['DCOILWTICO','DCOILBRENTEU']),{names:['WTI','Brent']},'Son referencias distintas por ubicación y calidad del crudo. La diferencia entre ellas puede variar por transporte y condiciones de mercado. <strong>No son precios de combustibles en grifos peruanos.</strong>'),
      times('world-metals-cycle','Cobre y oro','Cobre y oro · base 100 en la primera fecha común de la selección',seriesCodes(['PN01652XM','PN01654XM']),{names:['Cobre LME','Oro'],index:true},'La base 100 compara variaciones relativas, ya que el cobre se publica en centavos por libra y el oro en dólares por onza. No compara niveles de precio ni rendimientos de un portafolio invertible.'),
      times('world-gas-price','Gas natural Henry Hub','Henry Hub · US$ por millón de BTU',[f('DHHNGSP')],{names:['Gas Henry Hub'],area:true},'Henry Hub es una referencia estadounidense. No representa directamente las tarifas de gas en Perú ni el precio del gas natural licuado entregado en otros mercados.')
    ]);
    topic('Tema global','Selecciona una de las áreas disponibles.',[]);
  }
  return {peruTopics,worldTopics,renderPeruTopic,renderWorldTopic};
}
