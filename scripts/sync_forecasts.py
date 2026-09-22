"""Official MEF projections, including automatic MMM/IAPM edition discovery.

Reads the cached numeric values published in MEF's XLSX; it never evaluates
Excel formulas or guesses a forecast. Python standard library only.
"""
import argparse
from datetime import datetime, timezone, date
from html import unescape
from html.parser import HTMLParser
import hashlib
import io
import json
import math
from pathlib import Path
import posixpath
import re
import sys
import unicodedata
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from sync_data import atomic_json

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'config/forecasts.json'
OUTPUT = ROOT / 'data/forecasts.json'
MAIN_SNAPSHOT = ROOT / 'data/snapshot.json'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
MONTHS = dict(zip(('enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre').split(), range(1, 13)))
MONTHS['setiembre'] = 9


def normalized(value):
    text = ''.join(c for c in unicodedata.normalize('NFKD', str(value)) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', text.casefold()).strip()


def fetch(url):
    if urlparse(url).hostname not in {'www.gob.pe', 'cdn.www.gob.pe', 'www.mef.gob.pe'}:
        raise ValueError('La descarga debe proceder del MEF o de Gob.pe')
    with urlopen(Request(url, headers={'User-Agent': 'TreasuryMacroHub/1.0 (public economic research)'}), timeout=40) as response:
        raw = response.read(20_000_001)
    if len(raw) > 20_000_000:
        raise ValueError('Descarga MEF mayor que el límite previsto')
    return raw


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.href = None
        self.label = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.href = dict(attrs).get('href')
            self.label = []

    def handle_data(self, data):
        if self.href:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag == 'a' and self.href:
            self.links.append((unescape(self.href), ' '.join(self.label).strip()))
            self.href = None


def links_in(html):
    parser = Links()
    parser.feed(html)
    return parser.links


def publication_date(html):
    # The publication-type element is followed by the document's date, before
    # unrelated footer dates. Do not use a file upload timestamp as publication.
    match = re.search(r'institution-document__publication-type.{0,250}?(\d{1,2}) de ([a-z]+) de (20\d{2})', html, re.S | re.I)
    if match and match[2].lower() in MONTHS:
        return date(int(match[3]), MONTHS[match[2].lower()], int(match[1])).isoformat()
    return None


def discover_edition(catalog, request_fn=fetch):
    collection = request_fn(catalog['collectionUrl']).decode('utf-8')
    candidates = []
    for href, label in links_in(collection):
        match = re.search(r'marco macroeconomico multianual\s*(\d{4})\s*[-–]\s*(\d{4})', normalized(label))
        if match and '/institucion/mef/informes-publicaciones/' in href:
            candidates.append((int(match[1]), int(match[2]), urljoin(catalog['collectionUrl'], href)))
    if not candidates:
        raise ValueError('No se encuentran ediciones MMM en la colección oficial')
    first, final, page_url = max(candidates)
    page = request_fn(page_url).decode('utf-8')
    attachments = links_in(page)
    spreadsheets = []
    for href, label in attachments:
        if urlparse(href).hostname != 'cdn.www.gob.pe' or '.xlsx' not in href.lower():
            continue
        hint = normalized(unescape(href) + ' ' + label)
        if 'cuadros' not in hint or not re.search(rf'{first}[^0-9]+{final}', hint):
            continue
        kind = 'IAPM' if 'iapm' in hint else 'MMM' if 'mmm' in hint else None
        if kind:
            version = parse_qs(urlparse(href).query).get('v', ['0'])[0]
            spreadsheets.append((kind == 'IAPM', int(version) if version.isdigit() else 0, href, kind))
    if not spreadsheets:
        raise ValueError('La edición más reciente no ofrece cuadros estadísticos XLSX reconocibles')
    _, attachment_version, data_url, kind = max(spreadsheets)
    pdfs = [href for href, _ in attachments if urlparse(href).hostname == 'cdn.www.gob.pe' and '.pdf' in href.lower()
            and re.search(rf'{first}[^0-9]+{final}', href)
            and (('iapm' in href.lower()) if kind == 'IAPM' else ('marco-macroeconomico' in href.lower()))]
    if not pdfs:
        raise ValueError('No se encuentra el documento oficial que acompaña los cuadros')
    bootstrap = catalog['bootstrap']
    vintage = f'{kind} {first}–{final}'
    result = {
        'vintage': vintage,
        # IAPM is attached to the prior MMM page. That page's original date is
        # not the date of the update; leave it unknown instead of misdating it.
        'publishedAt': publication_date(page) if kind == 'MMM' else None,
        'editionDate': bootstrap.get('editionDate') if vintage == bootstrap['vintage'] else None,
        'forecastStart': first if kind == 'IAPM' else first - 1,
        'source': {'name': 'MEF', 'url': page_url, 'documentUrl': pdfs[0], 'dataUrl': data_url},
    }
    if attachment_version:
        result['sourceUpdatedAt'] = datetime.fromtimestamp(attachment_version, timezone.utc).isoformat()
    return result


def read_xlsx(raw):
    """Sparse XLSX reader: only cached values, no formulas, macros, or links."""
    with ZipFile(io.BytesIO(raw)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > 80_000_000:
            raise ValueError('Libro MEF con tamaño descomprimido inesperado')
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
            strings = [''.join(item.itertext()) for item in root.findall('s:si', NS)]
        relations = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {item.get('Id'): item.get('Target') for item in relations}
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = {}
        for sheet in workbook.find('s:sheets', NS):
            name = sheet.get('name', '').strip()
            if name not in {'C-01', 'C-02'}:
                continue
            target = targets[sheet.get(REL)]
            path = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            if not path.startswith('xl/worksheets/'):
                raise ValueError('Ruta de hoja inesperada')
            tree = ET.fromstring(archive.read(path))
            cells = {}
            for cell in tree.findall('.//s:sheetData/s:row/s:c', NS):
                value = cell.find('s:v', NS)
                kind = cell.get('t')
                if kind == 'inlineStr':
                    parsed = ''.join(cell.find('s:is', NS).itertext())
                elif value is None or value.text is None:
                    continue
                elif kind == 's':
                    parsed = strings[int(value.text)]
                elif kind in {'str', 'e', 'b'}:
                    parsed = value.text
                else:
                    try:
                        parsed = float(value.text)
                    except ValueError:
                        parsed = value.text
                cells[cell.get('r')] = parsed
            sheets[name] = cells
    return sheets


def year_columns(cells, forecast_start):
    candidates = {}
    for coordinate, value in cells.items():
        match = re.fullmatch(r'([A-Z]+)(\d+)', coordinate)
        if match and not isinstance(value, bool) and isinstance(value, (int, float)) and float(value).is_integer():
            if forecast_start - 1 <= value <= forecast_start + 5 and int(match[2]) < 12:
                candidates.setdefault(int(match[2]), {})[match[1]] = int(value)
    valid = [cols for cols in candidates.values() if len(cols) >= 5 and forecast_start in cols.values()]
    if len(valid) != 1:
        raise ValueError('Cabecera anual ambigua o ausente')
    columns = valid[0]
    years = sorted(columns.values())
    if len(years) != len(set(years)) or years != list(range(years[0], years[-1] + 1)) or years[0] != forecast_start - 1:
        raise ValueError('Años incompletos o frontera histórico/proyección no verificable')
    return columns


def parse_workbook(raw, catalog, edition, stamp):
    sheets = read_xlsx(raw)
    series = []
    for spec in catalog['series']:
        cells = sheets.get(spec['sheet'], {})
        columns = year_columns(cells, edition['forecastStart'])
        matches = [coordinate for coordinate, value in cells.items()
                   if re.fullmatch(spec['labelColumn'] + r'\d+', coordinate)
                   and normalized(value) == normalized(spec['sourceLabel'])]
        if len(matches) != 1:
            raise ValueError('Fila oficial ausente o ambigua: ' + spec['id'])
        row_number = re.search(r'\d+', matches[0])[0]
        observations = []
        for column, year in sorted(columns.items(), key=lambda pair: pair[1]):
            raw_value = cells.get(column + row_number)
            if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)) or not math.isfinite(raw_value):
                raise ValueError('Valor numérico publicado ausente: ' + spec['id'] + ' ' + str(year))
            observations.append({
                'date': f'{year}-01-01', 'value': raw_value * spec.get('scale', 1),
                'status': 'observed' if year < edition['forecastStart'] else 'forecast',
                'provider': 'MEF', 'sourceUrl': edition['source']['dataUrl'],
                'sourceCell': spec['sheet'] + '!' + column + row_number,
                'vintage': edition['vintage'], 'publicationDate': edition.get('publishedAt'),
            })
        series.append({
            **{key: spec[key] for key in ('id', 'name', 'shortName', 'group', 'unit', 'definition', 'nature')},
            'provider': 'MEF', 'primarySource': 'MEF', 'sourceCode': spec['sheet'] + ':' + matches[0],
            'country': 'PER', 'countryName': 'Perú', 'frequency': 'annual',
            'sourceUrl': edition['source']['dataUrl'], 'metadataUrl': edition['source']['documentUrl'],
            'sourceLabel': spec['sourceLabel'], 'vintage': edition['vintage'],
            'publicationDate': edition.get('publishedAt'), 'forecastStart': edition['forecastStart'],
            'fetchedAt': stamp, 'observations': observations,
        })
    return series


