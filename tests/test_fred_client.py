import io
import json
import os
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fred_client as fred

KEY = 'test-only-secret-not-a-real-key'
def page(items, count=None, offset=0):
    return {'count': len(items) if count is None else count, 'offset': offset,
            'observations': [{'date': d, 'value': v} for d, v in items]}

class FredTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'FRED_API_KEY': KEY})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_full_history_native_units_missing_and_zero(self):
        data = page([('2010-01-01', '.'), ('2010-02-01', '0'), ('2026-01-01', '5.2')])
        with patch.object(fred, 'get_page', return_value=data) as fetch:
            rows, meta = fred.observations('GDP', '2026-10-16')
        self.assertEqual(rows, [{'date': '2010-02-01', 'value': 0.0}, {'date': '2026-01-01', 'value': 5.2}])
        self.assertNotIn(KEY, str(meta))
        self.assertNotIn('api_key', str(meta))
        self.assertIn('observation_start=2010-01-01', meta['apiUrl'])
        self.assertEqual(fetch.call_args.args[0]['units'], 'lin')
        self.assertNotIn('frequency', fetch.call_args.args[0])

    def test_pagination(self):
        pages = [page([('2010-01-01', '1')], 2), page([('2010-02-01', '2')], 2, 1)]
        with patch.object(fred, 'get_page', side_effect=pages) as fetch:
            rows, _ = fred.observations('X', '2026-10-16')
        self.assertEqual(len(rows), 2)
        self.assertEqual(fetch.call_count, 2)

    def test_reject_bad_data(self):
        bad = [{}, page([]), page([('2010-01-01', '.')]),
               page([('2010-01-01', 'NaN')]), page([('2010-01-01', 'bad')]),
               page([('2030-01-01', '1')]), page([('2010-01-01', '1'), ('2010-01-01', '2')]),
               page([('2010-01-01', '1')], 1, 3)]
        for payload in bad:
            with self.subTest(payload=payload), patch.object(fred, 'get_page', return_value=payload):
                with self.assertRaises(fred.FredError):
                    fred.observations('X', '2026-10-16')

    def test_missing_key_does_not_request(self):
        with patch.dict(os.environ, {'FRED_API_KEY': ''}), patch.object(fred, 'get_page') as fetch:
            with self.assertRaisesRegex(fred.FredError, 'Falta'):
                fred.observations('X', '2026-10-16')
            fetch.assert_not_called()

    def test_400_fails_immediately_without_leaking_key(self):
        error = HTTPError('https://example.invalid/?api_key=' + KEY, 400, KEY, {}, None)
        with patch.object(fred, 'throttle'), patch.object(fred, 'urlopen', side_effect=error) as fetch:
            with self.assertRaises(fred.FredError) as result:
                fred.get_page({}, KEY)
        self.assertEqual(fetch.call_count, 1)
        self.assertNotIn(KEY, str(result.exception))

    def test_retries_are_bounded_and_safe(self):
        errors = [TimeoutError(KEY), URLError(KEY), HTTPError('url' + KEY, 500, KEY, {}, None),
                  HTTPError('url' + KEY, 429, KEY, {'Retry-After': '3'}, None)]
        for error in errors:
            with self.subTest(error=type(error).__name__), patch.object(fred, 'throttle'), patch.object(fred.time, 'sleep') as sleep, patch.object(fred, 'urlopen', side_effect=error) as fetch:
                with self.assertRaises(fred.FredError) as result:
                    fred.get_page({}, KEY)
                self.assertEqual(fetch.call_count, 3)
                self.assertTrue(all(call.args[0] <= 30 for call in sleep.call_args_list))
                self.assertNotIn(KEY, str(result.exception))

    def test_long_retry_after_is_not_retried_early(self):
        error = HTTPError('url', 429, 'limit', {'Retry-After': '120'}, None)
        with patch.object(fred, 'throttle'), patch.object(fred.time, 'sleep') as sleep, patch.object(fred, 'urlopen', side_effect=error) as fetch:
            with self.assertRaisesRegex(fred.FredError, 'Retry-After'):
                fred.get_page({}, KEY)
            self.assertEqual(fetch.call_count, 1)
            sleep.assert_not_called()

    def test_transient_failure_then_valid_json(self):
        with patch.object(fred, 'throttle'), patch.object(fred.time, 'sleep'), patch.object(fred, 'urlopen', side_effect=[TimeoutError(), io.BytesIO(b'{"count":1}')]) as fetch:
            self.assertEqual(fred.get_page({}, KEY), {'count': 1})
            self.assertEqual(fetch.call_count, 2)

    def test_invalid_json_safe(self):
        with patch.object(fred, 'throttle'), patch.object(fred, 'urlopen', return_value=io.BytesIO(KEY.encode())):
            with self.assertRaises(fred.FredError) as result:
                fred.get_page({}, KEY)
        self.assertNotIn(KEY, str(result.exception))

if __name__ == '__main__':
    unittest.main()
