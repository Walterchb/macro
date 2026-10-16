import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import refresh_publication as refresh
import sync_data

class RefreshSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        (self.root / 'data/snapshot.json').write_text('original bytes')
        self.rootpatch = patch.object(refresh, 'ROOT', self.root)
        self.rootpatch.start()
        self.addCleanup(self.rootpatch.stop)
        self.env = patch.dict(os.environ, {'FRED_API_KEY': 'test-key'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def assert_original(self):
        self.assertEqual((self.root / 'data/snapshot.json').read_text(), 'original bytes')
        self.assertFalse((self.root / 'data/new.json').exists())

    def test_hard_timeout_rolls_back_and_stops(self):
        def timeout(*args, **kwargs):
            (self.root / 'data/snapshot.json').write_text('partial')
            (self.root / 'data/new.json').write_text('partial')
            self.assertEqual(kwargs['timeout'], 600)
            raise subprocess.TimeoutExpired('fake', 600)
        with patch.object(refresh.subprocess, 'run', side_effect=timeout) as run:
            with self.assertRaises(RuntimeError):
                refresh.refresh_publication()
            self.assertEqual(run.call_count, 1)
        self.assert_original()

    def test_core_failure_cannot_be_masked_by_other_modules(self):
        with patch.object(refresh.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)) as run:
            with self.assertRaises(RuntimeError):
                refresh.refresh_publication()
            self.assertEqual(run.call_count, 1)
        self.assert_original()

    def test_validator_failure_rolls_back_all(self):
        def success(*args, **kwargs):
            (self.root / 'data/snapshot.json').write_text('changed')
            return subprocess.CompletedProcess([], 0)
        with patch.object(refresh.subprocess, 'run', side_effect=success), patch.object(refresh, 'validate_all', side_effect=ValueError('invalid')):
            with self.assertRaises(ValueError):
                refresh.refresh_publication()
        self.assert_original()

    def test_auxiliary_failure_restores_partial_file(self):
        count = 0
        def run(*args, **kwargs):
            nonlocal count
            count += 1
            (self.root / 'data/snapshot.json').write_text('core' if count == 1 else 'partial' if count == 2 else (self.root / 'data/snapshot.json').read_text())
            return subprocess.CompletedProcess([], 1 if count == 2 else 0)
        with patch.object(refresh.subprocess, 'run', side_effect=run), patch.object(refresh, 'validate_all'), patch.object(refresh, 'mark_non_fred_retained') as retained:
            refresh.refresh_publication()
            retained.assert_called_once()
        self.assertEqual((self.root / 'data/snapshot.json').read_text(), 'core')

    def test_nonfred_retention_preserves_actual_source_dates(self):
        fred = {'id': 'f', 'provider': 'FRED', 'country': 'USA', 'countryName': 'Estados Unidos', 'sourceCode': 'F', 'fetchedAt': '2026-10-16T00:00:00Z', 'observations': [{'date': '2010-01-01', 'value': 1}], 'status': 'ok'}
        bcrp = {**fred, 'id': 'b', 'provider': 'BCRP', 'fetchedAt': '2026-09-22T00:00:00Z'}
        snapshot = {'fetchedAt': '2026-10-16T00:00:00Z', 'series': [fred, bcrp]}
        (self.root / 'data/snapshot.json').write_text(json.dumps(snapshot))
        refresh.mark_non_fred_retained()
        saved = json.loads((self.root / 'data/snapshot.json').read_text())
        self.assertEqual(saved['series'][0], fred)
        self.assertEqual(saved['series'][1]['fetchedAt'], bcrp['fetchedAt'])
        self.assertEqual(saved['series'][1]['status'], 'retained')
        self.assertIn('lastAttemptAt', saved['series'][1])

    def test_real_hung_child_is_killed_and_rolled_back(self):
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/sync_data.py').write_text("import time; time.sleep(60)")
        started = time.monotonic()
        with patch.object(refresh, 'DOWNLOADS', [('sync_data.py', 'core', 0.1, [])]):
            with self.assertRaises(RuntimeError):
                refresh.refresh_publication()
        self.assertLess(time.monotonic() - started, 3)
        self.assert_original()

    def test_missing_key_fails_before_download(self):
        with patch.dict(os.environ, {'FRED_API_KEY': ''}), patch.object(refresh.subprocess, 'run') as run:
            with self.assertRaises(RuntimeError):
                refresh.refresh_publication()
            run.assert_not_called()
        self.assert_original()

class FredPublicationTests(unittest.TestCase):
    def test_two_source_phases_preserve_fred_and_revision_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config').mkdir(); (root / 'data').mkdir()
            fred = {'id': 'f', 'provider': 'FRED', 'sourceCode': 'F', 'country': 'USA', 'countryName': 'Estados Unidos', 'apiUrl': 'https://old.example/csv'}
            bcrp = {**fred, 'id': 'b', 'provider': 'BCRP', 'sourceCode': 'B'}
            catalog = [fred, bcrp]
            prior = [{**s, 'fetchedAt': '2020-01-01T00:00:00Z', 'observations': [{'date': '2010-01-01', 'value': 1}]} for s in catalog]
            (root / 'config/series.json').write_text(json.dumps(catalog))
            (root / 'data/snapshot.json').write_text(json.dumps({'series': prior}))
            rows = [{'date': '2010-01-01', 'value': 2}]
            with patch.object(sync_data, 'ROOT', root), patch.object(sync_data, 'OUT', root / 'data'), patch.object(sync_data, 'fetch_fred', return_value=[(fred, rows, {'apiUrl': 'https://api.stlouisfed.org/fred/series/observations?series_id=F'})]) as fetch_fred, patch.object(sync_data, 'fetch_bcrp', return_value=[(bcrp, rows, {})]) as fetch_bcrp:
                sync_data.main(['--provider', 'FRED'])
                fetch_bcrp.assert_not_called()
                first = json.loads((root / 'data/snapshot.json').read_text())
                self.assertEqual(first['series'][1]['fetchedAt'], prior[1]['fetchedAt'])
                fred_audit = json.loads((root / 'data/revisions.json').read_text())['revisions'][0]
                sync_data.main(['--provider', 'BCRP', '--provider', 'World Bank'])
                self.assertEqual(fetch_fred.call_count, 1)
            final = json.loads((root / 'data/snapshot.json').read_text())
            self.assertEqual(final['series'][0], first['series'][0])
            audit = json.loads((root / 'data/revisions.json').read_text())['revisions']
            self.assertIn(fred_audit, audit)
            self.assertEqual({r['id'] for r in audit}, {'f', 'b'})

    def test_historical_revision_is_published_and_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config').mkdir(); (root / 'data').mkdir()
            series = {'id': 'x', 'provider': 'FRED', 'sourceCode': 'X', 'country': 'USA', 'countryName': 'Estados Unidos'}
            prior = {**series, 'observations': [{'date': '2010-01-01', 'value': 1}]}
            (root / 'config/series.json').write_text(json.dumps([series]))
            (root / 'data/snapshot.json').write_text(json.dumps({'series': [prior]}))
            revised = [{'date': '2010-01-01', 'value': 2}, {'date': '2010-02-01', 'value': 3}]
            with patch.object(sync_data, 'ROOT', root), patch.object(sync_data, 'OUT', root / 'data'), patch.object(sync_data, 'fetch_fred', return_value=[(series, revised, {})]):
                sync_data.main([])
            saved = json.loads((root / 'data/snapshot.json').read_text())
            self.assertEqual(saved['series'][0]['observations'], revised)
            revisions = json.loads((root / 'data/revisions.json').read_text())
            self.assertEqual(revisions['revisions'][0]['changes'][0], {'date': '2010-01-01', 'before': 1, 'after': 2})

    def test_failure_keeps_published_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config').mkdir(); (root / 'data').mkdir()
            series = {'id': 'x', 'provider': 'FRED', 'sourceCode': 'X'}
            (root / 'config/series.json').write_text(json.dumps([series]))
            before = json.dumps({'series': [{**series, 'observations': [{'date': '2010-01-01', 'value': 1}]}]})
            (root / 'data/snapshot.json').write_text(before)
            with patch.object(sync_data, 'ROOT', root), patch.object(sync_data, 'OUT', root / 'data'), patch.object(sync_data, 'fetch_fred', side_effect=RuntimeError('failed')):
                with self.assertRaisesRegex(RuntimeError, 'FRED'):
                    sync_data.main([])
            self.assertEqual((root / 'data/snapshot.json').read_text(), before)
            self.assertTrue((root / 'refresh-status-all.json').exists())

if __name__ == '__main__':
    unittest.main()
