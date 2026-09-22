from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sync_forecasts import add_gdp_history, discover_edition, publication_date, retain_previous, validate_forecasts, year_columns


def snapshot():
    start = date.today().year
    rows = []
    for id, value in [('gdp_growth', 3), ('fiscal_balance', -2), ('primary_balance', -.5),
                      ('interest_cost', 1.5), ('trade_balance', 40), ('exports', 100), ('imports', 60)]:
        rows.append({'id': id, 'frequency': 'annual', 'forecastStart': start,
                     'observations': [{'date': f'{year}-01-01', 'value': value,
                                       'status': 'observed' if year < start else 'forecast',
                                       'provider': 'MEF', 'sourceUrl': 'https://cdn.www.gob.pe/data.xlsx'}
                                      for year in range(start - 1, start + 5)]})
    return {'schemaVersion': 1, 'forecastStart': start, 'source': {'dataUrl': 'https://cdn.www.gob.pe/data.xlsx'},
            'fetchedAt': '2026-08-28T12:00:00+00:00', 'status': 'ok', 'vintage': 'MMM 2027–2030', 'series': rows}


class ForecastTests(unittest.TestCase):
    def test_current_year_is_forecast_not_actual(self):
        item = snapshot()
        self.assertTrue(validate_forecasts(item))
        item['series'][0]['observations'][1]['status'] = 'observed'
        with self.assertRaisesRegex(ValueError, 'Frontera'):
            validate_forecasts(item)

    def test_trade_sign_and_fiscal_scope_reconciliation(self):
        for id in ('imports', 'interest_cost'):
            item = snapshot()
            next(s for s in item['series'] if s['id'] == id)['observations'][1]['value'] *= -1
            with self.assertRaisesRegex(ValueError, 'no coincide'):
                validate_forecasts(item)

    def test_retention_does_not_relabel_freshness_or_actuals(self):
        prior = snapshot()
        retained = retain_previous(prior, '2026-09-22T12:00:00+00:00', 'Source timeout')
        self.assertEqual(retained['fetchedAt'], prior['fetchedAt'])
        self.assertEqual(retained['series'], prior['series'])
        self.assertEqual(retained['status'], 'retained')
        self.assertNotEqual(retained['lastAttemptAt'], retained['fetchedAt'])
        self.assertEqual(prior['status'], 'ok')

    def test_year_header_cannot_skip_year_or_use_average_column(self):
        cells = {'B3': 'PBI', **{f'{chr(67 + index)}5': float(year) for index, year in enumerate(range(2025, 2031))}, 'I5': 'Promedio 2027–2030', 'B63': 2027.0}
        self.assertEqual(sorted(year_columns(cells, 2026).values()), list(range(2025, 2031)))
        del cells['F5']
        with self.assertRaisesRegex(ValueError, 'Años incompletos'):
            year_columns(cells, 2026)

    def test_history_splice_preserves_lineage_and_never_overwrites_mef(self):
        data = snapshot()
        cutoff = data['forecastStart'] - 1
        history = {'series': [{'id': 'wb_PER_NY.GDP.MKTP.KD.ZG', 'frequency': 'annual',
                              'sourceCode': 'NY.GDP.MKTP.KD.ZG', 'sourceUrl': 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
                              'observations': [{'date': f'{year}-01-01', 'value': 99}
                                               for year in range(2010, cutoff + 2)]}]}
        before = deepcopy(data['series'])
        add_gdp_history(data['series'], history)
        gdp = data['series'][0]
        self.assertEqual(next(o for o in gdp['observations'] if o['date'] == f'{cutoff}-01-01')['value'], 3)
        self.assertEqual(gdp['observations'][0]['provider'], 'Banco Mundial')
        self.assertEqual(gdp['observations'][0]['vintage'], 'WDI')
        self.assertEqual(data['series'][1:], before[1:])
        self.assertTrue(validate_forecasts(data))

    def test_iapm_discovery_uses_updated_forecast_boundary_but_not_old_page_date(self):
        catalog = {'collectionUrl': 'https://www.gob.pe/collection', 'bootstrap': {'vintage': 'MMM 2027–2030'}}
        collection = '<a href="/institucion/mef/informes-publicaciones/123">Marco Macroeconómico Multianual 2027 - 2030</a>'
        page = '''<p class="institution-document__publication-type">Documento</p><p>28 de agosto de 2026</p>
        <a href="https://cdn.www.gob.pe/cuadros-estadisticos-mmm-2027-2030.xlsx?v=1">Cuadros MMM</a>
        <a href="https://cdn.www.gob.pe/marco-macroeconomico-multianual-2027-2030.pdf">MMM</a>
        <a href="https://cdn.www.gob.pe/cuadros-estadisticos-iapm-2027-2030.xlsx?v=2">Descargar</a>
        <a href="https://cdn.www.gob.pe/iapm-2027-2030.pdf">IAPM</a>'''
        edition = discover_edition(catalog, lambda url: (collection if url == catalog['collectionUrl'] else page).encode())
        self.assertEqual(edition['forecastStart'], 2027)
        self.assertEqual(edition['vintage'], 'IAPM 2027–2030')
        self.assertIsNone(edition['publishedAt'])
        self.assertIn('iapm', edition['source']['dataUrl'])
        self.assertEqual(publication_date(page), '2026-08-28')

    def test_nan_missing_provenance_and_duplicate_years_are_rejected(self):
        for mutation in ('nan', 'provenance', 'duplicate'):
            item = snapshot()
            row = item['series'][0]['observations'][0]
            if mutation == 'nan':
                row['value'] = float('nan')
            elif mutation == 'provenance':
                row['provider'] = ''
            else:
                item['series'][0]['observations'].append(deepcopy(row))
            with self.assertRaises(ValueError):
                validate_forecasts(item)

    def test_published_package_has_all_configured_definitions(self):
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / 'config/forecasts.json').read_text())
        package = json.loads((root / 'data/forecasts.json').read_text())
        self.assertTrue(validate_forecasts(package))
        self.assertEqual({s['id'] for s in package['series']}, {s['id'] for s in config['series']})
        self.assertTrue(all(s['definition'] and s['sourceLabel'] for s in package['series']))


if __name__ == '__main__':
    unittest.main()
