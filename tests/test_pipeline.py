import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from sync_data import parse_period,validate_series,numeric
class PipelineTests(unittest.TestCase):
    def test_periods(self):
        self.assertEqual(parse_period('Ene.2026'),'2026-01-01')
        self.assertEqual(parse_period('T2.26'),'2026-04-01')
        self.assertEqual(parse_period('Dic.2025'),'2025-12-01')
    def test_missing(self):
        for x in ['.','',None,'NaN','Infinity']:self.assertIsNone(numeric(x))
        self.assertEqual(numeric('0'),0)
    def test_duplicates(self):
        with self.assertRaises(ValueError):validate_series({'id':'x','observations':[{'date':'2026-01-01','value':2},{'date':'2026-01-01','value':3}]})
if __name__=='__main__':unittest.main()
