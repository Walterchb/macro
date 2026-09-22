from datetime import date
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sync_regional import assemble_series, combine_exact, parse_batch, parse_inei_gdp, parse_inei_population, per_capita, find_excel
import sync_regional


class RegionalDataTests(unittest.TestCase):
    def test_lima_sum_uses_both_territories_and_preserves_real_zero(self):
        metro = [{'date': '2026-01-01', 'value': 10}, {'date': '2026-02-01', 'value': 0}]
        provinces = [{'date': '2026-02-01', 'value': 0}, {'date': '2026-03-01', 'value': 6}]
        self.assertEqual(combine_exact([metro, provinces]), [{'date': '2026-02-01', 'value': 0}])
        self.assertEqual(combine_exact([metro, []]), [])

    def test_reordered_api_columns_cannot_assign_wrong_department(self):
        sources = [{'code': 'A', 'description': 'Crédito - Amazonas'}, {'code': 'B', 'description': 'Crédito - Callao'}]
        payload = {'config': {'series': [{'name': 'Crédito - Callao'}, {'name': 'Crédito - Amazonas'}]},
                   'periods': [{'name': 'Ene.2026', 'values': ['1', '2']}]}
        with self.assertRaisesRegex(ValueError, 'identidad'):
            parse_batch(payload, sources, date(2026, 9, 22))

    def test_missing_is_not_zero_and_future_is_rejected(self):
        sources = [{'code': 'A', 'description': 'Crédito - Amazonas'}]
        payload = {'config': {'series': [{'name': 'Crédito - Amazonas'}]},
                   'periods': [{'name': 'Ene.2026', 'values': ['n.d.']}, {'name': 'Feb.2026', 'values': ['0']}]}
        self.assertEqual(parse_batch(payload, sources, date(2026, 9, 22))['A'], [{'date': '2026-02-01', 'value': 0}])
        payload['periods'].append({'name': 'Oct.2026', 'values': ['3']})
        with self.assertRaisesRegex(ValueError, 'futura'):
            parse_batch(payload, sources, date(2026, 9, 22))

    def test_failure_preserves_data_and_original_fetch_date(self):
        spec = {'id': 'regional_15_tax', 'sources': [{'code': 'A'}, {'code': 'B'}]}
        previous = {'observations': [{'date': '2026-07-01', 'value': 20}], 'fetchedAt': '2026-08-01', 'lastObservationDate': '2026-07-01'}
        result = assemble_series(spec, {}, previous, '2026-09-22', {'B': 'timeout'}, {})
        self.assertEqual(result['status'], 'retained')
        self.assertEqual(result['observations'], previous['observations'])
        self.assertEqual(result['fetchedAt'], '2026-08-01')
        self.assertEqual(result['lastAttemptAt'], '2026-09-22')

    def test_receding_latest_period_does_not_replace_published_data(self):
        spec = {'id': 'regional_01_credit', 'sources': [{'code': 'A'}]}
        previous = {'observations': [{'date': '2026-07-01', 'value': 20}], 'fetchedAt': '2026-08-01', 'lastObservationDate': '2026-07-01'}
        result = assemble_series(spec, {'A': [{'date': '2026-06-01', 'value': 20}]}, previous, '2026-09-22', {}, {'A': 'url'})
        self.assertEqual(result['status'], 'retained')
        self.assertEqual(result['lastObservationDate'], '2026-07-01')

    def test_catalog_coverage_matches_ubigeo_and_lima_components(self):
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / 'config/regional-series.json').read_text())
        self.assertEqual({r['id'] for r in config['regions']}, {f'{n:02d}' for n in range(1, 26)})
        for indicator in config['indicators']:
            rows = [s for s in config['series'] if s['indicatorId'] == indicator['id']]
            self.assertEqual(len(rows), 24 if indicator['id'] == 'electricity' else 25)
        lima = next(s for s in config['series'] if s['regionId'] == '15' and s['indicatorId'] == 'tax_revenue')
        self.assertEqual({s['code'] for s in lima['sources']}, {'RD13788DM', 'RD13789DM'})
        self.assertEqual(lima['aggregation'], 'sum_exact_dates')

    def test_total_outage_records_attempt_without_reporting_fresh_data_or_success(self):
        config = json.loads(sync_regional.CATALOG.read_text())
        config['series'] = config['series'][:1]
        config['ineiSources'] = []
        previous = {**config['series'][0], 'status': 'ok',
                    'observations': [{'date': '2026-06-01', 'value': 123}],
                    'lastObservationDate': '2026-06-01', 'fetchedAt': '2026-08-01T12:00:00+00:00'}
        with TemporaryDirectory() as temp:
            catalog = Path(temp) / 'catalog.json'
            output = Path(temp) / 'regional.json'
            catalog.write_text(json.dumps(config))
            output.write_text(json.dumps({'fetchedAt': previous['fetchedAt'], 'series': [previous]}))
            with patch.object(sync_regional, 'CATALOG', catalog), patch.object(sync_regional, 'OUTPUT', output), \
                 patch.object(sync_regional, 'fetch_batch', side_effect=TimeoutError('timeout')), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, 'Todas las descargas'):
                    sync_regional.main([])
            retained = json.loads(output.read_text())
            self.assertEqual(retained['fetchedAt'], previous['fetchedAt'])
            self.assertGreater(retained['checkedAt'], retained['fetchedAt'])
            self.assertEqual(retained['status'], 'retained')
            self.assertEqual(retained['series'][0]['observations'], previous['observations'])
            self.assertEqual(retained['series'][0]['fetchedAt'], previous['fetchedAt'])
            self.assertEqual(retained['series'][0]['status'], 'retained')

    def test_inei_lima_is_disjoint_from_callao_and_preserves_estimate_markers(self):
        cells = {'A3': 'por Años, según Departamentos', 'A4': 'Valores a Precios Constantes de 2007',
                 'A5': '(Miles de soles)', 'B7': '2007', 'C7': '2008E/', 'A9': 'Lima',
                 'A10': 'Región Lima', 'A11': 'Provincia de Lima', 'A12': 'Prov. Const. del Callao',
                 'B9': '1000', 'C9': '1100', 'B10': '100', 'C10': '110', 'B11': '700', 'C11': '770', 'B12': '200', 'C12': '220'}
        regions = [{'id': '07', 'name': 'Callao'}, {'id': '15', 'name': 'Lima'}]
        parsed = parse_inei_gdp([{'cells': cells}], regions)
        self.assertAlmostEqual(parsed['15'][1]['value'], .88)
        self.assertAlmostEqual(parsed['07'][1]['value'], .22)
        self.assertEqual(parsed['15'][1]['observationStatus'], 'estimated')
        cells['C9'] = '1200'
        with self.assertRaisesRegex(ValueError, 'concilian'):
            parse_inei_gdp([{'cells': cells}], regions)
        cells['A4'] = 'Valores a Precios Constantes de 2020'
        with self.assertRaisesRegex(ValueError, 'base de precios'):
            parse_inei_gdp([{'cells': cells}], regions)

    def test_population_uses_both_sexes_and_official_department_codes(self):
        cells = {'A1': 'POBLACIÓN ESTIMADA AL 30 DE JUNIO, POR AÑOS CALENDARIO Y SEXO',
                 'C3': '2007', 'F3': '2008', 'C4': 'Total', 'F4': 'Total', 'A8': '070000',
                 'C8': '1000', 'D8': '600', 'E8': '400', 'F8': '1100'}
        rows = parse_inei_population([{'cells': cells}], [{'id': '07', 'name': 'Callao'}])['07']
        self.assertEqual([r['value'] for r in rows], [1000, 1100])
        self.assertTrue(all(r['observationStatus'] == 'population_estimate' for r in rows))
        cells['C4'] = 'Hombre'
        with self.assertRaisesRegex(ValueError, 'ambos sexos'):
            parse_inei_population([{'cells': cells}], [{'id': '07', 'name': 'Callao'}])

    def test_per_capita_requires_same_year_and_preserves_vab_status(self):
        numerator = [{'date': '2024-01-01', 'value': 10, 'observationStatus': 'provisional'}, {'date': '2025-01-01', 'value': 12}]
        rows = per_capita(numerator, [{'date': '2024-01-01', 'value': 1000}])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['value'], 10000)
        self.assertEqual(rows[0]['observationStatus'], 'provisional')
        self.assertEqual(combine_exact([rows]), rows)

    def test_dynamic_inei_link_discovery_rejects_ambiguous_workbooks(self):
        html = '<a href="/new.xlsx">PERÚ: Producto Bruto Interno por Años, según Departamentos 2007–2025</a>'
        pattern = 'peru: producto bruto interno por anos, segun departamentos'
        self.assertEqual(find_excel(html, pattern, 'https://www.inei.gob.pe/index'), 'https://www.inei.gob.pe/new.xlsx')
        with self.assertRaisesRegex(ValueError, 'único'):
            find_excel(html + html.replace('new.xlsx', 'duplicate.xlsx'), pattern, 'https://www.inei.gob.pe/index')


if __name__ == '__main__':
    unittest.main()
