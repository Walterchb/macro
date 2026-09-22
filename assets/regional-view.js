/** Regional explorer: official departmental boundaries and exact-period observations. */
const finite = v => typeof v === 'number' && Number.isFinite(v);
const monthDate = (year, month) => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
const valueCache = new WeakMap();
const valueMap = series => {
  if (!series) return new Map();
  if (!valueCache.has(series)) valueCache.set(series, new Map((series.observations || []).filter(o => finite(o.value)).map(o => [o.date, o.value])));
  return valueCache.get(series);
};
const percentage = (current, previous) => finite(current) && finite(previous) && previous > 0 ? (current / previous - 1) * 100 : null;

/** Stocks: YTD vs prior December. Flows: Jan–month sum vs same months one year earlier. */
export function regionalValue(series, indicator, period, mode = 'level') {
  if (!series || !/^\d{4}-\d{2}-01$/.test(period || '')) return null;
  const values = valueMap(series), current = values.get(period);
  if (!finite(current)) return null;
  if (mode === 'level') return current;
  const year = Number(period.slice(0, 4)), month = Number(period.slice(5, 7)) - 1;
  if (mode === 'yoy') return percentage(current, values.get(monthDate(year - 1, month)));
  if (series.frequency !== 'monthly') return null;
  if (mode === 'mom') return percentage(current, values.get(monthDate(year, month - 1)));
  if (mode !== 'ytd') return null;
  if (indicator.kind === 'stock') return percentage(current, values.get(monthDate(year - 1, 11)));
  if (indicator.kind !== 'flow') return null;
  let total = 0, previous = 0;
  for (let m = 0; m <= month; m++) {
    const now = values.get(monthDate(year, m)), before = values.get(monthDate(year - 1, m));
    if (!finite(now) || !finite(before)) return null;
    total += now; previous += before;
  }
  return percentage(total, previous);
}

/** Common dates include missing regions in the denominator. No forward-filled values. */
export function regionalPeriods(regions, series, indicator, mode = 'level') {
  const relevant = series.filter(s => s.indicatorId === indicator.id);
  const periods = [...new Set(relevant.flatMap(s => s.observations.filter(o => finite(o.value)).map(o => o.date)))].sort();
  const byRegion = new Map(relevant.map(s => [s.regionId, s]));
  return periods.map(date => ({ date, count: regions.filter(r => finite(regionalValue(byRegion.get(r.id), indicator, date, mode))).length }))
    .filter(p => p.count > 0);
}

export function regionalSeries(series, indicator, mode = 'level') {
  if (!series) return null;
  if (mode === 'level') return series;
  const formula = mode === 'ytd' ? indicator.kind === 'flow'
    ? 'YTD: suma de enero al mes seleccionado frente a la suma de los mismos meses del año anterior; exige todos los meses.'
    : 'YTD: saldo del mes seleccionado frente al saldo de diciembre del año anterior.'
    : mode === 'mom' ? 'MOM: mes seleccionado frente al mes calendario anterior.' : series.frequency === 'annual' ? 'YOY: año seleccionado frente al año calendario anterior.' : 'YOY: mes seleccionado frente al mismo mes del año anterior.';
  return { ...series, id: `${series.id}_${mode}`, name: `${series.name} · ${mode.toUpperCase()}`, unit: '%', derived: mode,
    description: `${series.description || indicator.description || ''} ${formula}`,
    observations: series.observations.map(o => ({ ...o, value: regionalValue(series, indicator, o.date, mode) })) };
}

export const regionalModes = frequency => frequency === 'annual' ? ['level', 'yoy'] : ['level', 'yoy', 'mom', 'ytd'];

