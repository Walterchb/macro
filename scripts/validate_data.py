"""Validate the root snapshot before either GitHub Pages publishing mode."""
import json
import math
from sync_data import validate_series, ROOT


def validate_data(root=ROOT):
    data = root / 'data'
    snapshot = json.loads((data / 'snapshot.json').read_text(encoding='utf-8'))
    ids = [s['id'] for s in snapshot['series']]
    assert ids and len(ids) == len(set(ids)), 'Catálogo vacío o IDs duplicados'
    for s in snapshot['series']:
        validate_series(s)
        assert s['provider'] in ('BCRP', 'FRED', 'World Bank')
        assert s.get('unit') and s.get('sourceUrl', '').startswith('https://')
        assert s['frequency'] in ('daily', 'weekly', 'monthly', 'quarterly', 'annual')
    observations = sum(len(s['observations']) for s in snapshot['series'])
    assert observations, 'La publicación no contiene observaciones'
    lookup = {s['id']: {o['date']: o['value'] for o in s['observations']} for s in snapshot['series']}
    exp, imp, trade = [lookup['bcrp_' + c] for c in ('PN38714BM', 'PN38718BM', 'PN38723BM')]
    for d in exp.keys() & imp.keys() & trade.keys():
        assert math.isclose(exp[d] - imp[d], trade[d], abs_tol=.001), 'Comercio no reconcilia ' + d
    for total_code, first_code, second_code, label in (
        ('PN02301FM', 'PN02302FM', 'PN02303FM', 'IGV interno + importaciones'),
        ('PN03432FQ', 'PN03433FQ', 'PN03442FQ', 'Deuda externa + interna'),
    ):
        total, first, second = [lookup.get('bcrp_' + c, {}) for c in (total_code, first_code, second_code)]
        for d in total.keys() & first.keys() & second.keys():
            assert math.isclose(total[d], first[d] + second[d], abs_tol=.001), label + ' no reconcilia ' + d
    idx = lookup['bcrp_PN38705PM']
    inflation = lookup['bcrp_PN01273PM']
    for d, value in inflation.items():
        prev = str(int(d[:4]) - 1) + d[4:]
        if d in idx and prev in idx:
            assert math.isclose((idx[d] / idx[prev] - 1) * 100, value, abs_tol=.001), 'IPC no reconcilia ' + d
    manifest = json.loads((data / 'manifest.json').read_text(encoding='utf-8'))
    health = json.loads((data / 'health.json').read_text(encoding='utf-8'))
    assert manifest['version'] == snapshot['version'] == health['version'], 'Versiones de publicación distintas'
    assert manifest['series'] == len(ids), 'Conteo de series no coincide'
    assert manifest['observations'] == observations, 'Conteo de observaciones no coincide'
    assert {s['id'] for s in health['series']} == set(ids), 'Control de calidad incompleto'
    return f'VALIDADO: {len(ids)} series; {observations} observaciones; IPC, comercio, IGV y deuda conciliados.'


if __name__ == '__main__':
    print(validate_data())
