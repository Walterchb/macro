import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySignal,monitorFreshness,monitorTransform,createEconomicMonitor} from '../assets/economic-monitor.js';

const series=(observations,frequency='monthly')=>({id:'test',frequency,status:'ok',observations});

test('inflation band includes both official endpoints; missing observations never look healthy',()=>{
  assert.equal(classifySignal(1,'inflation-pe').label,'Dentro del rango');
  assert.equal(classifySignal(3,'inflation-pe').label,'Dentro del rango');
  assert.equal(classifySignal(.999,'inflation-pe').position,0);
  assert.equal(classifySignal(3.001,'inflation-pe').position,2);
  assert.equal(classifySignal(null,'growth').tone,'muted');
  assert.equal(classifySignal(NaN,'growth').position,-1);
  assert.equal(classifySignal(.5,'sahm').tone,'risk');
  assert.notEqual(classifySignal(-.7,'cfnai').tone,'risk');
  assert.equal(classifySignal(-.701,'cfnai').tone,'risk');
});

test('staleness uses reference-period end, distinguishes a retained download, and rejects future data',()=>{
  const s=series([{date:'2026-06-01',value:3}]);
  assert.equal(monitorFreshness(s,s.observations[0],'2026-09-22').state,'fresh');
  assert.equal(monitorFreshness(s,s.observations[0],'2026-10-09').state,'stale');
  assert.equal(monitorFreshness({...s,status:'retained'},s.observations[0],'2026-09-22').state,'retained');
  assert.equal(monitorFreshness(s,{date:'2026-10-01',value:3},'2026-09-22').state,'missing');
  const q=series([{date:'2026-04-01',value:2}],'quarterly');
  assert.equal(monitorFreshness(q,q.observations[0],'2026-09-22').ageDays,84);
});

test('monitor transformations require exact comparison periods and preserve meaningful units',()=>{
  const s=series([{date:'2025-07-01',value:100},{date:'2026-07-01',value:110}]);
  assert.ok(Math.abs(monitorTransform(s,'yoy')[0].value-10)<1e-9);
  assert.equal(monitorTransform(series([{date:'2025-08-01',value:100},{date:'2026-07-01',value:110}]),'yoy').length,0);
  const q=series([{date:'2026-01-01',value:100},{date:'2026-04-01',value:101}],'quarterly');
  assert.ok(Math.abs(monitorTransform(q,'annualized')[0].value-4.060401)<1e-9);
  assert.equal(monitorTransform(series([{date:'2026-01-01',value:0},{date:'2026-04-01',value:101}],'quarterly'),'annualized').length,0);
});

test('three-month payroll momentum cannot silently span a missing intermediate month',()=>{
  const s=series([{date:'2026-05-01',value:100},{date:'2026-06-01',value:101},{date:'2026-07-01',value:105},{date:'2026-08-01',value:109}]);
  assert.deepEqual(monitorTransform(s,'mean3diff'),[{date:'2026-08-01',value:3}]);
  assert.equal(monitorTransform({...s,observations:s.observations.filter(o=>o.date!=='2026-06-01')},'mean3diff').length,0);
});

test('cycle monitor distinguishes incomplete coverage and does not assert zero risk from missing sources',()=>{
  const now=()=>new Date('2026-09-22');
  const empty=createEconomicMonitor({getSeries:()=>[],now});
  const cycle=empty.build('world').find(c=>c.key==='cycle');
  assert.equal(cycle.state.label,'Cobertura parcial');
  assert.equal(cycle.customHeadline,'0 / 0');
  const mk=(sourceCode,value)=>({...series([{date:'2026-08-01',value}]),provider:'FRED',sourceCode,id:`fred_${sourceCode}`});
  const complete=createEconomicMonitor({getSeries:()=>[mk('SAHMREALTIME',.5),mk('CFNAIMA3',-.7)],now}).build('world').find(c=>c.key==='cycle');
  assert.equal(complete.customHeadline,'1 / 2');
  assert.equal(complete.state.tone,'watch');
  assert.match(empty.render('world'),/Pulso de EE. UU./);
  assert.match(empty.render('peru'),/Sin dato/);
});

test('a finite but future or old primary observation cannot yield a live positive signal',()=>{
  const now=()=>new Date('2026-09-22');
  const mk=date=>({...series([{date,value:3}]),provider:'BCRP',sourceCode:'PN01728AM',id:'bcrp_PN01728AM'});
  for(const date of ['2026-10-01','2025-01-01']) {
    const growth=createEconomicMonitor({getSeries:()=>[mk(date)],now}).build('peru').find(c=>c.key==='growth');
    assert.equal(growth.state.tone,'muted');
    assert.equal(growth.state.position,-1);
  }
});

