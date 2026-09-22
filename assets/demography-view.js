/** Source-backed demographic and purchasing-power comparisons. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const byDate = series => new Map((series?.observations || []).filter(row => finite(row.value)).map(row => [row.date, row.value]));
export const AGE_IDS = ['age_young', 'age_working', 'age_older'];

export function ageComposition(series, country, day) {
  const groups = AGE_IDS.map(id => series.find(s => s.country === country && s.indicatorId === id));
  const values = groups.map(s => byDate(s).get(day));
  if (values.some(value => !finite(value) || value < 0 || value > 100) || Math.abs(values.reduce((a, b) => a + b, 0) - 100) > .02) return null;
  return values;
}

/** Demographic dependency; age bands do not identify employment or economic support. */
export function demographicDependency(values) {
  return values?.length === 3 && values.every(value => finite(value) && value >= 0 && value <= 100) && Math.abs(values.reduce((a, b) => a + b, 0) - 100) <= .02 && values[1] > 0 ? (values[0] + values[2]) / values[1] * 100 : null;
}

export function latestBigMac(rows, countries) {
  const selected = rows.filter(row => !countries || countries.includes(row.country));
  const latest = selected.map(row => row.date).sort().at(-1);
  return { date: latest || null, rows: selected.filter(row => row.date === latest) };
}

