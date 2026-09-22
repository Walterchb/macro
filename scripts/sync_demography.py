"""Population, income and purchasing power; WDI and The Economist public sources."""
import argparse
import csv
import io
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from sync_data import atomic_json, numeric, request, validate_series

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data/demography.json'
CONFIG = ROOT / 'config/demography.json'
AGE_IDS = ('age_young', 'age_working', 'age_older')


def parse_wdi(payload, indicator, countries, today):
    if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[0], dict) or not isinstance(payload[1], list):
        raise ValueError('Esquema WDI inesperado')
    if int(payload[0].get('pages', 1)) != 1:
        raise ValueError('Respuesta WDI paginada: no publicar un subconjunto')
    rows = {country['id']: [] for country in countries}
    for item in payload[1]:
        if item.get('indicator', {}).get('id') != indicator['code']:
            raise ValueError('Identidad de indicador WDI incorrecta')
        country = item.get('countryiso3code')
        if country not in rows:
            raise ValueError('País WDI inesperado')
        value = numeric(item.get('value'))
        if value is None:
            continue
        year = str(item.get('date', ''))
        if len(year) != 4 or not year.isdigit() or int(year) > today.year:
            raise ValueError('Año WDI inválido o futuro')
        if value < 0 or indicator['id'] in (*AGE_IDS, 'urban') and value > 100:
            raise ValueError('Valor demográfico fuera de rango')
        rows[country].append({'date': year + '-01-01', 'value': value})
    for country, observations in rows.items():
        observations.sort(key=lambda row: row['date'])
        validate_series({'id': country + '_' + indicator['id'], 'observations': observations})
    if not any(rows.values()):
        raise ValueError('WDI no devolvió datos numéricos')
    return rows


def fetch_wdi(indicator, config, now):
    countries = ';'.join(country['id'] for country in config['countries'])
    url = f'https://api.worldbank.org/v2/country/{countries}/indicator/{indicator["code"]}?format=json&date={config["historyFrom"]}:{now.year}&per_page=20000&source=2'
    payload = json.loads(request(url))
    return parse_wdi(payload, indicator, config['countries'], now.date()), url, payload[0].get('lastupdated')


