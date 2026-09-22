/**
 * Treasury Hub analytical charts.
 * Layout stays in treasury-core.css; this module only owns plot rendering and
 * source-backed annotations. Nulls are never interpolated and exported rows
 * are the original observations in the selected time window.
 */
const finite = n => typeof n === 'number' && Number.isFinite(n);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp = date => Date.parse(date + 'T00:00:00Z');
const nextMonth = date => { const d = new Date(stamp(date)); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
const opacity = (color, alpha) => {
  if (/^#[\da-f]{6}$/i.test(color)) return `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},${alpha})`;
  return color;
};

/** Empirical CDF: percentage of finite observations at or below the value. */
export function percentileRank(values, value) {
  const valid = values.filter(finite);
  return valid.length && finite(value) ? valid.filter(n => n <= value).length / valid.length * 100 : null;
}

export function computeStats(rows, history = rows) {
  const valid = rows.filter(o => finite(o.value));
  if (!valid.length) return null;
  const sorted = valid.map(o => o.value).sort((a,b) => a-b);
  const n = sorted.length, mid = Math.floor(n / 2), latest = valid.at(-1);
  const historical = history.filter(o => finite(o.value));
  return {
    count: n, min: sorted[0], max: sorted.at(-1),
    mean: valid.reduce((sum,o) => sum + o.value, 0) / n,
    median: n % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2,
    latest, firstDate: valid[0].date, lastDate: latest.date,
    percentile: percentileRank(historical.map(o => o.value), latest.value),
    historyCount: historical.length, historyStart: historical[0]?.date, historyEnd: historical.at(-1)?.date,
  };
}

/** OLS on pairs already aligned by exact date. No forecast or causal claim. */
export function regression(rows) {
  const valid = rows.filter(o => finite(o.x) && finite(o.y));
  if (valid.length < 3) return null;
  const n = valid.length, mx = valid.reduce((a,o) => a+o.x,0)/n, my = valid.reduce((a,o) => a+o.y,0)/n;
  let xx=0, yy=0, xy=0;
  for (const o of valid) { xx+=(o.x-mx)**2; yy+=(o.y-my)**2; xy+=(o.x-mx)*(o.y-my); }
  if (!xx || !yy) return null;
  const slope=xy/xx, intercept=my-slope*mx, r=xy/Math.sqrt(xx*yy);
  const xs=valid.map(o=>o.x), min=Math.min(...xs), max=Math.max(...xs);
  return {n,slope,intercept,r,r2:Math.min(1,Math.max(0,r*r)),line:[[min,intercept+slope*min],[max,intercept+slope*max]]};
}

/** Exact-date subtraction, returning no synthetic or carried-forward values. */
export function spreadRows(left, right) {
  const lookup = new Map(right.filter(o => finite(o.value)).map(o => [o.date,o.value]));
  return left.filter(o => finite(o.value) && lookup.has(o.date)).map(o => ({date:o.date,value:o.value-lookup.get(o.date)}));
}

/** USREC denotes US recessions only. Missing months end a band. */
export function recessionBands(series, startDate, endDate) {
  if (!series || series.sourceCode !== 'USREC' || series.provider !== 'FRED') return [];
  const rows = (series.observations || []).filter(o => o.value === 0 || o.value === 1);
  const bands = [];
  let first = null, previous = null;
  const close = end => {
    if (first && end > startDate && first <= endDate) bands.push([first < startDate ? startDate : first, end > endDate ? endDate : end]);
    first = null;
  };
  for (const row of rows) {
    if (first && previous && row.date !== nextMonth(previous)) close(nextMonth(previous));
    if (row.value === 1 && !first) first = row.date;
    if (row.value === 0 && first) close(row.date);
    previous = row.date;
  }
  if (first && previous) close(nextMonth(previous));
  return bands.filter(([a,b]) => a < b);
}

export function createChartEngine(context) {
  const {colors,css,theme,fmt,date,chart,chartRows,unitKey,windowRows,withGaps,cut,transform,commonDates,isRate} = context;
  const getRange = () => typeof context.range === 'function' ? context.range() : context.range;
  const palette = () => [theme() ? '#71d2dd' : css('--navy3'), colors[2], colors[3], colors[0], colors[1], colors[4], colors[5], colors[6]];
  const compact = n => {
    if (!finite(n)) return '—';
    const v=Math.abs(n);
    return v>=1e12 ? `${fmt(n/1e12,1)} B` : v>=1e9 ? `${fmt(n/1e9,1)} mil M` : v>=1e6 ? `${fmt(n/1e6,1)} M` : v>=1e4 ? `${fmt(n/1e3,0)} mil` : fmt(n,v>=100?0:v>=1?1:2);
  };

  function baseOption() {
    return {
      animation:false,
      color:palette(),
      textStyle:{fontFamily:'Manrope, Segoe UI, sans-serif',color:css('--muted')},
      backgroundColor:'transparent',
      tooltip:{
        trigger:'axis',confine:true,backgroundColor:'#122133',borderWidth:0,padding:[10,12],
        extraCssText:'border-radius:7px;box-shadow:0 5px 20px #00162926;max-width:360px;',
        textStyle:{color:'#f5f8fc',fontFamily:'Manrope, Segoe UI, sans-serif',fontSize:11},
        axisPointer:{type:'line',lineStyle:{color:css('--muted'),type:'dashed',width:1}},
        valueFormatter:v=>fmt(v),
      },
      legend:{top:3,left:12,right:12,type:'scroll',itemWidth:16,itemHeight:3,icon:'roundRect',itemGap:15,textStyle:{color:css('--muted'),fontSize:11}},
      grid:{left:54,right:32,top:42,bottom:54},
      xAxis:{type:'time',boundaryGap:false,axisLine:{lineStyle:{color:css('--line')}},axisTick:{show:false},axisLabel:{color:css('--muted'),fontSize:10,hideOverlap:true,margin:12},splitLine:{show:false},axisPointer:{label:{show:false}}},
      yAxis:{type:'value',splitNumber:4,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:css('--muted'),fontSize:10,formatter:compact},splitLine:{lineStyle:{color:css('--grid'),width:1}},axisPointer:{label:{show:false}}},
      dataZoom:[
        {type:'inside',filterMode:'none',zoomOnMouseWheel:false,moveOnMouseWheel:false,moveOnMouseMove:true},
        {type:'slider',filterMode:'none',height:14,bottom:4,left:54,right:32,borderColor:'transparent',backgroundColor:css('--soft'),fillerColor:theme()?'#71d2dd18':'#0b365415',showDataShadow:true,dataBackground:{lineStyle:{color:css('--muted'),opacity:.18},areaStyle:{color:css('--muted'),opacity:.04}},selectedDataBackground:{lineStyle:{color:palette()[0],opacity:.4},areaStyle:{color:palette()[0],opacity:.08}},handleSize:11,handleStyle:{color:css('--panel'),borderColor:css('--muted')},moveHandleSize:0,showDetail:false,textStyle:{color:css('--muted'),fontSize:10}},
      ],
    };
  }

  function timeChart(id, input, options={}) {
    const {names=[],types=[],target=false,zero=false,index=false,area=false,recession=null,stats=true} = options;
    const el=document.getElementById(id);
    if (!el) return;
    const mapped=input.map((s,i)=>({s,name:names[i]||s?.name,type:types[i]||'line'})).filter(x=>x.s);
    const ss=mapped.map(x=>x.s), range=getRange();
    if (!ss.length) { el.innerHTML='<div class="empty">Serie no disponible en esta publicación.</div>'; return; }
    const units=[...new Set(ss.map(unitKey))], dates=index?commonDates(ss,range):[];
    if (index&&!dates.length) { el.innerHTML='<div class="empty">No hay una fecha base común.</div>'; return; }
    if (units.length>2&&!index) { el.innerHTML='<div class="empty">Hay más de dos unidades: compara menos series o usa base 100.</div>'; return; }
    const rows=windowRows(ss.map(s=>({s,rows:index?transform(s,'index',range,dates[0]):cut(s,'all'),...(index?{mode:'index'}:{})})),range);
    const finiteRows=rows.flatMap(g=>g.rows.filter(o=>finite(o.value)));
    if (!finiteRows.length) { el.innerHTML='<div class="empty">No hay observaciones en la ventana seleccionada.</div>'; return; }
    const chronological=finiteRows.map(o=>o.date).sort(), firstDate=chronological[0], lastDate=chronological.at(-1);
    const opt=baseOption(), colorsHere=palette(), twoAxes=units.length>1&&!index;
    const narrow=el.clientWidth<440;
    const meta=chartRows.get(id)||{title:ss[0].name,ss};
    meta.rows=rows;
    if(index) meta.mode='index';
    chartRows.set(id,meta);
    opt.legend.show=false;
    opt.grid={left:narrow?43:54,right:twoAxes?(narrow?51:64):(narrow?47:59),top:32,bottom:49};
    opt.dataZoom[1].left=opt.grid.left;
    opt.dataZoom[1].right=opt.grid.right;
    opt.xAxis.min=stamp(firstDate);
    opt.xAxis.max=stamp(lastDate);
    opt.xAxis.splitNumber=narrow?4:6;
    opt.yAxis=(index?['Base 100']:units).slice(0,2).map((u,i)=>({
      ...opt.yAxis,position:i?'right':'left',name:u.length<28?u:'',nameGap:15,
      nameTextStyle:{fontFamily:'Manrope, Segoe UI, sans-serif',fontSize:10,color:css('--muted'),align:i?'right':'left'},
      scale:!zero&&!index&&ss.length===1&&!isRate(ss[0]),
      axisLabel:{...opt.yAxis.axisLabel,margin:8},
    }));
    const allRendered=rows.map(({s,rows})=>withGaps(rows,s.frequency));
    opt.tooltip.formatter=params=>{
      const items=(Array.isArray(params)?params:[params]).filter(p=>p.seriesIndex<ss.length&&Array.isArray(p.value)&&finite(p.value[1]));
      if(!items.length)return '';
      return '<div class="chart-tooltip">'+items.map(p=>{
        const s=ss[p.seriesIndex], rawDate=typeof p.value[0]==='number'?new Date(p.value[0]).toISOString().slice(0,10):p.value[0];
        const u=index?'Base 100':s.unit;
        return `<div class="chart-tooltip-row"><span class="chart-tooltip-name"><i style="background:${colorsHere[p.seriesIndex%colorsHere.length]}"></i>${escapeHtml(mapped[p.seriesIndex].name)}</span><strong>${escapeHtml(fmt(p.value[1]))} <small>${escapeHtml(u)}</small></strong><span class="chart-tooltip-meta">${escapeHtml(date(rawDate,s.frequency))} · ${escapeHtml(s.provider)} · ${escapeHtml(s.sourceCode)}</span></div>`;
      }).join('')+'</div>';
    };
    opt.series=rows.map(({s,rows:observations},i)=>{
      const color=colorsHere[i%colorsHere.length], type=mapped[i].type, final=observations.filter(o=>finite(o.value)).at(-1);
      return {
        id:`${id}-${i}`,name:mapped[i].name,type,
        data:allRendered[i].map(o=>[o.date,o.value]),
        showSymbol:false,symbol:'circle',symbolSize:5,connectNulls:false,
        yAxisIndex:index?0:Math.min(units.indexOf(unitKey(s)),1),smooth:false,
        lineStyle:{width:ss.length>4?1.4:1.8,color},itemStyle:{color,opacity:type==='bar'?.78:1,borderRadius:type==='bar'?[2,2,0,0]:undefined},
        emphasis:{focus:'series',lineStyle:{width:2.4},itemStyle:{opacity:1}},
        blur:{lineStyle:{opacity:.25},itemStyle:{opacity:.22}},
        areaStyle:area&&i===0?{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:opacity(color,.13)},{offset:1,color:opacity(color,.01)}]}}:undefined,
        barMaxWidth:18,barMinWidth:1,
        endLabel:type==='line'&&!twoAxes?{show:true,formatter:p=>compact(p.value?.[1]),color,fontSize:10,fontWeight:650,distance:7,backgroundColor:css('--panel'),padding:[2,3],borderRadius:3}:undefined,
        labelLayout:{moveOverlap:'shiftY',hideOverlap:true},
        markPoint:final?{silent:true,symbol:'circle',symbolSize:5,itemStyle:{color,borderColor:css('--panel'),borderWidth:1.2},label:{show:false},data:[{coord:[final.date,final.value]}]}:undefined,
        z:type==='bar'?2:4,
      };
    });
    const markAreas=[],markLines=[];
    const targetBand=target===true?{min:1,max:3,label:'Meta BCRP · 1–3%'}:target;
    if(targetBand&&finite(targetBand.min)&&finite(targetBand.max)) {
      markAreas.push([{yAxis:targetBand.min,itemStyle:{color:theme()?'#13b9c810':'#009bae0c'}},{yAxis:targetBand.max}]);
      markLines.push({yAxis:targetBand.max,name:targetBand.label||`Banda ${targetBand.min}–${targetBand.max}`,lineStyle:{color:colors[0],opacity:.5,type:'dashed'},label:{show:true,formatter:targetBand.label||`Banda ${targetBand.min}–${targetBand.max}`,position:'insideEndTop',fontSize:9,color:css('--muted')}});
    }
    const bands=recessionBands(recession,firstDate,lastDate);
    for(const [a,b] of bands)markAreas.push([{xAxis:a,itemStyle:{color:theme()?'#b4c2d312':'#152c4010'}},{xAxis:b}]);
    if(zero)markLines.push({yAxis:0,lineStyle:{color:css('--muted'),opacity:.55,type:'solid',width:1},label:{show:false}});
    if(index)markLines.push({yAxis:100,lineStyle:{color:css('--muted'),opacity:.4,type:'dashed',width:1},label:{show:false}});
    if(markAreas.length)opt.series[0].markArea={silent:true,label:{show:false},data:markAreas};
    if(markLines.length)opt.series[0].markLine={silent:true,symbol:'none',label:{show:false},data:markLines};
    const instance=chart(id,opt);
    if(!instance)return;
    let footer=el.nextElementSibling;
    if(!footer?.classList.contains('chart-evidence')) { footer=document.createElement('div');footer.className='chart-evidence';el.insertAdjacentElement('afterend',footer); }
    footer.dataset.chartEvidence=id;
    const history=index?rows[0].rows:cut(ss[0],'all');
    const statHelp='Percentil empírico: porcentaje de observaciones del historial que son menores o iguales al último valor. No mide si el indicador es bueno, malo, barato o caro.';
    function updateEvidence(groups) {
      const primary=computeStats(groups[0]?.rows||[],history);
      footer.innerHTML=`<div class="chart-series-legend" aria-label="Series del gráfico">${groups.map(({s,rows:obs},i)=>{
        const final=obs.filter(o=>finite(o.value)).at(-1);
        return `<button type="button" class="chart-legend-item" data-legend-index="${i}" aria-pressed="true" title="Mostrar u ocultar ${escapeHtml(mapped[i].name)}"><i style="--series-color:${colorsHere[i%colorsHere.length]}" aria-hidden="true"></i><span class="chart-legend-name">${escapeHtml(mapped[i].name)}</span><strong>${escapeHtml(fmt(final?.value))}<small> ${escapeHtml(index?'Base 100':s.unit)}</small></strong><span class="chart-legend-period">${final?escapeHtml(date(final.date,s.frequency)):'Sin dato'}</span></button>`;
      }).join('')}</div>${stats&&primary&&groups.length<=3?`<div class="chart-distribution"><div class="chart-range-stat"><span>Mín. ventana</span><strong>${escapeHtml(compact(primary.min))}</strong></div><div class="chart-range-stat"><span>Mediana</span><strong>${escapeHtml(compact(primary.median))}</strong></div><div class="chart-range-stat"><span>Máx. ventana</span><strong>${escapeHtml(compact(primary.max))}</strong></div><div class="chart-percentile" title="${statHelp}"><div><span>Percentil histórico</span><strong>P${escapeHtml(fmt(primary.percentile,0))}</strong></div><div class="chart-percentile-track"><i style="left:${Math.max(0,Math.min(100,primary.percentile))}%"></i></div></div></div><div class="chart-history-caption">${groups.length>1?escapeHtml(mapped[0].name)+' · ':''}${escapeHtml(date(primary.firstDate,ss[0].frequency))}–${escapeHtml(date(primary.lastDate,ss[0].frequency))} · ${primary.count} obs. en ventana${finite(primary.percentile)?` · percentil sobre ${primary.historyCount} obs. desde ${escapeHtml(date(primary.historyStart,ss[0].frequency))}`:''}</div>`:''}${bands.length?'<div class="chart-recession-key"><i></i> Sombreado: recesiones de EE. UU. · FRED / NBER (USREC)</div>':''}`;
      const selected=instance.getOption().legend?.[0]?.selected||{};
      footer.querySelectorAll('[data-legend-index]').forEach(button=>{
        const name=mapped[Number(button.dataset.legendIndex)].name;
        button.setAttribute('aria-pressed',String(selected[name]!==false));
        button.onclick=()=>instance.dispatchAction({type:'legendToggleSelect',name});
      });
    }
    updateEvidence(rows);
    instance.on('legendselectchanged',event=>footer.querySelectorAll('[data-legend-index]').forEach(button=>button.setAttribute('aria-pressed',String(event.selected[mapped[Number(button.dataset.legendIndex)].name]!==false))));
    instance.on('datazoom',()=>{
      const zoom=instance.getOption().dataZoom?.[0]||{},start=finite(zoom.start)?zoom.start:0,end=finite(zoom.end)?zoom.end:100;
      const lo=stamp(firstDate)+(stamp(lastDate)-stamp(firstDate))*start/100,hi=stamp(firstDate)+(stamp(lastDate)-stamp(firstDate))*end/100;
      const visible=rows.map(group=>({...group,rows:group.rows.filter(o=>stamp(o.date)>=lo-.5&&stamp(o.date)<=hi+.5)}));
      meta.rows=visible;
      updateEvidence(visible);
    });
    return instance;
  }
  return {baseOption,timeChart};
}