/** Same-year nominal sector composition. The residual includes all other activities. */
export function regionalStructure(series, regionId, period) {
  const total = valueMap(series.find(s => s.regionId === regionId && s.indicatorId === 'vab_nominal')).get(period);
  const sectors = series.filter(s => s.regionId === regionId && s.indicatorId.startsWith('sector_'));
  if (!(total > 0) || sectors.length !== 5) return [];
  const rows = sectors.map(s => ({ id: s.indicatorId, s, value: valueMap(s).get(period) }));
  if (rows.some(r => !finite(r.value) || r.value < 0)) return [];
  const other = total - rows.reduce((sum, row) => sum + row.value, 0);
  if (other < -0.01) return [];
  return [...rows, { id: 'sector_other', s: null, value: Math.max(0, other) }]
    .map(row => ({ ...row, share: row.value / total * 100 }));
}

export function createRegionalView(ctx) {
  const { esc, fmt, date, panel, chart, timeChart, baseOption, chartRows, colors, css, theme } = ctx;
  let dataset = null, geometry = null, pending = null, cacheGeneration = 0, renderGeneration = 0;
  let regionId = '15', indicatorId = '', period = '', mode = 'level', peerId = '04';
  let host = null, selector = '#economic-topic', controller = null, ownedCharts = [], mapChart = null, mapZoom = 1;
  const signed = n => finite(n) ? `${n > 0 ? '+' : ''}${fmt(n, 1)}%` : '—';
  const unit = indicator => mode === 'level' ? indicator.unit : '%';
  const showPeriod = d => date(d, indicator()?.frequency || 'monthly');
  const region = id => dataset?.regions.find(r => r.id === id);
  const indicator = () => dataset?.indicators.find(i => i.id === indicatorId);
  const seriesFor = (rid = regionId, iid = indicatorId) => dataset?.series.find(s => s.regionId === rid && s.indicatorId === iid);
  const currentRows = () => dataset.regions.map(r => ({ ...r, s: seriesFor(r.id), value: regionalValue(seriesFor(r.id), indicator(), period, mode) }));

  async function load() {
    if (dataset && geometry) return;
    if (!pending) {
      const generation = cacheGeneration;
      const request = ctx.fetchData ? ctx.fetchData() : fetch('./data/regional.json', { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`Datos regionales: HTTP ${r.status}`); return r.json();
      });
      pending = Promise.all([request, geometry || fetch('./assets/peru-regions.geo.json').then(r => {
        if (!r.ok) throw new Error(`Mapa regional: HTTP ${r.status}`); return r.json();
      })]).then(([data, geo]) => {
        if (generation !== cacheGeneration) return;
        if (!Array.isArray(data.regions) || !data.regions.length || !Array.isArray(data.indicators) || !data.indicators.length || !Array.isArray(data.series)) throw new Error('La publicación regional está incompleta.');
        if (geo.type !== 'FeatureCollection' || geo.features.length !== 25) throw new Error('La cartografía regional está incompleta.');
        data.series = data.series.map(s => ({ ...s, country: 'PER', countryName: `Perú · ${data.regions.find(r => r.id === s.regionId)?.name || s.regionId}`, primarySource: s.sourceInstitution || s.provider,
          description: [s.description, s.territoryNote].filter(Boolean).join(' ') }));
        dataset = data; geometry = geo;
        if (!data.regions.some(r => r.id === regionId)) regionId = data.regions[0].id;
        if (!data.indicators.some(i => i.id === indicatorId)) indicatorId = data.indicators[0].id;
        if (!data.regions.some(r => r.id === peerId)) peerId = data.regions.find(r => r.id !== regionId)?.id || regionId;
      }).finally(() => { if (generation === cacheGeneration) pending = null; });
    }
    await pending;
  }

  function releaseCharts() {
    ownedCharts.forEach(c => { if (c && !c.isDisposed?.()) c.dispose(); });
    ownedCharts = []; mapChart = null;
    ['regional-map', 'regional-rank', 'regional-history', 'regional-structure'].forEach(id => chartRows.delete(id));
  }
  function dispose() { renderGeneration++; controller?.abort(); controller = null; releaseCharts(); host = null; }
  function invalidate() { cacheGeneration++; dataset = null; pending = null; }
  function track(id, option) { const c = chart(id, option); if (c) ownedCharts.push(c); return c; }
  function chartFooter(id) {
    const body = host.querySelector(`#${id}`)?.parentElement;
    if (!body) return null;
    let footer = body.querySelector('.chart-note');
    if (!footer) { footer = document.createElement('div'); footer.className = 'chart-note'; body.append(footer); }
    return footer;
  }
  function redraw() { if (host?.isConnected) return render(selector); }

  function selectRegion(id) {
    if (!dataset.regions.some(r => r.id === id) || id === regionId) return;
    regionId = id;
    if (peerId === regionId) peerId = dataset.regions.find(r => r.id !== regionId)?.id || regionId;
    redraw();
  }

  function kpis() {
    const references = dataset.indicators.filter(i => i.frequency === indicator().frequency && i.reference !== false);
    return `<section class="regional-references" style="--regional-reference-count:${references.length}" aria-label="Indicadores de referencia de ${esc(region(regionId).name)}">${references.map(i => {
      const s = seriesFor(regionId, i.id), observation = s?.observations.find(o => o.date === period && finite(o.value));
      const yoy = regionalValue(s, i, period, 'yoy');
      return `<button class="regional-reference ${i.id === indicatorId ? 'active' : ''}" data-regional-indicator="${esc(i.id)}" aria-pressed="${i.id === indicatorId}" title="Ver ${esc(i.name)} en el mapa"><span>${esc(i.shortName || i.name)}</span><strong>${observation ? fmt(observation.value, i.unit === 'personas' ? 0 : 1) : '—'}</strong><small>${esc(i.unit)}</small><span class="regional-kpi-change">YOY <b>${signed(yoy)}</b></span>${!observation ? '<small>Sin dato en este periodo</small>' : ''}</button>`;
    }).join('')}</section>`;
  }

  function chooseIndicator(id) {
    indicatorId = id; period = '';
    if (!regionalModes(indicator()?.frequency).includes(mode)) mode = 'level';
  }

  function indicatorOptions() {
    const sameFrequency = dataset.indicators.filter(i => i.frequency === indicator().frequency);
    const groups = indicator().frequency === 'annual' ? [['production', 'Producción y población'], ['sectors', 'Actividad económica · VAB nominal']] : [[undefined, 'Coyuntura mensual']];
    return groups.map(([group, label]) => `<optgroup label="${esc(label)}">${sameFrequency.filter(i => i.group === group).map(i => `<option value="${i.id}" ${i.id === indicatorId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function observationLabel(observation) {
    return ({ estimated: 'Estimado', provisional: 'Provisional', population_estimate: 'Estimación/proyección de población' })[observation?.observationStatus] || '';
  }

  const sectorName = id => id === 'sector_other' ? 'Otros sectores' : dataset.indicators.find(i => i.id === id)?.shortName || id;
  function structureSeries(rid, row) {
    const total = seriesFor(rid, 'vab_nominal');
    const source = row.s || { ...total, id: `${total.id}_other`, sourceCode: `${total.sourceCode} − cinco sectores`, description: 'Cálculo: VAB nominal total menos agricultura, minería e hidrocarburos, manufactura, construcción y comercio. Incluye pesca, electricidad, transporte y los demás servicios.' };
    const observation = total.observations.find(o => o.date === period);
    return { ...source, id: `${source.id}_share`, name: `${sectorName(row.id)} · ${region(rid).name}`, unit: '% del VAB nominal', derived: 'sector_share',
      description: `${source.description} Participación = VAB sectorial / VAB nominal departamental del mismo año × 100.`,
      observations: [{ ...observation, date: period, value: row.share }] };
  }

  function structureHtml() {
    const rows = regionalStructure(dataset.series, regionId, period);
    if (!rows.length) return '<p class="regional-structure-empty">Desglose productivo no disponible para el año seleccionado.</p>';
    const other = regionalStructure(dataset.series, peerId, period);
    const before = regionalStructure(dataset.series, regionId, `${Number(period.slice(0, 4)) - 1}-01-01`);
    const sources = [...rows.map(r => structureSeries(regionId, r)), ...other.map(r => structureSeries(peerId, r))];
    return `<div class="regional-structure-grid">${panel('regional-structure', 'Estructura productiva · VAB nominal', `${showPeriod(period)} · % · ${esc(region(regionId).name)} y ${esc(region(peerId).name)}`, sources, { help: 'Participación de cada actividad en el VAB nominal del mismo departamento y año. Otros sectores agrupa las demás actividades, incluida pesca, electricidad, transporte y otros servicios. Las barras comparan estructura, no tamaño económico.' })}<section class="panel regional-sector-table"><div class="panel-head"><div><h2>${esc(region(regionId).name)} · actividad económica</h2><p>${showPeriod(period)} · precios corrientes</p></div></div><div class="regional-table-scroll"><table><thead><tr><th>Sector</th><th>S/ millones</th><th>%</th><th>YOY</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(sectorName(r.id))}</td><td>${fmt(r.value, 1)}</td><td>${fmt(r.share, 1)}</td><td>${signed(percentage(r.value, before.find(b => b.id === r.id)?.value))}</td></tr>`).join('')}</tbody></table></div><p class="regional-sector-note">YOY nominal: incluye precios y volumen. Otros sectores es el saldo del VAB no incluido en las cinco actividades anteriores.</p></section></div>`;
  }

  function drawStructure() {
    if (!host.querySelector('#regional-structure')) return;
    const selected = regionalStructure(dataset.series, regionId, period), peer = regionalStructure(dataset.series, peerId, period);
    const opt = baseOption(); delete opt.dataZoom;
    opt.grid = { left: 155, right: 42, top: 40, bottom: 30 };
    opt.legend = { data: [region(regionId).name, region(peerId).name], top: 5, textStyle: { fontSize: 11, color: css('--muted') }, icon: 'roundRect', itemWidth: 13, itemHeight: 5 };
    opt.xAxis = { type: 'value', axisLabel: { formatter: n => `${fmt(n, 0)}%`, fontSize: 11, color: css('--muted') }, splitLine: { lineStyle: { color: css('--grid') } } };
    opt.yAxis = { type: 'category', inverse: true, data: selected.map(r => sectorName(r.id)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { width: 140, overflow: 'truncate', color: css('--muted'), fontSize: 11 } };
    opt.tooltip = { ...opt.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => `<strong>${esc(params[0]?.axisValue || '')}</strong><br>${params.filter(p => finite(p.value)).map(p => `${p.marker} ${esc(p.seriesName)} <b>${fmt(p.value, 1)}%</b>`).join('<br>')}` };
    opt.series = [{ rid: regionId, rows: selected }, { rid: peerId, rows: peer }].map(({ rid, rows }, index) => ({ name: region(rid).name, type: 'bar', barMaxWidth: 13,
      itemStyle: { color: colors[index === 0 ? 0 : 2], borderRadius: [0, 2, 2, 0] },
      data: selected.map(s => rows.find(r => r.id === s.id)?.share ?? null), label: { show: true, position: 'right', formatter: p => finite(p.value) ? `${fmt(p.value, 1)}%` : '', color: css('--ink'), fontSize: 11 } }));
    chartRows.get('regional-structure').rows = [...selected.map(r => structureSeries(regionId, r)), ...peer.map(r => structureSeries(peerId, r))].map(s => ({ s, rows: s.observations }));
    track('regional-structure', opt);
  }

  function periodOptions(periods) {
    return periods.slice().reverse().map(p => `<option value="${p.date}" ${p.date === period ? 'selected' : ''}>${showPeriod(p.date)}${p.count < dataset.regions.length ? ` · ${p.count}/${dataset.regions.length}` : ''}</option>`).join('');
  }

  async function render(target = '#economic-topic') {
    selector = target; const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    const ticket = ++renderGeneration; host = el;
    controller?.abort(); releaseCharts();
    if (!dataset || !geometry) el.innerHTML = '<div class="regional-loading" role="status"><i class="fa-solid fa-map" aria-hidden="true"></i> Cargando regiones…</div>';
    try { await load(); }
    catch (error) {
      if (ticket !== renderGeneration || !el.isConnected) return;
      el.innerHTML = `<section class="panel regional-error"><h2>Perú por regiones</h2><p>No se pudo cargar la publicación regional.</p><button class="btn" data-regional-retry>Reintentar</button></section>`;
      el.querySelector('[data-regional-retry]').onclick = () => render(target); return;
    }
    if (ticket !== renderGeneration || !el.isConnected || !dataset) return;
    const ind = indicator();
    if (!regionalModes(ind.frequency).includes(mode)) mode = 'level';
    const periods = regionalPeriods(dataset.regions, dataset.series, ind, mode);
    const coverageTarget = dataset.regions.filter(r => seriesFor(r.id)?.observations.some(o => finite(o.value))).length;
    if (!periods.some(p => p.date === period)) period = periods.filter(p => p.count === coverageTarget).at(-1)?.date || periods.at(-1)?.date || '';
    const rows = currentRows(), valid = rows.filter(r => finite(r.value)), chosen = rows.find(r => r.id === regionId);
    const ordered = valid.slice().sort((a, b) => b.value - a.value), rank = ordered.findIndex(r => r.id === regionId) + 1;
    const selectedSeries = seriesFor(), peerSeries = seriesFor(peerId);
    const history = [selectedSeries, peerSeries].filter(Boolean).map(s => regionalSeries(s, ind, mode));
    const mapSeries = rows.filter(r => r.s).map(r => regionalSeries(r.s, ind, mode));
    const stamp = period ? showPeriod(period) : 'Sin periodo disponible';
    const regionalName = region(regionId).name;
    const statusLabel = observationLabel(selectedSeries?.observations.find(o => o.date === period));
    el.innerHTML = `<div class="regional-frequency" role="group" aria-label="Frecuencia de los indicadores regionales"><button data-regional-frequency="annual" class="${ind.frequency === 'annual' ? 'active' : ''}" aria-pressed="${ind.frequency === 'annual'}">Producción y población · anual</button><button data-regional-frequency="monthly" class="${ind.frequency === 'monthly' ? 'active' : ''}" aria-pressed="${ind.frequency === 'monthly'}">Coyuntura · mensual</button></div><div class="regional-controls"><label>Región<select id="regional-region">${dataset.regions.map(r => `<option value="${r.id}" ${r.id === regionId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label><label>Indicador<select id="regional-indicator">${indicatorOptions()}</select></label><label>${ind.frequency === 'annual' ? 'Año común' : 'Periodo común'}<select id="regional-period" ${periods.length ? '' : 'disabled'}>${periodOptions(periods)}</select></label><label>Vista<select id="regional-mode">${regionalModes(ind.frequency).map(m => `<option value="${m}" ${mode === m ? 'selected' : ''}>${m === 'level' ? 'Nivel' : m.toUpperCase()}</option>`).join('')}</select></label></div>
      <div class="regional-section-head"><h2>${esc(regionalName)} <span>· ${stamp}</span></h2><span>Indicadores de referencia</span></div>${kpis()}
      <div class="regional-summary" aria-live="polite"><div><strong>${esc(ind.name)}</strong><span>${mode === 'level' ? esc(ind.unit) : mode.toUpperCase() + ' · %'} · ${stamp}${statusLabel ? ' · ' + esc(statusLabel) : ''}</span></div><div class="regional-selected-value"><b>${finite(chosen?.value) ? fmt(chosen.value, 1) : 'Sin dato'}</b><span>${finite(chosen?.value) ? `${esc(unit(ind))} · ${rank} de ${valid.length} con dato` : esc(regionalName)}</span></div><span class="regional-coverage">${valid.length}/${dataset.regions.length} regiones</span></div>
      <div class="regional-map-grid">${panel('regional-map', 'Mapa regional', `${esc(ind.name)} · ${stamp}`, mapSeries, { note: '' })}${panel('regional-rank', 'Comparación regional', `${mode === 'level' ? esc(ind.unit) : mode.toUpperCase() + ' · %'} · ${stamp}`, mapSeries, { note: '' })}</div>
      <div class="regional-history-controls"><label>Comparar ${esc(regionalName)} con<select id="regional-peer">${dataset.regions.filter(r => r.id !== regionId).map(r => `<option value="${r.id}" ${r.id === peerId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label><span>${esc(ind.description || '')}</span></div>
      <div class="regional-history">${panel('regional-history', `${esc(ind.name)} · evolución`, `${esc(regionalName)} y ${esc(region(peerId)?.name || '')} · ${mode === 'level' ? esc(ind.unit) : mode.toUpperCase() + ' · %'}`, history)}</div>
      ${ind.frequency === 'annual' ? structureHtml() : ''}
      <details class="regional-method"><summary>Fuentes y cálculo</summary><p>${esc(selectedSeries?.description || ind.description || '')}</p><dl><dt>${ind.frequency === 'annual' ? 'YOY' : 'YOY / MOM'}</dt><dd>${ind.frequency === 'annual' ? 'Cambio porcentual frente al año anterior, con ambos años publicados. No se calculan MOM ni YTD para una serie anual.' : 'Cambio porcentual frente al mismo mes del año anterior / mes anterior, con ambos datos publicados.'}</dd>${ind.frequency === 'monthly' ? `<dt>YTD</dt><dd>${ind.kind === 'flow' ? 'Acumulado de enero al mes seleccionado frente al mismo periodo del año anterior. Requiere todos los meses de ambos periodos.' : 'Saldo del mes seleccionado frente al saldo de diciembre del año anterior.'}</dd>` : '<dt>INEI</dt><dd>VAB: valor agregado bruto, excluye los impuestos nacionales no asignados a departamentos. E: estimado; P: provisional. Población: estimación/proyección al 30 de junio. VAB por habitante: cálculo propio con ambas fuentes INEI del mismo año.</dd>'}<dt>Cobertura</dt><dd>Un mismo periodo para el mapa y la comparación. Lima corresponde al departamento y excluye Callao. Sin dato no equivale a cero.</dd></dl><ul>${[...new Map([selectedSeries, peerSeries].filter(Boolean).map(s => [s.sourceUrl, s])).values()].map(s => `<li><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.sourceInstitution || s.provider)}${s.sourceInstitution && s.sourceInstitution !== s.provider ? ' vía ' + esc(s.provider) : ''} · ${esc(s.sourceCode || s.name)}</a></li>`).join('')}${selectedSeries?.populationSourceUrl ? `<li><a href="${esc(selectedSeries.populationSourceUrl)}" target="_blank" rel="noopener">INEI · población estimada/proyectada</a></li>` : ''}</ul><p><a href="${esc(geometry.metadata.sourceUrl)}" target="_blank" rel="noopener">Cartografía: ANA · SNIRH</a> · límites referenciales. <span>Datos: ${new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' }).format(new Date(dataset.fetchedAt))}.</span></p>${selectedSeries?.status === 'retained' ? '<p>Esta serie conserva la última descarga válida.</p>' : ''}</details>`;
    controller = new AbortController();
    el.addEventListener('change', event => {
      const { id, value } = event.target;
      if (id === 'regional-region') return selectRegion(value);
      if (id === 'regional-indicator') chooseIndicator(value);
      else if (id === 'regional-period') period = value;
      else if (id === 'regional-mode') { mode = value; period = ''; }
      else if (id === 'regional-peer') peerId = value;
      else return;
      redraw();
    }, { signal: controller.signal });
    el.addEventListener('click', event => {
      const button = event.target.closest('[data-regional-indicator],[data-regional-select],[data-map-zoom],[data-regional-frequency]');
      if (!button) return;
      if (button.dataset.regionalIndicator) { chooseIndicator(button.dataset.regionalIndicator); return redraw(); }
      if (button.dataset.regionalFrequency) { const next = dataset.indicators.find(i => i.frequency === button.dataset.regionalFrequency); if (next && next.frequency !== ind.frequency) { chooseIndicator(next.id); return redraw(); } }
      if (button.dataset.regionalSelect) return selectRegion(button.dataset.regionalSelect);
      if (button.dataset.mapZoom) { mapZoom = Math.max(0.9, Math.min(4, button.dataset.mapZoom === 'reset' ? 1 : mapZoom + Number(button.dataset.mapZoom))); mapChart?.setOption({ series: [{ zoom: mapZoom }] }); }
    }, { signal: controller.signal });
    drawMap(rows, ind); drawRanking(ordered, ind);
    if (ind.frequency === 'annual') drawStructure();
    if (history.some(s => s.observations.some(o => finite(o.value)))) {
      timeChart('regional-history', history, { names: [region(regionId).name, region(peerId)?.name || 'Comparación'], zero: mode !== 'level', stats: false });
      const c = window.echarts?.getInstanceByDom(el.querySelector('#regional-history')); if (c) ownedCharts.push(c);
    } else el.querySelector('#regional-history').innerHTML = '<div class="regional-loading">Sin observaciones para esta comparación.</div>';
  }

  function drawMap(rows, ind) {
    if (!window.echarts) return;
    const geo = { ...geometry, features: geometry.features.map(f => ({ ...f, properties: { ...f.properties, name: region(f.properties.id)?.name || f.properties.name } })) };
    echarts.registerMap('treasury-peru-regions', geo);
    const values = rows.map(r => r.value).filter(finite), low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
    const varying = mode !== 'level', extreme = Math.max(Math.abs(low), Math.abs(high), 0.01);
    const opt = baseOption(); delete opt.xAxis; delete opt.yAxis; delete opt.grid; delete opt.legend; delete opt.dataZoom;
    opt.animationDurationUpdate = 160;
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => {
      const r = rows.find(r => r.name === p.name), flag = observationLabel(r?.s?.observations.find(o => o.date === period)); return `${esc(p.name)}<br>${showPeriod(period)}${flag ? ' · ' + esc(flag) : ''}<br><strong>${finite(r?.value) ? `${fmt(r.value, 2)} ${esc(unit(ind))}` : 'Sin dato'}</strong>`;
    }};
    opt.visualMap = { type: 'continuous', min: varying ? -extreme : low, max: varying ? extreme : high === low ? high + 1 : high,
      left: 12, bottom: 24, orient: 'vertical', itemHeight: 130, itemWidth: 11, calculable: false,
      text: [fmt(varying ? extreme : high, 1), fmt(varying ? -extreme : low, 1)], precision: 1,
      textStyle: { color: css('--muted'), fontSize: 11 }, inRange: { color: varying ? ['#be8236', theme() ? '#233847' : '#f0f3f5', '#087e94'] : [theme() ? '#254556' : '#d6ebf0', '#3ca4b7', theme() ? '#7fd2dd' : '#073b57'] },
      outOfRange: { color: css('--line') } };
    opt.series = [{ id: 'peru-region-map', name: ind.name, type: 'map', map: 'treasury-peru-regions', roam: 'move', zoom: mapZoom,
      layoutCenter: ['54%', '47%'], layoutSize: '90%', selectedMode: 'single', scaleLimit: { min: 0.9, max: 4 },
      itemStyle: { borderColor: css('--panel'), borderWidth: 0.8, areaColor: css('--line') },
      label: { show: false }, emphasis: { label: { show: true, fontSize: 12, color: css('--ink'), backgroundColor: css('--panel'), padding: [4, 6], borderRadius: 3 }, itemStyle: { borderColor: css('--amber'), borderWidth: 2 } },
      select: { label: { show: true, fontSize: 12, fontWeight: 700, color: css('--ink'), backgroundColor: css('--panel'), padding: [4, 6], borderRadius: 3 }, itemStyle: { borderColor: css('--amber'), borderWidth: 2.5 } },
      data: rows.map(r => ({ name: r.name, value: finite(r.value) ? r.value : null, selected: r.id === regionId })) }];
    chartRows.get('regional-map').rows = rows.filter(r => r.s).map(r => ({ s: regionalSeries(r.s, ind, mode), rows: [{ ...r.s.observations.find(o => o.date === period), date: period, value: r.value }] }));
    mapChart = track('regional-map', opt);
    mapChart?.on('click', p => { const r = rows.find(r => r.name === p.name); if (r) selectRegion(r.id); });
    const note = chartFooter('regional-map');
    note.innerHTML = `<span class="regional-map-note"><i></i> Sin dato · <a href="${esc(geometry.metadata.sourceUrl)}" target="_blank" rel="noopener">ANA · SNIRH</a></span><span class="regional-map-actions"><button class="icon-only" data-map-zoom="0.3" aria-label="Acercar mapa"><i class="fa-solid fa-plus" aria-hidden="true"></i></button><button class="icon-only" data-map-zoom="-0.3" aria-label="Alejar mapa"><i class="fa-solid fa-minus" aria-hidden="true"></i></button><button class="icon-only" data-map-zoom="reset" aria-label="Restablecer escala del mapa"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i></button><button data-regional-select="07">Callao</button></span>`;
  }

  function drawRanking(rows, ind) {
    const opt = baseOption(); delete opt.legend; delete opt.dataZoom;
    opt.grid = { left: 114, right: 63, top: 14, bottom: 28 };
    opt.tooltip = { ...opt.tooltip, trigger: 'item', formatter: p => `${esc(p.name)} · ${showPeriod(period)}<br><strong>${fmt(p.value, 2)} ${esc(unit(ind))}</strong>` };
    opt.xAxis = { type: 'value', axisLabel: { color: css('--muted'), fontSize: 11, formatter: n => Math.abs(n) >= 1000000 ? `${fmt(n / 1000000, 1)} M` : Math.abs(n) >= 1000 ? `${fmt(n / 1000, 0)} mil` : fmt(n, 0) }, splitLine: { lineStyle: { color: css('--grid') } } };
    opt.yAxis = { type: 'category', inverse: true, data: rows.map(r => r.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: css('--muted'), fontSize: 11, width: 104, overflow: 'truncate' } };
    opt.series = [{ type: 'bar', name: ind.name, barMaxWidth: 13, data: rows.map(r => ({ value: r.value, itemStyle: { color: r.id === regionId ? colors[0] : theme() ? '#355267' : '#b8cdd8', borderRadius: [0, 2, 2, 0] } })), label: { show: true, position: 'right', fontSize: 11, color: css('--ink'), formatter: p => fmt(p.value, 1) }, emphasis: { itemStyle: { color: colors[0] } } }];
    chartRows.get('regional-rank').rows = rows.map(r => ({ s: regionalSeries(r.s, ind, mode), rows: [{ ...r.s.observations.find(o => o.date === period), date: period, value: r.value }] }));
    const ranking = track('regional-rank', opt);
    ranking?.on('click', p => { const r = rows.find(r => r.name === p.name); if (r) selectRegion(r.id); });
    chartFooter('regional-rank').innerHTML = `<span>${rows.length} regiones con dato · selecciona una barra para explorar.</span>`;
  }

  return { render, dispose, invalidate };
}
