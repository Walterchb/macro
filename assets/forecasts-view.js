/** Official annual projections: source vintage, observation status and units stay attached. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const yearOf = value => Number(String(value).slice(0, 4));
const stamp = year => Date.UTC(Number(year), 0, 1);
const annual = year => `${year}-01-01`;
const observed = row => row.status === 'observed';
const forecast = row => row.status === 'forecast';

/** Split the line at the source's observation boundary; an adjacent actual anchors the dashed leg. */
export function forecastSegments(series) {
  const rows = (series?.observations || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const known = rows.filter(row => finite(row.value) && observed(row));
  const projected = rows.filter(row => finite(row.value) && forecast(row));
  const first = projected[0];
  const anchor = first && known.find(row => yearOf(row.date) === yearOf(first.date) - 1);
  const start = rows.length ? yearOf(rows[0].date) : null;
  const end = rows.length ? yearOf(rows.at(-1).date) : null;
  const values = new Map(rows.map(row => [yearOf(row.date), row]));
  const historical = [], outlook = [];
  for (let year = start; start !== null && year <= end; year++) {
    const row = values.get(year);
    historical.push([stamp(year), observed(row || {}) && finite(row.value) ? row.value : null]);
    outlook.push([stamp(year), row && finite(row.value) && (forecast(row) || row === anchor) ? row.value : null]);
  }
  return { historical, outlook, firstForecast: first?.date || null, anchor: anchor?.date || null, rows };
}

/** A derived volume path, not an official GDP level. Never compound across a missing annual rate. */
export function forecastIndex(series, baseYear) {
  const base = series?.observations?.find(row => yearOf(row.date) === baseYear && finite(row.value));
  if (!base || !observed(base)) return null;
  const map = new Map(series.observations.map(row => [yearOf(row.date), row]));
  const end = Math.max(...map.keys());
  let level = 100;
  const observations = [{ ...base, date: annual(baseYear), value: 100 }];
  for (let year = baseYear + 1; year <= end; year++) {
    const row = map.get(year);
    level = finite(level) && finite(row?.value) && row.value > -100 ? level * (1 + row.value / 100) : null;
    observations.push({ ...(row || {}), date: annual(year), value: level, status: row?.status || 'missing' });
  }
  return { ...series, id: `${series.id}_path`, sourceCode: `${series.sourceCode || series.id} · cálculo`,
    name: 'Trayectoria del PBI real', unit: `Índice ${baseYear} = 100`, derived: 'forecast_path',
    description: `Cálculo a partir del crecimiento real anual del MEF: índice del año anterior × (1 + crecimiento YOY / 100). Base ${baseYear} = 100. No es el nivel oficial del PBI ni un escenario adicional. Una tasa anual faltante interrumpe la trayectoria.`, observations };
}

export function projectionDelta(series, year, referenceYear) {
  const current = series?.observations?.find(row => yearOf(row.date) === Number(year));
  const reference = series?.observations?.find(row => yearOf(row.date) === Number(referenceYear));
  return finite(current?.value) && finite(reference?.value) ? current.value - reference.value : null;
}

const GROUPS = [['all', 'Todos'], ['activity', 'Actividad'], ['fiscal', 'Fiscal'], ['external', 'Sector externo'], ['sectors', 'Sectores'], ['assumptions', 'Entorno']];
const PRIMARY = ['gdp_growth', 'private_consumption', 'private_investment', 'fiscal_balance', 'public_debt', 'current_account'];
const SHORT_NAMES = { gdp_growth: 'PBI real', private_consumption: 'Consumo privado', private_investment: 'Inversión privada', fiscal_balance: 'Resultado fiscal', public_debt: 'Deuda pública', current_account: 'Cuenta corriente' };

export function createForecastView(ctx) {
  const { esc, fmt, date, panel, chart, baseOption, chartRows, colors, css, theme } = ctx;
  let dataset = null, pending = null, cacheGeneration = 0, renderGeneration = 0;
  let host = null, controller = null, ownedCharts = [], selectedYear = '', tableGroup = 'all';
  let selector = '#economic-topic';
  const seriesFor = id => dataset?.series.find(s => s.id === id);
  const rowFor = (s, year = selectedYear) => s?.observations.find(o => yearOf(o.date) === Number(year));
  const shortUnit = unit => String(unit || '').replace('% del PBI', '% PBI').replace('USD millones', 'US$ MM').replace('US$ millones', 'US$ MM').replace('S/ miles de millones', 'S/ mil MM');
  const signed = value => `${value > 0 ? '+' : ''}${fmt(value, 1)}`;
  const vintage = () => dataset.vintage || dataset.source?.title || 'Edición oficial';
  const published = () => dataset.publishedAt || dataset.publicationDate || '';
  const sourceUrl = () => dataset.source?.documentUrl || dataset.source?.url;
  const baselineYear = () => Math.max(...dataset.series.flatMap(s => s.observations.filter(o => observed(o) && finite(o.value)).map(o => yearOf(o.date))));
  const projectionYears = () => [...new Set(dataset.series.flatMap(s => s.observations.filter(o => forecast(o) && finite(o.value)).map(o => yearOf(o.date))))].sort((a, b) => a - b);
  const validSeries = ids => ids.map(seriesFor).filter(s => s && s.observations.some(o => finite(o.value)));

  async function load() {
    if (dataset) return;
    if (!pending) {
      const generation = cacheGeneration;
      pending = Promise.resolve(ctx.fetchData ? ctx.fetchData() : fetch('./data/forecasts.json', { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`Proyecciones: HTTP ${r.status}`); return r.json();
      })).then(data => {
        if (generation !== cacheGeneration) return;
        if (!Array.isArray(data.series) || !data.series.length || !data.source?.url || !data.vintage) throw new Error('Publicación de proyecciones incompleta.');
        if (!data.series.every(s => s.frequency === 'annual' && Array.isArray(s.observations) && s.observations.every(o => /^\d{4}-01-01$/.test(o.date) && ['observed', 'forecast'].includes(o.status)))) throw new Error('Periodos o estados de proyección inválidos.');
        dataset = { ...data, series: data.series.map(s => ({ ...s, provider: s.provider || data.source.name || 'MEF', primarySource: s.primarySource || data.source.name || 'MEF', sourceCode: s.sourceCode || s.id,
          country: 'PER', countryName: 'Perú', vintage: s.vintage || data.vintage, publicationDate: s.publicationDate || data.publishedAt || data.publicationDate,
          sourceUrl: s.sourceUrl || data.source.documentUrl || data.source.url, description: s.description || s.definition || s.name,
          observations: s.observations.slice().sort((a, b) => a.date.localeCompare(b.date)).map(o => ({ ...o, vintage: o.vintage || s.vintage || data.vintage, provider: o.provider || s.provider || data.source.name || 'MEF', sourceUrl: o.sourceUrl || s.sourceUrl || data.source.documentUrl || data.source.url })) })) };
        const years = projectionYears();
        if (!years.includes(Number(selectedYear))) selectedYear = String(years.find(y => y >= new Date().getUTCFullYear()) || years[0] || '');
      }).finally(() => { if (generation === cacheGeneration) pending = null; });
    }
    await pending;
  }

  function releaseCharts() {
    ownedCharts.forEach(c => { if (c && !c.isDisposed?.()) c.dispose(); }); ownedCharts = [];
    ['forecast-growth', 'forecast-path', 'forecast-sectors', 'forecast-fiscal', 'forecast-debt', 'forecast-trade'].forEach(id => chartRows.delete(id));
  }
  function dispose() { renderGeneration++; controller?.abort(); controller = null; releaseCharts(); host = null; }
  function invalidate() { cacheGeneration++; dataset = null; pending = null; }
  function track(id, option) { const c = chart(id, option); if (c) ownedCharts.push(c); return c; }
  function redraw() { if (host?.isConnected) return render(selector); }
  function meta(id, ss, rows = null) {
    const config = chartRows.get(id);
    if (config) { config.rows = rows || ss.map(s => ({ s, rows: s.observations })); config.exportNote = `${vintage()} · histórico continuo / proyección discontinua`; }
  }
  function section(id, title, subtitle, ss, help) {
    if (!ss.length) return '';
    return panel(id, title, subtitle, ss, { help: esc(help || ss.map(s => s.description).join(' ')) });
  }
  function cards() {
    const reference = baselineYear();
    return `<section class="forecast-kpis" aria-label="Proyecciones de referencia para ${selectedYear}">${validSeries(PRIMARY).map(s => {
      const row = rowFor(s), delta = projectionDelta(s, selectedYear, reference);
      return `<article class="forecast-kpi"><div><span>${esc(SHORT_NAMES[s.id] || s.name)}</span><small>${selectedYear} P</small></div><strong>${fmt(row?.value, 1)}<small>${esc(shortUnit(s.unit))}</small></strong><span class="forecast-kpi-delta">${finite(delta) ? `<b>${delta>0?'+':''}${fmt(delta,2)} pp</b> vs. ${reference}` : `Sin dato comparable en ${reference}`}</span></article>`;
    }).join('')}</section>`;
  }
  function groupFor(series) {
    if (GROUPS.some(([g]) => g === series.group)) return series.group;
    return 'assumptions';
  }
  function renderTable() {
    const element = host?.querySelector('#forecast-table'); if (!element) return;
    const years = [...new Set(dataset.series.flatMap(s => s.observations.map(o => yearOf(o.date))))].filter(y => y >= baselineYear()).sort((a, b) => a - b);
    const yearsForecast = projectionYears();
    const ss = dataset.series.filter(s => tableGroup === 'all' || groupFor(s) === tableGroup);
    element.innerHTML = `<table><thead><tr><th>Indicador</th><th>Unidad</th>${years.map(y => `<th class="numeric ${yearsForecast.includes(y) ? 'forecast-column' : ''} ${y === Number(selectedYear) ? 'forecast-selected' : ''}">${y}${yearsForecast.includes(y) ? ' P' : ''}</th>`).join('')}</tr></thead><tbody>${ss.map(s => `<tr><th scope="row" title="${esc(s.description)}">${esc(s.name)}${s.nature === 'assumption' ? '<small class="forecast-assumption">Supuesto</small>' : ''}</th><td>${esc(shortUnit(s.unit))}</td>${years.map(y => { const row = rowFor(s, y); return `<td class="numeric ${forecast(row || {}) ? 'forecast-column' : ''} ${y === Number(selectedYear) ? 'forecast-selected' : ''}" title="${esc(row?.status === 'forecast' ? `${s.nature === 'assumption' ? 'Supuesto del escenario' : 'Proyección'} · ${vintage()}` : row?.status === 'observed' ? `Histórico MEF · ${vintage()}` : 'Sin dato')}">${fmt(row?.value, 1)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    host.querySelectorAll('[data-forecast-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.forecastGroup === tableGroup)));
  }
  function downloadTable() {
    const rows = [['indicador', 'codigo', 'fecha', 'valor', 'unidad', 'estado_dato', 'naturaleza', 'edicion_proyeccion', 'publicado', 'fuente', 'url', 'definicion']];
    dataset.series.filter(s => tableGroup === 'all' || groupFor(s) === tableGroup).forEach(s => s.observations.filter(o => yearOf(o.date) >= baselineYear()).forEach(o => rows.push([s.name, s.sourceCode, o.date, o.value ?? '', s.unit, o.status, s.nature || 'forecast', o.vintage || s.vintage, o.publicationDate || s.publicationDate, o.provider || s.provider, o.sourceUrl || s.sourceUrl, s.description])));
    const content = '\ufeff' + rows.map(r => r.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `treasury-macro-proyecciones-${tableGroup}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function render(target = '#economic-topic') {
    selector = target; const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    const ticket = ++renderGeneration; host = el; controller?.abort(); releaseCharts();
    if (!dataset) el.innerHTML = '<div class="forecast-loading" role="status">Cargando proyecciones oficiales…</div>';
    try { await load(); } catch (error) {
      if (ticket !== renderGeneration || !el.isConnected) return;
      el.innerHTML = '<section class="panel forecast-error"><h2>Proyecciones del Perú</h2><p>No se pudo cargar la publicación oficial.</p><button data-forecast-retry>Reintentar</button></section>';
      el.querySelector('[data-forecast-retry]').onclick = () => render(target); return;
    }
    if (ticket !== renderGeneration || !el.isConnected || !dataset) return;
    const years = projectionYears(), baseYear = baselineYear();
    const growth = validSeries(['gdp_growth', 'domestic_demand']);
    const path = forecastIndex(seriesFor('gdp_growth'), baseYear);
    const sectorSeries = dataset.series.filter(s => s.group === 'sectors');
    const fiscal = validSeries(['fiscal_balance', 'primary_balance']), debt = validSeries(['public_debt']), trade = validSeries(['exports', 'imports']);
    const lastPath = path?.observations.filter(o => finite(o.value)).at(-1);
    const availableGroups = GROUPS.filter(([key]) => key === 'all' || dataset.series.some(s => groupFor(s) === key));
    el.innerHTML = `<section class="forecast-view">
      <div class="forecast-toolbar"><div class="forecast-edition"><a href="${esc(sourceUrl())}" target="_blank" rel="noopener"><strong>MEF · ${esc(vintage())}</strong><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a><span>Publicado ${published() ? esc(date(published().slice(0, 10), 'daily')) : 'en la fuente'}${dataset.status === 'retained' ? ' · última edición verificada' : ''}</span></div><div class="forecast-selectors"><label>Año de referencia<select id="forecast-year">${years.map(y => `<option value="${y}" ${String(y) === selectedYear ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div></div>
      ${cards()}
      <div class="forecast-key"><span><i class="forecast-solid"></i>Histórico</span><span><i class="forecast-dashed"></i>Proyección oficial</span><span><i class="forecast-shaded"></i>${years[0]}–${years.at(-1)}</span></div>
      <div class="forecast-chart-grid">
      ${section('forecast-growth', 'Crecimiento y demanda interna', 'Variación anual · % YOY', growth)}
      ${path ? section('forecast-path', 'Trayectoria del PBI real', `${baseYear} = 100 · ${finite(lastPath?.value) ? signed(lastPath.value - 100) + '% acumulado a ' + yearOf(lastPath.date) : 'cálculo derivado'}`, [path], path.description) : ''}
      ${section('forecast-sectors', 'Proyección por sector', `${selectedYear} frente a ${baseYear} · % YOY`, sectorSeries, 'Variaciones del valor agregado real anual por sector, según el MEF. Son tasas de crecimiento, no contribuciones al crecimiento agregado. Se compara el mismo indicador de una única edición.')}
      ${section('forecast-fiscal', 'Balance fiscal', 'Sector público no financiero · % PBI', fiscal)}
      ${section('forecast-debt', 'Deuda pública', 'Saldo · % PBI', debt)}
      ${section('forecast-trade', 'Comercio exterior', 'Exportaciones e importaciones de bienes · US$ MM', trade)}
      </div>
      <section class="panel forecast-table-panel"><div class="forecast-table-head"><div><h2>Escenario oficial</h2><span>P: proyección · histórico sujeto a revisión</span></div><button data-forecast-csv><i class="fa-solid fa-download" aria-hidden="true"></i> CSV</button></div><div class="forecast-table-tabs" aria-label="Grupo de proyecciones">${availableGroups.map(([id, label]) => `<button data-forecast-group="${id}" aria-pressed="${tableGroup === id}">${label}</button>`).join('')}</div><div id="forecast-table" class="table-scroll"></div></section>
      <details class="forecast-method"><summary>Fuente y metodología</summary><p>Escenario del <a href="${esc(sourceUrl())}" target="_blank" rel="noopener">${esc(vintage())} · MEF</a>, publicado ${published() ? esc(date(published().slice(0, 10), 'daily')) : 'en la fuente'}. La tabla muestra los años de esta edición. Cuando el gráfico del PBI incorpora historia anterior del Banco Mundial, la fuente se identifica por año y puede tener revisiones distintas. La fecha de descarga no cambia la fecha de publicación del escenario.</p><p>El sombreado identifica años proyectados; no representa un intervalo de confianza. El índice de PBI se calcula encadenando las tasas reales anuales desde ${baseYear} = 100. Las diferencias entre porcentajes se expresan en puntos porcentuales (pp).</p><div>${dataset.source?.dataUrl ? `<a href="${esc(dataset.source.dataUrl)}" target="_blank" rel="noopener">Cuadros oficiales · Excel</a>` : ''}<a href="${esc(dataset.source.url)}" target="_blank" rel="noopener">Publicación MEF</a></div></details>
      </section>`;
    controller = new AbortController();
    el.addEventListener('change', event => { if (event.target.id === 'forecast-year') { selectedYear = event.target.value; redraw(); } }, { signal: controller.signal });
    el.addEventListener('click', event => {
      const button = event.target.closest('[data-forecast-group],[data-forecast-csv]'); if (!button) return;
      if (button.dataset.forecastGroup) { tableGroup = button.dataset.forecastGroup; renderTable(); }
      else downloadTable();
    }, { signal: controller.signal });
    lineChart('forecast-growth', growth);
    if (path) lineChart('forecast-path', [path], { index: true });
    sectorChart(sectorSeries, baseYear);
    lineChart('forecast-fiscal', fiscal, { zero: true });
    lineChart('forecast-debt', debt);
    lineChart('forecast-trade', trade);
    renderTable();
  }

  function lineChart(id, ss, { index = false, zero = false } = {}) {
    if (!ss.length || !host?.querySelector(`#${id}`)) return;
    const lastObserved = Math.max(...ss.flatMap(s => s.observations.filter(observed).map(o => yearOf(o.date))));
    const historyWindow = typeof ctx.range === 'function' ? ctx.range() : '5';
    const visible = ss.map(s => ({ ...s, observations: s.observations.filter(o => historyWindow === 'all' || forecast(o) || yearOf(o.date) >= lastObserved - Number(historyWindow)) }));
    const option = baseOption(), dates = visible.flatMap(s => s.observations.map(o => o.date)).sort();
    const firstForecast = ss.flatMap(s => s.observations.filter(forecast).map(o => o.date)).sort()[0];
    const last = dates.at(-1), shadeStart = firstForecast && Date.parse(firstForecast + 'T00:00:00Z');
    const palette = [theme() ? '#71d2dd' : css('--navy3'), colors[3], colors[2]];
    delete option.dataZoom;
    option.grid = { left: 54, right: 48, top: 49, bottom: 34 };
    option.legend = { ...option.legend, top: 5, data: ss.map(s => s.name), selectedMode: false, itemHeight: 3, itemWidth: 15 };
    option.xAxis = { ...option.xAxis, min: Date.parse(dates[0] + 'T00:00:00Z'), max: Date.parse(last + 'T00:00:00Z'), splitNumber: 6, minInterval: 365 * 86400000, axisLabel: { ...option.xAxis.axisLabel, formatter: value => String(new Date(value).getUTCFullYear()) } };
    option.yAxis = { ...option.yAxis, scale: !zero, splitNumber: 4, name: index ? 'Índice' : shortUnit(ss[0].unit), nameTextStyle: { fontSize: 11, color: css('--muted') } };
    option.series = visible.flatMap((s, i) => {
      const segments = forecastSegments(s), color = palette[i % palette.length];
      const common = { name: s.name, type: 'line', showSymbol: true, symbol: 'circle', symbolSize: 5, connectNulls: false, itemStyle: { color }, emphasis: { focus: 'series' } };
      return [{ ...common, id: `${id}-${i}-observed`, data: segments.historical, lineStyle: { width: 2.1, color }, symbolSize: 6,
        markArea: i === 0 && shadeStart ? { silent: true, itemStyle: { color: theme() ? '#71d2dd0d' : '#0d657d09' }, data: [[{ xAxis: shadeStart }, { xAxis: Date.parse(last + 'T00:00:00Z') }]] } : undefined,
        markLine: zero && i === 0 ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: css('--muted'), type: 'solid', width: 1 }, data: [{ yAxis: 0 }] } : undefined },
      { ...common, id: `${id}-${i}-forecast`, data: segments.outlook, symbol: 'emptyCircle', symbolSize: 6, lineStyle: { width: 2.1, type: 'dashed', color },
        endLabel: { show: true, formatter: p => finite(p.value?.[1]) ? fmt(p.value[1], 1) : '', color, fontSize: 11, fontWeight: 650, backgroundColor: css('--panel'), padding: [2, 3] }, labelLayout: { moveOverlap: 'shiftY', hideOverlap: true } }];
    });
    option.tooltip.formatter = params => {
      const items = (Array.isArray(params) ? params : [params]).filter(p => Array.isArray(p.value) && finite(p.value[1]));
      if (!items.length) return '';
      const year = new Date(items[0].value[0]).getUTCFullYear();
      return `<strong>${year}</strong>` + ss.map((s, i) => {
        const row = rowFor(s, year); if (!finite(row?.value)) return '';
        return `<div class="forecast-tooltip-row"><span><i style="background:${palette[i % palette.length]}"></i>${esc(s.name)}</span><b>${fmt(row.value, 2)} ${esc(shortUnit(s.unit))}</b><small>${row.status === 'forecast' ? s.nature === 'assumption' ? 'Supuesto del escenario' : 'Proyección' : 'Histórico'} · ${esc(row.provider || s.provider)}${index ? ' · índice calculado' : ''} · ${esc(row.vintage || s.vintage)}</small></div>`;
      }).join('');
    };
    meta(id, ss, visible.map(s => ({ s, rows: s.observations }))); track(id, option);
    const footer = document.createElement('div'); footer.className = 'forecast-chart-foot';
    footer.innerHTML = ss.map(s => { const row = rowFor(s); return `<span>${esc(s.name)} <b>${fmt(row?.value, 1)}</b> <small>${selectedYear} P</small></span>`; }).join('');
    host.querySelector(`#${id}`).after(footer);
    const spliced = ss.filter(s => s.observations.some(o => o.provider && o.provider !== s.provider));
    if (spliced.length) {
      const note = document.createElement('p'); note.className = 'forecast-splice-note';
      note.innerHTML = spliced.map(s => esc(s.sourceSummary || 'Historia anterior: Banco Mundial; últimos datos y proyecciones: MEF.')).join(' · ');
      footer.after(note);
      const config = chartRows.get(id); if (config) config.exportNote += ' · histórico previo Banco Mundial';
    }
  }

  function sectorChart(ss, baseYear) {
    if (!ss.length || !host?.querySelector('#forecast-sectors')) return;
    const rows = ss.filter(s => finite(rowFor(s)?.value)).sort((a, b) => rowFor(a).value - rowFor(b).value);
    const option = baseOption(); delete option.dataZoom;
    const color = theme() ? '#71d2dd' : css('--navy3');
    option.legend = { ...option.legend, data: [`${baseYear} histórico`, `${selectedYear} proyección`], selectedMode: false, top: 4 };
    option.grid = { left: 113, right: 51, top: 39, bottom: 27 };
    option.xAxis = { ...option.yAxis, type: 'value', axisLabel: { ...option.yAxis.axisLabel, formatter: value => fmt(value, 0) + '%' } };
    option.yAxis = { type: 'category', data: rows.map(s => s.shortName || s.name.replace(/^PBI\s*[·:–-]?\s*/i, '')), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: css('--muted'), fontSize: 11, width: 104, overflow: 'truncate' } };
    option.series = [{ name: `${baseYear} histórico`, type: 'bar', barMaxWidth: 7, itemStyle: { color: theme() ? '#6c8391' : '#adbdc6', borderRadius: [0, 2, 2, 0] }, data: rows.map(s => rowFor(s, baseYear)?.value ?? null) },
      { name: `${selectedYear} proyección`, type: 'bar', barMaxWidth: 9, itemStyle: { color: theme() ? '#71d2dd22' : '#0d657d15', borderColor: color, borderWidth: 1.5, borderType: 'dashed', borderRadius: [0, 2, 2, 0] }, data: rows.map(s => rowFor(s)?.value ?? null), label: { show: true, position: 'right', formatter: p => fmt(p.value, 1), color: css('--ink'), fontSize: 11 } }];
    option.tooltip = { ...option.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => {
      const values = Array.isArray(params) ? params : [params]; const s = rows[values[0]?.dataIndex]; if (!s) return '';
      return `<strong>${esc(s.name)}</strong><br>${values.filter(p => finite(p.value)).map(p => `${p.marker}${esc(p.seriesName)}: <b>${fmt(p.value, 1)}% YOY</b>`).join('<br>')}`;
    } };
    meta('forecast-sectors', rows, rows.map(s => ({ s, rows: s.observations.filter(o => [baseYear, Number(selectedYear)].includes(yearOf(o.date))) })));
    const config = chartRows.get('forecast-sectors'); if (config) config.exportNote = `${vintage()} · ${baseYear} histórico / ${selectedYear} proyección`;
    track('forecast-sectors', option);
  }

  return { render, invalidate, dispose };
}
