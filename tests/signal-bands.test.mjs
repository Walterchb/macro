import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calibratedChangeSignal} from '../assets/signal-bands.js';
const dates=(n=61)=>Array.from({length:n},(_,i)=>new Date(Date.UTC(2020,i,1)).toISOString().slice(0,10));
const rows=(value=.2,n=61)=>dates(n).map(date=>({date,value}));

test('band excludes current point, reverses direction, and includes neutral endpoints',()=>{
  const h=rows(); h.at(-1).value=.2;
  assert.equal(calibratedChangeSignal(h).value,0);
  h.at(-1).value=.200001;
  assert.equal(calibratedChangeSignal(h).band,.2);
  assert.equal(calibratedChangeSignal(h).value,1);
  assert.equal(calibratedChangeSignal(h,{direction:-1}).value,-1);
  h.at(-1).value=-.2;
  assert.equal(calibratedChangeSignal(h).value,0);
  h.at(-1).value=-.200001;
  assert.equal(calibratedChangeSignal(h).value,-1);
});

test('historical cut is invariant to future observations; future values cannot calibrate it',()=>{
  const h=rows(); const cut=h.at(-1).date;
  const before=calibratedChangeSignal(h,{asOf:cut});
  assert.deepEqual(calibratedChangeSignal([...h,{date:'2030-01-01',value:99999}],{asOf:cut}),before);
});

test('calibration uses 60 calendar months, requires 36 unique valid months and never fills gaps',()=>{
  const h=rows(.2,100); h[0].value=9999;
  assert.equal(calibratedChangeSignal(h).sampleSize,60);
  assert.equal(calibratedChangeSignal(h).startDate,h[39].date);
  assert.equal(calibratedChangeSignal(rows(.2,36)).value,null);
  assert.equal(calibratedChangeSignal(rows(.2,37)).sampleSize,36);
  const g=h.filter((_,i)=>i%2===0);
  assert.equal(calibratedChangeSignal(g).value,null);
  assert.equal(calibratedChangeSignal([...h,h[80]]).value,null);
});

test('rounding floor neutralizes tiny changes and missing values never become healthy',()=>{
  const h=rows(0); h.at(-1).value=.000001;
  assert.equal(calibratedChangeSignal(h).band,.005);
  assert.equal(calibratedChangeSignal(h).value,0);
  h.at(-1).value=-.000001;
  assert.equal(calibratedChangeSignal(h).value,0);
  assert.equal(calibratedChangeSignal([]).value,null);
  assert.equal(calibratedChangeSignal(rows(),{direction:0}).value,null);
});

test('persistence reconstructs prior calibration, ends on missing month or different classification',()=>{
  const h=rows(); h.at(-1).value=.01; h.at(-2).value=.01;
  assert.equal(calibratedChangeSignal(h).persistence,25); // earlier points have fewer than36 prior months
  h.at(-3).value=.3;
  assert.equal(calibratedChangeSignal(h).persistence,2);
  assert.equal(calibratedChangeSignal(h.filter((_,i)=>i!==59)).persistence,1);
});

test('real Peru snapshot calibration is indicator-specific, not a universal pp threshold',()=>{
  const ss=JSON.parse(fs.readFileSync(new URL('../data/snapshot.json',import.meta.url))).series;
  const expected={PN01273PM:[.19742233400676287,1],PN01277PM:[.08916700746525984,0],PN07809NM:[.12389999999999973,0]};
  // Pin the audit cut; later syncs must not make this a test of the newest value.
  for(const [code,[band,value]] of Object.entries(expected)) {
    const raw=ss.find(s=>s.sourceCode===code).observations;
    const map=new Map(raw.map(o=>[o.date,o.value]));
    const changes=raw.flatMap(o=>{const d=new Date(`${o.date}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-3);const prev=map.get(d.toISOString().slice(0,10));return Number.isFinite(prev)?[{date:o.date,value:o.value-prev}]:[];});
    const r=calibratedChangeSignal(changes,{asOf:'2026-09-01'});
    const previous=changes.filter(o=>o.date>='2021-09-01'&&o.date<'2026-09-01').map(o=>Math.abs(o.value)).sort((a,b)=>a-b);
    const index=(previous.length-1)*.2, independently=previous[Math.floor(index)]+(previous[Math.ceil(index)]-previous[Math.floor(index)])*(index%1);
    assert.ok(Math.abs(r.band-Math.max(.005,independently))<1e-10,code);assert.equal(r.sampleSize,60);
  }
});

 test('sensitivity at p10/p30 suppresses convention-dependent directional claims',()=>{
  const h=rows();h.forEach((o,i)=>o.value=(i+1)/100);h.at(-1).value=.15;
  const r=calibratedChangeSignal(h);
  assert.equal(r.baseValue,1);assert.equal(r.sensitivity.stable,false);assert.equal(r.value,0);
  assert.ok(r.sensitivity.lowBand<r.band && r.band<r.sensitivity.highBand);
 });
