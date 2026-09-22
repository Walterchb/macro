import test from 'node:test';
import assert from 'node:assert/strict';
import { ageComposition, demographicDependency, latestBigMac } from '../assets/demography-view.js';

const group = (indicatorId, value, date = '2025-01-01') => ({ country: 'PER', indicatorId, observations: [{ date, value }] });

test('age composition uses the exact year and all three mutually exclusive bands', () => {
  const series = [group('age_young', 25), group('age_working', 65), group('age_older', 10)];
  assert.deepEqual(ageComposition(series, 'PER', '2025-01-01'), [25, 65, 10]);
  assert.equal(ageComposition(series, 'PER', '2024-01-01'), null);
  assert.equal(ageComposition(series.slice(0, 2), 'PER', '2025-01-01'), null);
  series[2].observations[0].value = 12;
  assert.equal(ageComposition(series, 'PER', '2025-01-01'), null);
});

test('demographic dependency is dependents per hundred working-age persons, not population share', () => {
  assert.equal(demographicDependency([20, 70, 10]), 30 / 70 * 100);
  assert.equal(demographicDependency([100, 0, 0]), null);
  assert.equal(demographicDependency([-10, 100, 10]), null);
  assert.equal(demographicDependency([10, 10, 10]), null);
});

test('Big Mac comparison uses the latest shared publication window without mixing stale countries', () => {
  const rows = [{ country: 'PER', date: '2025-07-01', raw: -20 }, { country: 'CHL', date: '2026-07-01', raw: 5 }, { country: 'USA', date: '2026-07-01', raw: 0 }];
  assert.deepEqual(latestBigMac(rows, ['PER', 'CHL', 'USA']), { date: '2026-07-01', rows: rows.slice(1) });
  assert.deepEqual(latestBigMac(rows, ['PER']), { date: '2025-07-01', rows: [rows[0]] });
  assert.deepEqual(latestBigMac(rows, ['WLD']), { date: null, rows: [] });
});