def add_gdp_history(series, snapshot):
    """Exact annual real GDP growth definition only; do not splice fiscal scopes."""
    gdp = next(row for row in series if row['id'] == 'gdp_growth')
    history = next((row for row in snapshot.get('series', []) if row['id'] == 'wb_PER_NY.GDP.MKTP.KD.ZG'), None)
    if not history or history.get('frequency') != 'annual':
        return
    cutoff = min(row['date'] for row in gdp['observations'])
    rows = [{**row, 'status': 'observed', 'provider': 'Banco Mundial',
             'sourceUrl': history['sourceUrl'], 'sourceCode': history['sourceCode'],
             'vintage': 'WDI', 'publicationDate': history.get('sourceUpdatedAt')}
            for row in history['observations'] if '2010-01-01' <= row['date'] < cutoff]
    if rows:
        gdp['observations'] = rows + gdp['observations']
        gdp['historySource'] = {'name': 'Banco Mundial', 'sourceCode': history['sourceCode'],
                                'url': history['sourceUrl'], 'fetchedAt': history.get('fetchedAt'),
                                'through': rows[-1]['date']}
        gdp['sourceSummary'] = f'Banco Mundial hasta {rows[-1]["date"][:4]}; MEF desde {cutoff[:4]}. Las ediciones pueden incorporar revisiones diferentes.'


