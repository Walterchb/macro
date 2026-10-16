"""Refresh with hard process deadlines and transactional local rollback.

Only a fully refreshed FRED snapshot may reach the repository/Pages commit.
Failed auxiliary downloads retain their prior validated files with warnings.
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from sync_data import publish

from validate_data import validate_data
from sync_agenda import validate_agenda
from sync_regional import validate_regional
from sync_forecasts import validate_forecasts
from sync_demography import validate_demography

ROOT = Path(__file__).resolve().parents[1]
# Independent source phases: slow BCRP/World Bank cannot consume FRED's
# workers/deadline. At most 10 + 4 + 4*2 = 22 minutes of child processes.
DOWNLOADS = [('sync_data.py', 'indicadores/FRED', 600, ['--provider', 'FRED']),
             ('sync_data.py', 'BCRP y Banco Mundial', 240, ['--provider', 'BCRP', '--provider', 'World Bank']),
             ('sync_agenda.py', 'agenda', 120, []),
             ('sync_regional.py', 'regiones', 120, []),
             ('sync_forecasts.py', 'proyecciones', 120, []),
             ('sync_demography.py', 'población y poder adquisitivo', 120, [])]


def restore(source, destination):
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)


def mark_non_fred_retained():
    snapshot = json.loads((ROOT / 'data/snapshot.json').read_text())
    stamp = datetime.now(timezone.utc).isoformat()
    for series in snapshot['series']:
        if series['provider'] != 'FRED':
            series['status'] = 'retained' if series.get('observations') else 'unavailable'
            series['lastAttemptAt'] = stamp
            series['error'] = 'Actualización BCRP/Banco Mundial incompleta o agotó su plazo; historial anterior conservado.'
    snapshot['errors']=[e for e in snapshot.get('errors',[]) if e.get('provider')=='FRED'] + [
        {'provider':provider,'code':'all','error':'Descarga incompleta o tiempo agotado; se conserva versión anterior.','lastAttemptAt':stamp}
        for provider in ('BCRP','World Bank')]
    # Keep each source fetchedAt and lastObservationDate unchanged.
    publish(snapshot, output=ROOT / 'data')


def validate_all():
    print(validate_data(), flush=True)
    validate_agenda()
    validate_regional(json.loads((ROOT / 'data/regional.json').read_text()))
    validate_forecasts(json.loads((ROOT / 'data/forecasts.json').read_text()))
    validate_demography(json.loads((ROOT / 'data/demography.json').read_text()))


def refresh_publication():
    if not os.environ.get('FRED_API_KEY', '').strip():
        raise RuntimeError('Falta FRED_API_KEY: guardar el secreto y enlazarlo en el workflow.')
    data = ROOT / 'data'
    with tempfile.TemporaryDirectory(prefix='macro-refresh-') as temporary:
        backup = Path(temporary) / 'original'
        shutil.copytree(data, backup)
        try:
            for index, (script, label, seconds, arguments) in enumerate(DOWNLOADS):
                current = Path(temporary) / 'before-module'
                if current.exists():
                    shutil.rmtree(current)
                shutil.copytree(data, current)
                try:
                    result = subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *arguments],
                                            cwd=ROOT, timeout=seconds, check=False)
                    ok = result.returncode == 0
                except subprocess.TimeoutExpired:
                    ok = False
                    print(f'::error::{label}: superó el límite real de {seconds} segundos.', flush=True)
                if not ok:
                    restore(current, data)
                    if index == 0:
                        raise RuntimeError('No se completó indicadores/FRED. Publicación anterior conservada; ejecución fallida.')
                    if index == 1:
                        mark_non_fred_retained()
                    print(f'::warning::No se completó {label}; se conserva su versión anterior.', flush=True)
            validate_all()
        except BaseException:
            restore(backup, data)
            raise
    print('FRED actualizado; publicación completa validada. Revisar advertencias de módulos auxiliares.', flush=True)


if __name__ == '__main__':
    try:
        refresh_publication()
    except Exception as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