export function createDemographyView(ctx) {
  const { esc, fmt, date, panel, chart, timeChart, baseOption, chartRows, colors, css } = ctx;
  let dataset = null, pending = null, cacheVersion = 0, renderVersion = 0, controller = null, owned = [];
  let region = 'peru', selected = { peru: 'PER', world: 'USA' }, peer = { peru: 'CHL', world: 'CHN' }, year = { peru: '', world: '' }, bigMode = 'raw';
  let target = '#economic-topic', host = null;
  const countryName = id => dataset.countries.find(country => country.id === id)?.name || id;
  const seriesFor = (indicator, country = selected[region]) => dataset.series.find(series => series.country === country && series.indicatorId === indicator);
  const value = (indicator, country = selected[region], day = year[region] + '-01-01') => byDate(seriesFor(indicator, country)).get(day);
  const signed = n => finite(n) ? `${n > 0 ? '+' : ''}${fmt(n, 1)}%` : '—';
  const own = instance => { if (instance) owned.push(instance); return instance; };
  const history = series => series ? { ...series, observations: series.observations.filter(row => row.date <= year[region] + '-12-31') } : null;
  const scaleSeries = (series, divisor, unit) => series ? { ...series, unit, id: series.id + '_scaled', observations: series.observations.map(row => ({ ...row, value: row.value / divisor })) } : null;
  function release() { owned.forEach(instance => { if (!instance.isDisposed?.()) instance.dispose(); }); owned = []; }
  function dispose() { renderVersion++; controller?.abort(); controller = null; release(); host = null; }
  function invalidate() { cacheVersion++; dataset = null; pending = null; }
  async function load() {
    if (dataset) return;
    if (!pending) {
      const ticket = cacheVersion;
      pending = (ctx.fetchData ? ctx.fetchData() : fetch('./data/demography.json', { cache: 'no-cache' }).then(response => { if (!response.ok) throw new Error('Demografía no disponible'); return response.json(); }))
        .then(data => { if (ticket !== cacheVersion) return; if (!data.countries?.length || !data.indicators?.length || !data.series?.length) throw new Error('Publicación incompleta'); dataset = data; })
        .finally(() => { if (ticket === cacheVersion) pending = null; });
    }
    await pending;
  }
  function empty(id, text = 'Sin dato para este periodo.') { host.querySelector('#' + id).innerHTML = `<div class="demography-empty">${esc(text)}</div>`; }
  function card(label, amount, unit, period, note) {
    return `<article class="demography-kpi"><span>${esc(label)}</span><strong>${amount}</strong><small>${esc(unit)} · ${esc(period || 'Sin dato')}</small>${note ? `<span class="demography-kpi-note">${note}</span>` : ''}</article>`;
  }
  function bigSeries(country, key) {
    const source = dataset.bigMac;
    return { id: `bigmac_${country}_${key}`, provider: 'The Economist', primarySource: 'The Economist', sourceCode: `USD_${key}`,
      sourceUrl: source.sourceUrl, country, countryName: countryName(country), frequency: 'irregular', unit: '% frente a EE.UU.',
      name: key === 'raw' ? 'Big Mac · simple' : 'Big Mac · ajustado por ingreso', description: key === 'raw'
        ? 'Precio USD del Big Mac / precio USD del Big Mac de EE.UU. − 1. Mide una brecha de precio de un producto; no estima un tipo de cambio objetivo.'
        : 'Índice de The Economist ajustado por PBI por habitante con su metodología de julio de 2022. No equivale al índice simple ni a una previsión de divisas.',
      status: source.status, fetchedAt: source.fetchedAt, license: source.license,
      observations: source.observations.filter(row => row.country === country && finite(row[key])).map(row => ({ date: row.date, value: row[key] })) };
  }
  function rowsMeta(id, groups) { const meta = chartRows.get(id); if (meta) meta.rows = groups; }
  function sourceLine(id, html) {
    const body = host.querySelector('#' + id)?.parentElement;
    if (!body) return;
    const footer = document.createElement('div'); footer.className = 'demography-chart-source'; footer.innerHTML = html; body.append(footer);
  }
  function categoryOption(names) {
    const option = baseOption(); delete option.dataZoom; delete option.legend;
    option.grid = { left: 105, right: 57, top: 28, bottom: 35 };
    option.xAxis = { ...option.yAxis, type: 'value', name: '', axisLabel: { ...option.yAxis.axisLabel, fontSize: 11 } };
    option.yAxis = { type: 'category', inverse: true, data: names, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: css('--muted'), fontSize: 11, width: 94, overflow: 'truncate' } };
    return option;
  }
  function drawRank(id, indicator, ids, { reference = null } = {}) {
    const day = year[region] + '-01-01';
    const rows = ids.map(country => ({ country, s: seriesFor(indicator, country), value: value(indicator, country) })).filter(row => finite(row.value)).sort((a, b) => b.value - a.value);
    if (!rows.length) return empty(id);
    const option = categoryOption(rows.map(row => countryName(row.country)));
    option.tooltip = { ...option.tooltip, trigger: 'item', formatter: p => `${esc(countryName(rows[p.dataIndex].country))} · ${year[region]}<br><strong>${fmt(p.value, 1)} ${esc(rows[p.dataIndex].s.unit)}</strong>` };
    option.series = [{ type: 'bar', barMaxWidth: 20, data: rows.map(row => ({ value: row.value, itemStyle: { color: row.country === selected[region] ? colors[0] : colors[2], opacity: row.country === selected[region] ? 1 : .65, borderRadius: [0, 3, 3, 0] } })),
      label: { show: true, position: 'right', color: css('--ink'), fontSize: 11, formatter: p => fmt(p.value, indicator === 'gdp_pc_ppp' ? 0 : 1) },
      ...(reference === null ? {} : { markLine: { silent: true, symbol: 'none', lineStyle: { color: css('--muted'), type: 'dashed' }, label: { formatter: 'EE.UU. = 100', color: css('--muted'), fontSize: 11 }, data: [{ xAxis: reference }] } }) }];
    rowsMeta(id, rows.map(row => ({ s: row.s, rows: [{ date: day, value: row.value }] })));
    own(chart(id, option));
    sourceLine(id, `<span>${rows.length}/${ids.length} economías · ${year[region]}</span><a href="${esc(rows[0].s.sourceUrl)}" target="_blank" rel="noopener">Banco Mundial ↗</a>`);
  }
  function drawAgeComparison(ids) {
    const day = year[region] + '-01-01';
    const rows = ids.map(country => ({ country, values: ageComposition(dataset.series, country, day) })).filter(row => row.values);
    if (!rows.length) return empty('demography-age-compare');
    const option = categoryOption(rows.map(row => countryName(row.country)));
    option.grid.right = 25; option.grid.top = 38;
    option.xAxis.max = 100; option.xAxis.axisLabel.formatter = value => value + '%';
    option.legend = { data: ['0–14', '15–64', '65+'], top: 3, left: 105, itemWidth: 11, itemHeight: 8, textStyle: { color: css('--muted'), fontSize: 11 } };
    option.tooltip = { ...option.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => {
      const row = rows[params[0].dataIndex]; return `${esc(countryName(row.country))} · ${year[region]}<br>${row.values.map((number, index) => `${['0–14 años', '15–64 años', '65 años o más'][index]}: <strong>${fmt(number, 1)}%</strong>`).join('<br>')}<br>Dependencia demográfica: <strong>${fmt(demographicDependency(row.values), 1)}</strong> por 100 de 15–64`;
    } };
    option.series = AGE_IDS.map((key, index) => ({ name: ['0–14', '15–64', '65+'][index], type: 'bar', stack: 'ages', barMaxWidth: 22, itemStyle: { color: colors[[2, 0, 3][index]] }, data: rows.map(row => row.values[index]), label: { show: true, color: '#fff', fontSize: 11, formatter: p => p.value > 9 ? fmt(p.value, 0) : '' } }));
    rowsMeta('demography-age-compare', rows.flatMap(row => AGE_IDS.map((id, index) => ({ s: seriesFor(id, row.country), rows: [{ date: day, value: row.values[index] }] }))));
    own(chart('demography-age-compare', option));
    sourceLine('demography-age-compare', `<span>Bandas excluyentes · total 100%</span><a href="https://data.worldbank.org/indicator/SP.POP.0014.TO.ZS" target="_blank" rel="noopener">ONU / Banco Mundial ↗</a>`);
  }
  function drawBigMac(ids) {
    const publication = latestBigMac(dataset.bigMac.observations, ids);
    const rows = publication.rows.filter(row => finite(row[bigMode])).sort((a, b) => b[bigMode] - a[bigMode]);
    if (!rows.length) return empty('demography-bigmac-rank');
    const option = categoryOption(rows.map(row => countryName(row.country)));
    option.grid.right = 57; option.xAxis.axisLabel.formatter = number => fmt(number, 0) + '%';
    option.tooltip = { ...option.tooltip, trigger: 'item', formatter: p => {
      const row = rows[p.dataIndex]; return `${esc(countryName(row.country))} · ${date(row.date, 'monthly')}<br><strong>${signed(row[bigMode])}</strong> · ${bigMode === 'raw' ? 'simple' : 'ajustado por ingreso'}<br>${fmt(row.localPrice, 2)} ${esc(row.currency)} · USD ${fmt(row.usdPrice, 2)}`;
    } };
    option.series = [{ type: 'bar', barMaxWidth: 20, data: rows.map(row => ({ value: row[bigMode], itemStyle: { color: row[bigMode] < 0 ? colors[2] : colors[3], opacity: row.country === selected[region] ? 1 : .65 } })),
      label: { show: true, position: 'right', color: css('--ink'), fontSize: 11, formatter: p => signed(p.value) },
      markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: css('--muted'), width: 1 }, data: [{ xAxis: 0 }] } }];
    rowsMeta('demography-bigmac-rank', rows.map(row => ({ s: bigSeries(row.country, bigMode), rows: [{ date: row.date, value: row[bigMode] }] })));
    own(chart('demography-bigmac-rank', option));
    sourceLine('demography-bigmac-rank', `<span>${date(publication.date, 'monthly')} · ${rows.length} economías</span><a href="${esc(dataset.bigMac.sourceUrl)}" target="_blank" rel="noopener">The Economist · CC BY 4.0 ↗</a>`);
  }
  async function render(nextRegion = 'peru', nextTarget = '#economic-topic') {
    region = nextRegion; target = nextTarget;
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!element) return;
    const ticket = ++renderVersion; host = element; controller?.abort(); release();
    if (!dataset) element.innerHTML = '<div class="demography-empty" role="status">Cargando población y poder adquisitivo…</div>';
    try { await load(); } catch (error) {
      if (ticket !== renderVersion || !element.isConnected) return;
      element.innerHTML = '<div class="demography-empty">No se pudo cargar esta publicación. <button class="btn" data-demography-retry>Reintentar</button></div>';
      element.querySelector('[data-demography-retry]').onclick = () => render(region, target); return;
    }
    if (ticket !== renderVersion || !element.isConnected || !dataset) return;
    const selectedCountry = selected[region];
    const availableYears = [...new Set((seriesFor('population')?.observations || []).map(row => row.date.slice(0, 4)))].sort().reverse();
    if (!availableYears.includes(year[region])) year[region] = availableYears.find(y => finite(value('gdp_pc_ppp', selectedCountry, y + '-01-01')) && ageComposition(dataset.series, selectedCountry, y + '-01-01')) || availableYears[0] || '';
    const day = year[region] + '-01-01', ages = ageComposition(dataset.series, selectedCountry, day);
    const referenceCountries = region === 'peru' ? ['PER', 'CHL', 'COL', 'BRA', 'MEX', 'ARG', 'USA'] : dataset.countries.filter(country => !country.aggregate).map(country => country.id);
    const ageCountries = region === 'peru' ? ['PER', 'CHL', 'COL', 'BRA', 'MEX', 'ARG', 'WLD'] : ['WLD', 'PER', 'USA', 'CHN', 'DEU', 'IND', 'JPN'];
    if (!ageCountries.includes(selectedCountry)) ageCountries.unshift(selectedCountry);
    const big = latestBigMac(dataset.bigMac.observations, [selectedCountry]);
    const recentBig = big.rows[0];
    const pop = value('population'), previousPop = value('population', selectedCountry, `${Number(year[region]) - 1}-01-01`);
    const dep = demographicDependency(ages), country = countryName(selectedCountry);
    const gp = indicator => dataset.indicators.find(i => i.id === indicator);
    const members = indicator => referenceCountries.map(id => seriesFor(indicator, id)).filter(Boolean);
    const ageDates = new Set((seriesFor('age_young')?.observations || []).filter(row => ageComposition(dataset.series, selectedCountry, row.date)).map(row => row.date));
    const ageSeries = AGE_IDS.map(id => history(seriesFor(id))).map(s => s ? { ...s, observations: s.observations.filter(row => ageDates.has(row.date)) } : null);
    const popSeries = scaleSeries(history(seriesFor('population')), 1e6, 'millones de personas');
    const realSeries = [history(seriesFor('gdp_pc_real')), history(seriesFor('gdp_pc_real', peer[region]))].filter(Boolean);
    const priceSeries = [history(seriesFor('price_level')), history(seriesFor('price_level', peer[region]))].filter(Boolean);
    const bigHistory = ['raw', 'adjusted'].map(key => bigSeries(selectedCountry, key));
    element.innerHTML = `<div class="demography-controls">${region === 'world' ? `<label>Economía<select id="demography-country">${dataset.countries.map(c => `<option value="${c.id}" ${c.id === selectedCountry ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}<label>Año de referencia<select id="demography-year">${availableYears.map(y => `<option ${y === year[region] ? 'selected' : ''}>${y}</option>`).join('')}</select></label><label>Comparar evolución con<select id="demography-peer">${dataset.countries.filter(c => c.id !== selectedCountry).map(c => `<option value="${c.id}" ${c.id === peer[region] ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><span class="demography-country-title">${esc(country)}</span></div>
      <section class="demography-kpis" aria-label="Indicadores de población y poder adquisitivo">${card('Población', finite(pop) ? fmt(pop / 1e6, 2) : '—', 'millones', year[region], finite(previousPop) && previousPop > 0 ? `YOY <b>${signed((pop / previousPop - 1) * 100)}</b>` : '')}${card('PBI per cápita', finite(value('gdp_pc_nominal')) ? fmt(value('gdp_pc_nominal'), 0) : '—', 'USD corrientes', year[region])}${card('PBI per cápita PPA', finite(value('gdp_pc_ppp')) ? fmt(value('gdp_pc_ppp'), 0) : '—', 'USD internacionales de 2021', year[region])}${card('Dependencia demográfica', finite(dep) ? fmt(dep, 1) : '—', 'por 100 personas de 15–64 años', year[region])}${card('Precios del consumo', finite(value('price_level')) ? fmt(value('price_level'), 1) : '—', 'EE.UU. = 100', year[region])}${card('Big Mac · índice simple', recentBig ? signed(recentBig.raw) : '—', 'frente a EE.UU.', recentBig ? date(big.date, 'monthly') : '', recentBig ? `${fmt(recentBig.localPrice, 2)} ${esc(recentBig.currency)} · USD ${fmt(recentBig.usdPrice, 2)}` : 'Sin dato para esta economía')}</section>
      <div class="demography-grid">${panel('demography-population', 'Población', `${esc(country)} · millones de personas`, [popSeries], { help: gp('population').description })}${panel('demography-income', 'PBI real per cápita', 'USD constantes de 2015', realSeries, { help: gp('gdp_pc_real').description })}${panel('demography-ages', 'Cómo cambia la estructura de edad', `${esc(country)} · % de la población`, ageSeries, { help: 'Bandas excluyentes que suman 100%. Son estimaciones demográficas de Naciones Unidas distribuidas por el Banco Mundial. La banda de 15–64 años no equivale a ocupados.' })}${panel('demography-age-compare', 'Distribución de la edad', `${year[region]} · % de la población`, ageCountries.flatMap(c => AGE_IDS.map(i => seriesFor(i, c))).filter(Boolean), { help: 'Dependencia demográfica = (población de 0–14 años + población de 65 años o más) / población de 15–64 años × 100. No mide dependencia económica ni empleo.' })}${panel('demography-ppp-rank', 'Producción por habitante comparable', `${year[region]} · USD internacionales de 2021`, members('gdp_pc_ppp'), { help: gp('gdp_pc_ppp').description })}${panel('demography-price-level', 'Cuánto cuesta una canasta comparable', 'Consumo de hogares · EE.UU. = 100', priceSeries, { help: gp('price_level').description })}</div>
      <div class="demography-section"><h2>Índice Big Mac</h2><div class="demography-segmented" role="group" aria-label="Método del índice Big Mac"><button class="btn ${bigMode === 'raw' ? 'active' : ''}" data-bigmac-mode="raw" aria-pressed="${bigMode === 'raw'}">Simple</button><button class="btn ${bigMode === 'adjusted' ? 'active' : ''}" data-bigmac-mode="adjusted" aria-pressed="${bigMode === 'adjusted'}">Ajustado por ingreso</button></div><span>The Economist · última publicación disponible</span></div>
      <div class="demography-grid">${panel('demography-bigmac-rank', 'Brecha frente a Estados Unidos', `${bigMode === 'raw' ? 'Índice simple' : 'Ajustado por ingreso'} · %`, referenceCountries.map(c => bigSeries(c, bigMode)), { help: 'Índice simple = (precio en USD / precio en USD en Estados Unidos − 1) × 100. El ajuste por ingreso usa el modelo publicado por The Economist; no se estima aquí. Positivo indica mayor precio relativo, negativo menor. Es un único producto, no una canasta completa. No es un objetivo de tipo de cambio.' })}${panel('demography-bigmac-history', 'Precio e ingreso: dos lecturas', `${esc(country)} · % frente a EE.UU.`, bigHistory, { help: 'The Economist cambió en julio de 2022 el precio de referencia estadounidense y el método del índice ajustado. La serie ajustada histórica puede revisarse. El índice simple y el ajustado responden a preguntas distintas.' })}</div>
      <div class="demography-footnote">Estimaciones demográficas: ONU / Banco Mundial. PBI por habitante ≠ ingreso personal. Big Mac mide un producto; el índice de consumo compara una canasta más amplia.</div>
      <details class="demography-method"><summary>Fuentes y metodología</summary><p>Los indicadores anuales usan el año elegido. Los gráficos históricos terminan en ese año; Big Mac mantiene su propia fecha de publicación. Un dato ausente no se sustituye por cero ni por el último de otro año.</p><p>PBI nominal: precios y tipos de cambio corrientes. PBI real: USD constantes de 2015. PPA: dólares internacionales constantes de 2021. Las bases no son intercambiables.</p><p>Dependencia demográfica: (0–14 + 65+) / 15–64 × 100. Las tres bandas se verifican contra 100% antes de mostrarse.</p><p>Big Mac: <a href="${esc(dataset.bigMac.sourceUrl)}" target="_blank" rel="noopener">The Economist</a> · <a href="${esc(dataset.bigMac.licenseUrl)}" target="_blank" rel="noopener">CC BY 4.0</a>. Adaptación: valores porcentuales y selección de países. <a href="${esc(dataset.bigMac.methodologyUrl)}" target="_blank" rel="noopener">Cambio metodológico de julio de 2022</a>. No es una recomendación ni una previsión de divisas.</p><div class="demography-source-links">${dataset.indicators.map(i => `<a href="${esc(i.sourceUrl)}" target="_blank" rel="noopener">${esc(i.name)} ↗</a>`).join('')}</div>${dataset.series.some(s => s.status === 'retained') || dataset.bigMac.status === 'retained' ? '<p>Parte de esta publicación conserva la última descarga válida; se reintentará en la próxima sincronización.</p>' : ''}</details>`;
    controller = new AbortController();
    element.addEventListener('change', event => {
      if (event.target.id === 'demography-country') { selected[region] = event.target.value; year[region] = ''; if (peer[region] === selected[region]) peer[region] = selected[region] === 'PER' ? 'CHL' : 'PER'; }
      else if (event.target.id === 'demography-peer') peer[region] = event.target.value;
      else if (event.target.id === 'demography-year') year[region] = event.target.value;
      else return;
      render(region, target);
    }, { signal: controller.signal });
    element.addEventListener('click', event => { const button = event.target.closest('[data-bigmac-mode]'); if (button && button.dataset.bigmacMode !== bigMode) { bigMode = button.dataset.bigmacMode; render(region, target); } }, { signal: controller.signal });
    own(timeChart('demography-population', [popSeries], { area: true, stats: false }));
    own(timeChart('demography-income', realSeries, { names: [country, countryName(peer[region])], stats: false }));
    const ageChart = own(timeChart('demography-ages', ageSeries, { stacked: true, stats: false }));
    ageChart?.setOption({ yAxis: [{ min: 0, max: 100 }] });
    drawAgeComparison(ageCountries);
    drawRank('demography-ppp-rank', 'gdp_pc_ppp', referenceCountries);
    own(timeChart('demography-price-level', priceSeries, { names: [country, countryName(peer[region])], stats: false, referenceLines: [{ value: 100, label: 'EE.UU. = 100' }] }));
    drawBigMac(referenceCountries);
    if (bigHistory.some(s => s.observations.length)) {
      own(timeChart('demography-bigmac-history', bigHistory, { stats: false, zero: true, lineStyles: ['solid', 'dashed'] }));
    } else empty('demography-bigmac-history', 'The Economist no publica el índice para esta selección.');
  }
  return { render, invalidate, dispose };
}
