import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastSegments, forecastIndex, projectionDelta } from '../assets/forecasts-view.js';

const series = observations => ({ id: 'gdp_growth', name: 'PBI real', frequency: 'annual', unit: '% YOY', provider: 'MEF', sourceCode: 'C-01', vintage: 'MMM 2027–2030', observations });
const row = (year, value, status = 'forecast', extra = {}) => ({ date: `${year}-01-01`, value, status, ...extra });

test('projection starts with an adjacent historical anchor while the observed curve stops at the actual cutoff', () => {
  const s = series([row(2024, 2, 'observed'), row(2025, 3, 'observed'), row(2026, 4), row(2027, 5)]);
  const result = forecastSegments(s);
  assert.equal(result.anchor, '2025-01-01');
  assert.equal(result.firstForecast, '2026-01-01');
  assert.deepEqual(result.historical.map(r => r[1]), [2, 3, null, null]);
  assert.deepEqual(result.outlook.map(r => r[1]), [null, 3, 4, 5]);
  assert.equal(result.outlook[2][0], Date.UTC(2026, 0, 1));
  assert.equal(result.rows.length, 4, 'export rows never duplicate the bridge point');
});

test('missing annual dates break the projection and an old historical point cannot bridge over them', () => {
  const result = forecastSegments(series([row(2024, 2, 'observed'), row(2026, 4), row(2028, 5)]));
  assert.equal(result.anchor, null);
  assert.deepEqual(result.outlook.map(r => r[1]), [null, null, 4, null, 5]);
  assert.equal(result.historical[1][1], null);
});

test('derived GDP path compounds source growth, preserves status and identifies the calculated level', () => {
  const s = series([row(2025, 2, 'observed'), row(2026, 10), row(2027, -5), row(2028, 0)]);
  const result = forecastIndex(s, 2025);
  assert.deepEqual(result.observations.map(r => r.status), ['observed', 'forecast', 'forecast', 'forecast']);
  assert.equal(result.observations[0].value, 100);
  assert.ok(Math.abs(result.observations[1].value - 110) < 1e-10);
  assert.ok(Math.abs(result.observations[2].value - 104.5) < 1e-10);
  assert.ok(Math.abs(result.observations[3].value - 104.5) < 1e-10);
  assert.equal(result.unit, 'Índice 2025 = 100');
  assert.match(result.description, /No es el nivel oficial/);
  assert.equal(result.vintage, s.vintage);
});

test('derived path never resumes after a missing growth rate and cannot use a forecast as actual base', () => {
  const result = forecastIndex(series([row(2025, 2, 'observed'), row(2027, 4), row(2028, 3)]), 2025);
  assert.deepEqual(result.observations.map(r => r.value), [100, null, null, null]);
  assert.equal(forecastIndex(series([row(2025, 2), row(2026, 3)]), 2025), null);
});

test('differences are percentage points and require both exact annual observations', () => {
  const s = series([row(2025, -2, 'observed'), row(2026, -1.5)]);
  assert.equal(projectionDelta(s, 2026, 2025), 0.5);
  assert.equal(projectionDelta(s, 2026, 2024), null);
  assert.equal(projectionDelta(series([row(2025, 0, 'observed'), row(2026, 0)]), 2026, 2025), 0);
});

test('historical WB provenance survives splitting and a MEF-only calculated path does not inherit older observations', () => {
  const s = series([row(2024, 3, 'observed', { provider: 'Banco Mundial', vintage: 'WDI', sourceUrl: 'https://data.worldbank.org/' }), row(2025, 2, 'observed', { provider: 'MEF' }), row(2026, 4, 'forecast', { provider: 'MEF' })]);
  assert.equal(forecastSegments(s).rows[0].vintage, 'WDI');
  const path = forecastIndex(s, 2025);
  assert.equal(path.observations.length, 2);
  assert.ok(path.observations.every(o => o.provider === 'MEF'));
});
