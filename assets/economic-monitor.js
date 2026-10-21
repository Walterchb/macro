import {calibratedChangeSignal} from './signal-bands.js';
import {seriesFreshness as monitorFreshness} from './data-freshness.js';
/** Evidence-led economic monitor. Rules describe observations; they are not forecasts. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const DAY = 86400000;
const fallbackEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validRows = s => (s?.observations || []).filter(o => finite(o.value) && /^\d{4}-\d{2}-\d{2}$/.test(o.date)).slice().sort((a,b)=>a.date.localeCompare(b.date));
function shiftedMonth(iso, amount) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth()+amount);
  return dt.toISOString().slice(0,10);
}

export {seriesFreshness as monitorFreshness} from './data-freshness.js';

/** Exact calendar periods only. Missing observations never shorten a window. */
export function monitorTransform(series, kind='level') {
  const rows=validRows(series), lookup=new Map(rows.map(o=>[o.date,o.value]));
  if(kind==='level') return rows;
  const frequency=series?.frequency;
  if(kind==='weeklyMean4' && frequency==='weekly') return rows.flatMap(o=>{
    const values=Array.from({length:4},(_,k)=>lookup.get(new Date(new Date(`${o.date}T00:00:00Z`)-k*7*DAY).toISOString().slice(0,10)));
    return values.every(finite)?[{date:o.date,value:values.reduce((a,b)=>a+b,0)/4}]:[];
  });
  if(!['monthly','quarterly','annual'].includes(frequency)) return [];
  const stride=frequency==='quarterly'?3:frequency==='annual'?12:1;
  return rows.flatMap(o=>{
    let value=null;
    const window=length=>Array.from({length},(_,k)=>lookup.get(shiftedMonth(o.date,-k)));
    if(['mean3','sum12','compound3'].includes(kind) && frequency==='monthly') {
      const values=window(kind==='sum12'?12:3);
      if(values.every(finite)) value=kind==='mean3'?values.reduce((a,b)=>a+b,0)/3:kind==='sum12'?values.reduce((a,b)=>a+b,0):(values.reduce((a,b)=>a*(1+b/100),1)-1)*100;
    } else if(kind==='mean3diff' && frequency==='monthly') {
      const values=window(4); if(values.every(finite)) value=(values[0]-values[3])/3;
    } else if(['ann3','ann6'].includes(kind) && frequency==='monthly') {
      const months=kind==='ann3'?3:6,values=window(months+1);
      if(values.every(v=>finite(v)&&v>0))value=((values[0]/values[months])**(12/months)-1)*100;
    } else {
      const lag=kind==='yoy'||kind==='change12'?12:kind==='change3'?3:kind==='change6'?6:stride;
      const previous=lookup.get(shiftedMonth(o.date,-lag));
      if(finite(previous)) {
        if(['diff','change3','change6','change12'].includes(kind))value=o.value-previous;
        else if(kind==='yoy' && previous!==0)value=(o.value/previous-1)*100;
        else if(kind==='annualized' && frequency==='quarterly' && previous>0 && o.value>0)value=((o.value/previous)**4-1)*100;
      }
    }
    return finite(value)?[{date:o.date,value}]:[];
  });
}

/** Derived comparisons join exactly on reference date, never the latest two unrelated vintages. */
export function monitorJoin(a,b,calculate) {
  const other=new Map(b.map(o=>[o.date,o.value]));
  return a.flatMap(o=>{const second=other.get(o.date); if(!finite(second))return [];const value=calculate(o.value,second);return finite(value)?[{date:o.date,value}]:[];});
}

/** Every sector must exist for a month to enter the breadth history. No weighting is implied. */
export function monitorBreadth(sectors) {
  if(!sectors.length||sectors.some(s=>!s))return [];
  const maps=sectors.map(s=>new Map(validRows(s).map(o=>[o.date,o.value])));
  return validRows(sectors[0]).flatMap(o=>{
    const values=maps.map(m=>m.get(o.date));
    return values.every(finite)?[{date:o.date,value:values.filter(v=>v>0).length,total:values.length,negative:values.filter(v=>v<0).length}]:[];
  });
}

/** Each segment represents one disclosed condition. Divergence is never hidden by averaging. */
export function monitorConsensus(signals, labels={}) {
  const available=signals.filter(s=>[-1,0,1].includes(s.value)),positive=available.filter(s=>s.value===1).length,negative=available.filter(s=>s.value===-1).length;
  const counts={positive,negative,available:available.length,total:signals.length};
  if(available.length<signals.length||!signals.length)return {...counts,tone:'muted',label:'Cobertura parcial',position:-1};
  if(positive&&negative)return {...counts,tone:'neutral',label:labels.mixed||'Señales mixtas',position:1};
  if(positive&&positive<available.length)return {...counts,tone:'neutral',label:'Apoyo parcial',position:1};
  if(negative&&negative<available.length)return {...counts,tone:'neutral',label:'Deterioro parcial',position:1};
  if(positive)return {...counts,tone:'good',label:labels.positive||'Señales favorables',position:2};
  if(negative)return {...counts,tone:'watch',label:labels.negative||'Señales de deterioro',position:0};
  return {...counts,tone:'neutral',label:'Sin dirección clara',position:1};
}

function changeOverDays(rows,days=91) {
  // Binary search keeps daily market histories responsive (O(n log n), not O(n²)).
  return rows.flatMap(o=>{
    const target=new Date(`${o.date}T00:00:00Z`)-days*DAY,targetDate=new Date(target).toISOString().slice(0,10);
    let low=0,high=rows.length;
    while(low<high){const middle=(low+high)>>1;if(rows[middle].date<=targetDate)low=middle+1;else high=middle;}
    const previous=rows[low-1];
    return previous&&target-new Date(`${previous.date}T00:00:00Z`)<=7*DAY?[{date:o.date,value:o.value-previous.value}]:[];
  });
}

/** Weekly sampling of daily 13-week changes avoids counting every trading day
 * as independent evidence. Quantiles are a disclosed convention, not inference. */
