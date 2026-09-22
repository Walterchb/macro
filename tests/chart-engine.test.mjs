import test from 'node:test';
import assert from 'node:assert/strict';
import {computeStats,regression,spreadRows,recessionBands} from '../assets/chart-engine.js';
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
