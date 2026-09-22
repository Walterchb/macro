import test from 'node:test';
import assert from 'node:assert/strict';
import {computeStats,regression,spreadRows,recessionBands,periodChanges,weeklyRollingMeanRows,createChartEngine} from '../assets/chart-engine.js';
import {change} from '../assets/math.js';
test('El percentil usa toda la historia y el rango solo la ventana visible',()=>{
 const history=[{date:'2024-01-01',value:10},{date:'2024-02-01',value:20},{date:'2024-03-01',value:20},{date:'2024-04-01',value:40}];
 const s=computeStats(history.slice(1,3),history);
 assert.equal(s.min,20);assert.equal(s.max,20);assert.equal(s.percentile,75);assert.equal(s.historyCount,4);
});
test('La regresión recupera una relación conocida y rechaza varianza cero',()=>{
 const fit=regression([{x:1,y:5},{x:2,y:8},{x:3,y:11},{x:4,y:14}]);
 assert.equal(fit.slope,3);assert.equal(fit.intercept,2);assert.equal(fit.r2,1);
 assert.equal(regression([{x:1,y:2},{x:1,y:3},{x:1,y:4}]),null);
});
test('Un diferencial no arrastra un vencimiento ausente',()=>{
 assert.deepEqual(spreadRows([{date:'2026-01-01',value:4},{date:'2026-01-02',value:5}],[{date:'2026-01-02',value:3}]),[{date:'2026-01-02',value:2}]);
});
test('Bandas de recesión no rellenan meses ausentes ni otras economías',()=>{
 const s={provider:'FRED',sourceCode:'USREC',observations:[{date:'2020-02-01',value:1},{date:'2020-04-01',value:1},{date:'2020-05-01',value:0}]};
 assert.deepEqual(recessionBands(s,'2020-01-01','2020-06-01'),[['2020-02-01','2020-03-01'],['2020-04-01','2020-05-01']]);
 assert.deepEqual(recessionBands({...s,sourceCode:'OTHER'},'2020-01-01','2020-06-01'),[]);
});
test('Cambio semanal compara exactamente siete días antes',()=>{
 const s={frequency:'weekly',unit:'Miles USD',observations:[{date:'2026-09-02',value:100},{date:'2026-09-09',value:110}]};
 assert.equal(change(s).value,10);assert.equal(change(s).unit,'%');
});

test('Los cambios del tooltip exigen periodos comparables y distinguen porcentajes de pp',()=>{
 const monthly=[{date:'2026-01-01',value:100},{date:'2026-02-01',value:110},{date:'2026-04-01',value:121}];
 const changes=periodChanges(monthly,'monthly','Millones USD');
 assert.deepEqual(changes.get('2026-02-01'),{label:'MOM',previous:'2026-01-01',value:10,unit:'%'});
 assert.equal(changes.has('2026-04-01'),false);
 const rates=periodChanges([{date:'2026-01-01',value:2},{date:'2026-02-01',value:3}],'monthly','% YOY');
 assert.equal(rates.get('2026-02-01').value,1);assert.equal(rates.get('2026-02-01').unit,'pp');
 const signed=periodChanges([{date:'2026-01-01',value:-2},{date:'2026-02-01',value:1}],'monthly','Índice');
 assert.equal(signed.get('2026-02-01').value,3);assert.equal(signed.get('2026-02-01').unit,'Índice');
 const sessions=periodChanges([{date:'2026-09-18',value:10},{date:'2026-09-21',value:11}],'daily','USD');
 assert.deepEqual(sessions.get('2026-09-21'),{label:'DOD',previous:'2026-09-18',value:10,unit:'%'});
});

test('La media de cuatro semanas no reemplaza una semana sin publicación',()=>{
 const rows=[{date:'2026-08-01',value:100},{date:'2026-08-08',value:110},{date:'2026-08-15',value:120},{date:'2026-08-22',value:130},{date:'2026-09-05',value:140}];
 const mean=weeklyRollingMeanRows(rows,4);
 assert.equal(mean[2].value,null);assert.equal(mean[3].value,115);assert.equal(mean[4].value,null);
});