export function marketChangeSignal(history,{digits=2,direction=-1}={}) {
  const empty={value:null,band:null,sampleSize:0,sensitivity:null};
  const rows=(history||[]).filter(o=>o&&finite(o.value)&&/^\d{4}-\d{2}-\d{2}$/.test(o.date)&&Number.isFinite(Date.parse(o.date+'T00:00:00Z'))&&new Date(o.date+'T00:00:00Z').toISOString().slice(0,10)===o.date).slice().sort((a,b)=>a.date.localeCompare(b.date));
  if(![1,-1].includes(direction)||!Number.isInteger(digits)||digits<0||digits>8||rows.some((o,i)=>i&&o.date===rows[i-1].date))return empty;
  const current=rows.at(-1);if(!current)return empty;
  const week=d=>Math.floor((Date.parse(d+'T00:00:00Z')/DAY+3)/7);
  const currentWeek=week(current.date), sampled=new Map();
  for(const o of rows){const w=week(o.date);if(w>=currentWeek-104&&w<currentWeek)sampled.set(w,o);}
  const prior=[...sampled.values()], result={...empty,sampleSize:prior.length,startDate:prior[0]?.date,endDate:prior.at(-1)?.date};
  if(prior.length<52)return result;
  const abs=prior.map(o=>Math.abs(o.value)).sort((a,b)=>a-b),q=p=>{const n=(abs.length-1)*p,l=Math.floor(n);return abs[l]+(abs[Math.ceil(n)]-abs[l])*(n-l);};
  const floor=.5*10**(-digits),band=Math.max(floor,q(.2)),low=Math.max(floor,q(.1)),high=Math.max(floor,q(.3));
  const classify=b=>Math.abs(current.value)<=b?0:Math.sign(current.value)*direction;
  const baseValue=classify(band),stable=classify(low)===baseValue&&classify(high)===baseValue;
  return {...result,band,baseValue,value:stable?baseValue:0,sensitivity:{lowBand:low,highBand:high,stable}};
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
  let cachedSeries,cachedDay,cached={};

  function build(scope='peru') {
    const ss=getSeries(),today=new Date(now()).toISOString().slice(0,10);
    if(ss!==cachedSeries||today!==cachedDay){cachedSeries=ss;cachedDay=today;cached={};}
    if(cached[scope])return cached[scope];
    const byCode=new Map(ss.map(s=>[`${s.provider}:${s.sourceCode}`,s]));
    const b=code=>byCode.get(`BCRP:${code}`),f=code=>byCode.get(`FRED:${code}`);
    const metric=(s,label,unit,kind='level',digits=1,customRows=null,sources=null)=>{
      const history=customRows ?? monitorTransform(s,kind),point=history.at(-1),dependencies=sources||[s];
      const sourceState=dependencies.some(s=>s?.status==='retained')?'retained':s?.status;
      const freshness=monitorFreshness({...s,status:sourceState},point,now());
      return {series:s,id:s?.id,label,unit:unit??s?.unit??'',kind,digits,history,value:point?.value,date:point?.date,freshness,dependencies};
    };
    const usable=m=>finite(m?.value)&&!['stale','missing'].includes(m.freshness.state);
    const val=(m,signed=false)=>finite(m?.value)?`${signed&&m.value>0?'+':''}${fmt(m.value,m.digits)}${m.unit?' '+m.unit:''}`:'sin dato';
    const derived=(a,b,label,unit,calculate,digits=1)=>metric(a?.series,label,unit,'derived',digits,monitorJoin(a?.history||[],b?.history||[],calculate),[...(a?.dependencies||[]),...(b?.dependencies||[])]);
    const signal=(m,label,rule,fn=v=>Math.sign(v))=>{
      const result=usable(m)?fn(m.value):null;
      if(m)m.signal=result;
      return {label,rule,value:result,metric:m};
    };
    // Only Peru's 3M changes use this operational filter; official thresholds and
    // descriptive growth/surplus zero crossings retain their original meanings.
    const changeSignal=(m,label,rule)=>{
      const calibration=calibratedChangeSignal(m.history,{digits:m.digits,direction:-1});
      const result=usable(m)?calibration.value:null;
      m.signal=result;
      return {label,rule,value:result,metric:m,calibration};
    };
    const worldChange=(m,label,rule,market=false)=>{
      const result=market?marketChangeSignal(m.history,{digits:m.digits,direction:-1}):calibratedChangeSignal(m.history,{digits:m.digits,direction:-1});
      const value=usable(m)?result.value:null;m.signal=value;
      const unit=m.unit||'pp';
      const filter=result.band===null?`Filtro no evaluable: ${result.sampleSize} periodos previos disponibles`:`Banda p20 ±${fmt(result.band,3)} ${unit}; ${result.sampleSize} ${market?'cortes semanales':'meses'} previos (${result.startDate} a ${result.endDate}); sensibilidad p10–p30: ±${fmt(result.sensitivity.lowBand,3)} a ±${fmt(result.sensitivity.highBand,3)} ${unit}, ${result.sensitivity.stable?'estable':'indeterminada'}`;
      return {label,rule,value,metric:m,filter};
    };
    const card=(config)=>{
      const state=config.state||monitorConsensus(config.signals,config.labels);
      const dates=[config.primary,...(config.evidence||[])].map(m=>m?.date).filter(Boolean).sort();
      return {...config,state,dateRange:dates.length?[dates[0],dates.at(-1)]:null};
    };
    if(scope==='peru') {
      const gdp=metric(b('PN01728AM'),'PBI real','% YOY');
      const gdp3=metric(b('PN01728AM'),'PBI · media 3M','% YOY','mean3');
      const impulse=metric(b('PN01731AM'),'PBI desest. · 3M','%','compound3');
      const sectors=['PN01713AM','PN01716AM','PN01717AM','PN01720AM','PN01723AM','PN01724AM','PN01725AM','PN01726AM'].map(b);
      const breadthRows=monitorBreadth(sectors),breadth=metric({...b('PN01728AM'),id:null},'Sectores creciendo','de 8','derived',0,breadthRows,sectors);
      const confidence=metric(b('PD38045AM'),'Expectativas 3M','pts');
      const nonprimary=metric(b('PN01730AM'),'PBI no primario','% YOY');
      const prices=metric(b('PN01273PM'),'Inflación general','% YOY','level',2);
      const core=metric(b('PN01277PM'),'IPC sin alimentos y energía','% YOY','level',2);
      const food=metric(b('PN09822PM'),'Alimentos','% YOY','level',2);
      const pricesDelta=metric(b('PN01273PM'),'IPC · Δ3M','pp','change3',2);
      const coreDelta=metric(b('PN01277PM'),'Sin alimentos y energía · Δ3M','pp','change3',2);
      const expectation=metric(b('PD12912AM'),'Expectativas 12M','%','level',2);
      const wholesale=metric(b('PN01287PM'),'Precios mayoristas','% YOY','level',2);
      const jobs=metric(b('PN31880GM'),'Empleo formal nacional','% YOY');
      const privateJobs=metric(b('PN31882GM'),'Empleo privado','% YOY');
      const income=metric(b('PN37697PM'),'Ingreso real formal','% YOY','yoy');
      const employment=metric(b('PN38051GM'),'Ocupados · Lima','% YOY','yoy');
      const unemployment=metric(b('PN38063GM'),'Desempleo Lima','%');
      const unemploymentDelta=metric(b('PN38063GM'),'Desempleo · ΔYOY','pp','change12');
      const credit=metric(b('PN00539MM'),'Crédito nominal','% YOY');
      const realCredit=derived(credit,prices,'Crédito real¹','% YOY',(a,c)=>((1+a/100)/(1+c/100)-1)*100);
      const business=metric(b('PN00536MM'),'Crédito empresas','% YOY');
      const mortgage=metric(b('PN07848NM'),'Hipotecaria PEN','% TEA','level',2);
      const corporate=metric(b('PN07809NM'),'Corporativa · Δ3M','pp','change3',2);
      const deposits=derived(metric(b('PN00281MM'),'Depósitos PEN','% YOY','yoy'),prices,'Depósitos PEN reales¹','% YOY',(a,c)=>((1+a/100)/(1+c/100)-1)*100);
      const reference=metric(b('PD04722MM'),'Referencia BCRP','%','level',2);
      const realRate=derived(reference,expectation.series?expectation:prices,expectation.series?'Tasa real ex ante¹':'Tasa real ex post¹','%',(a,c)=>((1+a/100)/(1+c/100)-1)*100,2);
      const fx=metric(b('PN01207PM'),'USD/PEN','% YOY','yoy',2);
      const trade=metric(b('PN38723BM'),'Comercio · 12M','M US$','sum12',0);
      const current=metric(b('PN39002BQ'),'Cuenta corriente','% PBI','level',2);
      const exports=metric(b('PN02536AQ'),'Exportaciones reales','% YOY','yoy');
      const reserves=metric(b('PN00027MM'),'RIN','M US$','level',0);
      const imports=metric(b('PN38718BM'),'Importaciones · 12M','M US$','sum12',0);
      const cover=derived(reserves,imports,'RIN / import.¹','meses',(r,m)=>m>0?r/(m/12):null,1);
      const terms=metric(b('PN38923BM'),'Térm. intercambio','% YOY','yoy');
      const growthSignals=[signal(gdp3,'Crecim.','Media de tres tasas YOY del PBI > 0'),signal(impulse,'Impulso','PBI desestacionalizado: variación acumulada de 3 meses > 0'),signal(breadth,'Sectores','Más de la mitad de los 8 sectores crece',v=>Math.sign(v-4)),signal(confidence,'Expect.','Expectativas a 3 meses > 50 puntos',v=>Math.sign(v-50))];
      const priceSignals=[signal(prices,'Meta','IPC general en el rango BCRP 1%–3%',v=>v>=1&&v<=3?1:-1),changeSignal(pricesDelta,'Impulso','Inflación general: disminución 3M fuera de banda operativa'),changeSignal(coreDelta,'Sin A&E','Inflación sin alimentos y energía: disminución 3M fuera de banda operativa')];
      if(expectation.series)priceSignals.push(signal(expectation,'Expect.','Inflación esperada a 12 meses entre 1% y 3%; referencia analítica a la meta general',v=>v>=1&&v<=3?1:-1));
      const cards=[
        card({key:'growth',title:'Actividad',primary:gdp,heroLabel:'PBI real · YOY',evidence:[gdp3,impulse,breadth,confidence,nonprimary],signals:growthSignals,labels:{positive:'Expansión respaldada',negative:'Debilidad extendida'},
          summary:usable(gdp3)&&usable(breadth)?`${val(breadth)} sectores crecen. Impulso 3M: ${val(impulse,true)}; expectativas: ${val(confidence)}.`:'Se necesitan crecimiento, impulso, amplitud y expectativas recientes para completar la lectura.',
          methodology:'Crecimiento = media aritmética de tres tasas YOY; no es la tasa del PBI trimestral. Impulso = producto de (1 + MOM/100) de tres meses desestacionalizados, menos 1. Amplitud: agropecuario, pesca, minería e hidrocarburos, manufactura, electricidad y agua, construcción, comercio y otros servicios. Se exige el mismo mes para los ocho, sin ponderar; el recuento no mide su contribución al PBI. Expectativas: 50 es el punto de equilibrio del índice de difusión. Las cuatro condiciones se muestran por separado y ninguna sustituye a las demás.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN01728AM-PN01731AM-PD38045AM/html'}),
        card({key:'prices',title:'Precios',primary:prices,heroLabel:'IPC Lima · YOY',evidence:[core,food,expectation.series?expectation:wholesale,pricesDelta,coreDelta],signals:priceSignals,labels:{positive:'Presión contenida',negative:prices.value>3?'Presión persistente':'Fuera de rango'},
          summary:usable(prices)&&usable(pricesDelta)?`IPC ${prices.value<1?'bajo':prices.value>3?'sobre':'en'} el rango de 1–3%. En 3M, general ${val(pricesDelta,true)} y sin alimentos y energía ${val(coreDelta,true)}.`:'La meta, el cambio de la inflación y su componente persistente se evalúan con periodos exactos.',
          methodology:'La meta BCRP 1%–3% corresponde al IPC general de Lima. PN01277PM mide IPC sin alimentos y energía, no el IPC subyacente PN01279PM. Para estos componentes se informa el dato, sin atribuirles una meta oficial distinta. Cambios 3M = tasa YOY actual menos tasa YOY de hace tres meses, en puntos porcentuales; no son inflación trimestral anualizada. Las expectativas se contrastan con la meta general como señal de anclaje. No se anualiza el IPC no desestacionalizado.',source:'https://www.bcrp.gob.pe/politica-monetaria.html'}),
        card({key:'jobs',title:'Trabajo e ingresos',primary:jobs,heroLabel:'Empleo formal nacional · YOY',evidence:[privateJobs,income,employment,unemployment,unemploymentDelta],signals:[signal(privateJobs,'Empleo','Empleo formal privado: YOY > 0'),signal(income,'Ingreso','Ingreso formal privado real: YOY > 0'),signal(employment,'Ocupados','Población ocupada de Lima: YOY > 0'),signal(unemploymentDelta,'Desempl.','Tasa de desempleo Lima: cambio YOY < 0',v=>-Math.sign(v))],labels:{positive:'Mejora extendida',negative:'Deterioro extendido'},
          summary:usable(income)&&usable(unemploymentDelta)?`Ingreso real ${val(income,true)}; desempleo de Lima ${val(unemploymentDelta,true)} frente a un año antes.`:'Se contrastan empleo, poder de compra y mercado laboral de Lima; la cobertura no representa todo el empleo nacional.',
          methodology:'Empleo formal nacional y privado: registros administrativos. Ingreso real: variación YOY del nivel deflactado publicado. Ocupados y desempleo: Lima Metropolitana, ventanas móviles de tres meses; se compara la misma ventana del año anterior para evitar interpretar estacionalidad como mejora. Empleo formal privado, ingreso real, ocupados y desempleo de Lima determinan cuatro señales; no se extrapolan al empleo informal ni al desempleo nacional.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN31880GM-PN37697PM-PN38063GM/html'}),
        card({key:'credit',title:'Financiamiento',primary:realCredit,heroLabel:'Crédito real¹ · YOY',evidence:[business,deposits,corporate,realRate,fx],signals:[signal(realCredit,'Crédito real','Crecimiento crediticio real > 0'),signal(deposits,'Depósitos','Depósitos en soles, deflactados: YOY > 0'),changeSignal(corporate,'Costo PEN','Tasa preferencial corporativa en soles: descenso 3M fuera de banda operativa')],labels:{positive:'Expansión y menor costo',negative:'Contracción y mayor costo'},
          summary:usable(realCredit)&&usable(corporate)?`Crédito real ${val(realCredit,true)}; costo corporativo ${val(corporate,true)} en 3M. USD/PEN: ${val(fx,true)}.`:'La lectura necesita crédito real, depósitos reales y costo corporativo recientes.',
          methodology:`¹ Crédito y depósitos reales = [(1 + crecimiento nominal/100)/(1 + IPC YOY/100) − 1] × 100, en el mismo mes. El IPC de Lima aproxima la deflación; crédito y depósitos conservan su cobertura original. Tasa real ${expectation.series?'ex ante usa expectativas de inflación a 12 meses':'ex post usa inflación observada YOY'} y la identidad de Fisher; no estima la tasa neutral. USD/PEN es contexto: una subida indica depreciación del sol, sin asignarle automáticamente signo favorable o desfavorable. Las tres condiciones describen volumen y precio del financiamiento, no solvencia bancaria.`,source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/mensuales/resultados/PN00539MM-PN00281MM-PN07809NM/html'}),
        card({key:'external',title:'Sector externo',primary:current,heroLabel:'Cuenta corriente · % PBI',evidence:[trade,exports,terms,reserves,cover],signals:[signal(current,'Cta. cte.','Saldo corriente del trimestre > 0'),signal(exports,'Volumen','Exportaciones reales de bienes y servicios: YOY > 0'),signal(terms,'Precios','Términos de intercambio: YOY > 0')],labels:{positive:'Apoyos externos',negative:'Presión externa'},
          summary:usable(current)&&usable(exports)?`Cuenta corriente ${current.value>0?'superavitaria':current.value<0?'deficitaria':'equilibrada'}; exportaciones reales ${val(exports,true)}. Bienes 12M: ${val(trade)}.`:'Se distinguen saldo corriente, volúmenes exportados, precios relativos y liquidez externa.',
          methodology:'Cuenta corriente: saldo trimestral / PBI del trimestre, distinto del saldo de bienes. Balanza comercial 12M: suma de doce meses consecutivos. Exportaciones reales: bienes y servicios, variación YOY del trimestre. Términos de intercambio: cociente de precios de exportación e importación, YOY. ¹ Meses de importación = RIN / promedio mensual de importaciones FOB de bienes de los últimos doce meses, ambos al mismo mes; medida descriptiva calculada aquí, sin servicios y sin umbral oficial de suficiencia. Reservas y comercio se muestran como contexto, no como votos adicionales correlacionados.',source:'https://estadisticas.bcrp.gob.pe/estadisticas/series/trimestrales/resultados/PN39002BQ-PN02536AQ/html'})
      ];
      cached[scope]=cards;return cards;
    }
    const gdp=metric(f('GDPC1'),'PBI real','% QOQ anualizado','annualized');
    const production=metric(f('INDPRO'),'Industria · 3M','% anual.','ann3');
    const consumption=metric(f('PCEC96'),'Consumo real · 3M','% anual.','ann3');
    const productionYoy=metric(f('INDPRO'),'Industria · YOY','% YOY','yoy');
    const capacity=metric(f('TCU'),'Capacidad utilizada','%');
    const cfnai=metric(f('CFNAIMA3'),'CFNAI · media 3M','índice','level',2);
    const pce=metric(f('PCEPI'),'PCE general','% YOY','yoy',2);
    const core=metric(f('PCEPILFE'),'PCE subyacente','% YOY','yoy',2);
    const core3=metric(f('PCEPILFE'),'PCE subyac. · 3M','% anual.','ann3',2);
    const core6=metric(f('PCEPILFE'),'PCE subyac. · 6M','% anual.','ann6',2);
    const cpi=metric(f('CPIAUCSL'),'IPC general','% YOY','yoy',2);
    const expectations=metric(f('T5YIE'),'Breakeven 5a','%','level',2);
    const pceGap=metric(pce.series,'PCE general − objetivo 2%','pp','derived',2,pce.history.map(o=>({...o,value:o.value-2})));
    const core3Gap=derived(core3,core,'Impulso 3M vs. YOY','pp',(a,b)=>a-b,2),core6Gap=derived(core6,core,'Impulso 6M vs. YOY','pp',(a,b)=>a-b,2);
    const payroll=metric(f('PAYEMS'),'Nóminas · media 3M','mil/mes','mean3diff',0);
    const jobsChange=metric(f('PAYEMS'),'Nóminas · MOM','mil','diff',0);
    const unemployment=metric(f('UNRATE'),'Desempleo','%');
    const sahm=metric(f('SAHMREALTIME'),'Sahm · umbral ≥ 0,50','pp','level',2);
    const claims=metric(f('ICSA'),'Peticiones · 4S','mil','weeklyMean4',0);
    claims.history=claims.history.map(o=>({...o,value:o.value/1000}));claims.value=claims.history.at(-1)?.value;
    const claimsChange=metric(f('ICSA'),'Peticiones 4S · cambio 13S','mil','derived',1,changeOverDays(claims.history));
    const wages=derived(metric(f('CES0500000003'),'Salario por hora','% YOY','yoy'),cpi,'Salario real¹','% YOY',(a,b)=>((1+a/100)/(1+b/100)-1)*100);
    claims.note=`Δ 13S: ${val(claimsChange,true)}`;
    const nfci=metric(f('NFCI'),'NFCI','índice','level',2);
    const stress=metric(f('STLFSI4'),'Estrés St. Louis','índice','level',2);
    const vix=metric(f('VIXCLS'),'VIX','pts','level',1);
    const hy=metric(f('BAMLH0A0HYM2'),'Spread high yield','pp','level',2);
    const ig=metric(f('BAMLC0A0CM'),'Spread IG','pp','level',2);
    const hyChange=metric(hy.series,'High yield · Δ13S','pp','derived',2,changeOverDays(hy.history));
    const vixChange=metric(vix.series,'VIX · cambio 13S','pts','derived',1,changeOverDays(vix.history));
    vix.note=`Δ 13S: ${val(vixChange,true)}`;
    const curve=metric(f('T10Y3M')||f('T10Y2Y'),f('T10Y3M')?'Curva UST 10a − 3m':'Curva UST 10a − 2a','pp','level',2);
    const cycleAvailable=[sahm,cfnai].filter(usable),cycleCount=cycleAvailable.filter(m=>m===sahm?m.value>=.5:m.value<-.7).length;
    const cycleSignals=[signal(sahm,'Empleo','Sahm < 0,50 pp',v=>v>=.5?-1:1),signal(cfnai,'Actividad','CFNAI-MA3 ≥ −0,70',v=>v<-.7?-1:1)];
    const cycleState=cycleAvailable.length<2?{tone:'muted',label:'Cobertura parcial',position:-1}:cycleCount===0?{tone:'neutral',label:'Sin umbrales activos',position:2}:cycleCount===1?{tone:'watch',label:'Una señal activa',position:1}:{tone:'risk',label:'Dos señales activas',position:0};
    const cards=[
      card({key:'growth',title:'Actividad',primary:gdp,heroLabel:'PBI real · QOQ anualizado',evidence:[production,consumption,productionYoy,cfnai,capacity],signals:[signal(gdp,'PBI','PBI real: QOQ anualizado > 0'),signal(production,'Industria','Producción industrial: 3M anualizado > 0'),signal(consumption,'Consumo','Consumo real: 3M anualizado > 0')],labels:{positive:'Expansión respaldada',negative:'Contracción extendida'},
        summary:usable(production)&&usable(consumption)?`Impulso 3M anualizado: industria ${fmt(production.value,1)}% y consumo ${fmt(consumption.value,1)}%.`:'La lectura contrasta PBI trimestral con producción y consumo mensuales.',
        methodology:'PBI: [(trimestre actual / anterior)^4 − 1] × 100. Impulso mensual 3M: [(nivel actual / nivel de hace 3 meses)^4 − 1] × 100; requiere cuatro meses consecutivos y series desestacionalizadas. No equivale a YOY. CFNAI-MA3 y capacidad son contexto; CFNAI cero significa crecimiento en torno a la tendencia histórica, no PBI sin crecimiento. Tres condiciones contrastan actividad agregada, industria y consumo, sin ponderarlas en un índice.',source:'https://fred.stlouisfed.org/series/GDPC1'}),
      card({key:'prices',title:'Inflación',primary:pce,heroLabel:'PCE general · YOY',evidence:[pceGap,core,core3,core6,cpi,expectations],signals:[worldChange(core3Gap,'Impulso 3M','PCE subyacente 3M anualizado vs. YOY: diferencia filtrada'),worldChange(core6Gap,'Impulso 6M','PCE subyacente 6M anualizado vs. YOY: diferencia filtrada')],labels:{positive:'Impulso menor que YOY',negative:'Impulso mayor que YOY'},
        summary:usable(core3)&&usable(core)?`Subyacente: ${val(core3)} a 3M frente a ${val(core)}. PCE general ${usable(pce)?(pce.value>2?'sobre':'en o bajo'):'sin comparación con'} el 2%.`:'Se contrastan inflación anual e impulso de 3 y 6 meses con ajuste estacional.',
        methodology:'La meta Fed es 2% sobre el PCE general YOY, a largo plazo. Su distancia se muestra como contexto separado, sin inventar una banda oficial ni premiar cualquier inflación bajo 2%. El estado de esta tarjeta describe exclusivamente el impulso subyacente respecto a su ritmo anual, no cumplimiento del objetivo: impulso menor puede coexistir con inflación elevada o deflación. PCE subyacente 3M/6M = [(nivel / nivel rezagado)^4 o ^2 − 1] × 100, con todos los meses y series desestacionalizadas. Sus diferencias respecto a YOY miden impulso, no desviaciones de una meta independiente. Los horizontes comparten observaciones y no son señales estadísticamente independientes. Breakeven 5a incluye primas de riesgo y liquidez; no es una expectativa pura.',source:'https://www.federalreserve.gov/faqs/economy_14400.htm'}),
      card({key:'jobs',title:'Empleo e ingresos',primary:payroll,heroLabel:'Nóminas · media de cambios MOM de 3M',evidence:[jobsChange,unemployment,sahm,claims,wages],signals:[signal(payroll,'Creación','Media de tres cambios MOM de nóminas > 0'),signal(wages,'Salario real','Salario real aproximado: YOY > 0'),signal(claimsChange,'Peticiones','Media de cuatro semanas de peticiones menor que hace trece semanas',v=>-Math.sign(v)),signal(sahm,'Desempleo','Sahm < 0,50 pp',v=>v>=.5?-1:1)],labels:{positive:'Resiliencia respaldada',negative:'Deterioro extendido'},
        summary:usable(payroll)&&usable(wages)?`Creación media ${val(payroll,true)}; salario real ${val(wages,true)}. Peticiones 4S: ${val(claims)}.`:'Se contrastan nóminas, desempleo, peticiones e ingreso real con sus fechas de referencia.',
        methodology:'Nóminas 3M = (PAYEMS actual − nivel de hace 3 meses)/3; exige cuatro meses consecutivos. Peticiones: media de cuatro semanas exactas; su cambio compara con trece semanas atrás. Sahm se toma de la serie oficial en tiempo real, preservando su metodología de vintages. ¹ Salario real aproximado = [(1 + salario horario YOY/100)/(1 + IPC YOY/100) − 1] × 100, en el mismo mes; no corrige cambios de composición del empleo. Ninguna regla es una tasa de desempleo de equilibrio.',source:'https://fred.stlouisfed.org/series/PAYEMS',extraSource:'https://fred.stlouisfed.org/series/SAHMREALTIME'}),
      card({key:'finance',title:'Condiciones financieras',primary:nfci,heroLabel:'NFCI · desviación del promedio',evidence:[stress,hy,hyChange,ig,vix],signals:[signal(nfci,'NFCI','NFCI < 0: condiciones más holgadas que el promedio',v=>-Math.sign(v)),worldChange(hyChange,'Crédito','Spread high yield: cambio de trece semanas filtrado',true),worldChange(vixChange,'VIX','VIX: cambio de trece semanas filtrado',true)],labels:{positive:'Holgura y alivio',negative:'Tensión y deterioro'},
        summary:usable(nfci)&&usable(hyChange)?`NFCI ${nfci.value<0?'bajo':'sobre'} su promedio; spread HY ${val(hyChange,true)} y VIX ${val(vixChange,true)} en 13S.`:'La lectura necesita nivel de condiciones financieras y cambios recientes de crédito y volatilidad.',
        methodology:'NFCI < 0: condiciones más holgadas que su promedio histórico; STLFSI < 0: estrés por debajo de su promedio. Se informa el nivel de ambos índices sin sumarlos. Impulso de spread HY y VIX: último valor menos el de trece semanas atrás, usando el día publicado más cercano anterior (tolerancia máxima de siete días). Los cambios pequeños o sensibles a la banda elegida se muestran neutrales. Los restantes describen alivio/tensión relativa, no umbrales universales de crisis. 1 pp de spread = 100 pb. La dependencia entre indicadores impide interpretar el recuento como probabilidad.',source:'https://www.chicagofed.org/research/data/nfci/about'}),
      card({key:'cycle',title:'Señales del ciclo',primary:null,customHeadline:`${cycleCount} / ${cycleAvailable.length}`,customHeroLabel:'umbrales activos · Sahm y CFNAI',evidence:[sahm,cfnai,curve,payroll,claims],signals:cycleSignals,state:cycleState,
        summary:cycleAvailable.length===2?`${cycleCount} de 2 umbrales activos. Curva ${val(curve,true)}; creación media ${val(payroll,true)}.`:'Cobertura insuficiente para evaluar conjuntamente las reglas de empleo y actividad.',
        methodology:'Recuento exclusivo de dos reglas publicadas: Sahm en tiempo real ≥ 0,50 pp y CFNAI-MA3 < −0,70. La primera contrasta el desempleo medio de 3 meses con el mínimo de las medias de los doce meses anteriores; la segunda tiene interpretación recesiva histórica después de una expansión. Ambas pueden dar señales falsas y revisarse. Curva, nóminas y peticiones aportan contexto adelantado o coincidente, pero no se añaden al recuento. Una curva positiva no descarta una recesión ni elimina una inversión previa. No estima probabilidades ni sustituye la datación NBER.',source:'https://fred.stlouisfed.org/series/SAHMREALTIME',extraSource:'https://www.chicagofed.org/research/data/cfnai/current-data'})
    ];
    cached[scope]=cards;return cards;
  }

  function formatMetric(m) {return finite(m?.value)?`${fmt(m.value,m.digits)}${m.unit?' '+m.unit:''}`:'Sin dato';}
  function freshnessLabel(m) {return m?.freshness.state==='stale'?(m.freshness.reason==='origin-release'?' · rezago frente al origen':' · dato antiguo'):m?.freshness.state==='retained'?' · descarga conservada':'';}
  function evidenceHTML(m) {
    const muted=['missing','stale'].includes(m.freshness.state),tone=muted?'muted':m.signal===1?'good':m.signal===-1?'watch':'neutral';
    return `<div class="pulse-evidence ${muted?'pulse-evidence-missing':''}"><span class="pulse-evidence-label"><i class="pulse-dot ${tone}" aria-hidden="true"></i>${esc(m.label)}</span><strong>${esc(formatMetric(m))}</strong><span class="pulse-evidence-date">${m.date?esc(date(m.date,m.series?.frequency)):'Sin observaciones'}${esc(freshnessLabel(m))}${m.note?` · ${esc(m.note)}`:''}</span></div>`;
  }
  function sparkHTML(m) {
    const rows=m?.history?.slice(-18)||[];if(rows.length<3)return '';
    const lo=Math.min(...rows.map(o=>o.value)),hi=Math.max(...rows.map(o=>o.value)),span=hi-lo||1;
    const path=rows.map((o,i)=>`${i?'L':'M'}${(i/(rows.length-1)*92+4).toFixed(2)},${(30-(o.value-lo)/span*25).toFixed(2)}`).join(' ');
    return `<span class="pulse-spark" title="${rows.length} observaciones · escala propia"><svg viewBox="0 0 100 36" aria-hidden="true"><path d="${path} L96,35 L4,35 Z" fill="currentColor" opacity=".07"/><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="96" cy="${(30-(rows.at(-1).value-lo)/span*25).toFixed(2)}" r="2.6" fill="currentColor"/></svg></span>`;
  }
  function headlineHTML(c) {
    const primary=c.primary,primaryUnit=primary?.unit?.replace(/\s+(YOY|QOQ).*$/,'')||'';
    const valueHTML=c.customHeadline?`<strong>${esc(c.customHeadline)}</strong>`:finite(primary?.value)?`<strong>${esc(fmt(primary.value,primary.digits))} <small class="pulse-value-unit">${esc(primaryUnit)}</small></strong>`:'<strong>Sin dato</strong>';
    return `<div class="pulse-headline"><div>${valueHTML}<span>${esc(c.customHeroLabel||c.heroLabel)}</span></div>${sparkHTML(primary)}</div><p class="pulse-primary-date">${primary?.date?`${esc(date(primary.date,primary.series?.frequency))}${esc(freshnessLabel(primary))} · ${esc(primary.series?.provider||'')}`:'EE. UU. · dos reglas publicadas'}</p>`;
  }
  function signalHTML(c) {
    const active=c.signals.filter(s=>s.value!==null),positive=active.filter(s=>s.value===1).length,negative=active.filter(s=>s.value===-1).length;
    const neutral=active.length-positive-negative;
    const caption=c.key==='cycle'?`${c.customHeadline} umbrales activos`:`${positive} apoyos · ${negative} alertas${neutral?` · ${neutral} neutrales`:''}${active.length<c.signals.length?` · ${c.signals.length-active.length} sin dato`:''}`;
    return `<div class="pulse-signal-meter" role="img" aria-label="${esc(caption)}">${c.signals.map(s=>`<span class="${s.value===1?'good':s.value===-1?'watch':s.value===null?'muted':'neutral'}" title="${esc(s.rule)}"><i></i><span>${esc(s.label)}</span></span>`).join('')}</div><p class="pulse-signal-caption">${esc(caption)}</p>`;
  }
  function rulesHTML(c) {
    return `<ul class="pulse-method-rules">${c.signals.map(s=>`<li><i class="pulse-dot ${s.value===1?'good':s.value===-1?'watch':s.value===null?'muted':'neutral'}" aria-hidden="true"></i><span>${esc(s.rule)}<small>${s.metric?.date?esc(date(s.metric.date,s.metric.series?.frequency))+' · ':''}${esc(formatMetric(s.metric))}${s.filter?` · ${esc(s.filter)}`:''}${s.calibration?` · ${esc(s.calibration.band===null?'Banda no evaluable: historial insuficiente o ambiguo':`Banda p20 ±${fmt(s.calibration.band,3)} pp · ${s.calibration.sampleSize} meses (${s.calibration.startDate} a ${s.calibration.endDate}) · ${s.calibration.persistence} cortes con igual clasificación (no implica tasa sin cambios) · sensibilidad p10–p30 (${fmt(s.calibration.sensitivity.lowBand,3)}–${fmt(s.calibration.sensitivity.highBand,3)} pp) ${s.calibration.sensitivity?.stable?'estable':'indeterminada'}`)}`:''}${s.value===null?' · no evaluable':s.value===0?' · neutral (no implica cambio exactamente nulo)':s.value===1?' · cumple':' · no cumple'}</small></span></li>`).join('')}</ul>`;
  }
  function renderCard(c,scope) {
    const id=`pulse-reading-${scope}-${c.key}`;
    return `<article class="pulse-card pulse-${c.state.tone}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(c.title)}: ${esc(c.state.label)}. Ver indicadores y método" aria-describedby="${id}" data-pulse-open="${scope}:${c.key}"><div class="pulse-card-top"><h3>${esc(c.title)} <i class="fa-solid fa-arrow-up-right-from-square pulse-open-icon" aria-hidden="true"></i></h3><span class="pulse-status">${esc(c.state.label)}</span></div>${headlineHTML(c)}${signalHTML(c)}<p class="pulse-reading" id="${id}">${esc(c.summary)}</p>${c.dateRange?`<p class="pulse-primary-date">Referencias: ${esc(c.dateRange[0])} — ${esc(c.dateRange[1])}</p>`:''}</article>`;
  }
  function criteriaHTML(scope) {
    return `<section class="pulse-dialog-criteria"><h3>Clasificación y vigencia</h3>${scope==='peru'?'<p>Para los cambios 3M de inflación y tasa corporativa, banda neutral = percentil 20 de cambios absolutos de cada indicador en los 60 meses previos (mínimo 36), excluido el actual y con piso de media unidad de redondeo. Es una convención operativa, no significancia económica o estadística. Se contrasta p10–p30; si discrepan, la señal es neutral por sensibilidad. Persistencia: meses consecutivos con la misma clasificación, calculada con observaciones de periodos anteriores del historial revisado disponible; las ventanas 3M se solapan y no son evidencias independientes. El historial incorpora revisiones: no es una validación en tiempo real. No altera la meta de inflación, el umbral 50 de expectativas ni los signos descriptivos de crecimiento y saldos.</p>':'<p>En EE. UU., la distancia del PCE general al 2% es contexto y no un voto de desinflación. Para las diferencias de impulso subyacente 3M/6M frente a YOY, banda p20 de valores absolutos de los 60 meses anteriores (mínimo 36). Para cambios de 13 semanas del spread HY y VIX, se toma el último corte publicado de cada semana de las 104 semanas anteriores, excluida la semana actual (mínimo 52). Cada indicador conserva su unidad y tiene un piso de media unidad de redondeo. Se contrasta p10–p30: si la dirección depende de esa elección, queda neutral. Son convenciones descriptivas, no umbrales oficiales, significancia estadística ni probabilidades; las ventanas se solapan, los datos se revisan y no constituyen validación predictiva. Los niveles NFCI y reglas Sahm/CFNAI conservan su interpretación publicada.</p>'}<p>Cada segmento representa una condición: verde, apoyo; ámbar, alerta; gris, sin dirección o sin dato. Apoyos y alertas producen una lectura mixta; condiciones neutrales o indeterminadas, confirmación parcial; y condiciones faltantes, cobertura parcial. No se promedian puntuaciones ni se calculan probabilidades. Las señales del ciclo cuentan únicamente dos umbrales publicados.</p><p>Fechas mixtas: las tarjetas no son una estimación sincronizada del presente ni un pronóstico. Fechas propias por indicador; las operaciones entre series exigen el mismo periodo. Se excluyen datos con más de 10 días (diarios), 28 (semanales), 100 (mensuales), 180 (trimestrales) o 730 (anuales) desde el fin del periodo. Son límites de respaldo, no calendarios de publicación. Una publicación más reciente verificada en el origen prevalece sobre esos límites; se conserva el dato del proveedor sin mezclarlo automáticamente con otra fuente. YOY: mismo periodo del año anterior; MOM: mes anterior; QOQ: trimestre anterior; pp: puntos porcentuales. ¹ Cálculo derivado.</p></section>`;
  }
  function modal(scope='peru',key) {
    scope=scope==='world'?'world':'peru';
    const c=build(scope).find(c=>c.key===key);if(!c)return '';
    const metrics=[c.primary,...c.evidence,...c.signals.map(s=>s.metric)].filter(Boolean);
    const sources=[...new Map(metrics.flatMap(m=>m.dependencies||[m.series]).filter(Boolean).map(s=>[`${s.provider}:${s.sourceCode||s.id}`,s])).values()];
    return `<div class="pulse-dialog pulse-${c.state.tone}"><div class="pulse-dialog-intro"><div class="pulse-dialog-summary"><div class="pulse-dialog-context"><span>${scope==='world'?'Estados Unidos':'Perú'}</span><span class="pulse-status">${esc(c.state.label)}</span></div>${headlineHTML(c)}${signalHTML(c)}<p class="pulse-reading">${esc(c.summary)}</p></div><section class="pulse-dialog-evidence"><h3>Indicadores de respaldo</h3><div class="pulse-evidence-list">${c.evidence.map(evidenceHTML).join('')}</div></section></div><section class="pulse-dialog-rules"><h3>Condiciones evaluadas</h3>${rulesHTML(c)}${[...new Map(metrics.filter(m=>m.freshness?.sourceRelease).map(m=>[m.freshness.sourceRelease.url,m.freshness.sourceRelease])).values()].map(r=>`<p class="pulse-reading">Rezago verificado: el origen publicó el periodo ${esc(r.referenceDate)} el ${esc(r.publicationDate)}. Se mantiene la serie del proveedor sin sustituir valores. <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Publicación de origen</a>.</p>`).join('')}</section><section class="pulse-dialog-method"><h3>Método</h3><p>${esc(c.methodology)}</p><p class="pulse-method-links"><a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer">Referencia oficial <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>${c.extraSource?`<a href="${esc(c.extraSource)}" target="_blank" rel="noopener noreferrer">Regla publicada <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`:''}</p></section><section class="pulse-dialog-sources"><h3>Series y fuentes</h3><div class="pulse-source-list">${sources.map(s=>`<a href="${esc(s.sourceUrl||s.metadataUrl||c.source)}" target="_blank" rel="noopener noreferrer"><strong>${esc(s.name||s.sourceCode||s.id)}</strong><span>${esc(s.primarySource||s.originalSource||s.provider)} · ${esc(s.sourceCode||s.id)} · ${esc(s.unit||'')} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></span></a>`).join('')}</div></section>${criteriaHTML(scope)}</div>`;
  }
  function open(scope='peru',key) {
    scope=scope==='world'?'world':'peru';
    const c=build(scope).find(c=>c.key===key);if(!c||typeof ctx.showDialog!=='function')return false;
    ctx.showDialog(`Pulso · ${c.title}`,modal(scope,key));return true;
  }
  const boundContainers=new WeakSet();
  function bind(container) {
    if(!container||boundContainers.has(container))return;
    const activate=event=>{
      const card=event.target?.closest?.('[data-pulse-open]');
      if(!card||!container.contains(card))return;
      if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
      if(event.type==='keydown'){event.preventDefault();if(event.repeat)return;}
      const [scope,key]=card.dataset.pulseOpen.split(':');open(scope,key);
    };
    container.addEventListener('click',activate);container.addEventListener('keydown',activate);boundContainers.add(container);
  }
  function render(scope='peru') {
    scope=scope==='world'?'world':'peru';
    return `<section class="economic-pulse" aria-labelledby="pulse-title-${scope}"><div class="pulse-section-head"><h2 id="pulse-title-${scope}">${scope==='world'?'Pulso de EE. UU. · transmisión global':'Pulso económico del Perú'}</h2></div><p class="pulse-primary-date">Lectura descriptiva · referencias mixtas por indicador, no pronóstico. Ver fechas, magnitudes y método en cada tarjeta.</p><div class="pulse-grid">${build(scope).map(c=>renderCard(c,scope)).join('')}</div></section>`;
  }
  return {render,build,modal,open,bind};
}
