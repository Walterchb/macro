import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {marketChangeSignal,createEconomicMonitor} from '../assets/economic-monitor.js';
const DAY=86400000;
const history=(current=0)=>Array.from({length:106},(_,i)=>({date:new Date(Date.UTC(2024,9,7)+i*7*DAY).toISOString().slice(0,10),value:i===105?current:1}));
test('market bands require sufficient distinct completed weeks and reject duplicates',()=>{
 assert.equal(marketChangeSignal(history().slice(-52)).value,null);
 const h=history();assert.equal(marketChangeSignal([...h,h.at(-1)]).value,null);
 assert.equal(marketChangeSignal(history(),{direction:0}).value,null);
});
test('tiny market changes are neutral; substantial changes retain direction',()=>{
 for(const n of [-.000001,0,.000001])assert.equal(marketChangeSignal(history(n)).value,0);
 assert.equal(marketChangeSignal(history(-2)).value,1);
 assert.equal(marketChangeSignal(history(2)).value,-1);
});
test('sampling does not count daily observations as additional weekly evidence',()=>{
 const h=history(2),extra=h.slice(0,-1).flatMap(o=>[o,{date:new Date(Date.parse(o.date)+DAY).toISOString().slice(0,10),value:o.value}]);
 const a=marketChangeSignal(h),b=marketChangeSignal([...extra,h.at(-1)]);
 assert.equal(a.sampleSize,b.sampleSize);assert.equal(a.band,b.band);assert.equal(a.value,b.value);
});
test('current week is excluded from prior calibration, even earlier observations',()=>{
 const h=history(2),last=h.pop(),current={date:new Date(Date.parse(last.date)+DAY).toISOString().slice(0,10),value:2};
 const a=marketChangeSignal([...h,current]),b=marketChangeSignal([...h,{...last,value:1e8},current]);
 assert.equal(a.band,b.band);assert.equal(a.sampleSize,b.sampleSize);
});
test('sensitivity across operational quantiles suppresses convention-dependent direction',()=>{
 const h=history();h.forEach((o,i)=>o.value=i/100);h.at(-1).value=.2;
 const r=marketChangeSignal(h);assert.equal(r.sensitivity.stable,false);assert.equal(r.value,0);
});
test('US inflation separates distance from target and filtered momentum without changing observations',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../data/snapshot.json',import.meta.url))),before=JSON.stringify(d.series);
 const m=createEconomicMonitor({series:d.series,now:()=>new Date('2026-10-21')});const c=m.build('world').find(c=>c.key==='prices');
 assert.equal(c.signals.length,2);assert.ok(c.evidence.some(x=>x.label==='PCE general − objetivo 2%'));
 assert.ok(c.signals.every(x=>x.filter));assert.equal(JSON.stringify(d.series),before);
 assert.doesNotMatch(m.modal('world','prices'),/PCE general entre 0% y 2%/);
 assert.match(m.modal('world','prices'),/no un voto de desinflación/);
 assert.match(m.render('world'),/referencias mixtas/);
});
