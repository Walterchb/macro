"""Incremental catalog additions must preserve the provenance of existing data."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sync_data


class IncrementalSyncTests(unittest.TestCase):
    def test_only_new_does_not_refresh_or_redate_existing_observations(self):
        existing = {
            'id': 'fred_existing', 'sourceCode': 'existing', 'provider': 'FRED',
            'name': 'Existente', 'frequency': 'monthly', 'country': 'USA',
            'countryName': 'Estados Unidos', 'unit': '%',
            'observations': [{'date': '2020-01-01', 'value': 4}],
            'fetchedAt': '2020-02-01T00:00:00+00:00', 'status': 'ok',
            'lastObservationDate': '2020-01-01',
        }
        new = {**existing, 'id': 'fred_new', 'sourceCode': 'new'}
        for key in ('observations', 'fetchedAt', 'status', 'lastObservationDate'):
            new.pop(key)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config').mkdir()
            (root / 'data').mkdir()
            (root / 'config/series.json').write_text(json.dumps([{
                k: v for k, v in existing.items()
                if k not in ('observations', 'fetchedAt', 'status', 'lastObservationDate')
            }, new]))
            (root / 'data/snapshot.json').write_text(json.dumps({'series': [existing]}))
            with patch.object(sync_data, 'ROOT', root), patch.object(sync_data, 'OUT', root / 'data'), patch.object(sync_data, 'fetch_fred', return_value=[(new, [{'date': '2020-03-01', 'value': 8}], {})]) as fetch:
                sync_data.main(['--only-new'])
            fetch.assert_called_once()
            self.assertEqual(fetch.call_args.args[0]['id'], 'fred_new')
            saved = json.loads((root / 'data/snapshot.json').read_text())
            self.assertEqual(saved['series'][0]['observations'], existing['observations'])
            self.assertEqual(saved['series'][0]['fetchedAt'], existing['fetchedAt'])
            self.assertEqual(saved['series'][1]['observations'][0]['value'], 8)
            self.assertEqual(json.loads((root / 'data/manifest.json').read_text())['series'], 2)


if __name__ == '__main__':
    unittest.main()
