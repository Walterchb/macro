"""Refresh statistics and calendars independently, retaining validated prior data."""
from pathlib import Path
import json
import subprocess
import sys

from validate_data import validate_data
from sync_agenda import validate_agenda
from sync_regional import validate_regional

ROOT = Path(__file__).resolve().parents[1]


def refresh_publication():
    successes = 0
    for script, label in [('sync_data.py', 'indicadores'), ('sync_agenda.py', 'agenda'), ('sync_regional.py', 'regiones')]:
        result = subprocess.run([sys.executable, str(ROOT / 'scripts' / script)], cwd=ROOT)
        if result.returncode == 0:
            successes += 1
        else:
            print(f'::warning::No se completó la descarga de {label}; se conserva la última publicación válida.', flush=True)
    if not successes:
        raise RuntimeError('Ninguna descarga se completó. No se publica esta ejecución.')
    print(validate_data(), flush=True)
    validate_agenda()
    validate_regional(json.loads((ROOT / 'data/regional.json').read_text()))
    print('Indicadores, agenda y regiones verificados para publicar.', flush=True)


if __name__ == '__main__':
    refresh_publication()
