from contextlib import redirect_stdout
from copy import deepcopy
from datetime import date
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sync_demography as module


class DemographyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = json.loads(module.OUTPUT.read_text())
        cls.config = json.loads(module.CONFIG.read_text())

    def test_published_age_bands_price_base_and_bigmac_reconcile(self):
        result = module.validate_demography(self.snapshot)
        self.assertGreater(result['observations'], 4000)
        self.assertGreater(result['bigMacObservations'], 300)

    def test_wdi_identity_nulls_and_duplicate_years(self):
        spec = {'id': 'age_young', 'code': 'SP.POP.0014.TO.ZS'}
        country = [{'id': 'PER'}]
        row = {'indicator': {'id': spec['code']}, 'countryiso3code': 'PER', 'date': '2025', 'value': None}
        payload = [{'pages': 1}, [row, {**row, 'date': '2024', 'value': 0}]]
        self.assertEqual(module.parse_wdi(payload, spec, country, date(2026, 9, 22)), {'PER': [{'date': '2024-01-01', 'value': 0}]})
        with self.assertRaisesRegex(ValueError, 'Identidad'):
            module.parse_wdi([{'pages': 1}, [{**row, 'indicator': {'id': 'OTHER'}}]], spec, country, date(2026, 9, 22))
        with self.assertRaisesRegex(ValueError, 'duplicada'):
            module.parse_wdi([{'pages': 1}, [{**row, 'value': 20}, {**row, 'value': 21}]], spec, country, date(2026, 9, 22))

    def test_age_total_cannot_silently_be_renormalized(self):
        snapshot = deepcopy(self.snapshot)
        series = next(s for s in snapshot['series'] if s['country'] == 'PER' and s['indicatorId'] == 'age_young')
        series['observations'][-1]['value'] += 1
        with self.assertRaisesRegex(ValueError, 'no suman 100'):
            module.validate_demography(snapshot)

    def test_price_level_ratio_not_confused_with_base100(self):
        snapshot = deepcopy(self.snapshot)
        series = next(s for s in snapshot['series'] if s['country'] == 'USA' and s['indicatorId'] == 'price_level')
        series['observations'][-1]['value'] = 1
        with self.assertRaisesRegex(ValueError, 'base del índice'):
            module.validate_demography(snapshot)

    def test_big_mac_percentage_conversion_and_corruption(self):
        text = ('date,iso_a3,local_price,dollar_ex,dollar_price,USD_raw,USD_adjusted,currency_code\n'
                '2025-07-01,USA,5,1,5,0,0,USD\n'
                '2025-07-01,PER,16,4,4,-0.2,0.03,PEN\n')
        rows = module.parse_big_mac(text, [{'id': 'USA', 'aggregate': False}, {'id': 'PER', 'aggregate': False}], date(2026, 9, 22))
        peru = next(row for row in rows if row['country'] == 'PER')
        self.assertEqual((peru['raw'], peru['adjusted']), (-20, 3))
        peru['raw'] = -.2
        with self.assertRaisesRegex(ValueError, 'brecha Big Mac'):
            module.validate_big_mac(rows, {'PER', 'USA'}, date(2026, 9, 22))

    def test_persisted_big_mac_is_validated_not_only_download(self):
        snapshot = deepcopy(self.snapshot)
        snapshot['bigMac']['observations'][0]['usdPrice'] *= 2
        with self.assertRaisesRegex(ValueError, 'Precio USD'):
            module.validate_demography(snapshot)

    def test_outage_preserves_fetch_dates_and_records_check(self):
        with TemporaryDirectory() as folder:
            output = Path(folder) / 'demography.json'
            output.write_text(json.dumps(self.snapshot))
            with patch.object(module, 'OUTPUT', output), patch.object(module, 'fetch_wdi', side_effect=TimeoutError('offline')), patch.object(module, 'request', side_effect=TimeoutError('offline')), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(SystemExit, 'Todas las fuentes'):
                    module.refresh()
            retained = json.loads(output.read_text())
            self.assertEqual(retained['fetchedAt'], self.snapshot['fetchedAt'])
            self.assertGreaterEqual(retained['checkedAt'], retained['fetchedAt'])
            self.assertEqual(retained['status'], 'retained')
            self.assertEqual(retained['series'][0]['fetchedAt'], self.snapshot['series'][0]['fetchedAt'])
            self.assertEqual(retained['series'][0]['observations'], self.snapshot['series'][0]['observations'])
            self.assertEqual(retained['bigMac']['status'], 'retained')


if __name__ == '__main__':
    unittest.main()