def parse_big_mac(text, countries, today):
    reader = csv.DictReader(io.StringIO(text))
    required = {'date', 'iso_a3', 'local_price', 'dollar_ex', 'dollar_price', 'USD_raw', 'USD_adjusted'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('Cambió el esquema de Big Mac')
    selected = {country['id'] for country in countries if not country['aggregate']}
    rows, seen = [], set()
    for row in reader:
        if row['iso_a3'] not in selected:
            continue
        day = row['date']
        datetime.strptime(day, '%Y-%m-%d')
        if day > today.isoformat() or (row['iso_a3'], day) in seen:
            raise ValueError('Fecha futura o duplicada en Big Mac')
        seen.add((row['iso_a3'], day))
        local, fx, usd, raw = (numeric(row[key]) for key in ('local_price', 'dollar_ex', 'dollar_price', 'USD_raw'))
        if any(value is None or value <= 0 for value in (local, fx, usd)) or raw is None:
            raise ValueError('Big Mac contiene precios o cotizaciones inválidas')
        if abs(local / fx - usd) > max(.005, usd * .001):
            raise ValueError('El precio USD no coincide con precio local / tipo de cambio')
        adjusted = numeric(row['USD_adjusted'])
        rows.append({'country': row['iso_a3'], 'date': day, 'localPrice': local, 'currency': row.get('currency_code', ''),
                     'usdPrice': usd, 'exchangeRate': fx, 'raw': raw * 100,
                     'adjusted': adjusted * 100 if adjusted is not None else None})
    if not rows:
        raise ValueError('Big Mac vacío')
    validate_big_mac(rows, selected, today)
    return sorted(rows, key=lambda row: (row['country'], row['date']))


def validate_big_mac(rows, countries, today):
    us = {row['date']: row['usdPrice'] for row in rows if row['country'] == 'USA'}
    seen = set()
    for row in rows:
        day = row['date']
        datetime.strptime(day, '%Y-%m-%d')
        key = (row['country'], day)
        if key in seen or row['country'] not in countries or day > today.isoformat():
            raise ValueError('Identidad o fecha Big Mac inválida')
        seen.add(key)
        if any(numeric(row.get(field)) is None or row[field] <= 0 for field in ('localPrice', 'usdPrice', 'exchangeRate')):
            raise ValueError('Precio Big Mac inválido')
        if numeric(row.get('raw')) is None or row.get('adjusted') is not None and numeric(row['adjusted']) is None:
            raise ValueError('Brecha Big Mac inválida')
        if abs(row['localPrice'] / row['exchangeRate'] - row['usdPrice']) > max(.005, row['usdPrice'] * .001):
            raise ValueError('Precio USD Big Mac inconsistente')
        if day not in us or abs((row['usdPrice'] / us[day] - 1) * 100 - row['raw']) > .01:
            raise ValueError('La brecha Big Mac no coincide con su referencia de EE.UU.')


def validate_demography(snapshot):
    if snapshot.get('schemaVersion') != 1 or not snapshot.get('countries') or not snapshot.get('indicators'):
        raise ValueError('Publicación demográfica incompleta')
    country_ids = {country['id'] for country in snapshot['countries']}
    indicator_ids = {indicator['id'] for indicator in snapshot['indicators']}
    keys, lookup = set(), {}
    for series in snapshot['series']:
        key = (series['country'], series['indicatorId'])
        if key in keys or key[0] not in country_ids or key[1] not in indicator_ids:
            raise ValueError('Identidad demográfica duplicada o desconocida')
        keys.add(key)
        validate_series(series)
        lookup[key] = {row['date']: row['value'] for row in series['observations']}
        for value in lookup[key].values():
            if value < 0 or series['indicatorId'] in (*AGE_IDS, 'urban') and value > 100:
                raise ValueError('Valor demográfico fuera de rango')
    if len(keys) != len(country_ids) * len(indicator_ids):
        raise ValueError('Faltan identidades del catálogo demográfico')
    for country in country_ids:
        groups = [lookup.get((country, key), {}) for key in AGE_IDS]
        for day in set.intersection(*(set(group) for group in groups)):
            if abs(sum(group[day] for group in groups) - 100) > .02:
                raise ValueError(f'Las edades no suman 100: {country} {day}')
    if not any(series['observations'] for series in snapshot['series']):
        raise ValueError('Publicación demográfica sin datos')
    # Consumption price-level index is already expressed as USA=100, not a ratio.
    for day, value in lookup.get(('USA', 'price_level'), {}).items():
        if abs(value - 100) > .02:
            raise ValueError('Cambió la base del índice de precios de consumo')
    validate_big_mac(snapshot.get('bigMac', {}).get('observations', []), country_ids, datetime.now(timezone.utc).date())
    return {'series': len(keys), 'observations': sum(len(series['observations']) for series in snapshot['series']),
            'bigMacObservations': len(snapshot.get('bigMac', {}).get('observations', []))}


def refresh():
    config = json.loads(CONFIG.read_text())
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}
    prior = {(series['country'], series['indicatorId']): series for series in previous.get('series', [])}
    now = datetime.now(timezone.utc)
    stamp = now.isoformat()
    results, errors, sources = {}, {}, []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_wdi, indicator, config, now): indicator for indicator in config['indicators']}
        for future in as_completed(futures):
            indicator = futures[future]
            try:
                results[indicator['id']] = future.result()
                print('OK WDI', indicator['code'], flush=True)
            except Exception as error:
                errors[indicator['id']] = str(error)
                print('RETAIN WDI', indicator['code'], str(error), flush=True)
    output = []
    for indicator in config['indicators']:
        result = results.get(indicator['id'])
        sources.append({'id': indicator['id'], 'provider': 'World Bank', 'sourceUrl': indicator['sourceUrl'],
                        'status': 'ok' if result else 'retained' if any(key[1] == indicator['id'] for key in prior) else 'unavailable',
                        'attemptedAt': stamp, 'error': errors.get(indicator['id'])})
        for country in config['countries']:
            old = prior.get((country['id'], indicator['id']))
            observations = result[0][country['id']] if result else []
            rollback = old and old['observations'] and (not observations or observations[-1]['date'] < old['observations'][-1]['date'] or len(observations) < len(old['observations']) * .9)
            if not result or rollback:
                observations = old.get('observations', []) if old else []
                status = 'retained' if observations else 'unavailable'
            else:
                status = 'ok' if observations else 'no_data'
            output.append({'id': f'demography_{country["id"]}_{indicator["id"]}', 'indicatorId': indicator['id'],
                           'country': country['id'], 'countryName': country['name'], 'name': indicator['name'],
                           'unit': indicator['unit'], 'provider': 'World Bank', 'primarySource': indicator['primarySource'],
                           'sourceCode': indicator['code'], 'sourceUrl': indicator['sourceUrl'] + '?locations=' + country['id'],
                           'description': indicator['description'], 'frequency': 'annual', 'status': status,
                           'fetchedAt': stamp if status in ('ok', 'no_data') else old.get('fetchedAt') if old else None,
                           'lastAttemptAt': stamp, 'sourceUpdatedAt': result[2] if result else old.get('sourceUpdatedAt') if old else None,
                           'apiUrl': result[1] if result else old.get('apiUrl') if old else None,
                           'lastObservationDate': observations[-1]['date'] if observations else None, 'observations': observations})
    for source in sources:
        statuses = {series['status'] for series in output if series['indicatorId'] == source['id']}
        if 'retained' in statuses or 'unavailable' in statuses:
            source['status'] = 'partial' if 'ok' in statuses else 'retained' if 'retained' in statuses else 'unavailable'
    big_mac = dict(config['bigMac'])
    try:
        rows = parse_big_mac(request(big_mac['apiUrl']), config['countries'], now.date())
        old_rows = previous.get('bigMac', {}).get('observations', [])
        if old_rows and (len(rows) < len(old_rows) * .9 or max(row['date'] for row in rows) < max(row['date'] for row in old_rows)):
            raise ValueError('La publicación Big Mac retrocedió')
        big_mac.update(observations=rows, status='ok', fetchedAt=stamp, attemptedAt=stamp)
    except Exception as error:
        old = previous.get('bigMac', {})
        big_mac.update(observations=old.get('observations', []), status='retained' if old.get('observations') else 'unavailable',
                       fetchedAt=old.get('fetchedAt'), attemptedAt=stamp, error=str(error))
    any_fresh = any(series['status'] == 'ok' for series in output) or big_mac['status'] == 'ok'
    payload = {'schemaVersion': 1, 'fetchedAt': stamp if any_fresh else previous.get('fetchedAt'), 'checkedAt': stamp,
               'status': 'ok' if all(source['status'] == 'ok' for source in sources) and big_mac['status'] == 'ok' else 'partial' if any_fresh else 'retained',
               'countries': config['countries'], 'indicators': config['indicators'],
               'sources': sources, 'series': output, 'bigMac': big_mac}
    summary = validate_demography(payload)
    atomic_json(OUTPUT, payload)
    print(json.dumps(summary))
    if not results and big_mac['status'] != 'ok':
        raise SystemExit('Todas las fuentes fallaron; se conservan las observaciones válidas.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args()
    if args.validate:
        print(json.dumps(validate_demography(json.loads(OUTPUT.read_text()))))
    else:
        refresh()