def validate_forecasts(snapshot):
    if snapshot.get('schemaVersion') != 1 or not snapshot.get('series'):
        raise ValueError('Paquete de proyecciones vacío o esquema inesperado')
    start = snapshot['forecastStart']
    source = snapshot['source']
    if not snapshot.get('vintage') or urlparse(source['dataUrl']).hostname != 'cdn.www.gob.pe':
        raise ValueError('Edición o procedencia de las proyecciones no verificable')
    ids = set()
    for series in snapshot['series']:
        if series['id'] in ids or series['frequency'] != 'annual' or series['forecastStart'] != start:
            raise ValueError('Identidad o frecuencia de proyecciones incoherente')
        ids.add(series['id'])
        seen = set()
        years = []
        for row in series['observations']:
            day = date.fromisoformat(row['date'])
            if day.month != 1 or day.day != 1 or row['date'] in seen:
                raise ValueError('Periodo anual duplicado o inválido')
            if isinstance(row['value'], bool) or not isinstance(row['value'], (int, float)) or not math.isfinite(row['value']):
                raise ValueError('Valor no finito en proyecciones')
            status = 'observed' if day.year < start else 'forecast'
            if row['status'] != status or not row.get('provider') or not row.get('sourceUrl'):
                raise ValueError('Frontera histórica/proyección o linaje incorrecto')
            if status == 'observed' and day.year >= date.today().year:
                raise ValueError('Un año en curso o futuro no puede presentarse como histórico anual')
            seen.add(row['date'])
            years.append(day.year)
        if years != sorted(years) or years != list(range(years[0], years[-1] + 1)):
            raise ValueError('Serie de proyecciones desordenada o incompleta')
        if years[0] >= start or years[-1] < start + 3:
            raise ValueError('Cobertura de proyecciones insuficiente')
    keyed = {series['id']: {row['date']: row['value'] for row in series['observations']} for series in snapshot['series']}
    for day, trade in keyed.get('trade_balance', {}).items():
        if abs(trade - (keyed['exports'][day] - keyed['imports'][day])) > .01:
            raise ValueError('Exportaciones menos importaciones no coincide con la balanza comercial')
    for day, balance in keyed.get('fiscal_balance', {}).items():
        if abs(balance - (keyed['primary_balance'][day] - keyed['interest_cost'][day])) > .0001:
            raise ValueError('Resultado primario menos intereses no coincide con resultado económico')
    return True


