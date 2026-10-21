"""Refresh with hard process deadlines and transactional local rollback.

Only a fully refreshed FRED snapshot may reach the repository/Pages commit.
Failed auxiliary downloads retain their prior validated files with warnings.
"""
from pathlib import Path
import json
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from sync_data import publish, atomic_json

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


def module_has_retained_data(script, arguments):
    """A zero exit code can still represent a partial multi-source download."""
    filename = {'sync_data.py': 'snapshot.json', 'sync_agenda.py': 'agenda.json',
                'sync_regional.py': 'regional.json', 'sync_forecasts.py': 'forecasts.json',
                'sync_demography.py': 'demography.json'}[script]
    payload = json.loads((ROOT / 'data' / filename).read_text())
    bad = {'retained', 'unavailable', 'partial', 'failed', 'error'}
    if script == 'sync_data.py':
        providers = {arguments[i + 1] for i, value in enumerate(arguments[:-1]) if value == '--provider'}
        return any(row.get('status') in bad for row in payload.get('series', [])
                   if not providers or row.get('provider') in providers)
    records = [payload, *payload.get('sources', []), *payload.get('series', [])]
    if isinstance(payload.get('bigMac'), dict):
        records.append(payload['bigMac'])
    return any(row.get('status') in bad for row in records)


def _refresh_publication(fred_only=False):
    if not os.environ.get('FRED_API_KEY', '').strip():
        raise RuntimeError('Falta FRED_API_KEY: guardar el secreto y enlazarlo en el workflow.')
    data = ROOT / 'data'
    failed_modules = []
    with tempfile.TemporaryDirectory(prefix='macro-refresh-') as temporary:
        backup = Path(temporary) / 'original'
        shutil.copytree(data, backup)
        try:
            phases = DOWNLOADS[:1] if fred_only else DOWNLOADS
            for index, (script, label, seconds, arguments) in enumerate(phases):
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
                    failed_modules.append(label)
                    if index == 1:
                        mark_non_fred_retained()
                    print(f'::warning::No se completó {label}; se conserva su versión anterior.', flush=True)
                elif module_has_retained_data(script, arguments):
                    failed_modules.append(label)
                    print(f'::warning::{label}: actualización parcial; algunas fuentes conservan datos anteriores.', flush=True)
            validate_all()
        except BaseException:
            restore(backup, data)
            raise
    print('FRED actualizado; publicación validada. Revisar advertencias de módulos auxiliares.', flush=True)
    return failed_modules


def known_failure_reason(started):
    """Read only this attempt's safe enumerated cause, never publish raw errors."""
    try:
        report = json.loads((ROOT / 'refresh-status-FRED.json').read_text())
        if datetime.fromisoformat(report['checkedAt'].replace('Z', '+00:00')) < datetime.fromisoformat(started):
            return 'refresh-failed'
        for reason in ('provider-maintenance', 'provider-unexpected-response'):
            if any('failureReason=' + reason in str(error.get('error', ''))
                   for error in report.get('errors', [])):
                return reason
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return 'refresh-failed'


def refresh_publication(fred_only=False):
    """Report failed attempts without changing the last validated observations.

    The workflow may publish this status alongside the untouched valid snapshot.
    Exception details remain in Actions logs; status text never carries tokens,
    arbitrary URLs or source-response content.
    """
    status_path = ROOT / 'data/refresh-status.json'
    previous = {}
    if status_path.exists():
        try:
            previous = json.loads(status_path.read_text())
        except (ValueError, OSError):
            pass
    started = datetime.now(timezone.utc).isoformat()
    try:
        failed_modules = _refresh_publication(fred_only=fred_only) or []
    except BaseException:
        reason = known_failure_reason(started)
        atomic_json(status_path, {
            'failureReason': reason,
            'attemptAt': started, 'completedAt': datetime.now(timezone.utc).isoformat(),
            'mode': 'fred-only' if fred_only else 'full', 'outcome': 'failed',
            'lastSuccessfulAt': previous.get('lastSuccessfulAt'),
            'lastSuccessfulMode': previous.get('lastSuccessfulMode'),
            'lastFullSuccessfulAt': previous.get('lastFullSuccessfulAt'),
            'error': ('FRED está en mantenimiento. Se conservan los datos validados anteriores.' if reason == 'provider-maintenance' else 'FRED devolvió una respuesta inesperada. No se publican datos de este intento; se conservan los datos validados anteriores.' if reason == 'provider-unexpected-response' else 'No se completó la actualización. Se conservan los datos validados anteriores; consultar el registro de ejecución.'),
            'lastFredSuccessfulAt': previous.get('lastFredSuccessfulAt'),
            'failedModules': [], 'retainedModules': False,
            'retainedSnapshot': True})
        raise
    completed = datetime.now(timezone.utc).isoformat()
    partial = bool(failed_modules)
    atomic_json(status_path, {
        'attemptAt': started, 'completedAt': completed,
        'mode': 'fred-only' if fred_only else 'full',
        'outcome': 'succeeded-with-warnings' if partial else 'succeeded',
        'lastSuccessfulAt': previous.get('lastSuccessfulAt') if partial else completed,
        'lastSuccessfulMode': previous.get('lastSuccessfulMode') if partial else ('fred-only' if fred_only else 'full'),
        'lastFullSuccessfulAt': previous.get('lastFullSuccessfulAt') if fred_only or partial else completed,
        'lastFredSuccessfulAt': completed,
        'failedModules': failed_modules, 'retainedModules': partial,
        'error': 'FRED actualizado; algunos módulos auxiliares conservan datos anteriores.' if partial else None,
        'retainedSnapshot': False})



if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--fred-only', action='store_true', help='Revalidar FRED intradía sin volver a descargar módulos auxiliares.')
        refresh_publication(fred_only=parser.parse_args().fred_only)
    except Exception as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(1)
