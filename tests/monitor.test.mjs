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
