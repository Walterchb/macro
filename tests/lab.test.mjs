import test from 'node:test';
import assert from 'node:assert/strict';
import {exactCommonYears,median,compareAtDates,restrictWindow,pairwiseEvidence,sanitizeSavedComparisons} from '../assets/comparison-lab.js';

const s=(id,observations,extra={})=>({id,frequency:'annual',unit:'%',country:'PER',sourceCode:id,observations,...extra});
const a=s('a',[{date:'2020-01-01',value:2},{date:'2021-01-01',value:null},{date:'2022-01-01',value:4}]);
const b=s('b',[{date:'2020-01-01',value:3},{date:'2021-01-01',value:5}]);

test('common years require every requested series and finite observations',()=>{
  assert.deepEqual(exactCommonYears([a,b]),['2020-01-01']);
  assert.deepEqual(exactCommonYears([a,undefined]),[]);
  assert.deepEqual(exactCommonYears([a,{...b,frequency:'monthly'}]),[]);
  assert.equal(median([null,2,7,4,8]),5.5);
});

test('change never substitutes another year or divides by zero',()=>{
  const result=compareAtDates(a,'2020-01-01','2022-01-01');
  assert.equal(result.absolute,2);assert.equal(result.unit,'pp');
  assert.equal(compareAtDates(a,'2021-01-01','2022-01-01'),null);
  assert.equal(compareAtDates(a,'2022-01-01','2020-01-01'),null);
  assert.equal(compareAtDates(s('zero',[{date:'2020-01-01',value:0},{date:'2022-01-01',value:3}]),'2020-01-01','2022-01-01').relative,null);
});

test('custom window is inclusive and invalid date intervals have no rows',()=>{
  const groups=[{s:a,rows:a.observations}];
  assert.deepEqual(restrictWindow(groups,'2020-01-01','2020-01-01')[0].rows,[a.observations[0]]);
  assert.equal(restrictWindow(groups,'2022-01-01','2020-01-01')[0].rows.length,0);
  assert.equal(restrictWindow(groups,'2021-02-30','')[0].rows.length,0);
  assert.equal(groups[0].rows.length,3);
});

test('correlation aligns exact dates and rejects short, constant or incompatible pairs',()=>{
  const rows=Array.from({length:14},(_,i)=>({date:`${2000+i}-01-01`,value:i}));
  const left={s:a,rows},right={s:b,rows:rows.map(o=>({...o,value:2*o.value+5}))};
  const matched=pairwiseEvidence([left,right])[0][1];
  assert.equal(matched.n,14);assert.equal(matched.r,1);
  assert.equal(pairwiseEvidence([left,{...right,rows:right.rows.slice(4)}])[0][1].r,null);
  assert.equal(pairwiseEvidence([left,{...right,rows:right.rows.map(o=>({...o,value:5}))}])[0][1].r,null);
  assert.equal(pairwiseEvidence([left,{...right,s:{...b,frequency:'monthly'}}])[0][1].n,0);
  assert.equal(pairwiseEvidence([{...left,s:{...a,sourceCode:'SI.POV.NAHC'}},{...right,s:{...b,country:'CHL'}}])[0][1].n,0);
});

test('saved comparisons sanitize malformed browser storage without inventing series',()=>{
  const clean=sanitizeSavedComparisons([null,{id:'one',name:'  Mi selección  ',selected:['a','a',3,'b','c','d','e'],mode:'hack',chartType:'line',start:'2023-12-01',end:'2022-01-01'},{id:'one',name:'Duplicated',selected:['a']}]);
  assert.equal(clean.length,1);assert.equal(clean[0].name,'Mi selección');
  assert.deepEqual(clean[0].selected,['a','b','c','d']);assert.equal(clean[0].mode,'level');assert.equal(clean[0].start,'');assert.equal(clean[0].range,'10');
  assert.equal(sanitizeSavedComparisons([{id:'range',name:'Toda la historia',selected:['a'],range:'all'}])[0].range,'all');
});