import {monitorJoin,monitorBreadth,monitorConsensus} from '../assets/economic-monitor.js';

test('divergent evidence stays mixed even if a majority points upward; missing conditions stay partial',()=>{
  const votes=values=>values.map(value=>({value}));
  assert.equal(monitorConsensus(votes([1,1,1,-1])).label,'Señales mixtas');
  assert.equal(monitorConsensus(votes([1,1,1,-1])).tone,'neutral');
  assert.equal(monitorConsensus(votes([1,1,null])).tone,'muted');
  assert.equal(monitorConsensus(votes([1,1,0])).label,'Apoyo parcial');
  assert.equal(monitorConsensus(votes([-1,0,0])).label,'Deterioro parcial');
  assert.equal(monitorConsensus(votes([0,0,0])).label,'Sin dirección clara');
});

test('real-rate and purchasing-power calculations join the same reference month only',()=>{
  const nominal=[{date:'2026-07-01',value:4.5},{date:'2026-08-01',value:4.25}],expected=[{date:'2026-07-01',value:3.01},{date:'2026-09-01',value:3.1}];
  const joined=monitorJoin(nominal,expected,(n,p)=>((1+n/100)/(1+p/100)-1)*100);
  assert.equal(joined.length,1);assert.equal(joined[0].date,'2026-07-01');
  assert.ok(Math.abs(joined[0].value-1.4464615085914)<1e-10);
});

test('breadth cannot combine different months or silently drop a missing sector',()=>{
  const sectors=[series([{date:'2026-06-01',value:1},{date:'2026-07-01',value:2}]),series([{date:'2026-06-01',value:-1},{date:'2026-08-01',value:3}])];
  assert.deepEqual(monitorBreadth(sectors),[{date:'2026-06-01',value:1,total:2,negative:1}]);
  assert.deepEqual(monitorBreadth([...sectors,null]),[]);
});

test('annualized momentum and compounded rates reject gaps and preserve the correct formula',()=>{
  const s=series([{date:'2026-04-01',value:100},{date:'2026-05-01',value:101},{date:'2026-06-01',value:102},{date:'2026-07-01',value:103}]);
  assert.ok(Math.abs(monitorTransform(s,'ann3')[0].value-((1.03**4-1)*100))<1e-10);
  assert.deepEqual(monitorTransform({...s,observations:s.observations.filter(o=>o.date!=='2026-05-01')},'ann3'),[]);
  const rates=series([{date:'2026-05-01',value:10},{date:'2026-06-01',value:-10},{date:'2026-07-01',value:10}]);
  assert.ok(Math.abs(monitorTransform(rates,'compound3')[0].value-8.9)<1e-10);
});

test('weekly claims average requires four consecutive weekly observations',()=>{
  const s=series([{date:'2026-08-22',value:100},{date:'2026-08-29',value:200},{date:'2026-09-05',value:300},{date:'2026-09-12',value:400}],'weekly');
  assert.deepEqual(monitorTransform(s,'weeklyMean4'),[{date:'2026-09-12',value:250}]);
  assert.equal(monitorTransform({...s,observations:s.observations.filter(o=>o.date!=='2026-08-29')},'weeklyMean4').length,0);
});

test('growth cannot retain a live expansion label when one required corroborating source goes stale',()=>{
  const now=()=>new Date('2026-09-22');
  const mk=(sourceCode,observations)=>({...series(observations),provider:'BCRP',sourceCode,id:`bcrp_${sourceCode}`});
  const monthly=[{date:'2026-05-01',value:2},{date:'2026-06-01',value:2},{date:'2026-07-01',value:2}];
  const codes=['PN01713AM','PN01716AM','PN01717AM','PN01720AM','PN01723AM','PN01724AM','PN01725AM','PN01726AM'];
  const rows=[mk('PN01728AM',monthly),mk('PN01731AM',monthly),...codes.map(c=>mk(c,monthly)),mk('PD38045AM',[{date:'2025-01-01',value:60}])];
  const growth=createEconomicMonitor({series:rows,now}).build('peru').find(c=>c.key==='growth');
  assert.equal(growth.state.tone,'muted');assert.equal(growth.state.label,'Cobertura parcial');
  assert.equal(growth.signals.filter(s=>s.value===1).length,3);
});
