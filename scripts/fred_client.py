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


def decode_response(body, headers=None, status=None):
    """Decode bounded transport bytes; diagnostics expose only whitelisted classes."""
    headers = headers or {}
    mime = str(headers.get('Content-Type', '')).split(';')[0].strip().lower()
    mime = mime if mime in {'application/json', 'text/json', 'text/html', 'application/xml', 'text/xml', 'text/plain'} else 'other-or-missing'
    encoding = str(headers.get('Content-Encoding', '')).strip().lower()
    encoding = encoding if encoding in {'gzip', 'identity', 'deflate', 'br', ''} else 'other'
    status = status if isinstance(status, int) and 100 <= status <= 599 else 'unknown'
    wire_size = len(body)
    stripped = bytes(body).lstrip(b'\xef\xbb\xbf \t\r\n')
    if not stripped:
        shape = 'empty'
    elif stripped[:1] in (b'{', b'['):
        shape = 'json-like'
    elif stripped[:1] == b'<':
        shape = 'markup-like'
    else:
        shape = 'other'
    if shape == 'markup-like' and b'Site Maintenance | St. Louis Fed' in body and any(phrase in body for phrase in (b'currently performing maintenance on our site', b'currently performing scheduled maintenance on our site')):
        raise FredError('FRED: mantenimiento confirmado del proveedor (failureReason=provider-maintenance)')
    try:
        return json.loads(bytes(body).decode('utf-8-sig'))
    except (ValueError, UnicodeError):
        raise FredError(f'FRED: JSON inválido (HTTP={status}; tipo={mime}; encoding={encoding or "none"}; bytes={wire_size}; formato={shape})') from None


def get_page(params, key):
    url = ENDPOINT + '?' + urlencode({**params, 'api_key': key})
    for attempt in range(ATTEMPTS):
        throttle()
        retry_after = 0
        try:
            req = Request(url, headers={'User-Agent': 'TreasuryMacroHub/2.0', 'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache'})
            with urlopen(req, timeout=TIMEOUT) as response:
                # Socket timeout is not a total deadline. Bound body size and elapsed
                # time here; refresh_publication also enforces a hard process deadline.
                headers = getattr(response, 'headers', {})
                status = getattr(response, 'status', None)
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
            result = decode_response(body, headers, status)
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


def observations(series_code, end_date, verify_latest=False):
    key = os.environ.get('FRED_API_KEY', '').strip()
    if not key:
        raise FredError('Falta el secreto FRED_API_KEY en el entorno de ejecución')
    params = {'series_id': series_code, 'file_type': 'json', 'units': 'lin',
              'observation_start': '2010-01-01', 'observation_end': end_date,
              'sort_order': 'asc', 'limit': 100000, 'offset': 0}
    rows = []
    realtime = {}
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
        for field in ('realtime_start', 'realtime_end'):
            if page.get(field):
                try:
                    date.fromisoformat(page[field])
                except (ValueError, TypeError):
                    raise FredError('FRED: periodo realtime inválido') from None
                if field in realtime and realtime[field] != page[field]:
                    raise FredError('FRED: cambió el periodo realtime durante la descarga')
                realtime[field] = page[field]
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
    metadata = {'apiUrl': safe_url, 'downloadMode': 'full-history-since-2010',
                'providerRealtimeStart': realtime.get('realtime_start'),
                'providerRealtimeEnd': realtime.get('realtime_end'),
                'lastCheckedAt': datetime.now(timezone.utc).isoformat(),
                'latestVerification': 'full-history-completed'}
    # A second request is targeted to delayed high-frequency series, not every
    # monthly/quarterly history. This is a recheck policy, not a release calendar.
    if verify_latest in ('daily', 'weekly'):
        age = (date.fromisoformat(end_date) - date.fromisoformat(rows[-1]['date'])).days
        verify_latest = age > (3 if verify_latest == 'daily' else 10)
    if verify_latest:
        tail_params = {**params, 'sort_order': 'desc', 'limit': 100, 'offset': 0}
        tail = get_page(tail_params, key)
        try:
            items = tail['observations']
            if int(tail['count']) != expected or int(tail['offset']) != 0 or not isinstance(items, list) or not items:
                raise ValueError()
            numeric_tail = []
            seen_tail = set()
            for item in items:
                day = item['date']
                date.fromisoformat(day)
                if day < '2010-01-01' or day > end_date or day in seen_tail:
                    raise ValueError()
                seen_tail.add(day)
                if item['value'] == '.':
                    continue
                value = float(item['value'])
                if not math.isfinite(value):
                    raise ValueError()
                numeric_tail.append({'date': day, 'value': value})
            if not numeric_tail:
                raise ValueError()
            numeric_tail.sort(key=lambda row: row['date'])
            history = {row['date']: row['value'] for row in rows}
            if numeric_tail[-1] != rows[-1] or any(history.get(row['date']) != row['value'] for row in numeric_tail):
                raise ValueError()
            for field, value in realtime.items():
                if tail.get(field) and tail[field] != value:
                    raise ValueError()
        except (KeyError, ValueError, TypeError):
            raise FredError('FRED: última consulta no coincide con el historial; no publicar una mezcla de cortes') from None
        metadata.update({'latestVerification': 'provider-tail-verified',
                         'latestVerifiedAt': datetime.now(timezone.utc).isoformat(),
                         'providerLatestObservationDate': rows[-1]['date']})
    return rows, metadata
