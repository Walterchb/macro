import json
from pathlib import Path
import sys
import unittest
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from sync_agenda import (SOURCES,event,parse_ics,parse_bls,parse_bea,parse_fed,parse_ecb,
                         merge_results,validate_agenda,window_events,parse_bcrp,
                         parse_peru_holidays,parse_us_holidays,parse_target_holidays)
SOURCE={s['id']:s for s in SOURCES}
NOW=datetime(2026,9,22,12,tzinfo=timezone.utc)

class AgendaTests(unittest.TestCase):
    def test_inei_folded_lines_date_only_and_cancelled(self):
        feed='''BEGIN:VCALENDAR
BEGIN:VEVENT
UID:price-1
DTSTART;VALUE=DATE:20261001
SUMMARY:Indicadores de precios de la econo
 mía
DESCRIPTION:Septiembre\\, 2026
END:VEVENT
BEGIN:VEVENT
UID:cancel
DTSTART;VALUE=DATE:20261002
SUMMARY:Cancelled event
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR'''
        rows=parse_ics(feed,SOURCE['inei'])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['title'],'Indicadores de precios de la economía')
        self.assertEqual(rows[0]['date'],'2026-10-01')
        self.assertEqual(rows[0]['description'],'Septiembre, 2026')
        self.assertIsNone(rows[0]['time']);self.assertIsNone(rows[0]['startsAt'])

    def test_daylight_saving_and_utc_date_boundary(self):
        summer=event(SOURCE['bls'],'CPI','2026-10-14',time='08:30',zone='America/New_York')
        winter=event(SOURCE['bls'],'CPI','2026-11-10',time='08:30',zone='America/New_York')
        self.assertEqual(summer['time'],'07:30')
        self.assertEqual(winter['time'],'08:30')
        feed='BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20261002T020000Z\nSUMMARY:UTC event\nEND:VEVENT\nEND:VCALENDAR'
        row=parse_ics(feed,SOURCE['inei'])[0]
        self.assertEqual((row['date'],row['time']),('2026-10-01','21:00'))

    def test_official_html_parsers_no_inferred_times(self):
        bls='<tr><td>Friday, October 2, 2026</td><td>08:30 AM</td><td>Employment Situation for September 2026</td></tr>'
        self.assertEqual(parse_bls(bls,SOURCE['bls'])[0]['time'],'07:30')
        bea='<tr><th>Year 2026</th></tr><tr><td><div class="release-date">October 29</div><small>8:30 AM</small></td><td class="release-title views-field">GDP (Advance Estimate), 3rd Quarter 2026</td></tr>'
        self.assertEqual(parse_bea(bea,SOURCE['bea'])[0]['date'],'2026-10-29')
        fed='<h4>2026 FOMC Meetings</h4><div class="fomc-meeting__month"><strong>October</strong></div><div class="fomc-meeting__date">27-28*</div>'
        row=parse_fed(fed,SOURCE['fed'])[0]
        self.assertEqual(row['date'],'2026-10-28');self.assertIsNone(row['time'])
        ecb='<dt>28/10/2026</dt><dd>monetary policy meeting (Day 1)</dd><dt>29/10/2026</dt><dd>monetary policy meeting (Day 2)</dd><dt>25/11/2026</dt><dd>non-monetary policy meeting</dd>'
        self.assertEqual([x['date'] for x in parse_ecb(ecb,SOURCE['ecb'])],['2026-10-29'])

    def test_failure_retains_verification_success_removes_cancelled_dates(self):
        original=event(SOURCE['inei'],'Publicación','2026-10-01')
        previous={'events':[original], 'sources':[dict(SOURCE['inei'],fetchedAt='2026-09-20T12:00:00Z',lastSuccessAt='2026-09-20T12:00:00Z',publishedThrough='2026-12-01')]}
        retained=merge_results(previous,{'inei':{'error':'timeout'}},NOW)
        source=next(s for s in retained['sources'] if s['id']=='inei')
        self.assertEqual(source['status'],'retained')
        self.assertEqual(retained['events'][0]['verifiedAt'],'2026-09-20T12:00:00Z')
        self.assertNotEqual(source['attemptedAt'],source['lastSuccessAt'])
        replacement=event(SOURCE['inei'],'Nueva fecha','2026-10-02')
        updated=merge_results(previous,{'inei':{'events':[replacement]}},NOW)
        self.assertEqual([e['date'] for e in updated['events']],['2026-10-02'])

    def test_window_is_lima_and_validation_rejects_invented_hour(self):
        now=datetime(2026,9,23,2,tzinfo=timezone.utc) # still September 22 in Lima
        data=merge_results({}, {'inei':{'events':[event(SOURCE['inei'],'x','2026-09-22'),event(SOURCE['inei'],'y','2026-11-21'),event(SOURCE['inei'],'z','2026-11-22')]}},now,horizon=60)
        self.assertEqual(data['windowStart'],'2026-09-22')
        self.assertEqual([e['date'] for e in data['events']],['2026-09-22','2026-11-21'])
        validate_agenda(data)
        data['events'][0]['time']='12:00'
        with self.assertRaises(ValueError):validate_agenda(data)

    def test_coverage_uses_official_dates_not_requested_window(self):
        short=merge_results({}, {'inei':{'events':[event(SOURCE['inei'],'x','2026-10-01')]}},NOW)
        self.assertEqual(short['horizonDays'],120)
        self.assertFalse(short['coverage']['peru']['coversMonth'])
        full=merge_results({}, {'inei':{'events':[event(SOURCE['inei'],'x','2026-10-23')]}},NOW)
        self.assertTrue(full['coverage']['peru']['coversMonth'])

    def test_bcrp_explicit_dates_and_years_only(self):
        text='<h3>2026</h3><table><tr><td>15 de octubre</td><td>Nota informativa</td></tr><tr><td>noviembre</td><td>Por confirmar</td></tr></table><h3>2027</h3><table><tr><td>14 de enero</td><td>Nota informativa</td></tr></table>'
        rows=parse_bcrp(text,SOURCE['bcrp-policy'])
        self.assertEqual([e['date'] for e in rows],['2026-10-15','2027-01-14'])
        self.assertTrue(all(e['time'] is None and e['key'] for e in rows))
        with self.assertRaises(ValueError):parse_bcrp('<h3>2026</h3><tr><td>diciembre</td></tr>',SOURCE['bcrp-inflation'])

    def test_peru_holidays_include_featured_next_holiday_not_nonworking_days(self):
        page='<h1 class="holidays__title">Feriados 2026</h1><p>El siguiente feriado nacional es</p><p class="holidays__recent-holiday-date">Jueves 8 de octubre</p><p class="holidays__recent-holiday-name">Combate de Angamos</p><table><tr><td>Feriado nacional</td><td>Domingo 1 de noviembre</td><td>Todos los Santos</td></tr><tr><td>Día no laborable</td><td>Viernes 9 de octubre</td><td>Sector público</td></tr></table>'
        rows=parse_peru_holidays(page,SOURCE['peru-holidays'])
        self.assertEqual([e['date'] for e in rows],['2026-10-08','2026-11-01'])
        self.assertTrue(all(e['kind']=='holiday' and e['precision']=='date' for e in rows))

    def test_fed_holiday_saturday_no_friday_closure_and_sunday_observed_monday(self):
        page='<table><tr><td></td><td>HOLIDAY</td><td>2026</td><td>2027</td></tr><tr><td></td><td>Independence Day</td><td>Jul 4</td><td>Jul 4<sup>1</sup></td></tr></table>'
        rows=parse_us_holidays(page,SOURCE['us-holidays'])
        self.assertEqual([e['date'] for e in rows],['2026-07-04','2027-07-05'])
        self.assertTrue(all('bolsas' in e['description'] for e in rows))

    def test_target_filters_bce_office_holidays_and_keeps_explicit_year(self):
        page='<table><tr><th>Christmas Day*</th><td>25 December 2026</td></tr><tr><th>New Year\'s Eve</th><td>31 December 2026</td></tr><tr><th>New Year\'s Day*</th><td>1 January 2027</td></tr></table>'
        rows=parse_target_holidays(page,SOURCE['target-holidays'])
        self.assertEqual([e['date'] for e in rows],['2026-12-25','2027-01-01'])

    def test_120_day_calendar_handles_year_boundary(self):
        rows=[event(SOURCE['inei'],'Enero','2027-01-20'),event(SOURCE['inei'],'Fuera','2027-01-21')]
        data=merge_results({}, {'inei':{'events':rows}},NOW)
        self.assertEqual(data['windowEnd'],'2027-01-20')
        self.assertEqual([e['title'] for e in data['events']],['Enero'])

if __name__=='__main__':unittest.main()
