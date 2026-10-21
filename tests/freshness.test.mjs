import test from 'node:test';
import assert from 'node:assert/strict';
import {seriesFreshness,FRESHNESS_LIMIT_DAYS,VERIFIED_ORIGIN_RELEASES} from '../assets/data-freshness.js';
const s={provider:'BCRP',sourceCode:'PN01728AM',frequency:'monthly',status:'ok'};
const july={date:'2026-07-01',value:3.56};
test('known origin release overrides age fallback without replacing values',()=>{
  const f=seriesFreshness(s,july,'2026-10-21');
  assert.equal(f.ageDays,82);assert.equal(f.limitDays,100);assert.equal(f.state,'stale');assert.equal(f.reason,'origin-release');
  assert.equal(f.sourceRelease.referenceDate,'2026-08-01');
  assert.equal(july.value,3.56);assert.equal('value' in f.sourceRelease,false);
  assert.equal(seriesFreshness(s,{date:'2026-08-01',value:3.23},'2026-10-21').state,'fresh');
  assert.equal(seriesFreshness(s,{date:'2026-09-01',value:3},'2026-10-21').state,'fresh');
});
test('release warning does not appear before publication or for unrelated series',()=>{
  assert.equal(seriesFreshness(s,july,'2026-10-14').state,'fresh');
  assert.equal(seriesFreshness({...s,sourceCode:'other'},july,'2026-10-21').state,'fresh');
  assert.equal(seriesFreshness({...s,provider:'other'},july,'2026-10-21').state,'fresh');
});
test('retained and stale can coexist without hiding origin lag',()=>{
  const f=seriesFreshness({...s,status:'retained'},july,'2026-10-21');
  assert.equal(f.state,'stale');assert.equal(f.retained,true);
  assert.equal(seriesFreshness({...s,status:'retained'},{date:'2026-08-01',value:3},'2026-10-21').state,'retained');
});
test('period-end age fallback is deterministic at boundary',()=>{
  const f=seriesFreshness({...s,sourceCode:'other'},{date:'2026-06-01',value:3},'2026-10-08');
  assert.equal(f.ageDays,100);assert.equal(f.state,'fresh');
  assert.equal(seriesFreshness({...s,sourceCode:'other'},{date:'2026-06-01',value:3},'2026-10-09').state,'stale');
  assert.equal(seriesFreshness({...s,frequency:'quarterly'},{date:'2026-04-01',value:2},'2026-09-22').ageDays,84);
  assert.equal(seriesFreshness({...s,frequency:'annual'},{date:'2025-01-01',value:2},'2026-01-01').ageDays,1);
});
test('invalid, missing and future observations cannot appear fresh',()=>{
  for(const observation of [null,{date:'2026-02-31',value:1},{date:'oops',value:1},{date:'2026-11-01',value:1},{date:'2026-08-01',value:NaN}])assert.equal(seriesFreshness(s,observation,'2026-10-21').state,'missing');
});
test('release registry is bounded evidence with valid dates and official links',()=>{
  for(const r of VERIFIED_ORIGIN_RELEASES){assert.ok(r.referenceDate<r.publicationDate);assert.ok(r.publicationDate<=r.verifiedAt);assert.equal(new URL(r.url).hostname,r.provider==='FRED'?'www.federalreserve.gov':'www.inei.gob.pe');if(r.provider==='FRED')assert.ok(['DGS10','DGS2','DFII10'].includes(r.sourceCode));}
  assert.equal(FRESHNESS_LIMIT_DAYS.monthly,100);
});
test('future dates age existing data but do not invent later origin releases',()=>{
  const caughtUp=seriesFreshness(s,{date:'2026-08-01',value:3.23},'2030-01-01');
  assert.equal(caughtUp.state,'stale');assert.equal(caughtUp.reason,'age');
  assert.equal(caughtUp.sourceRelease,undefined);
  const lagging=seriesFreshness(s,july,'2030-01-01');
  assert.equal(lagging.reason,'origin-release');
  assert.equal(lagging.sourceRelease.referenceDate,'2026-08-01');
  assert.equal(lagging.sourceRelease.verifiedAt,'2026-10-21');
});

test("verified H15 release warns only until FRED catches up",()=>{for(const sourceCode of ["DGS10","DGS2","DFII10"]){const s={provider:"FRED",sourceCode,frequency:"daily",status:"ok"};assert.equal(seriesFreshness(s,{date:"2026-10-16",value:5},"2026-10-21").reason,"origin-release");assert.equal(seriesFreshness(s,{date:"2026-10-19",value:5},"2026-10-21").state,"fresh");}});
