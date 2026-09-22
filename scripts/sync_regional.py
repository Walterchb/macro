"""Refresh Peru regional statistics from BCRP. Python standard library only."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import posixpath
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from sync_data import atomic_json, numeric, parse_period, request, validate_series

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'config/regional-series.json'
OUTPUT = ROOT / 'data/regional.json'
XLS_NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def xlsx_grids(content):
    """Read published XLSX values, including cached formulas; no Excel dependency."""
    with ZipFile(io.BytesIO(content)) as archive:
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(node.itertext()) for node in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        relations = {r.get('Id'): r.get('Target') for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        result = []
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', XLS_NS):
            target = relations[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            filename = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            grid = {}
            for cell in ET.fromstring(archive.read(filename)).findall('.//s:sheetData/s:row/s:c', XLS_NS):
                value = cell.find('s:v', XLS_NS)
                if cell.get('t') == 'inlineStr':
                    grid[cell.get('r')] = ''.join(cell.find('s:is', XLS_NS).itertext())
                elif value is not None:
                    grid[cell.get('r')] = shared[int(value.text)] if cell.get('t') == 's' else value.text
            result.append({'name': sheet.get('name'), 'cells': grid})
        if not result:
            raise ValueError('El libro INEI no contiene hojas legibles')
        return result


def find_excel(index_html, pattern, base_url):
    links = re.findall(r'<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>', index_html, re.S | re.I)
    candidates = [urljoin(base_url, html.unescape(href)) for href, label in links
                  if re.search(pattern, normalized(re.sub('<[^>]+>', ' ', html.unescape(label))))
                  and href.lower().endswith('.xlsx')]
    if len(set(candidates)) != 1:
        raise ValueError('El índice INEI no identifica un único archivo: ' + pattern)
    return candidates[0]


def request_excel(url):
    with urlopen(Request(url, headers={'User-Agent': 'TreasuryMacroHub/1.0 (public economic research)'}), timeout=40) as response:
        content = response.read()
    if not content.startswith(b'PK'):
        raise ValueError('La fuente INEI no devolvió un archivo XLSX')
    return content


def parse_inei_gdp(grids, regions, price='real'):
    """Match headers, named territories and explicit Lima components, never row positions."""
    expected_price = 'constantes' if price == 'real' else 'corrientes'
    candidates = [g['cells'] for g in grids
                  if expected_price in normalized(g['cells'].get('A4', ''))
                  and 'miles de soles' in normalized(g['cells'].get('A5', ''))]
    if len(candidates) != 1:
        raise ValueError('No se identifica la hoja de VAB en miles de soles: ' + price)
    cells = candidates[0]
    if price == 'real' and '2007' not in cells.get('A4', ''):
        raise ValueError('La base de precios reales cambió; requiere revisar unidades y continuidad')
    if 'departamentos' not in normalized(cells.get('A3', '')):
        raise ValueError('El archivo no es una tabla departamental')
    years = {}
    for address, value in cells.items():
        if re.fullmatch(r'[A-Z]+7', address) and re.fullmatch(r'20\d{2}(?:[PE]/)?', value.strip()):
            year = int(value[:4])
            if year >= datetime.now(timezone.utc).year:
                raise ValueError('El VAB anual incluye un año no cerrado')
            years[address[:-1]] = (year, 'estimated' if 'E/' in value else 'provisional' if 'P/' in value else 'published')
    if len(years) < 2:
        raise ValueError('No se identifican los años de la tabla INEI')
    names = {normalized(value): int(address[1:]) for address, value in cells.items() if re.fullmatch(r'A\d+', address)}
    output = {}
    for region in regions:
        if region['id'] == '15':
            aliases = [('region lima', 'lima provincias'), ('provincia de lima', 'lima metropolitana')]
        elif region['id'] == '07':
            aliases = [('prov. const. del callao', 'callao')]
        else:
            aliases = [(normalized(region['name']),)]
        row_numbers = []
        for alternatives in aliases:
            matches = [names[name] for name in alternatives if name in names]
            if len(matches) != 1:
                raise ValueError('Territorio INEI ausente o ambiguo: ' + region['name'])
            row_numbers.append(matches[0])
        rows = []
        for column, (year, status) in sorted(years.items(), key=lambda x: x[1][0]):
            values = [numeric(cells.get(column + str(row))) for row in row_numbers]
            if all(value is not None for value in values):
                total = sum(values)
                if total < 0:
                    raise ValueError('VAB negativo en la tabla regional')
                rows.append({'date': f'{year}-01-01', 'value': total / 1000, 'observationStatus': status})
        output[region['id']] = rows
    # INEI's broad Lima aggregate includes Callao: explicitly test our disjoint mapping.
    if 'lima' in names:
        lookups = {rid: {r['date']: r['value'] for r in output[rid]} for rid in ('07', '15')}
        for column, (year, _) in years.items():
            broad = numeric(cells.get(column + str(names['lima'])))
            day = f'{year}-01-01'
            if broad is not None and all(day in lookups[rid] for rid in lookups):
                if abs((lookups['07'][day] + lookups['15'][day]) * 1000 - broad) > 3:
                    raise ValueError('Lima, sus componentes y Callao no concilian')
    return output


def parse_inei_population(grids, regions):
    output = {region['id']: [] for region in regions}
    for sheet in grids:
        cells = sheet['cells']
        if 'poblacion estimada al 30 de junio' not in normalized(cells.get('A1', '')):
            continue
        years = {address[:-1]: int(value) for address, value in cells.items()
                 if re.fullmatch(r'[A-Z]+3', address) and re.fullmatch(r'20\d{2}', value.strip())
                 and int(value) <= datetime.now(timezone.utc).year}
        totals = {column: year for column, year in years.items() if normalized(cells.get(column + '4', '')) == 'total'}
        if years != totals:
            raise ValueError('No se identifica la población total, ambos sexos')
        for address, ubigeo in cells.items():
            if not re.fullmatch(r'A\d+', address) or not re.fullmatch(r'\d{6}', ubigeo):
                continue
            rid, row = ubigeo[:2], address[1:]
            if rid not in output:
                continue
            for column, year in sorted(totals.items(), key=lambda x: x[1]):
                value = numeric(cells.get(column + row))
                if value is None or value <= 0 or value != int(value):
                    raise ValueError('Población regional inválida: ' + rid)
                output[rid].append({'date': f'{year}-01-01', 'value': value, 'observationStatus': 'population_estimate'})
    for rid, rows in output.items():
        if len(rows) < 2:
            raise ValueError('Falta población regional: ' + rid)
        rows.sort(key=lambda row: row['date'])
        validate_series({'id': 'INEI:population:' + rid, 'observations': rows})
    return output


def per_capita(numerator, population):
    """Same department and same year only; millions of soles / persons -> soles/person."""
    people = {row['date']: row['value'] for row in population}
    return [{**row, 'value': row['value'] * 1000000 / people[row['date']],
             'populationBasis': 'INEI estimated/projected mid-year population'}
            for row in numerator if people.get(row['date'], 0) > 0]


def fetch_inei(config):
    rows_by_code, errors_by_code, api_urls = {}, {}, {}
    indices, workbooks = {}, {}
    for spec in config.get('ineiSources', []):
        try:
            if spec['indexUrl'] not in indices:
                indices[spec['indexUrl']] = request(spec['indexUrl'])
            url = find_excel(indices[spec['indexUrl']], spec['linkPattern'], spec['indexUrl'])
            if url not in workbooks:
                workbooks[url] = xlsx_grids(request_excel(url))
            grids = workbooks[url]
            metric = spec['indicatorId']
            by_region = parse_inei_population(grids, config['regions']) if metric == 'population' else parse_inei_gdp(grids, config['regions'], spec.get('price', 'real'))
            for rid, rows in by_region.items():
                code = f'INEI:{metric}:{rid}'
                rows_by_code[code] = rows
                api_urls[code] = url
        except Exception as error:
            for region in config['regions']:
                errors_by_code[f'INEI:{spec["indicatorId"]}:{region["id"]}'] = str(error)
            print('AVISO INEI regional', spec['indicatorId'], str(error), flush=True)
    for region in config['regions']:
        rid = region['id']
        for metric in ('vab_real_pc', 'vab_nominal_pc'):
            numerator = f'INEI:{metric[:-3]}:{rid}'
            population = f'INEI:population:{rid}'
            code = f'INEI:{metric}:{rid}'
            if numerator in errors_by_code or population in errors_by_code:
                errors_by_code[code] = 'No se actualizó una de las dos fuentes de VAB por habitante'
            else:
                rows_by_code[code] = per_capita(rows_by_code.get(numerator, []), rows_by_code.get(population, []))
                api_urls[code] = [api_urls.get(numerator, ''), api_urls.get(population, '')]
    return rows_by_code, errors_by_code, api_urls


def normalized(value):
    value = ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', value.casefold()).strip()


def parse_batch(payload, sources, today):
    """Check every API column against the catalogue before assigning its region."""
    columns = payload.get('config', {}).get('series', [])
    if len(columns) != len(sources) or not payload.get('periods'):
        raise ValueError('Esquema BCRP regional vacío o número de columnas inesperado')
    for column, source in zip(columns, sources):
        if normalized(column.get('name', '')) != normalized(source['description']):
            raise ValueError('La identidad de la columna no coincide: ' + source['code'])
    result = {source['code']: [] for source in sources}
    for period in payload['periods']:
        period_date = parse_period(period['name'])
        if period_date > today.isoformat():
            raise ValueError('La fuente devuelve una observación futura')
        values = period.get('values', [])
        if len(values) != len(sources):
            raise ValueError('Periodo regional con columnas incompletas')
        for source, raw in zip(sources, values):
            value = numeric(raw)
            if value is not None:
                result[source['code']].append({'date': period_date, 'value': value})
    for code, rows in result.items():
        rows.sort(key=lambda row: row['date'])
        validate_series({'id': code, 'observations': rows})
    return result


def fetch_batch(sources, now, history_from):
    start = history_from[:7]
    codes = '-'.join(source['code'] for source in sources)
    url = f'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/{codes}/json/{start}/{now.year}-{now.month}'
    return parse_batch(json.loads(request(url)), sources, now.date()), url


def combine_exact(sources):
    """Sum disjoint territories only for dates observed in every component."""
    if not sources or any(not rows for rows in sources):
        return []
    if len(sources) == 1:
        return [dict(row) for row in sources[0]]
    lookups = [{row['date']: row['value'] for row in rows} for rows in sources]
    dates = set.intersection(*(set(lookup) for lookup in lookups))
    return [{'date': day, 'value': sum(lookup[day] for lookup in lookups)} for day in sorted(dates)]


def assemble_series(spec, rows_by_code, previous, stamp, errors_by_code, api_urls):
    codes = [source['code'] for source in spec['sources']]
    errors = [errors_by_code[code] for code in codes if code in errors_by_code]
    rows = []
    if not errors:
        rows = combine_exact([rows_by_code.get(code, []) for code in codes])
        if not rows:
            errors.append('La fuente no devuelve observaciones numéricas comunes')
        if previous and previous.get('observations') and rows:
            prior_rows = previous['observations']
            if rows[-1]['date'] < prior_rows[-1]['date'] or len(rows) < len(prior_rows) * .9:
                errors.append('La cobertura retrocedió; se conserva el historial válido')
    if errors:
        retained = previous and previous.get('observations')
        return {
            **spec,
            'observations': previous['observations'] if retained else [],
            'fetchedAt': previous.get('fetchedAt') if retained else None,
            'lastObservationDate': previous.get('lastObservationDate') if retained else None,
            'status': 'retained' if retained else 'unavailable',
            'lastAttemptAt': stamp,
            'error': '; '.join(dict.fromkeys(errors)),
            'apiUrls': previous.get('apiUrls', []) if retained else [],
        }
    result = {
        **spec,
        'observations': rows,
        'fetchedAt': stamp,
        'lastAttemptAt': stamp,
        'lastObservationDate': rows[-1]['date'],
        'status': 'ok',
        'apiUrls': list(dict.fromkeys(url for code in codes for url in
                                     (api_urls[code] if isinstance(api_urls[code], list) else [api_urls[code]]))),
    }
    validate_series(result)
    return result


def validate_regional(snapshot):
    region_ids = {region['id'] for region in snapshot['regions']}
    if region_ids != {f'{number:02d}' for number in range(1, 26)}:
        raise ValueError('La cobertura geográfica debe incluir 25 códigos departamentales')
    indicators = {indicator['id']: indicator for indicator in snapshot['indicators']}
    indicator_ids = set(indicators)
    keys = set()
    for series in snapshot['series']:
        key = (series['regionId'], series['indicatorId'])
        if key in keys or key[0] not in region_ids or key[1] not in indicator_ids:
            raise ValueError('Identidad regional duplicada o desconocida')
        keys.add(key)
        validate_series(series)
        if series.get('frequency') != indicators[key[1]]['frequency']:
            raise ValueError('Frecuencia regional diferente a la del indicador')
        if any(row['date'][8:] != '01' for row in series['observations']):
            raise ValueError('El periodo regional debe usar el primer día como identificador')
        if series.get('frequency') == 'annual' and any(row['date'][5:] != '01-01' for row in series['observations']):
            raise ValueError('Un periodo anual debe usar el primero de enero como identificador')
        if series['observations'] and series['lastObservationDate'] != series['observations'][-1]['date']:
            raise ValueError('La fecha del último dato no coincide')
    by_key = {(s['regionId'], s['indicatorId']): s for s in snapshot['series']}
    for rid in region_ids:
        for metric in ('vab_real', 'vab_nominal'):
            numerator = by_key.get((rid, metric))
            population = by_key.get((rid, 'population'))
            derived = by_key.get((rid, metric + '_pc'))
            group = [numerator, population, derived]
            if not all(s and s.get('status') == 'ok' for s in group):
                continue
            if len({s.get('fetchedAt') for s in group}) != 1:
                continue
            expected = {r['date']: r['value'] for r in per_capita(numerator['observations'], population['observations'])}
            if any(row['date'] not in expected or abs(row['value'] - expected[row['date']]) > 1e-6 for row in derived['observations']):
                raise ValueError('El VAB por habitante no concilia con sus dos fuentes')
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate', action='store_true', help='Valida el paquete local sin acceder a la red.')
    args = parser.parse_args(argv)
    if args.validate:
        validate_regional(json.loads(OUTPUT.read_text(encoding='utf-8')))
        print('Paquete regional válido')
        return
    config = json.loads(CATALOG.read_text(encoding='utf-8'))
    old = json.loads(OUTPUT.read_text(encoding='utf-8')) if OUTPUT.exists() else {'series': []}
    previous = {series['id']: series for series in old['series']}
    now = datetime.now(timezone.utc)
    stamp = now.isoformat()
    sources = {source['code']: source for series in config['series'] if series['provider'] == 'BCRP' for source in series['sources']}
    ordered = [sources[code] for code in sorted(sources)]
    batches = [ordered[start:start + 10] for start in range(0, len(ordered), 10)]
    rows_by_code, errors_by_code, api_urls = {}, {}, {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_batch, batch, now, config['historyFrom']): batch for batch in batches}
        for future in as_completed(futures):
            batch = futures[future]
            try:
                rows, url = future.result()
                rows_by_code.update(rows)
                api_urls.update({source['code']: url for source in batch})
            except Exception as error:
                errors_by_code.update({source['code']: str(error) for source in batch})
                print('AVISO regional', batch[0]['code'], str(error), flush=True)
    inei_rows, inei_errors, inei_urls = fetch_inei(config)
    rows_by_code.update(inei_rows)
    errors_by_code.update(inei_errors)
    api_urls.update(inei_urls)
    series = [assemble_series(spec, rows_by_code, previous.get(spec['id']), stamp, errors_by_code, api_urls)
              for spec in config['series']]
    if not any(item['observations'] for item in series):
        raise RuntimeError('No hay observaciones regionales válidas; no se publica un paquete vacío')
    refreshed = sum(item['status'] == 'ok' for item in series)
    last_fetched = old.get('fetchedAt') or max(
        (item.get('fetchedAt') for item in series if item.get('fetchedAt')), default=None)
    snapshot = {
        'schemaVersion': '1.1', 'fetchedAt': stamp if refreshed else last_fetched, 'checkedAt': stamp,
        'status': 'ok' if refreshed == len(series) else 'partial' if refreshed else 'retained',
        'regions': config['regions'], 'indicators': config['indicators'], 'series': series,
        'notes': config['notes'], 'catalogUrl': config['catalogUrl'],
        'coverage': {
            'regions': len(config['regions']), 'indicators': len(config['indicators']),
            'series': len(series), 'seriesWithData': sum(bool(s['observations']) for s in series),
            'observations': sum(len(s['observations']) for s in series),
            'retained': sum(s['status'] == 'retained' for s in series),
            'unavailable': sum(s['status'] == 'unavailable' for s in series),
            'frequencies': {frequency: sum(s['frequency'] == frequency for s in series) for frequency in sorted({s['frequency'] for s in series})},
            'missingCombinations': [{'regionId': '07', 'indicatorId': 'electricity',
                                     'reason': 'MINEM/BCRP no publica una serie separada de Callao.'}],
        },
    }
    validate_regional(snapshot)
    snapshot['version'] = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()[:16]
    atomic_json(OUTPUT, snapshot)
    print(json.dumps(snapshot['coverage'], ensure_ascii=False))
    if not refreshed:
        raise RuntimeError('Todas las descargas regionales fallaron; se conservaron los datos y su fecha de obtención')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ERROR regional:', error, file=sys.stderr)
        sys.exit(1)