def retain_previous(previous, stamp, error):
    if not previous:
        raise ValueError('No existe edición previa válida: ' + str(error))
    validate_forecasts(previous)
    return {**previous, 'status': 'retained', 'lastAttemptAt': stamp, 'error': str(error)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args(argv)
    previous = json.loads(OUTPUT.read_text()) if OUTPUT.exists() else None
    if args.validate:
        validate_forecasts(previous)
        print(f'Proyecciones válidas: {len(previous["series"])} indicadores · {previous["vintage"]}')
        return 0
    catalog = json.loads(CONFIG.read_text())
    stamp = datetime.now(timezone.utc).isoformat()
    try:
        edition = discover_edition(catalog)
        if previous and edition['forecastStart'] < previous['forecastStart']:
            raise ValueError('La colección oficial retrocedió a una edición anterior')
        raw = fetch(edition['source']['dataUrl'])
        series = parse_workbook(raw, catalog, edition, stamp)
        if MAIN_SNAPSHOT.exists():
            add_gdp_history(series, json.loads(MAIN_SNAPSHOT.read_text()))
        snapshot = {
            'schemaVersion': 1, **edition, 'status': 'ok', 'fetchedAt': stamp, 'lastAttemptAt': stamp,
            'contentHash': hashlib.sha256(raw).hexdigest(),
            'historyLabel': 'Histórico; sujeto a revisión',
            'forecastLabel': 'Proyección MEF',
            'methodology': 'Cifras anuales publicadas por el MEF; se conserva la separación entre historia y proyección de cada edición. Los precios internacionales son supuestos del escenario. El PBI real añade historia del Banco Mundial con fuente identificada por observación.',
            'excludedAssumptions': 'No se incorporan las filas de inflación y tipo de cambio del XLSX: proceden de encuestas y contienen una nota de extrapolación que no coincide con todas las celdas de esta edición.',
            'series': series,
        }
        validate_forecasts(snapshot)
        atomic_json(OUTPUT, snapshot)
        print(f'MEF {edition["vintage"]}: {len(series)} indicadores, proyecciones {edition["forecastStart"]}–{max(int(s["observations"][-1]["date"][:4]) for s in series)}')
        return 0
    except Exception as error:
        if previous:
            atomic_json(OUTPUT, retain_previous(previous, stamp, error))
            print('Proyecciones: se conserva la edición validada. ' + str(error), file=sys.stderr)
        else:
            print('Proyecciones: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
