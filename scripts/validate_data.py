import json,sys,math
from pathlib import Path
from sync_data import validate_series,ROOT
p=json.loads((ROOT/'dist/data/snapshot.json').read_text())
ids=[s['id'] for s in p['series']]
assert len(ids)==len(set(ids)), 'IDs duplicados'
for s in p['series']:
    validate_series(s)
    assert s['provider'] in ('BCRP','FRED','World Bank')
    assert s.get('unit') and s.get('sourceUrl','').startswith('https://')
    assert s['frequency'] in ('daily','monthly','quarterly','annual')
lookup={s['id']:{o['date']:o['value'] for o in s['observations']} for s in p['series']}
exp,imp,trade=[lookup['bcrp_'+c] for c in ('PN38714BM','PN38718BM','PN38723BM')]
for d in exp.keys()&imp.keys()&trade.keys():assert math.isclose(exp[d]-imp[d],trade[d],abs_tol=.001), 'Comercio no reconcilia '+d
idx=lookup['bcrp_PN38705PM'];infl=lookup['bcrp_PN01273PM']
for d,v in infl.items():
    prev=str(int(d[:4])-1)+d[4:]
    if d in idx and prev in idx:assert math.isclose((idx[d]/idx[prev]-1)*100,v,abs_tol=.001),'IPC no reconcilia '+d
manifest=json.loads((ROOT/'dist/data/manifest.json').read_text())
assert manifest['version']==p['version']
print(f"VALIDADO: {len(ids)} series; {sum(len(s['observations']) for s in p['series'])} observaciones; IPC y comercio conciliados.")
