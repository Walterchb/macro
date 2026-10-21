"""Current-provider verification, distinct timestamps, and history integrity."""
import io
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fred_client as fred
import sync_data
import refresh_publication as refresh


def page(items, count=None):
    return {'count': len(items) if count is None else count, 'offset': 0,
            'realtime_start': '2026-10-21', 'realtime_end': '2026-10-21',
            'observations': [{'date': d, 'value': v} for d, v in items]}


class LatestVerificationTests(unittest.TestCase):
    def test_provider_tail_recheck_and_realtime_are_not_release_date(self):
        history = page([('2026-10-16', '5.09'), ('2026-10-19', '5.15')])
        tail = page([('2026-10-19', '5.15'), ('2026-10-16', '5.09')])
        with patch.dict(os.environ, {'FRED_API_KEY': 'test-secret'}), patch.object(fred, 'get_page', side_effect=[history, tail]) as request:
            rows, meta = fred.observations('DGS10', '2026-10-21', verify_latest=True)
        self.assertEqual(rows[-1], {'date': '2026-10-19', 'value': 5.15})
        self.assertEqual(meta['providerLatestObservationDate'], '2026-10-19')
        self.assertEqual(meta['latestVerification'], 'provider-tail-verified')
        self.assertEqual(meta['providerRealtimeStart'], '2026-10-21')
        self.assertNotIn('publicationDate', meta)
        self.assertIn('latestVerifiedAt', meta)
        self.assertEqual(request.call_args.args[0]['sort_order'], 'desc')
        self.assertNotIn('test-secret', str(meta))

    def test_later_tail_or_revision_rejects_mixed_download(self):
        first = page([('2026-10-16', '5.09')])
        for later in [page([('2026-10-19', '5.15')]), page([('2026-10-16', '5.10')])]:
            with self.subTest(later=later), patch.dict(os.environ, {'FRED_API_KEY': 'test-secret'}), patch.object(fred, 'get_page', side_effect=[first, later]):
                with self.assertRaisesRegex(fred.FredError, 'no coincide'):
                    fred.observations('DGS10', '2026-10-21', verify_latest=True)

    def test_tail_missing_values_and_zero_valid(self):
        first = page([('2026-10-16', '0'), ('2026-10-17', '.')])
        tail = page([('2026-10-17', '.'), ('2026-10-16', '0')])
        with patch.dict(os.environ, {'FRED_API_KEY': 'test-secret'}), patch.object(fred, 'get_page', side_effect=[first, tail]):
            rows, _ = fred.observations('X', '2026-10-21', verify_latest=True)
        self.assertEqual(rows[-1]['value'], 0)

    def test_no_cache_headers(self):
        with patch.object(fred, 'throttle'), patch.object(fred, 'urlopen', return_value=io.BytesIO(b'{"count":1}')) as request:
            fred.get_page({}, 'test-key')
        headers = dict(request.call_args.args[0].header_items())
        self.assertEqual(headers['Cache-control'], 'no-cache')
        self.assertEqual(headers['Pragma'], 'no-cache')

    def test_one_full_retry_only_for_changed_tail(self):
        row = [{'date': '2026-10-19', 'value': 5.15}]
        error = fred.FredError('FRED: última consulta no coincide con el historial')
        with patch.object(sync_data, 'fred_observations', side_effect=[error, (row, {})]) as fetch:
            result = sync_data.fetch_fred({'sourceCode': 'DGS10'}, datetime(2026, 10, 21, tzinfo=timezone.utc))
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(result[0][1], row)
        with patch.object(sync_data, 'fred_observations', side_effect=fred.FredError('HTTP 429')) as fetch:
            with self.assertRaises(fred.FredError):
                sync_data.fetch_fred({'sourceCode': 'X'}, datetime.now(timezone.utc))
            self.assertEqual(fetch.call_count, 1)

    def test_archive_is_explicit_not_internal_gap_fill(self):
        prior = [{'date': '2020-01-01', 'value': 1}, {'date': '2021-01-01', 'value': 2}, {'date': '2022-01-01', 'value': 3}]
        latest = [{'date': '2021-01-01', 'value': 2.1}, {'date': '2022-01-01', 'value': 3}, {'date': '2023-01-01', 'value': 4}]
        rows, archived = sync_data.preserve_fred_history(latest, prior)
        self.assertEqual(archived, 1)
        self.assertEqual(rows[0], prior[0])
        self.assertEqual(rows[1]['value'], 2.1)
        with self.assertRaisesRegex(ValueError, 'faltan fechas'):
            sync_data.preserve_fred_history([prior[0], prior[2]], prior)
        with self.assertRaisesRegex(ValueError, 'retrocedió'):
            sync_data.preserve_fred_history(prior[:-1], prior)

    def test_targeted_recheck_does_not_duplicate_recent_or_monthly_fetch(self):
        payload = page([('2026-10-19', '5.15')])
        with patch.dict(os.environ, {'FRED_API_KEY': 'test-secret'}), patch.object(fred, 'get_page', return_value=payload) as fetch:
            _, meta = fred.observations('DGS10', '2026-10-21', verify_latest='daily')
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(meta['latestVerification'], 'full-history-completed')
        old = page([('2026-10-16', '5.09')])
        with patch.dict(os.environ, {'FRED_API_KEY': 'test-secret'}), patch.object(fred, 'get_page', return_value=old) as fetch:
            _, meta = fred.observations('DGS10', '2026-10-21', verify_latest='daily')
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(meta['latestVerification'], 'provider-tail-verified')

    def test_failure_status_is_public_safe_and_after_rollback(self):
        import tempfile, json
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'data').mkdir()
            (root / 'data/snapshot.json').write_text('valid original')
            with patch.object(refresh, 'ROOT', root), patch.object(refresh, '_refresh_publication', side_effect=RuntimeError('secret-key-url')):
                with self.assertRaises(RuntimeError):
                    refresh.refresh_publication(fred_only=True)
            status = json.loads((root / 'data/refresh-status.json').read_text())
            self.assertEqual(status['outcome'], 'failed')
            self.assertNotIn('secret-key-url', str(status))
            self.assertEqual(status['mode'], 'fred-only')
            self.assertEqual((root / 'data/snapshot.json').read_text(), 'valid original')

    def test_auxiliary_failure_records_partial_without_full_success(self):
        import tempfile, json
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'data').mkdir()
            prior = {'lastSuccessfulAt': '2026-10-20T12:00:00Z',
                     'lastSuccessfulMode': 'full',
                     'lastFullSuccessfulAt': '2026-10-20T12:00:00Z'}
            (root / 'data/refresh-status.json').write_text(json.dumps(prior))
            (root / 'data/snapshot.json').write_text('original')
            phases = [refresh.DOWNLOADS[0], refresh.DOWNLOADS[2]]
            with patch.object(refresh, 'ROOT', root), patch.dict(os.environ, {'FRED_API_KEY': 'test-secret'}), \
                 patch.object(refresh, 'DOWNLOADS', phases), \
                 patch.object(refresh.subprocess, 'run', side_effect=[SimpleNamespace(returncode=0), SimpleNamespace(returncode=1)]), \
                 patch.object(refresh, 'mark_non_fred_retained'), patch.object(refresh, 'module_has_retained_data', return_value=False), patch.object(refresh, 'validate_all'):
                refresh.refresh_publication()
            status = json.loads((root / 'data/refresh-status.json').read_text())
            self.assertEqual(status['outcome'], 'succeeded-with-warnings')
            self.assertEqual(status['failedModules'], ['agenda'])
            self.assertEqual(status['lastFullSuccessfulAt'], prior['lastFullSuccessfulAt'])
            self.assertEqual(status['lastSuccessfulAt'], prior['lastSuccessfulAt'])
            self.assertTrue(status['lastFredSuccessfulAt'])
            self.assertTrue(status['retainedModules'])
            self.assertFalse(status['retainedSnapshot'])

    def test_successful_exit_with_retained_sources_is_partial(self):
        import tempfile, json
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'data').mkdir()
            (root / 'data/agenda.json').write_text(json.dumps({'sources': [{'status': 'ok'}, {'status': 'retained'}]}))
            (root / 'data/snapshot.json').write_text(json.dumps({'series': [{'provider': 'FRED', 'status': 'ok'}, {'provider': 'BCRP', 'status': 'retained'}]}))
            with patch.object(refresh, 'ROOT', root):
                self.assertTrue(refresh.module_has_retained_data('sync_agenda.py', []))
                self.assertFalse(refresh.module_has_retained_data('sync_data.py', ['--provider', 'FRED']))
                self.assertTrue(refresh.module_has_retained_data('sync_data.py', ['--provider', 'BCRP']))

    def test_fred_only_cli_is_explicit_and_keeps_full_default(self):
        self.assertIn('--provider', refresh.DOWNLOADS[0][3])
        self.assertEqual(refresh.DOWNLOADS[0][3][-1], 'FRED')
        import inspect
        source = inspect.getsource(refresh._refresh_publication)
        self.assertIn('DOWNLOADS[:1] if fred_only else DOWNLOADS', source)
        self.assertFalse(inspect.signature(refresh.refresh_publication).parameters['fred_only'].default)

if __name__ == '__main__':
    unittest.main()
