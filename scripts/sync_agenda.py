#!/usr/bin/env python3
"""Refresh a 120-day official release calendar, independently of macro observations.

No inferred release-day recurrences are generated. INEI's feed is discovered from
its official page; the public calendar remains owned by INEI, not this project.
A failed source retains its previously verified future events and verification
stamp. A successfully fetched calendar replaces that source (including removals).
Only Python's standard library is required.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
import hashlib
from html import unescape
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
LIMA = ZoneInfo('America/Lima')
MONTHS = {m.lower(): i for i, m in enumerate(('January','February','March','April','May','June','July','August','September','October','November','December'), 1)}
SPANISH_MONTHS = {m:i for i,m in enumerate(('enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'),1)}
SPANISH_MONTHS['setiembre'] = 9
HOLIDAY_NAMES = {
    "New Year's Day":'Año Nuevo', 'Birthday of Martin Luther King, Jr.':'Día de Martin Luther King Jr.',
    "Washington's Birthday":'Día de los Presidentes', 'Memorial Day':'Día de los Caídos',
    'Juneteenth National Independence Day':'Juneteenth', 'Independence Day':'Día de la Independencia',
    'Labor Day':'Día del Trabajo', 'Columbus Day':'Columbus Day', 'Veterans Day':'Día de los Veteranos',
    'Thanksgiving Day':'Acción de Gracias', 'Christmas Day':'Navidad', 'Christmas Holiday':'Segundo día de Navidad',
    'Good Friday':'Viernes Santo', 'Easter Monday':'Lunes de Pascua', 'Labour Day':'Día del Trabajo',
}
SOURCES = [
    {'id':'inei','institution':'INEI','region':'peru','country':'Perú','url':'https://www.inei.gob.pe/calendario/'},
    {'id':'bcrp-policy','institution':'BCRP · Programa monetario','region':'peru','country':'Perú','url':'https://www.bcrp.gob.pe/politica-monetaria/notas-informativas-del-programa-monetario.html'},
    {'id':'bcrp-inflation','institution':'BCRP · Reporte de Inflación','region':'peru','country':'Perú','url':'https://www.bcrp.gob.pe/publicaciones/reporte-de-inflacion.html'},
    {'id':'peru-holidays','institution':'Gob.pe','region':'peru','country':'Perú','url':'https://www.gob.pe/feriados'},
    {'id':'bls','institution':'BLS','region':'world','country':'Estados Unidos','url':'https://www.bls.gov/schedule/news_release/current_year.asp'},
    {'id':'bea','institution':'BEA','region':'world','country':'Estados Unidos','url':'https://www.bea.gov/news/schedule'},
    {'id':'fed','institution':'Reserva Federal','region':'world','country':'Estados Unidos','url':'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'},
    {'id':'ecb','institution':'BCE','region':'world','country':'Zona euro','url':'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'},
    {'id':'us-holidays','institution':'Fed de Nueva York','region':'world','country':'Estados Unidos','url':'https://www.newyorkfed.org/aboutthefed/holiday_schedule'},
    {'id':'target-holidays','institution':'BCE · TARGET','region':'world','country':'Zona euro','url':'https://www.ecb.europa.eu/ecb/contacts/working-hours/html/index.en.html'},
]


def clean(text):
    return re.sub(r'\s+', ' ', unescape(re.sub('<[^>]+>', ' ', text))).strip()


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent':'TreasuryMacroHub/5.0 (+https://github.com/Walterchb/macro)'})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(4_000_001)
        if len(body) > 4_000_000:
            raise ValueError('El calendario supera el tamaño máximo permitido')
        text = body.decode('utf-8-sig', errors='replace')
    if 'Incapsula' in text or 'Request unsuccessful' in text:
        raise ValueError('El proveedor no permite la consulta automática en este momento')
    return text


def event(source, title, day, *, time=None, zone=None, description='', uid=None, category='actividad', key=False, note=''):
    day = date.fromisoformat(day).isoformat()
    item = {'id': source['id'] + '-' + hashlib.sha256((uid or title + day).encode()).hexdigest()[:16],
            'sourceId': source['id'], 'institution':source['institution'], 'region':source['region'], 'country':source['country'],
            'title':clean(title), 'description':clean(description), 'date':day, 'time':None,
            'startsAt':None, 'timezone':'America/Lima', 'precision':'date', 'sourceUrl':source['url'],
            'category':category, 'key':bool(key), 'status':'scheduled', 'note':note}
    if time:
        local = datetime.fromisoformat(day + 'T' + time).replace(tzinfo=ZoneInfo(zone or 'America/Lima'))
        lima = local.astimezone(LIMA)
        item.update(date=lima.date().isoformat(), time=lima.strftime('%H:%M'), startsAt=lima.isoformat(), precision='time')
    return item


def classify(title):
    t = title.lower()
    if any(x in t for x in ('price','precio','inflation','inflación','income and outlays')):
        return 'precios'
    if any(x in t for x in ('employment','earnings','labor','cost index','job openings','trabajo')):
        return 'empleo'
    if any(x in t for x in ('trade','export','import','transactions')):
        return 'externo'
    if any(x in t for x in ('fomc','monetary','monetaria')):
        return 'tasas'
    if any(x in t for x in ('vida','pobre','hogares','género','servicios básicos','población','niñez','seguridad','enfermedades','ambientales')):
        return 'bienestar'
    return 'actividad'


def key_event(title):
    t = title.lower()
    return any(x in t for x in ('producción nacional','producto bruto','mercado laboral','indicadores de precios',
                                'consumer price index','employment situation','personal income and outlays','gdp (','fomc','política monetaria'))


def ics_properties(block):
    unfolded = re.sub(r'\r?\n[ \t]', '', block)
    out = {}
    for line in unfolded.splitlines():
        if ':' not in line:
            continue
        raw_key, value = line.split(':', 1)
        out[raw_key.split(';')[0]] = (raw_key, re.sub(r'\\([nN,;\\])', lambda m: '\n' if m[1].lower() == 'n' else m[1], value))
    return out


def parse_ics(text, source):
    if 'BEGIN:VCALENDAR' not in text:
        raise ValueError('La respuesta no contiene un calendario iCalendar')
    events = []
    for block in text.split('BEGIN:VEVENT')[1:]:
        prop = ics_properties(block.split('END:VEVENT', 1)[0])
        if prop.get('STATUS', ('',''))[1] == 'CANCELLED' or 'DTSTART' not in prop or 'SUMMARY' not in prop:
            continue
        # Recurrence expansion must not invent dates; feeds used here publish individual events.
        if 'RRULE' in prop:
            continue
        raw_key, value = prop['DTSTART']
        day = datetime.strptime(value[:8], '%Y%m%d').date().isoformat()
        kwargs = {}
        if 'T' in value:
            zone = re.search(r'TZID=([^;:]+)', raw_key)
            kwargs = {'time':datetime.strptime(value[9:15], '%H%M%S').strftime('%H:%M:%S'),
                      'zone':'UTC' if value.endswith('Z') else (zone[1] if zone else 'America/Lima')}
        title = prop['SUMMARY'][1].strip()
        events.append(event(source,title,day,description=prop.get('DESCRIPTION',('',''))[1],
                            uid=prop.get('UID',('',title+day))[1],category=classify(title),key=key_event(title),**kwargs))
    if not events:
        raise ValueError('No se encontraron acontecimientos explícitos en el calendario')
    return events


def fetch_inei(source):
    page = fetch(source['url'])
    frames = re.findall(r'<iframe[^>]+src=["\']([^"\']+)',page,re.I)
    calendars = [urllib.parse.parse_qs(urllib.parse.urlparse(unescape(src)).query).get('src',[None])[0]
                 for src in frames if 'google.com/calendar/' in src]
    calendar_id = next((x for x in calendars if x),None)
    if not calendar_id:
        raise ValueError('INEI no publicó un calendario compatible en su página oficial')
    feed = 'https://calendar.google.com/calendar/ical/' + urllib.parse.quote(calendar_id,safe='') + '/public/basic.ics'
    events = parse_ics(fetch(feed), source)
    return events, {'feedUrl':feed, 'provenance':'Calendario público incrustado por INEI en su página oficial.'}


def parse_bls(text, source):
    events = []
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',text,re.S|re.I):
        cells = [clean(x) for x in re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S|re.I)]
        if len(cells) < 3:
            continue
        match = re.search(r'([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})',cells[0])
        clock = re.search(r'(\d{1,2}:\d{2})\s*(AM|PM)',cells[1],re.I)
        if not match or not clock or match[1].lower() not in MONTHS:
            continue
        title = cells[2]
        # National headline releases; omit local-area calendars and holidays.
        if not any(title.startswith(x) for x in ('Employment Situation','Consumer Price Index','Producer Price Index','Real Earnings',
                'Job Openings and Labor Turnover','Employment Cost Index','Productivity and Costs','U.S. Import and Export Price')):
            continue
        day = date(int(match[3]),MONTHS[match[1].lower()],int(match[2])).isoformat()
        time = datetime.strptime(clock[1]+' '+clock[2].upper(),'%I:%M %p').strftime('%H:%M')
        translations = {'Employment Situation':'Empleo y desempleo', 'Consumer Price Index':'Inflación al consumidor (IPC)',
                        'Producer Price Index':'Precios al productor (IPP)', 'Real Earnings':'Salarios reales',
                        'Job Openings and Labor Turnover Survey':'Vacantes y rotación laboral (JOLTS)',
                        'Employment Cost Index':'Costos laborales', 'Productivity and Costs':'Productividad y costos',
                        'U.S. Import and Export Price Indexes':'Precios de importación y exportación'}
        name = next((v for k,v in translations.items() if title.startswith(k)),title)
        events.append(event(source,name,day,time=time,zone='America/New_York',description=title,category=classify(title),key=key_event(title)))
    if not events:
        raise ValueError('No se reconocieron las filas de publicaciones nacionales del BLS')
    return events


def parse_bea(text, source):
    year = None
    events = []
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',text,re.S|re.I):
        header = re.search(r'Year\s+(20\d{2})',clean(row))
        if header:
            year = int(header[1])
            continue
        ds = re.search(r'class=["\']release-date["\'][^>]*>(.*?)</div>',row,re.S|re.I)
        ts = re.search(r'class=["\'][^"\']*release-title[^"\']*["\'][^>]*>(.*?)</td>',row,re.S|re.I)
        clock = re.search(r'(\d{1,2}:\d{2})\s*(AM|PM)',clean(row),re.I)
        if not (year and ds and ts and clock):
            continue
        month, day = clean(ds[1]).split(' ')[:2]
        if month.lower() not in MONTHS:
            continue
        title = clean(ts[1])
        if not any(x in title for x in ('GDP','Personal Income and Outlays','International Trade in Goods','International Transactions')):
            continue
        name = ('PIB y cuentas nacionales' if title.startswith('GDP') else 'Ingresos, consumo e inflación PCE' if title.startswith('Personal Income')
                else 'Comercio internacional' if 'Trade' in title else 'Balanza de pagos y posición internacional')
        time = datetime.strptime(clock[1]+' '+clock[2].upper(),'%I:%M %p').strftime('%H:%M')
        events.append(event(source,name,date(year,MONTHS[month.lower()],int(day)).isoformat(),time=time,zone='America/New_York',
                            description=title,category=classify(title),key=key_event(title)))
    if not events:
        raise ValueError('No se reconocieron las fechas de publicación de BEA')
    return events


def parse_fed(text, source):
    parts = re.split(r'(20\d{2}) FOMC Meetings',text)
    events = []
    for pos in range(1,len(parts),2):
        year, section = int(parts[pos]), parts[pos+1]
        for month, days in re.findall(r'class=["\'][^"\']*fomc-meeting__month[^"\']*["\'][^>]*>(.*?)</div>\s*<div[^>]*fomc-meeting__date[^>]*>(.*?)</div>',section,re.S|re.I):
            month, days = clean(month).split('/')[-1].lower(), clean(days)
            # Use final meeting day. No unsourced announcement time is assigned.
            numbers = re.findall(r'\d+',days)
            if month not in MONTHS or not numbers:
                continue
            day = date(year,MONTHS[month],int(numbers[-1])).isoformat()
            events.append(event(source,'Decisión de política monetaria — Fed',day,category='tasas',key=True,
                                description='Último día de la reunión del FOMC'+ ('; incluye proyecciones económicas.' if '*' in days else '.'),
                                note='Fecha publicada por la Fed; las reuniones futuras pueden ser revisadas. Hora por confirmar.'))
    if not events:
        raise ValueError('No se reconocieron las fechas del FOMC')
    return events


def parse_ecb(text, source):
    events = []
    for day, title in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',text,re.S|re.I):
        day, title = clean(day),clean(title)
        if 'monetary policy meeting' not in title or 'non-monetary' in title or 'Day 2' not in title:
            continue
        try:
            day = datetime.strptime(day,'%d/%m/%Y').date().isoformat()
        except ValueError:
            continue
        events.append(event(source,'Decisión de política monetaria — BCE',day,description=title,category='tasas',key=True,
                            note='Último día de la reunión y rueda de prensa. Hora por confirmar.'))
    if not events:
        raise ValueError('No se reconocieron las reuniones de política monetaria del BCE')
    return events


def spanish_date(text, year):
    match = re.search(r'(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+(?:de\s+)?(20\d{2}))?', clean(text).lower())
    if not match or match[2] not in SPANISH_MONTHS:
        return None
    return date(int(match[3] or year), SPANISH_MONTHS[match[2]], int(match[1])).isoformat()


def parse_bcrp(text, source):
    """Only explicit day/month rows under an explicit year heading are accepted."""
    # BCRP groups schedules/publications by year. Never infer a meeting from its
    # customary weekday, nor a report from the month of a previous report.
    year_headers = list(re.finditer(r'<(?:h[1-6]|strong|b|span|button|td)\b[^>]*>\s*(?:<[^>]+>\s*)*(20\d{2})\s*(?:</[^>]+>\s*)*</(?:h[1-6]|strong|b|span|button|td)>', text, re.I))
    rows = []
    for i, header in enumerate(year_headers):
        year = int(header[1])
        section = text[header.end():year_headers[i+1].start() if i+1<len(year_headers) else len(text)]
        for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', section, re.S|re.I):
            cells = [clean(c) for c in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.S|re.I)]
            if not cells:
                continue
            day = spanish_date(cells[0], year)
            if not day:
                continue
            inflation = source['id']=='bcrp-inflation'
            rows.append(event(source, 'Reporte de Inflación — BCRP' if inflation else 'Decisión de tasa de referencia — BCRP', day,
                              category='precios' if inflation else 'tasas', key=True,
                              description='Proyecciones macroeconómicas y balance de riesgos.' if inflation else 'Programa monetario y decisión del Directorio sobre la tasa de referencia.'))
    if not rows:
        raise ValueError('BCRP no ofrece fechas explícitas reconocibles; no se infiere el calendario')
    return list({r['id']:r for r in rows}.values())


def holiday(source, title, day, scope, description=''):
    item = event(source, title, day, category='feriados', description=description)
    item.update(kind='holiday', jurisdiction=scope)
    return item


def parse_peru_holidays(text, source):
    heading = re.search(r'<h1[^>]*>\s*Feriados\s+(20\d{2})', text, re.I)
    if not heading:
        raise ValueError('Gob.pe no identifica el año del calendario de feriados')
    year = int(heading[1]); events = []
    # The next holiday sits outside the table, and would otherwise be omitted.
    recent = re.search(r'holidays__recent-holiday-date[^>]*>(.*?)</p>\s*<p[^>]*holidays__recent-holiday-name[^>]*>(.*?)</p>', text, re.S)
    if recent and 'feriado nacional' in clean(text[max(0,recent.start()-400):recent.start()]).lower():
        day = spanish_date(recent[1],year)
        if day: events.append(holiday(source, clean(recent[2]), day, 'Feriado nacional · Perú'))
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', text, re.S|re.I):
        cells=[clean(x) for x in re.findall(r'<td\b[^>]*>(.*?)</td>',row,re.S|re.I)]
        if len(cells)<3 or cells[0].lower()!='feriado nacional':
            continue
        day=spanish_date(cells[1],year)
        if day: events.append(holiday(source,cells[2],day,'Feriado nacional · Perú'))
    if not events: raise ValueError('No se reconocieron feriados nacionales en Gob.pe')
    return list({e['id']:e for e in events}.values())


def parse_us_holidays(text, source):
    """Read NY Fed's multi-year table and its published Sunday-observance rule."""
    events=[]
    aliases={m[:3]:v for m,v in MONTHS.items()}
    for table in re.findall(r'<table\b[^>]*>(.*?)</table>',text,re.S|re.I):
        years=[]
        for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',table,re.S|re.I):
            cells=[clean(re.sub(r'<sup\b.*?</sup>','',x,flags=re.S|re.I)) for x in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',row,re.S|re.I)]
            cells=[x for x in cells if x]
            if cells and cells[0]=='HOLIDAY':
                years=[int(x) for x in cells[1:] if re.fullmatch(r'20\d{2}',x)];continue
            if not years or len(cells)!=len(years)+1:
                continue
            for year,cell in zip(years,cells[1:]):
                match=re.fullmatch(r'([A-Za-z]+)\.?\s+(\d{1,2})',cell)
                if not match or match[1][:3].lower() not in aliases: continue
                day=date(year,aliases[match[1][:3].lower()],int(match[2]))
                # NY Fed explicitly observes Sunday holidays on Monday; Saturday
                # holidays do NOT close the preceding Friday (unlike OPM rules).
                if day.weekday()==6: day+=timedelta(days=1)
                item=holiday(source,HOLIDAY_NAMES.get(cells[0],cells[0]),day.isoformat(),'Feriado bancario · Reserva Federal',
                             'Calendario de la Reserva Federal; no determina el cierre de las bolsas de valores.')
                events.append(item)
    if not events:raise ValueError('No se reconoció la tabla plurianual de feriados de la Fed')
    return events


def parse_target_holidays(text, source):
    events=[]
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',text,re.S|re.I):
        cells=[clean(x) for x in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',row,re.S|re.I)]
        if len(cells)!=2 or not cells[0].endswith('*'): continue
        match=re.fullmatch(r'(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})',cells[1])
        if not match or match[2].lower() not in MONTHS: continue
        day=date(int(match[3]),MONTHS[match[2].lower()],int(match[1])).isoformat()
        name=cells[0].rstrip('*')
        events.append(holiday(source,HOLIDAY_NAMES.get(name,name),day,'Cierre TARGET · Zona euro',
                              'Día de cierre TARGET identificado por el BCE. No es un feriado de todos los países de la zona euro.'))
    if not events:raise ValueError('No se encontraron fechas explícitas de cierre TARGET')
    return events


def retrieve(source):
    if source['id'] == 'inei':
        return fetch_inei(source)
    parser = {'bls':parse_bls,'bea':parse_bea,'fed':parse_fed,'ecb':parse_ecb,
              'bcrp-policy':parse_bcrp,'bcrp-inflation':parse_bcrp,'peru-holidays':parse_peru_holidays,
              'us-holidays':parse_us_holidays,'target-holidays':parse_target_holidays}[source['id']]
    return parser(fetch(source['url']),source), {}


def window_events(events, start, end):
    return [dict(e) for e in events if start <= e['date'] <= end]


def merge_results(previous, results, now, horizon=120):
    today = now.astimezone(LIMA).date()
    start, end = today.isoformat(), (today + timedelta(days=horizon)).isoformat()
    stamp = now.astimezone(timezone.utc).isoformat().replace('+00:00','Z')
    old_sources = {s['id']:s for s in previous.get('sources',[])}
    sources, events = [], []
    for spec in SOURCES:
        sid = spec['id']; result = results.get(sid,{'error':'Fuente no consultada'})
        old = old_sources.get(sid,{})
        source = {**spec, 'attemptedAt':stamp}
        if 'error' not in result:
            rows = result['events']
            source.update(status='ok', fetchedAt=stamp, lastSuccessAt=stamp, message='Calendario oficial consultado',**result.get('metadata',{}))
            source['publishedThrough'] = max((e['date'] for e in rows),default=None)
        else:
            rows = [e for e in previous.get('events',[]) if e['sourceId'] == sid]
            future = window_events(rows,start,end)
            source.update(status='retained' if future else 'unavailable', fetchedAt=old.get('fetchedAt'),lastSuccessAt=old.get('lastSuccessAt'),
                          publishedThrough=old.get('publishedThrough'), message='Se conserva la última agenda verificada' if future else 'Sin fechas verificadas disponibles',
                          error=str(result['error'])[:180])
            for key in ('feedUrl','provenance'):
                if key in old: source[key]=old[key]
        future = window_events(rows,start,end)
        for item in future:
            item['sourceStatus'] = source['status']
            item['verifiedAt'] = source['lastSuccessAt']
        source['eventsInWindow'] = len(future)
        source['coversMonth'] = bool(source.get('publishedThrough') and source['publishedThrough'] >= (today+timedelta(days=31)).isoformat())
        sources.append(source); events.extend(future)
    unique = {e['id']:e for e in events}
    events = sorted(unique.values(),key=lambda e:(e['date'],e.get('time') or '99:99',e['title']))
    coverage = {}
    for region in ('peru','world'):
        subset=[e for e in events if e['region']==region]
        relevant=[s for s in sources if s['region']==region]
        coverage[region]={'events':len(subset),'nextDate':min((e['date'] for e in subset),default=None),
                          'lastEventDate':max((e['date'] for e in subset),default=None),
                          'coversMonth':any(s['coversMonth'] for s in relevant),
                          'freshSources':sum(s['status']=='ok' for s in relevant),'totalSources':len(relevant)}
    return {'schemaVersion':1,'fetchedAt':stamp,'timezone':'America/Lima','horizonDays':horizon,
            'windowStart':start,'windowEnd':end,'coverage':coverage,'sources':sources,'events':events,
            'note':'Fechas publicadas por las instituciones, sujetas a revisión. Sin previsiones ni consensos de mercado. Las publicaciones sin hora se muestran como fecha, sin inventar un horario.'}


def validate_agenda(data=None):
    if data is None:
        data=json.loads((ROOT/'data/agenda.json').read_text())
    if data.get('schemaVersion')!=1 or data.get('horizonDays',0)<31:
        raise ValueError('Ventana de agenda inválida')
    if (date.fromisoformat(data['windowEnd'])-date.fromisoformat(data['windowStart'])).days<31:
        raise ValueError('La ventana debe cubrir al menos un mes')
    seen=set(); source_ids={s['id'] for s in data['sources']}
    for e in data['events']:
        if e['id'] in seen or e['sourceId'] not in source_ids:
            raise ValueError('Identificador duplicado o fuente inexistente')
        seen.add(e['id'])
        if not data['windowStart'] <= e['date'] <= data['windowEnd']:
            raise ValueError('Evento fuera del horizonte')
        if e['precision']=='date' and (e.get('time') or e.get('startsAt')):
            raise ValueError('Una fecha sin hora no puede tener horario inferido')
        if e['precision']=='time':
            dt=datetime.fromisoformat(e['startsAt']).astimezone(LIMA)
            if dt.date().isoformat()!=e['date'] or dt.strftime('%H:%M')!=e['time']:
                raise ValueError('Horario de Lima inconsistente')
    return data


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'data/agenda.json')
    parser.add_argument('--validate',action='store_true',help='Validate the existing JSON without network requests')
    args=parser.parse_args()
    if args.validate:
        validate_agenda(json.loads(args.output.read_text()));print('Agenda válida');return
    previous=json.loads(args.output.read_text()) if args.output.exists() else {}
    results={}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures={pool.submit(retrieve,source):source['id'] for source in SOURCES}
        for future in as_completed(futures):
            sid=futures[future]
            try:
                rows,metadata=future.result();results[sid]={'events':rows,'metadata':metadata}
            except Exception as exc:
                results[sid]={'error':str(exc)}
    data=validate_agenda(merge_results(previous,results,datetime.now(timezone.utc)))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary=args.output.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(args.output)
    print(json.dumps({'events':len(data['events']),'windowEnd':data['windowEnd'],'sources':{s['id']:s['status'] for s in data['sources']}},ensure_ascii=False))
    if not any(s['status']=='ok' for s in data['sources']):
        raise SystemExit(1)

if __name__=='__main__':
    main()
