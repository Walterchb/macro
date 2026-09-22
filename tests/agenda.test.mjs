import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaEvents,agendaSummary,agendaICS} from '../assets/agenda.js';
const now=new Date('2026-09-23T02:00:00Z');
const base={sourceId:'inei',institution:'INEI',region:'peru',country:'Perú',sourceUrl:'https://www.inei.gob.pe/calendario/',category:'actividad',precision:'date',key:true};
const data={fetchedAt:'2026-09-22T12:00:00Z',windowEnd:'2026-11-21',sources:[{id:'inei',region:'peru',status:'ok',publishedThrough:'2026-12-01'}],events:[
  {...base,id:'today',date:'2026-09-22',title:'Producción, precios; economía'},
  {...base,id:'month',date:'2026-10-23',title:'Actividad'},
  {...base,id:'beyond',date:'2026-11-22',title:'Fuera'},
]};
test('calendar uses the date in Lima and includes the one-month endpoint',()=>{
  assert.deepEqual(agendaEvents(data,'peru',{days:31},now).map(x=>x.id),['today','month']);
  assert.equal(agendaSummary(data,'peru',now).covered,true);
  assert.equal(agendaSummary(data,'peru',now).week,1);
  assert.equal(agendaSummary(data,'world',now).covered,false);
});
test('ICS preserves date-only events and converts timed releases to UTC',()=>{
  const text=agendaICS([data.events[0],{...base,id:'timed',date:'2026-10-14',time:'07:30',startsAt:'2026-10-14T07:30:00-05:00',precision:'time',title:'IPC'}],now);
  assert.match(text,/DTSTART;VALUE=DATE:20260922\r\nDTEND;VALUE=DATE:20260923/);
  assert.match(text,/DTSTART:20261014T123000Z/);
  assert.match(text,/SUMMARY:Producción\\, precios\\; economía/);
  assert.equal((text.match(/BEGIN:VEVENT/g)||[]).length,2);
  assert.ok(text.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75));
});
test('missing or aged agenda is marked stale without displaying past events',()=>{
  assert.equal(agendaSummary(null,'peru',now).stale,true);
  const later=new Date('2027-01-01T12:00:00Z');
  assert.deepEqual(agendaEvents(data,'peru',{},later),[]);
  assert.equal(agendaSummary(data,'peru',later).stale,true);
  assert.equal(agendaSummary(data,'peru',later).covered,false);
});

test('upcoming summary excludes timed events whose scheduled hour passed, keeping date-only entries',()=>{
  const fixture={...data,events:[...data.events,{...base,id:'passed',title:'IPC',precision:'time',date:'2026-09-22',time:'07:30',startsAt:'2026-09-22T07:30:00-05:00'}]};
  assert.equal(agendaEvents(fixture,'peru',{},now).some(e=>e.id==='passed'),true);
  assert.equal(agendaSummary(fixture,'peru',now).events.some(e=>e.id==='passed'),false);
  assert.equal(agendaSummary(fixture,'peru',now).events.some(e=>e.id==='today'),true);
});

test('preview paging preserves chronology, clamps edges, and keeps a partial last page',async()=>{
  const {agendaPage}=await import('../assets/agenda.js');
  const events=Array.from({length:10},(_,i)=>({id:i}));
  assert.deepEqual(agendaPage(events,0).rows.map(e=>e.id),[0,1,2,3]);
  assert.deepEqual(agendaPage(events,1).rows.map(e=>e.id),[4,5,6,7]);
  assert.deepEqual(agendaPage(events,99),{page:2,pages:3,rows:[{id:8},{id:9}],from:9,to:10,total:10});
  assert.equal(agendaPage(events,-1).page,0);
  assert.equal(agendaPage(events.slice(0,2),2).page,0);
  assert.deepEqual(agendaPage([]),{page:0,pages:1,rows:[],from:0,to:0,total:0});
});

test('holiday filters and exports keep jurisdiction without an invented release hour',()=>{
  const holiday={...base,id:'holiday',kind:'holiday',title:'Combate de Angamos',category:'feriados',key:false,date:'2026-10-08',jurisdiction:'Feriado nacional · Perú'};
  const fixture={...data,events:[...data.events,holiday]};
  assert.deepEqual(agendaEvents(fixture,'peru',{category:'feriados'},now).map(e=>e.id),['holiday']);
  assert.equal(agendaEvents(fixture,'peru',{key:true},now).some(e=>e.id==='holiday'),false);
  const exported=agendaICS([holiday],now);
  assert.match(exported,/DTSTART;VALUE=DATE:20261008/);
  assert.match(exported,/STATUS:CONFIRMED/);
  assert.doesNotMatch(exported,/DTSTART:20261008T/);
});
