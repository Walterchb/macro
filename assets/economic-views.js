/** Thematic economic views. All values come from the current validated snapshot. */
export const peruTopics = [
  ['actividad','Actividad y sectores'], ['hogares','Precios e ingresos'],
  ['trabajo','Trabajo y crédito'], ['fiscal','Finanzas públicas'],
  ['externo','Sector externo'], ['desarrollo','Desarrollo y bienestar']
];
export const worldTopics = [
  ['actividad','Actividad global'], ['riesgo','Riesgo financiero'],
  ['liquidez','Tasas y liquidez'], ['materias','Materias primas']
];

export function createEconomicViews(ctx) {
  const {$,esc,fmt,date,b,f,wb,last,panel,timeChart,chart,baseOption,chartRows,
    colors,css,theme,derived,cut,commonDates} = ctx;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const present = s => s && s.observations?.some(o => finite(o.value));
  const clean = ss => ss.filter(present);
  const range = () => typeof ctx.range === 'function' ? ctx.range() : ctx.range || '5';
  const y = (s,name) => present(s) ? derived(s,'yoy',name || `${s.name} · variación interanual`,'% interanual') : null;
  const d = (s,name) => present(s) ? derived(s,'diff',name || `${s.name} · cambio mensual`,s.unit) : null;
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
  function times(id,title,subtitle,ss,options={},help='') {
    const names=options.names || [];
    const pairs=ss.map((s,i)=>({s,name:names[i],type:options.types?.[i]})).filter(x=>present(x.s));
    return {id,title,subtitle,ss:pairs.map(x=>x.s),help,
      draw:()=>timeChart(id,pairs.map(x=>x.s),{...options,names:pairs.map(x=>x.name||x.s.name),types:pairs.map(x=>x.type||'line')})};
  }
  function topic(title,description,specs) {
    const target=$('#economic-topic'); if(!target) return;
    const ready=specs.filter(s=>s&&clean(s.ss).length&&(!s.requireAll||s.ss.every(present)));
    const ss=[...new Map(ready.flatMap(s=>clean(s.ss)).map(s=>[s.id,s])).values()];
    const retained=ss.filter(s=>s.status==='retained').length;
    target.innerHTML=`<div class="economic-intro"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="economic-coverage"><span>${ss.length} series con datos</span>${retained?`<span>${retained} con última descarga válida</span>`:''}</div></div>`+
      (ready.length?`<div class="economic-grid">${ready.map(s=>panel(s.id,s.title,s.subtitle,clean(s.ss),{wide:s.wide,help:s.help,note:s.note})).join('')}</div>`:
      '<div class="reading">Esta publicación aún no contiene observaciones para este tema. Consulta Fuentes para ver la cobertura disponible.</div>')+
      `<p class="economic-footnote">${ready.length} gráficos disponibles. Cada serie conserva su fecha, unidad y cobertura geográfica. ${ready.length<specs.filter(Boolean).length?'Se omiten los gráficos sin observaciones en esta publicación. ':''}Consulta «Datos» para revisar las fuentes y descargar la historia.</p>`;
    ready.forEach(s=>s.draw());
  }
  function rankingSectors() {
    const ss=clean(sectors.map(([code])=>b(code)));
    const period=commonDates(ss,'all').at(-1);
    if(!period)return null;
    const rows=ss.map(s=>({s,value:s.observations.find(o=>o.date===period)?.value,
      name:sectors.find(([code])=>code===s.sourceCode)?.[1] || s.name})).filter(x=>finite(x.value)).sort((a,b)=>a.value-b.value);
    const id='pe-sector-ranking';
    return {id,title:'¿Qué sectores impulsan el crecimiento?',subtitle:`${date(period)} · variación interanual (%) · mismo mes para todos`,ss,
      help:'Tasas de crecimiento, <strong>no contribuciones al PBI</strong>: un sector pequeño puede crecer mucho y aportar poco al agregado. El ranking usa el último mes con datos para todos los sectores incluidos.',
      draw(){
        const opt=baseOption(); delete opt.dataZoom; delete opt.legend;
        opt.grid={left:145,right:52,top:20,bottom:32};
        opt.tooltip={...opt.tooltip,trigger:'item',formatter:p=>`${esc(p.name)}<br>${date(period)}: <strong>${fmt(p.value)}%</strong>`};
        opt.xAxis={type:'value',axisLabel:{color:css('--muted'),fontSize:10,formatter:v=>`${v}%`},splitLine:{lineStyle:{color:css('--grid')}}};
        opt.yAxis={type:'category',data:rows.map(r=>r.name),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:css('--muted'),fontSize:10,width:132,overflow:'truncate'}};
        opt.series=[{type:'bar',barMaxWidth:24,data:rows.map(r=>({value:r.value,itemStyle:{color:r.value<0?colors[4]:colors[0],borderRadius:r.value<0?[3,0,0,3]:[0,3,3,0]}})),label:{show:true,position:'right',color:css('--ink'),fontSize:10,formatter:p=>fmt(p.value,1)},markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:css('--muted'),opacity:.5},data:[{xAxis:0}]}}];
        chartRows.get(id).rows=rows.map(r=>({s:r.s,rows:[{date:period,value:r.value}]})); chart(id,opt);
      }};
  }
  function sectorHeatmap() {
    const ss=clean(sectors.map(([code])=>b(code)));if(!ss.length)return null;
    const allDates=[...new Set(ss.flatMap(s=>s.observations.filter(o=>finite(o.value)).map(o=>o.date)))].sort();
    const months=allDates.slice(-36),cells=[];
    ss.forEach((s,i)=>{const m=new Map(s.observations.map(o=>[o.date,o.value]));months.forEach((date,j)=>{if(finite(m.get(date)))cells.push([j,i,m.get(date)]);});});
    const id='pe-sector-heatmap';
    return {id,title:'El mapa del ciclo sectorial',subtitle:'Últimos 36 meses publicados · PBI sectorial interanual (%)',ss,wide:true,
      help:'Cada celda es un sector y un mes. Rojo indica contracción y verde crecimiento. Los valores extremos saturan el color en ±15%; el tooltip conserva el valor exacto. <strong>Una celda vacía significa que falta el dato.</strong>',
      draw(){const opt=baseOption();delete opt.legend;delete opt.dataZoom;
        opt.grid={left:145,right:22,top:12,bottom:75};
        opt.tooltip={...opt.tooltip,trigger:'item',formatter:p=>`${esc(sectors.find(([c])=>c===ss[p.value[1]].sourceCode)?.[1]||ss[p.value[1]].name)} · ${date(months[p.value[0]])}<br><strong>${fmt(p.value[2])}%</strong>`};
        opt.xAxis={type:'category',data:months,axisLine:{show:false},axisTick:{show:false},axisLabel:{interval:2,rotate:0,color:css('--muted'),fontSize:9,formatter:v=>date(v).replace('.','')}};
        opt.yAxis={type:'category',data:ss.map(s=>sectors.find(([c])=>c===s.sourceCode)?.[1]||s.name),inverse:true,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:css('--muted'),fontSize:10,width:130,overflow:'truncate'}};
        opt.visualMap={min:-15,max:15,orient:'horizontal',left:'center',bottom:3,itemWidth:10,itemHeight:140,text:['≥ 15%','≤ −15%'],textStyle:{color:css('--muted'),fontSize:10},inRange:{color:['#bd4c53',theme()?'#172d3d':'#eef2f5','#078c8c']}};
        opt.series=[{type:'heatmap',data:cells,label:{show:false},emphasis:{itemStyle:{borderColor:css('--ink'),borderWidth:1}},itemStyle:{borderWidth:2,borderColor:css('--panel')}}];
        chartRows.get(id).rows=ss.map(s=>({s,rows:s.observations.filter(o=>months.includes(o.date))}));chart(id,opt);
      }};
  }
  function riskScatter() {
    const a=f('VIXCLS'),bb=f('BAMLH0A0HYM2');if(!present(a)||!present(bb))return null;
    const lookup=new Map(cut(bb,range()).map(o=>[o.date,o.value]));
    const rows=cut(a,range()).filter(o=>finite(o.value)&&finite(lookup.get(o.date))).map(o=>({date:o.date,x:o.value,y:lookup.get(o.date)}));
    if(rows.length<12)return null;
    const recent=rows.at(-1),median=values=>{const s=values.slice().sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
    const mx=median(rows.map(r=>r.x)),my=median(rows.map(r=>r.y));
    const id='world-risk-map';
    return {id,title:'Volatilidad y crédito: ¿el riesgo coincide?',subtitle:`VIX y spread HY · ${date(rows[0].date,'daily')}–${date(recent.date,'daily')} · ${rows.length.toLocaleString('es-PE')} días`,ss:[a,bb],
      help:'Cada punto representa un día con ambos datos. Las guías son las medianas de la ventana mostrada; el punto destacado es el último día común. <strong>La asociación histórica no demuestra causalidad ni anticipa por sí sola una crisis.</strong>',
      draw(){const opt=baseOption();delete opt.legend;delete opt.dataZoom;
        opt.grid={left:67,right:28,top:24,bottom:50};
        opt.xAxis={type:'value',name:'VIX · puntos',nameLocation:'middle',nameGap:31,axisLabel:{color:css('--muted'),fontSize:10},nameTextStyle:{color:css('--muted'),fontSize:10},splitLine:{lineStyle:{color:css('--grid')}}};
        opt.yAxis={type:'value',name:'Spread HY · pp',nameTextStyle:{color:css('--muted'),fontSize:10},axisLabel:{color:css('--muted'),fontSize:10},splitLine:{lineStyle:{color:css('--grid')}}};
        opt.tooltip={...opt.tooltip,trigger:'item',formatter:p=>`${date(p.value[2],'daily')}<br>VIX: <strong>${fmt(p.value[0])}</strong><br>Spread HY: <strong>${fmt(p.value[1])} pp</strong>`};
        opt.series=[{type:'scatter',symbolSize:4,data:rows.map(r=>[r.x,r.y,r.date]),itemStyle:{color:colors[1],opacity:.22},markLine:{silent:true,symbol:'none',lineStyle:{type:'dashed',color:css('--muted'),opacity:.5},label:{show:false},data:[{xAxis:mx},{yAxis:my}]}},{type:'scatter',symbolSize:12,data:[[recent.x,recent.y,recent.date]],itemStyle:{color:colors[0],borderWidth:2,borderColor:css('--panel')},label:{show:true,formatter:'Último',position:'top',fontSize:10,color:css('--ink')}}];
        chartRows.get(id).rows=[{s:a,rows:rows.map(r=>({date:r.date,value:r.x}))},{s:bb,rows:rows.map(r=>({date:r.date,value:r.y}))}];chart(id,opt);
      }};
  }
  function renderPeruTopic(name) {
    if(name==='actividad')return topic('Producción, sectores y expectativas','Distingue el crecimiento anual del impulso mensual y de las expectativas empresariales.',[
      rankingSectors(),sectorHeatmap(),
      times('pe-short-cycle','El impulso más reciente','PBI desestacionalizado · variación mensual (%)',[b('PN01731AM')],{names:['PBI desestacionalizado'],types:['bar'],zero:true},'La serie desestacionalizada permite comparar meses consecutivos. Puede revisarse al incorporarse nuevos datos; <strong>no es la tasa interanual del PBI.</strong>'),
      times('pe-expectations','¿Mejora la confianza empresarial?','Economía y demanda: horizontes de 3 y 12 meses · índice 0–100',seriesCodes(['PD38045AM','PD38047AM','PD37981AM','PD39751AM']),{names:['Economía 3 meses','Demanda 3 meses','Economía 12 meses','Demanda 12 meses'],target:{min:50,max:50,label:'Umbral de 50 puntos'}},'Índices de difusión de la encuesta del BCRP: por encima de 50 predomina una expectativa favorable; por debajo, desfavorable. <strong>Son expectativas, no crecimiento observado.</strong>')
    ]);
    if(name==='hogares')return topic('Precios, ingresos y poder de compra','La inflación mide el cambio de precios; el ingreso real ayuda a entender cuánto pueden comprar los salarios.',[
      times('pe-household-prices','¿Qué precios presionan a los hogares?','Lima Metropolitana · variación interanual (%)',seriesCodes(['PN01273PM','PN01277PM','PN09822PM']),{names:['Inflación general','Sin alimentos y energía','Alimentos y bebidas'],target:true},'La inflación sin alimentos y energía excluye esos componentes para observar presiones más persistentes. La banda de 1%–3% corresponde a la meta de inflación general.'),
      times('pe-price-level','Cuánto ha cambiado el nivel de precios','IPC Lima Metropolitana · base 100 en el inicio de la selección',[b('PN38705PM')],{names:['Nivel de precios'],index:true},'Una inflación menor significa que los precios suben más lentamente; no que regresen a su nivel anterior. Aquí 110 representa un nivel 10% mayor al de la fecha base.'),
      times('pe-real-income','¿El ingreso laboral gana poder de compra?','Sector formal privado · ingreso real promedio · soles de 2009',[b('PN37697PM')],{names:['Ingreso real formal privado'],area:true},'Ingreso promedio del empleo formal privado, expresado en soles constantes de 2009. <strong>No representa el ingreso de todos los trabajadores ni la mediana salarial.</strong>'),
      times('pe-savings-rate','La remuneración del ahorro a plazo','Depósitos bancarios a 181–360 días · tasas efectivas anuales (%)',seriesCodes(['PN07814NM','PN07834NM']),{names:['Depósitos en soles','Depósitos en dólares']},'Promedios de tasas de depósitos por moneda y plazo. No son ofertas vigentes de una entidad. <strong>Para comparar poder adquisitivo deben considerarse inflación, moneda y condiciones del depósito.</strong>'),
      times('pe-income-minimum','Ingreso formal y remuneración mínima','Soles corrientes por mes',seriesCodes(['PN37696PM','PN02124PM']),{names:['Ingreso promedio formal privado','Remuneración mínima vital']},'Compara un ingreso promedio observado con un piso normativo. El promedio depende de la composición de trabajadores; no mide por sí solo el aumento salarial de una misma persona.')
    ]);
    if(name==='trabajo')return topic('Empleo y financiamiento','Coberturas explícitas: empleo formal nacional, mercado laboral de Lima y crédito del sistema financiero.',[
      times('pe-formal-jobs','La creación de empleo formal','Variación interanual (%) · total y sector privado',seriesCodes(['PN31880GM','PN31882GM']),{names:['Empleo formal total','Empleo formal privado'],zero:true},'El empleo formal comprende puestos declarados en planilla. No equivale al empleo total del país ni incorpora todo el trabajo informal.'),
      times('pe-lima-unemployment','Desempleo en Lima Metropolitana','Porcentaje de la PEA · promedio móvil de tres meses',[b('PN38063GM')],{names:['Desempleo Lima Metropolitana']},'Cobertura: Lima Metropolitana. Cada observación resume tres meses móviles; las ventanas consecutivas se superponen. <strong>No es una tasa nacional ni un dato mensual independiente.</strong>'),
      times('pe-credit-growth','¿Dónde se expande el crédito?','Crédito al sector privado · variación interanual (%)',seriesCodes(['PN00536MM','PN00537MM','PN00538MM','PN00539MM']),{names:['Empresas','Consumo','Hipotecario','Total'],zero:true},'Las tasas corresponden a las series oficiales por tipo de crédito. Son saldos de financiamiento, no desembolsos del mes ni tasas de interés.'),
      times('pe-household-borrowing','¿Cuánto cuesta financiarse en soles?','Promedios bancarios · tasas efectivas anuales (%)',seriesCodes(['PN07845NM','PN07847NM','PN07848NM']),{names:['Tarjeta de crédito','Consumo > 360 días','Hipotecario']},'Promedios de tasas de interés por modalidad. <strong>No son la TCEA ni ofertas personalizadas:</strong> los seguros, comisiones y perfiles de riesgo pueden cambiar el costo final.'),
      times('pe-corporate-borrowing','El costo del crédito corporativo por moneda','Preferencial corporativa a 90 días · tasas efectivas anuales (%)',seriesCodes(['PN07809NM','PN07829NM']),{names:['Soles','Dólares']},'Compara tasas en monedas distintas. Una tasa menor en dólares <strong>no garantiza un financiamiento más barato en soles</strong>: importan la variación cambiaria y el costo de cobertura.'),
      times('pe-bank-deposits','¿En qué moneda crecen los depósitos?','Depósitos del sector privado en bancos · variación interanual (%)',[y(b('PN00281MM'),'Depósitos en soles · variación interanual'),y(b('PN00389MM'),'Depósitos en dólares · variación interanual')],{names:['Depósitos en soles','Depósitos en dólares'],zero:true},'Cada saldo crece en su moneda original; no se convierte con el tipo de cambio. La comparación <strong>no es una participación ni una medida de dolarización</strong>.'),
      times('pe-credit-composition','El tamaño de cada cartera','Crédito por destino · millones de soles',seriesCodes(['PN00532MM','PN00533MM','PN00534MM']),{names:['Empresas','Consumo','Hipotecario']},'Los niveles muestran la escala de las carteras. Compara esta vista con sus tasas de crecimiento: una cartera menor puede crecer más rápido sin concentrar la mayor parte del financiamiento.')
    ]);
    if(name==='fiscal')return topic('Las cuentas del Estado','Ingresos, gasto, déficit y deuda tienen unidades y horizontes distintos: los paneles los separan.',[
      times('pe-fiscal-flows','Ingresos y gasto en una ventana comparable','Gobierno general · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02204FM'),'Ingresos corrientes · 12 meses'),rolling12(b('PN02207FM'),'Gasto no financiero · 12 meses')],{names:['Ingresos corrientes','Gasto no financiero']},'Se suman 12 meses completos para reducir la estacionalidad. <strong>La diferencia entre estas dos líneas no es el resultado económico del SPNF:</strong> cambian la cobertura y otros componentes, incluidos intereses.'),
      times('pe-fiscal-balance','La posición fiscal del país','Resultado económico SPNF · acumulado 12 meses · % del PBI',[b('PN39524FM')],{names:['Resultado económico SPNF'],zero:true,area:true},'Negativo: déficit; positivo: superávit. La fuente publica directamente este acumulado como porcentaje del PBI; no se suman porcentajes mensuales.'),
      times('pe-fiscal-debt','La deuda frente al tamaño de la economía','Deuda pública del SPNF · porcentaje del PBI',[b('PN03432FQ')],{names:['Deuda pública SPNF']},'La deuda es un saldo al cierre del trimestre. No tiene la misma cobertura que la deuda del gobierno central de otras fuentes. Estadística primaria del MEF, distribuida por BCRPData.'),
      times('pe-public-investment','Inversión pública: ¿qué nivel de gobierno ejecuta?','Formación bruta de capital · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02211FM'),'Gobierno nacional · 12 meses'),rolling12(b('PN02212FM'),'Gobiernos regionales · 12 meses'),rolling12(b('PN02213FM'),'Gobiernos locales · 12 meses')],{names:['Gobierno nacional','Gobiernos regionales','Gobiernos locales']},'Flujos de formación bruta de capital por nivel de gobierno. La ventana de 12 meses exige todos los meses disponibles. <strong>No mide avance frente al PIM ni calidad del gasto.</strong>'),
      times('pe-fiscal-spending','¿Cómo se distribuye el gasto?','Gobierno general · suma móvil de 12 meses · millones de soles',[rolling12(b('PN02208FM'),'Gasto corriente · 12 meses'),rolling12(b('PN02209FM'),'Gasto de capital · 12 meses')],{names:['Gasto corriente','Gasto de capital']},'El gasto de capital incluye componentes adicionales a la inversión física. <strong>No equivale a porcentaje de ejecución del presupuesto:</strong> aquí se muestran flujos realizados de las cuentas fiscales.')
    ]);
    if(name==='externo')return topic('Perú y el resto del mundo','Exportaciones, saldo comercial, reservas y precios relativos: canales de transmisión de la economía global.',[
      times('pe-export-structure','La composición de las exportaciones','FOB · millones de US$',seriesCodes(['PN38738BM','PN38743BM']),{names:['Tradicionales','No tradicionales']},'Clasificación oficial por tipo de exportación. Las exportaciones tradicionales no son exclusivamente minerales; las no tradicionales incluyen varios sectores productivos.'),
      times('pe-export-drivers','Minería y diversificación exportadora','FOB · millones de US$',seriesCodes(['PN38741BM','PN38744BM','PN38746BM']),{names:['Productos mineros','Agropecuarios no tradicionales','Textiles no tradicionales']},'Rubros seleccionados de exportación: <strong>no representan el total</strong>. Los valores reflejan conjuntamente precios y volúmenes; no permiten atribuir el cambio a uno de esos factores por separado.'),
      times('pe-external-balance','Superávit o déficit comercial','Balanza de bienes FOB · millones de US$',[b('PN38723BM')],{names:['Exportaciones menos importaciones'],types:['bar'],zero:true},'Mide el saldo del comercio de bienes. <strong>No incluye servicios, rentas ni transferencias</strong>; por ello no es la cuenta corriente.'),
      times('pe-reserve-buffer','Las reservas internacionales','Reservas internacionales netas · millones de US$',[b('PN00027MM')],{names:['RIN'],area:true},'Activos y pasivos externos incluidos en la definición de reservas netas del BCRP. Un cambio puede reflejar transacciones y valorizaciones; no se interpreta automáticamente como intervención cambiaria.'),
      times('pe-terms-of-trade','El precio de lo que vendemos frente a lo que compramos','Términos de intercambio · índice 2007=100',[b('PN38923BM')],{names:['Términos de intercambio']},'Un aumento indica una mejora de los precios de exportación relativos a los de importación. <strong>No mide cantidades exportadas ni el saldo comercial.</strong>')
    ]);
    if(name==='desarrollo')return topic('Desarrollo y bienestar','Indicadores anuales para observar cambios estructurales. Su fecha de referencia puede ser anterior a la de las series mensuales.',[
      times('pe-national-poverty','Pobreza según la línea nacional','Porcentaje de la población · definición nacional',[pe('SI.POV.NAHC')],{names:['Pobreza monetaria nacional']},'La línea de pobreza nacional responde al costo local de necesidades básicas. <strong>No se compara directamente con líneas nacionales de otros países.</strong> Las actualizaciones dependen de encuestas de hogares.'),
      times('pe-inequality','La distribución del ingreso','Índice de Gini · escala 0–100',[pe('SI.POV.GINI')],{names:['Gini']},'Cero representa igualdad perfecta y 100 desigualdad máxima. El indicador depende de la encuesta y de la metodología; no sustituye al nivel de ingreso ni a la pobreza.'),
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
      times('us-production-consumption','Producción y consumo: dos motores del ciclo','EE. UU. · variación interanual (%) · series desestacionalizadas',[y(f('INDPRO'),'Producción industrial · interanual'),y(f('PCEC96'),'Consumo personal real · interanual')],{names:['Producción industrial','Consumo personal real'],zero:true},'Cálculo: nivel del mes frente al mismo mes del año anterior. El consumo se mide en términos reales; la producción es un índice de volumen. Sus tasas no se suman.'),
      times('us-retail-demand','La demanda en comercios y restaurantes','Ventas minoristas y servicios de alimentos · variación interanual (%)',[y(f('RSAFS'),'Ventas minoristas · variación interanual')],{names:['Ventas minoristas nominales'],zero:true},'Ventas desestacionalizadas a precios corrientes. Su aumento puede reflejar precios y cantidades; <strong>no es crecimiento del consumo real</strong> ni cubre todos los servicios.'),
      times('us-housing-cycle','Vivienda: permisos frente a obras iniciadas','EE. UU. · miles de unidades · ritmo anual desestacionalizado',fredCodes(['PERMIT','HOUST']),{names:['Permisos de construcción','Viviendas iniciadas']},'Los permisos y los inicios son etapas distintas del ciclo. Las series son tasas anuales desestacionalizadas (SAAR), <strong>no unidades efectivamente construidas en el mes</strong>.'),
      times('us-initial-claims','Una señal semanal del mercado laboral','Solicitudes iniciales de subsidio de desempleo · personas',[f('ICSA')],{names:['Solicitudes iniciales'],area:true},'Solicitudes iniciales semanales desestacionalizadas. No son el total de desempleados ni una tasa de desempleo; pueden mostrar volatilidad en torno a feriados y ajustes estacionales.'),
      times('us-payroll-momentum','¿Cuántos empleos se están creando?','EE. UU. · cambio mensual del empleo no agrícola · miles de puestos',[d(f('PAYEMS'),'Empleo no agrícola · cambio mensual')],{names:['Cambio mensual de nóminas'],types:['bar'],zero:true},'Diferencia entre dos niveles mensuales desestacionalizados. Un valor negativo implica caída neta del empleo. <strong>No es la tasa de desempleo.</strong> Las estimaciones se revisan.')
    ]);
    if(name==='riesgo')return topic('El termómetro del riesgo financiero','Señales complementarias: volatilidad implícita, compensación por riesgo de crédito y su relación histórica.',[
      times('world-credit-risk','Lo que exige el mercado por asumir riesgo de crédito','EE. UU. · spread ajustado por opciones · puntos porcentuales',fredCodes(['BAMLH0A0HYM2','BAMLC0A0CM']),{names:['High yield','Grado de inversión']},'Diferencial ajustado por opciones de índices ICE BofA frente a la curva del Tesoro. <strong>1 punto porcentual son 100 puntos básicos.</strong> No es un rendimiento total ni una probabilidad de impago. La descarga pública de estas series ICE está limitada a aproximadamente tres años de historia.'),
      times('world-vix-risk','Incertidumbre en la renta variable','CBOE VIX · índice de volatilidad implícita',[f('VIXCLS')],{names:['VIX'],area:true},'El VIX refleja volatilidad implícita esperada a 30 días a partir de opciones del S&P 500. No pronostica la dirección de la bolsa ni mide una probabilidad de recesión.'),
      times('world-financial-conditions','¿Las condiciones financieras se endurecen?','Chicago Fed NFCI · índice semanal',[f('NFCI')],{names:['Condiciones financieras NFCI'],zero:true},'Un valor positivo indica condiciones más restrictivas que el promedio histórico; uno negativo, más holgadas. Combina información de riesgo, crédito y apalancamiento. <strong>No es una probabilidad de recesión.</strong>'),
      riskScatter()
    ]);
    if(name==='liquidez')return topic('Tasas, dinero y liquidez global','Del balance de la Reserva Federal al costo hipotecario: distintas medidas de las condiciones financieras.',[
      times('world-fed-balance','El tamaño del balance de la Reserva Federal','Activos totales · miles de millones de US$', [convert(f('WALCL'),1000,'Activos totales de la Fed','Miles de millones USD')],{names:['Balance de la Fed'],area:true},'Balance semanal de la Reserva Federal, convertido de millones a miles de millones de dólares. <strong>No equivale al dinero en manos de hogares ni a la liquidez total del mercado.</strong>'),
      times('world-money-growth','La evolución de la oferta monetaria','M2 de EE. UU. · variación interanual (%)',[y(f('M2SL'),'M2 · variación interanual')],{names:['Crecimiento de M2'],zero:true},'M2 es un agregado monetario definido por la Reserva Federal. Su crecimiento no se convierte mecánicamente en inflación: también importan la demanda de dinero, la producción y la velocidad de circulación.'),
      times('world-real-yield','Rendimiento nominal, real e inflación implícita','Treasury a 10 años · porcentaje anual',fredCodes(['DGS10','DFII10','T10YIE']),{names:['Treasury nominal 10a','TIPS real 10a','Inflación implícita 10a'],zero:true},'El rendimiento real corresponde a TIPS. La inflación implícita incorpora expectativas y primas de riesgo y liquidez; <strong>no es un pronóstico puro de inflación.</strong>'),
      times('world-mortgage-rate','El costo de financiar una vivienda en EE. UU.','Tasa hipotecaria fija a 30 años · porcentaje anual',[f('MORTGAGE30US')],{names:['Hipoteca fija 30 años']},'Promedio semanal de Freddie Mac. La tasa de una hipoteca concreta depende del prestatario, comisiones, condiciones y momento de originación; no es la tasa de la Fed.')
    ]);
    if(name==='materias')return topic('Materias primas y la conexión con Perú','El petróleo transmite costos; los metales influyen en exportaciones y términos de intercambio.',[
      times('world-oil-benchmarks','Petróleo: referencias WTI y Brent','Precios spot · US$ por barril',fredCodes(['DCOILWTICO','DCOILBRENTEU']),{names:['WTI','Brent']},'Son referencias distintas por ubicación y calidad del crudo. La diferencia entre ellas puede variar por transporte y condiciones de mercado. <strong>No son precios de combustibles en grifos peruanos.</strong>'),
      times('world-metals-cycle','Metales: trayectorias comparables','Cobre y oro · base 100 en la primera fecha común de la selección',seriesCodes(['PN01652XM','PN01654XM']),{names:['Cobre LME','Oro'],index:true},'La base 100 compara variaciones relativas, ya que el cobre se publica en centavos por libra y el oro en dólares por onza. No compara niveles de precio ni rendimientos de un portafolio invertible.'),
      times('world-gas-price','El precio del gas natural en Estados Unidos','Henry Hub · US$ por millón de BTU',[f('DHHNGSP')],{names:['Gas Henry Hub'],area:true},'Henry Hub es una referencia estadounidense. No representa directamente las tarifas de gas en Perú ni el precio del gas natural licuado entregado en otros mercados.')
    ]);
    topic('Tema global','Selecciona una de las áreas disponibles.',[]);
  }
  return {peruTopics,worldTopics,renderPeruTopic,renderWorldTopic};
}