test('Los gráficos de barras y áreas apiladas conservan una base cero',()=>{
 const previousDocument=globalThis.document;
 globalThis.document={getElementById:()=>({clientWidth:640})};
 try {
  const source={id:'a',name:'Nivel',provider:'BCRP',sourceCode:'A',unit:'Millones USD',frequency:'monthly',observations:[{date:'2026-01-01',value:100},{date:'2026-02-01',value:110}]};
  let option;
  const engine=createChartEngine({colors:Array(8).fill('#123456'),css:()=> '#789abc',theme:()=>false,fmt:String,date:String,chart:(_id,o)=>{option=o;return null},chartRows:new Map(),unitKey:s=>s.unit,windowRows:rows=>rows,withGaps:rows=>rows,cut:s=>s.observations,transform:()=>[],commonDates:()=>[],isRate:()=>false,range:()=> 'all'});
  engine.timeChart('test',[source],{types:['bar']});
  assert.equal(option.yAxis[0].scale,false);
  engine.timeChart('test',[source,{...source,id:'b'}],{stacked:true});
  assert.equal(option.yAxis[0].scale,false);
  assert.equal(option.series[0].stack,'composition');assert.equal(option.series[1].stack,'composition');
  assert.equal(option.series[0].markPoint,undefined);
 } finally {globalThis.document=previousDocument;}
});

test('El impulso anualizado exige meses consecutivos y conserva la capitalización',async()=>{
 const {monthlyAnnualizedRows}=await import('../assets/chart-engine.js');
 const rows=[{date:'2024-01-01',value:100},{date:'2024-02-01',value:101},{date:'2024-03-01',value:102.01},{date:'2024-04-01',value:103.0301}];
 const out=monthlyAnnualizedRows(rows,3);
 assert.equal(out[2].value,null);
 assert.ok(Math.abs(out[3].value-((1.01**12)-1)*100)<1e-9);
 assert.equal(monthlyAnnualizedRows(rows.filter(r=>r.date!=='2024-03-01'),3).at(-1).value,null);
 assert.equal(monthlyAnnualizedRows([{date:'2024-01-01',value:0},{date:'2024-02-01',value:1}],1).at(-1).value,null);
});
test('La media móvil mensual no confunde tres filas con tres meses',async()=>{
 const {monthlyRollingMeanRows}=await import('../assets/chart-engine.js');
 const rows=[{date:'2023-12-01',value:10},{date:'2024-01-01',value:20},{date:'2024-02-01',value:30},{date:'2024-04-01',value:60}];
 assert.equal(monthlyRollingMeanRows(rows,3)[2].value,20);
 assert.equal(monthlyRollingMeanRows(rows,3)[3].value,null);
});

test('En Lima, ECharts mantiene el último punto y las anotaciones dentro del rango UTC',async()=>{
 const {execFileSync}=await import('node:child_process');
 const engineUrl=new URL('../assets/chart-engine.js',import.meta.url).href;
 const vendorPath=new URL('../assets/vendor/echarts.min.js',import.meta.url).pathname;
 const result=execFileSync(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import vm from 'node:vm';
  import {createChartEngine} from ${JSON.stringify(engineUrl)};
  const expected=[Date.parse('2026-01-01T00:00:00Z'),Date.parse('2026-02-01T00:00:00Z')];
  assert.equal(new Date(expected[0]).getTimezoneOffset(),300);
  const source={id:'test',name:'Nivel',provider:'FRED',sourceCode:'TEST',unit:'Índice',frequency:'monthly',observations:[{date:'2026-01-01',value:1},{date:'2026-02-01',value:2}]};
  const recession={provider:'FRED',sourceCode:'USREC',observations:[{date:'2026-01-01',value:1},{date:'2026-02-01',value:0}]};
  globalThis.document={getElementById:()=>({clientWidth:640})};
  let option;
  const renderer=createChartEngine({colors:Array(8).fill('#123456'),css:()=> '#789abc',theme:()=>false,fmt:String,date:String,chart:(_id,o)=>{option=o;return null},chartRows:new Map(),unitKey:s=>s.unit,windowRows:rows=>rows,withGaps:rows=>rows,cut:s=>s.observations,transform:()=>[],commonDates:()=>[],isRate:()=>false,range:()=> 'all'});
  renderer.timeChart('chart',[source],{recession});
  assert.equal(option.useUTC,true);
  assert.equal(option.series[0].markPoint.data[0].coord[0],expected[1]);
  assert.deepEqual(option.series[0].markArea.data[0].map(p=>p.xAxis),expected);
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(${JSON.stringify(vendorPath)},'utf8'),{module:mod,exports:mod.exports,setTimeout,clearTimeout});
  const chart=mod.exports.init(null,null,{renderer:'svg',ssr:true,width:640,height:320});
  chart.setOption(option);
  const actual=Array.from(chart.getModel().getSeriesByIndex(0).getData().getDataExtent('x'));
  assert.deepEqual(actual,expected);
  assert.equal(actual[1],option.xAxis.max);
  chart.dispose();
  process.stdout.write('UTC verified in America/Lima');
 `],{env:{...process.env,TZ:'America/Lima'},encoding:'utf8'});
 assert.equal(result,'UTC verified in America/Lima');
});
