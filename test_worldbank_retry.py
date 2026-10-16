import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import sync_data as sync

class WorldBankRetryTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.clock = patch.object(sync.time, 'monotonic', side_effect=lambda: self.now)
        self.clock.start(); self.addCleanup(self.clock.stop)
        self.sleep = patch.object(sync.time, 'sleep', side_effect=self.advance)
        self.sleeper = self.sleep.start(); self.addCleanup(self.sleep.stop)
    def advance(self, n):
        self.now += n
    def response(self, body='ok'):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = body.encode()
        return response
    def test_timeout_retries_then_succeeds(self):
        with patch.object(sync, 'urlopen', side_effect=[TimeoutError(), TimeoutError(), self.response()]) as call:
            self.assertEqual(sync.request_wb('https://api.worldbank.org/test', 200), 'ok')
        self.assertEqual([c.kwargs['timeout'] for c in call.call_args_list], [30, 30, 30])
        self.assertEqual([c.args[0] for c in self.sleeper.call_args_list], [2, 4])
    def test_three_attempts_max(self):
        with patch.object(sync, 'urlopen', side_effect=TimeoutError('slow')) as call:
            with self.assertRaises(TimeoutError): sync.request_wb('https://api.worldbank.org/test', 200)
        self.assertEqual(call.call_count, 3)
    def test_late_success_is_rejected(self):
        response=self.response()
        def read():
            self.advance(101)
            return b'ok'
        response.__enter__.return_value.read.side_effect=read
        with patch.object(sync,'urlopen',return_value=response) as call:
            with self.assertRaises(TimeoutError): sync.request_wb('https://api.worldbank.org/test',200)
        self.assertEqual(call.call_count,1)
    def test_malformed_retry_after_uses_backoff(self):
        with patch.object(sync,'urlopen',side_effect=[HTTPError('test',503,'busy',{'Retry-After':'nonsense'},None),self.response()]):
            self.assertEqual(sync.request_wb('https://api.worldbank.org/test',200),'ok')
        self.sleeper.assert_called_once_with(2)
    def test_http_400_is_not_retried(self):
        with patch.object(sync, 'urlopen', side_effect=HTTPError('test',400,'bad request',{},None)) as call:
            with self.assertRaises(HTTPError): sync.request_wb('https://api.worldbank.org/test',200)
        self.assertEqual(call.call_count,1); self.sleeper.assert_not_called()
    def test_retry_after_seconds_honored(self):
        error=HTTPError('test',429,'throttled',{'Retry-After':'8'},None)
        with patch.object(sync,'urlopen',side_effect=[error,self.response()]):
            self.assertEqual(sync.request_wb('https://api.worldbank.org/test',200),'ok')
        self.sleeper.assert_called_once_with(8)
    def test_retry_after_date_honored(self):
        until=format_datetime(datetime.now(timezone.utc)+timedelta(seconds=10))
        with patch.object(sync,'urlopen',side_effect=[HTTPError('test',503,'busy',{'Retry-After':until},None),self.response()]):
            sync.request_wb('https://api.worldbank.org/test',200)
        self.assertGreater(self.sleeper.call_args.args[0],8)
    def test_long_retry_after_never_retries_early(self):
        with patch.object(sync,'urlopen',side_effect=HTTPError('test',429,'busy',{'Retry-After':'120'},None)) as call:
            with self.assertRaises(TimeoutError): sync.request_wb('https://api.worldbank.org/test',200)
        self.assertEqual(call.call_count,1); self.sleeper.assert_not_called()
    def test_expired_shared_budget_does_not_request(self):
        with patch.object(sync,'urlopen') as call:
            with self.assertRaises(TimeoutError): sync.fetch_wb([{'country':'PER','sourceCode':'X'}],datetime.now(timezone.utc),99)
        call.assert_not_called()
    def test_timeout_capped_by_remaining_budget(self):
        with patch.object(sync,'urlopen',return_value=self.response()) as call:
            sync.request_wb('https://api.worldbank.org/test',105)
        self.assertEqual(call.call_args.kwargs['timeout'],5)
    def test_paginated_batch_uses_same_deadline(self):
        first=[{'pages':2,'lastupdated':'2026-10-16'},[{'countryiso3code':'PER','value':1,'date':'2024'}]]
        second=[{'pages':2},[{'countryiso3code':'PER','value':2,'date':'2025'}]]
        with patch.object(sync,'request_wb',side_effect=[json.dumps(first),json.dumps(second)]) as call:
            result=sync.fetch_wb([{'country':'PER','sourceCode':'X'}],datetime.now(timezone.utc),190)
        self.assertEqual([c.args[1] for c in call.call_args_list],[190,190]);self.assertEqual(len(result[0][1]),2)
    def test_wb_failure_preserves_history_dates_and_fred(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'config').mkdir(); (root/'data').mkdir()
            catalog=[{'id':code,'provider':provider,'sourceCode':code,'country':'PER','countryName':'Perú'} for code,provider in [('F','FRED'),('X','World Bank'),('Y','World Bank')]]
            old=[{**s,'fetchedAt':'2020-01-01T00:00:00Z','lastObservationDate':'2019-01-01','observations':[{'date':'2019-01-01','value':1}],'status':'ok'} for s in catalog]
            (root/'config/series.json').write_text(json.dumps(catalog)); (root/'data/snapshot.json').write_text(json.dumps({'series':old}))
            def fetch(group, now, deadline):
                if group[0]['id']=='X': raise TimeoutError('slow')
                return [(group[0],[{'date':'2019-01-01','value':2}],{})]
            with patch.object(sync,'ROOT',root),patch.object(sync,'OUT',root/'data'),patch.object(sync,'fetch_wb',side_effect=fetch):
                sync.main(['--provider','World Bank'])
            saved=json.loads((root/'data/snapshot.json').read_text())['series']
            self.assertEqual(saved[0],old[0])
            self.assertEqual(saved[1]['observations'],old[1]['observations'])
            self.assertEqual(saved[1]['fetchedAt'],old[1]['fetchedAt'])
            self.assertEqual(saved[1]['status'],'retained')
            self.assertEqual(saved[2]['observations'][0]['value'],2)
    def test_bcrp_transport_unchanged(self):
        with patch.object(sync,'urlopen',side_effect=[TimeoutError(),self.response()]) as call:
            self.assertEqual(sync.request('https://estadisticas.bcrp.gob.pe/test'),'ok')
        self.assertEqual([c.kwargs['timeout'] for c in call.call_args_list],[15,15]);self.sleeper.assert_called_once_with(1)

if __name__=='__main__':unittest.main()
