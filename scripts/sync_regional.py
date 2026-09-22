"""Refresh Peru regional statistics from BCRP. Python standard library only."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

from sync_data import atomic_json, numeric, parse_period, request, validate_series

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'config/regional-series.json'
OUTPUT = ROOT / 'data/regional.json'


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
        'apiUrls': list(dict.fromkeys(api_urls[code] for code in codes)),
    }
    validate_series(result)
    return result


def validate_regional(snapshot):
    region_ids = {region['id'] for region in snapshot['regions']}
    if region_ids != {f'{number:02d}' for number in range(1, 26)}:
        raise ValueError('La cobertura geográfica debe incluir 25 códigos departamentales')
    indicator_ids = {indicator['id'] for indicator in snapshot['indicators']}
    keys = set()
    for series in snapshot['series']:
        key = (series['regionId'], series['indicatorId'])
        if key in keys or key[0] not in region_ids or key[1] not in indicator_ids:
            raise ValueError('Identidad regional duplicada o desconocida')
        keys.add(key)
        validate_series(series)
        if any(row['date'][8:] != '01' for row in series['observations']):
            raise ValueError('Un periodo mensual debe usar el primer día como identificador')
        if series['observations'] and series['lastObservationDate'] != series['observations'][-1]['date']:
            raise ValueError('La fecha del último dato no coincide')
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
    sources = {source['code']: source for series in config['series'] for source in series['sources']}
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
    series = [assemble_series(spec, rows_by_code, previous.get(spec['id']), stamp, errors_by_code, api_urls)
              for spec in config['series']]
    if not any(item['observations'] for item in series):
        raise RuntimeError('No hay observaciones regionales válidas; no se publica un paquete vacío')
    refreshed = sum(item['status'] == 'ok' for item in series)
    last_fetched = old.get('fetchedAt') or max(
        (item.get('fetchedAt') for item in series if item.get('fetchedAt')), default=None)
    snapshot = {
        'schemaVersion': '1.0', 'fetchedAt': stamp if refreshed else last_fetched, 'checkedAt': stamp,
        'status': 'ok' if refreshed == len(series) else 'partial' if refreshed else 'retained',
        'regions': config['regions'], 'indicators': config['indicators'], 'series': series,
        'notes': config['notes'], 'catalogUrl': config['catalogUrl'],
        'coverage': {
            'regions': len(config['regions']), 'indicators': len(config['indicators']),
            'series': len(series), 'seriesWithData': sum(bool(s['observations']) for s in series),
            'observations': sum(len(s['observations']) for s in series),
            'retained': sum(s['status'] == 'retained' for s in series),
            'unavailable': sum(s['status'] == 'unavailable' for s in series),
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
