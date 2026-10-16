"""FRED observations API. Never expose credentials in metadata or exceptions."""
import json
import math
import os
import threading
import time
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENDPOINT = 'https://api.stlouisfed.org/fred/series/observations'
TIMEOUT = 15
ATTEMPTS = 3
MAX_BYTES = 20_000_000
_lock = threading.Lock()
_last_request = 0.0


class FredError(RuntimeError):
    pass


def throttle():
    # At most 60 starts/minute across all threads, including retries/pages.
    global _last_request
    with _lock:
        wait = 1.05 - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def get_page(params, key):
    url = ENDPOINT + '?' + urlencode({**params, 'api_key': key})
    for attempt in range(ATTEMPTS):
        throttle()
        retry_after = 0
        try:
            req = Request(url, headers={'User-Agent': 'TreasuryMacroHub/2.0', 'Accept': 'application/json'})
            with urlopen(req, timeout=TIMEOUT) as response:
                # Socket timeout is not a total deadline. Bound body size and elapsed
                # time here; refresh_publication also enforces a hard process deadline.
                started = time.monotonic()
                body = bytearray()
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise FredError('FRED: respuesta demasiado grande')
                    if time.monotonic() - started > 30:
                        raise TimeoutError()
            result = json.loads(body.decode('utf-8-sig'))
            if not isinstance(result, dict) or 'error_code' in result:
                raise FredError('FRED: respuesta API inválida')
            return result
        except HTTPError as exc:
            code = exc.code
            if code not in (429, 500, 502, 503, 504):
                raise FredError(f'FRED HTTP {code}: comprobar clave, permisos y código de serie') from None
            header = exc.headers.get('Retry-After', '0') if exc.headers else '0'
            try:
                retry_after = max(0, float(header))
            except (ValueError, TypeError):
                try:
                    retry_after = max(0, (parsedate_to_datetime(header) - datetime.now(timezone.utc)).total_seconds())
                except (ValueError, TypeError, OverflowError):
                    retry_after = 0
            if retry_after > 30:
                raise FredError(f'FRED HTTP {code}: Retry-After excede el presupuesto; esperar y reejecutar') from None
            message = f'FRED HTTP {code}: reintentos agotados'
        except (TimeoutError, URLError, OSError):
            message = 'FRED: fallo de conexión o tiempo de espera agotado'
        except (ValueError, UnicodeError):
            raise FredError('FRED: JSON inválido') from None
        if attempt == ATTEMPTS - 1:
            raise FredError(message) from None
        time.sleep(max(retry_after, 2 ** attempt))
    raise FredError('FRED: descarga incompleta')


def observations(series_code, end_date):
    key = os.environ.get('FRED_API_KEY', '').strip()
    if not key:
        raise FredError('Falta el secreto FRED_API_KEY en el entorno de ejecución')
    params = {'series_id': series_code, 'file_type': 'json', 'units': 'lin',
              'observation_start': '2010-01-01', 'observation_end': end_date,
              'sort_order': 'asc', 'limit': 100000, 'offset': 0}
    rows = []
    expected = None
    seen = set()
    while True:
        page = get_page(params, key)
        try:
            count = int(page['count'])
            offset = int(page['offset'])
            items = page['observations']
        except (KeyError, ValueError, TypeError):
            raise FredError('FRED: esquema de paginación inválido') from None
        if count < 1 or count > 1000000 or offset != params['offset'] or not isinstance(items, list) or not items:
            raise FredError('FRED: respuesta vacía o paginación incompleta')
        if expected is not None and count != expected:
            raise FredError('FRED: cambió el total durante la paginación; reintentar')
        expected = count
        for item in items:
            try:
                day = item['date']
                date.fromisoformat(day)
                if day < '2010-01-01' or day > end_date or day in seen:
                    raise ValueError()
                seen.add(day)
                value = item['value']
                if value == '.':
                    continue
                value = float(value)
                if not math.isfinite(value):
                    raise ValueError()
                rows.append({'date': day, 'value': value})
            except (KeyError, ValueError, TypeError):
                raise FredError('FRED: observación inválida o fecha duplicada') from None
        params['offset'] += len(items)
        if params['offset'] == count:
            break
        if params['offset'] > count:
            raise FredError('FRED: conteo de paginación inconsistente')
    if not rows:
        raise FredError('FRED: sin observaciones numéricas')
    rows.sort(key=lambda row: row['date'])
    # The returned public metadata MUST NOT include api_key.
    safe_url = ENDPOINT + '?' + urlencode({k: v for k, v in params.items() if k != 'offset'})
    return rows, {'apiUrl': safe_url, 'downloadMode': 'full-history-since-2010'}
