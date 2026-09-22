import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalValue, regionalPeriods, regionalSeries, regionalModes, regionalStructure} from '../assets/regional-view.js';

const series = (observations, extra={}) => ({id:'test', regionId:'01', indicatorId:'test', name:'Fixture', frequency:'monthly', unit:'S/ millones', observations:Object.entries(observations).map(([date,value])=>({date,value})), ...extra});
const stock = {id:'test',kind:'stock'}, flow = {id:'test',kind:'flow'};

test('regional stocks compare YTD against December; MOM and YOY use exact calendar periods', () => {
  const s=series({'2024-02-01':80,'2024-12-01':100,'2025-01-01':105,'2025-02-01':110});
  assert.ok(Math.abs(regionalValue(s,stock,'2025-02-01','ytd')-10)<1e-9);
  assert.ok(Math.abs(regionalValue(s,stock,'2025-02-01','mom')-(110/105-1)*100)<1e-9);
  assert.equal(regionalValue(s,stock,'2025-02-01','yoy'),37.5);
  assert.equal(regionalValue(s,stock,'2025-01-01','yoy'),null);
});

test('regional flow YTD uses complete comparable cumulative periods, never the last monthly value alone', () => {
  const s=series({'2024-01-01':10,'2024-02-01':30,'2025-01-01':20,'2025-02-01':40});
  assert.equal(regionalValue(s,flow,'2025-02-01','ytd'),50);
  const incomplete=series({'2024-02-01':30,'2025-01-01':20,'2025-02-01':40});
  assert.equal(regionalValue(incomplete,flow,'2025-02-01','ytd'),null);
  assert.equal(regionalValue(series({'2024-01-01':0,'2025-01-01':10}),flow,'2025-01-01','ytd'),null);
});

test('regional geography coverage keeps absent regions absent, and preserves observed zero', () => {
  const regions=[{id:'01'},{id:'07'}], ss=[series({'2025-01-01':0})];
  assert.deepEqual(regionalPeriods(regions,ss,stock),[{date:'2025-01-01',count:1}]);
  assert.equal(regionalValue(ss[0],stock,'2025-01-01'),0);
  assert.equal(regionalValue(null,stock,'2025-01-01'),null);
});

test('regional chart transformations preserve metadata and expose their true calculation and units', () => {
  const source=series({'2024-12-01':100,'2025-01-01':120},{sourceCode:'RD00000DM',sourceUrl:'https://estadisticas.bcrp.gob.pe/'});
  const chart=regionalSeries(source,stock,'ytd');
  assert.equal(chart.unit,'%');
  assert.equal(chart.sourceCode,source.sourceCode);
  assert.match(chart.description,/diciembre/);
  assert.equal(chart.observations[0].value,null);
  assert.ok(Math.abs(chart.observations[1].value-20)<1e-9);
});

test('annual regional data permits YOY only and preserves estimate flags in chart exports', () => {
  const s = series({'2024-01-01':100,'2025-01-01':120},{frequency:'annual'});
  s.observations[1].observationStatus = 'estimated';
  assert.deepEqual(regionalModes('annual'),['level','yoy']);
  assert.equal(regionalValue(s,flow,'2025-01-01','mom'),null);
  assert.equal(regionalValue(s,flow,'2025-01-01','ytd'),null);
  const transformed = regionalSeries(s,flow,'yoy');
  assert.ok(Math.abs(transformed.observations[1].value-20)<1e-9);
  assert.equal(transformed.observations[1].observationStatus,'estimated');
  assert.match(transformed.description,/año calendario anterior/);
});

test('sector structure requires complete matching years, includes residual and never silently imputes missing sectors', () => {
  const total=series({'2025-01-01':100},{indicatorId:'vab_nominal',frequency:'annual'});
  const sectors=['agriculture','mining','manufacturing','construction','trade'].map(id=>series({'2025-01-01':10},{indicatorId:`sector_${id}`,frequency:'annual'}));
  const rows=regionalStructure([total,...sectors],'01','2025-01-01');
  assert.equal(rows.length,6);
  assert.equal(rows.at(-1).share,50);
  assert.equal(rows.reduce((sum,r)=>sum+r.share,0),100);
  assert.deepEqual(regionalStructure([total,...sectors.slice(1)],'01','2025-01-01'),[]);
  assert.deepEqual(regionalStructure([total,...sectors],'01','2024-01-01'),[]);
});
