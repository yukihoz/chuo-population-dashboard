const colors = ["#56a6f1", "#ff7daa", "#6fcf97", "#f2994a", "#8c52ff", "#ff5757"];
const metrics = {
  total: { label: "人口", unit: "人", get: (d) => d.total },
  households: { label: "世帯数", unit: "世帯", get: (d) => d.households },
  male: { label: "男性人口", unit: "人", get: (d) => d.male },
  female: { label: "女性人口", unit: "人", get: (d) => d.female },
  peoplePerHousehold: {
    label: "1世帯あたり人数",
    unit: "人/世帯",
    get: (d) => d.households ? d.total / d.households : 0,
    digits: 2,
  },
};

const agePopulationTypes = {
  total: { label: "総数", field: "total" },
  japanese: { label: "日本人", field: "japaneseTotal", fallback: "total" },
  foreign: { label: "外国人", field: "foreignTotal" },
};

const state = {
  data: null,
  metric: "total",
  area: "区全体",
  compare: [],
  areaNames: [],
  scale: "absolute",
  baseDate: "",
  startDate: "",
  endDate: "",
  rankMode: "increase",
  agePopulation: "total",
  dates: [],
  trendIndex: 0,
  ageDates: [],
  ageIndex: 0,
  trendTimer: null,
  ageTimer: null,
};

const fmt = new Intl.NumberFormat("ja-JP");
const monthFmt = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short" });

function $(id) {
  return document.getElementById(id);
}

function formatDate(value) {
  return monthFmt.format(new Date(value));
}

function formatValue(value, metricKey = state.metric) {
  const metric = metrics[metricKey];
  const digits = metric.digits ?? 0;
  return `${fmt.format(Number(value).toFixed(digits))}${metric.unit}`;
}

function buildAreaSeries(rows) {
  const byArea = new Map();
  for (const row of rows) {
    const key = row.name;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(row);
  }
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const totals = dates.map((date) => {
    const items = rows.filter((row) => row.date === date);
    return {
      date,
      name: "区全体",
      households: items.reduce((sum, row) => sum + row.households, 0),
      male: items.reduce((sum, row) => sum + row.male, 0),
      female: items.reduce((sum, row) => sum + row.female, 0),
      total: items.reduce((sum, row) => sum + row.total, 0),
    };
  });
  byArea.set("区全体", totals);
  for (const items of byArea.values()) {
    items.sort((a, b) => a.date.localeCompare(b.date));
  }
  return byArea;
}

function addTownSeries(areaSeries, rows) {
  const byTown = new Map();
  for (const row of rows) {
    const key = row.town;
    if (!key) continue;
    if (!byTown.has(key)) byTown.set(key, []);
    byTown.get(key).push({
      date: row.date,
      name: key,
      households: row.households,
      male: row.male,
      female: row.female,
      total: row.total,
      sourceOrder: row.sourceOrder,
    });
  }
  for (const [name, items] of byTown) {
    items.sort((a, b) => a.date.localeCompare(b.date));
    areaSeries.set(name, items);
  }
  return areaSeries;
}

function optionList(select, values, selected) {
  select.innerHTML = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = Array.isArray(selected) ? selected.includes(value) : selected === value;
    select.append(option);
  }
}

function initNavigation() {
  const sidebar = document.querySelector(".sidebar");
  const toggle = document.querySelector(".nav-toggle");
  if (!sidebar || !toggle) return;
  const icon = toggle.querySelector(".material-symbols-rounded");
  const close = () => {
    sidebar.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    if (icon) icon.textContent = "menu";
  };
  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
    if (icon) icon.textContent = open ? "close" : "menu";
  });
  document.querySelectorAll(".side-nav a").forEach((link) => {
    link.addEventListener("click", close);
  });
}

function initControls() {
  const names = areaNamesInSourceOrder();
  state.areaNames = names;
  optionList($("areaSelect"), names, state.area);

  $("metricSelect").addEventListener("change", (event) => {
    state.metric = event.target.value;
    syncMetricButtons();
    render();
  });
  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      $("metricSelect").value = state.metric;
      syncMetricButtons();
      render();
    });
  });
  $("areaSelect").addEventListener("change", (event) => {
    state.area = event.target.value;
    state.compare = state.compare.filter((name) => name !== state.area);
    syncAreaChips();
    renderCompareChips();
    renderSuggestions();
    render();
  });
  document.querySelectorAll("[data-area-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      const area = button.dataset.areaChip;
      if (!state.data.areaSeries.has(area)) return;
      state.area = area;
      $("areaSelect").value = state.area;
      state.compare = state.compare.filter((name) => name !== state.area);
      syncAreaChips();
      renderCompareChips();
      renderSuggestions();
      render();
    });
  });
  $("compareSearch").addEventListener("input", renderSuggestions);
  $("compareSearch").addEventListener("focus", renderSuggestions);
  $("compareSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addFirstSuggestion();
    }
    if (event.key === "Escape") closeSuggestions();
  });
  $("compareAdd").addEventListener("click", addFirstSuggestion);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".compare-builder")) closeSuggestions();
  });
  document.querySelectorAll("[data-scale]").forEach((button) => {
    button.addEventListener("click", () => {
      state.scale = button.dataset.scale;
      syncScaleButtons();
      renderBaseDateControl();
      renderTrend();
      renderAgeChart();
    });
  });
  document.querySelectorAll("[data-age-population]").forEach((button) => {
    button.addEventListener("click", () => {
      state.agePopulation = button.dataset.agePopulation;
      syncAgePopulationButtons();
      renderSelectionPopup();
      renderAgeChart();
    });
  });
  $("baseDateSelect").addEventListener("change", (event) => {
    state.baseDate = event.target.value;
    $("ageBaseDateSelect").value = state.baseDate;
    renderTrend();
    renderAgeChart();
  });
  $("ageBaseDateSelect").addEventListener("change", (event) => {
    state.baseDate = event.target.value;
    $("baseDateSelect").value = state.baseDate;
    $("ageBaseDateSelect").value = state.baseDate;
    renderTrend();
    renderAgeChart();
  });
  $("startDateSelect").addEventListener("change", (event) => {
    state.startDate = event.target.value;
    if (state.startDate > state.endDate) state.endDate = state.startDate;
    resetTrendToPeriodEnd();
    renderDateControls();
    renderKpis();
    renderTrend();
    renderRanking();
    renderSelectionPopup();
    syncAgeControls();
    renderAgeChart();
  });
  $("endDateSelect").addEventListener("change", (event) => {
    state.endDate = event.target.value;
    if (state.endDate < state.startDate) state.startDate = state.endDate;
    resetTrendToPeriodEnd();
    renderDateControls();
    renderKpis();
    renderTrend();
    renderRanking();
    renderSelectionPopup();
    syncAgeControls();
    renderAgeChart();
  });
  document.querySelectorAll("[data-rank-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.rankMode = button.dataset.rankMode;
      syncRankButtons();
      renderRanking();
    });
  });
  $("trendSlider").addEventListener("input", (event) => {
    state.trendIndex = Number(event.target.value);
    renderKpis();
    renderTrend();
  });
  $("trendPlay").addEventListener("click", toggleTrendPlayback);
  $("ageSlider").addEventListener("input", (event) => {
    state.ageIndex = Number(event.target.value);
    syncAgeControls();
    renderAgeChart();
  });
  $("agePlay").addEventListener("click", toggleAgePlayback);
  renderCompareChips();
  syncScaleButtons();
  syncRankButtons();
  syncAgePopulationButtons();
  syncAreaChips();
}

function syncMetricButtons() {
  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.classList.toggle("active", button.dataset.metric === state.metric);
  });
}

function syncScaleButtons() {
  document.querySelectorAll("[data-scale]").forEach((button) => {
    button.classList.toggle("active", button.dataset.scale === state.scale);
  });
}

function syncRankButtons() {
  document.querySelectorAll("[data-rank-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.rankMode === state.rankMode);
  });
}

function syncAgePopulationButtons() {
  document.querySelectorAll("[data-age-population]").forEach((button) => {
    button.classList.toggle("active", button.dataset.agePopulation === state.agePopulation);
  });
}

function syncAreaChips() {
  document.querySelectorAll("[data-area-chip]").forEach((button) => {
    button.classList.toggle("active", button.dataset.areaChip === state.area);
  });
}

function renderBaseDateOptions() {
  for (const id of ["baseDateSelect", "ageBaseDateSelect"]) {
    const select = $(id);
    optionList(select, state.dates, state.baseDate);
    for (const option of select.options) {
      option.textContent = formatDate(option.value);
    }
  }
  renderBaseDateControl();
}

function renderBaseDateControl() {
  document.querySelectorAll(".base-date-control").forEach((control) => {
    control.classList.toggle("visible", state.scale === "index");
  });
}

function defaultStartDate() {
  const end = state.dates.at(-1);
  if (!end) return "";
  const [year, month] = end.split("-").map(Number);
  const fiscalYear = month >= 4 ? year : year - 1;
  const targetText = `${fiscalYear - 10}-04-01`;
  return state.dates.find((date) => date >= targetText) ?? state.dates[0];
}

function visibleDates() {
  return state.dates.filter((date) => date >= state.startDate && date <= state.endDate);
}

function resetTrendToPeriodEnd() {
  state.trendIndex = Math.max(0, visibleDates().length - 1);
  state.ageIndex = Math.max(0, visibleDates().length - 1);
}

function renderDateControls() {
  for (const id of ["startDateSelect", "endDateSelect"]) {
    const select = $(id);
    const selected = id === "startDateSelect" ? state.startDate : state.endDate;
    optionList(select, state.dates, selected);
    for (const option of select.options) {
      option.textContent = formatDate(option.value);
    }
  }
}

function normalizeSearchText(value) {
  return value.trim().toLowerCase().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function comparisonCandidates() {
  const query = normalizeSearchText($("compareSearch").value);
  return state.areaNames
    .filter((name) => name !== "区全体" && name !== state.area && !state.compare.includes(name))
    .filter((name) => !query || normalizeSearchText(name).includes(query))
    .slice(0, 8);
}

function renderSuggestions() {
  const suggestions = comparisonCandidates();
  const box = $("compareSuggestions");
  box.innerHTML = suggestions.map((name) => `<button type="button" data-add-compare="${name}">${name}</button>`).join("");
  box.classList.toggle("open", suggestions.length > 0 && document.activeElement === $("compareSearch"));
  box.querySelectorAll("[data-add-compare]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => addComparison(button.dataset.addCompare));
  });
}

function closeSuggestions() {
  $("compareSuggestions").classList.remove("open");
}

function addFirstSuggestion() {
  const [name] = comparisonCandidates();
  if (name) addComparison(name);
}

function addComparison(name) {
  if (!name || state.compare.includes(name) || name === state.area || name === "区全体") return;
  state.compare = [...state.compare, name].slice(-5);
  $("compareSearch").value = "";
  renderCompareChips();
  renderSuggestions();
  render();
}

function removeComparison(name) {
  state.compare = state.compare.filter((item) => item !== name);
  renderCompareChips();
  renderSuggestions();
  render();
}

function renderCompareChips() {
  const box = $("compareChips");
  if (!state.compare.length) {
    box.innerHTML = `<span class="empty-chip">比較エリアなし</span>`;
    return;
  }
  box.innerHTML = state.compare.map((name) => `<button type="button" data-remove-compare="${name}">${name} ×</button>`).join("");
  box.querySelectorAll("[data-remove-compare]").forEach((button) => {
    button.addEventListener("click", () => removeComparison(button.dataset.removeCompare));
  });
}

function areaNamesInSourceOrder() {
  const latestDate = state.data.dateRange[1];
  const latestRows = state.data.areaChome
    .filter((row) => row.date === latestDate)
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  const names = ["区全体"];
  const seen = new Set(names);
  for (const row of latestRows) {
    if (!seen.has(row.name)) {
      names.push(row.name);
      seen.add(row.name);
    }
  }
  for (const name of state.data.areaSeries.keys()) {
    if (!seen.has(name)) names.push(name);
  }
  return names;
}

function renderKpis() {
  const series = state.data.areaSeries.get(state.area) ?? [];
  const dates = visibleDates();
  const activeDate = dates[state.trendIndex] ?? dates.at(-1);
  const active = series.find((row) => row.date === activeDate) ?? series.at(-1);
  $("latestTotal").textContent = active ? formatValue(active.total, "total") : "-";
  $("latestHouseholds").textContent = active ? formatValue(active.households, "households") : "-";
  $("latestPeoplePerHousehold").textContent = active ? formatValue(metrics.peoplePerHousehold.get(active), "peoplePerHousehold") : "-";
}

function shiftYear(date, delta) {
  if (!date) return "";
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + delta);
  return next.toISOString().slice(0, 10);
}

function signed(value, metricKey) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatValue(value, metricKey)}`;
}

function signedRate(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt.format(Number(value).toFixed(1))}%`;
}

function renderTrend() {
  const selected = [state.area, ...state.compare.filter((name) => name !== state.area)];
  const dates = visibleDates();
  if (state.trendIndex > dates.length - 1) state.trendIndex = Math.max(0, dates.length - 1);
  const activeDate = dates[state.trendIndex] ?? dates.at(-1);
  const series = selected
    .map((name, index) => ({
      name,
      color: colors[index % colors.length],
      rawValues: (state.data.areaSeries.get(name) ?? [])
        .filter((row) => row.date >= state.startDate && row.date <= state.endDate)
        .map((row) => ({
          date: row.date,
          value: metrics[state.metric].get(row),
        })),
    }))
    .map((item) => ({
      ...item,
      values: state.scale === "index" ? toIndexValues(item.rawValues, state.baseDate) : item.rawValues,
    }))
    .filter((item) => item.values.length);

  $("trendTitle").textContent = `${metrics[state.metric].label}の推移${state.scale === "index" ? `（${formatDate(state.baseDate)}=100）` : ""}`;
  $("trendLegend").innerHTML = "";
  $("trendSlider").max = Math.max(0, dates.length - 1);
  $("trendSlider").value = state.trendIndex;
  $("trendDateLabel").textContent = activeDate ? formatDate(activeDate) : "-";
  renderTrendReadout(series, activeDate);
  drawLineChart($("trendChart"), series, state.trendIndex);
}

function renderTrendReadout(series, date) {
  if (!date) {
    $("trendReadout").innerHTML = "";
    return;
  }
  const chips = series.map((item) => {
    const point = item.values.find((value) => value.date === date);
    const rawPoint = item.rawValues.find((value) => value.date === date);
    const label = point ? formatTrendValue(point.value) : "-";
    const rawLabel = rawPoint && state.scale === "index" ? ` (${formatValue(rawPoint.value)})` : "";
    return `<span><i style="background:${item.color}"></i>${item.name}: ${label}${rawLabel}</span>`;
  });
  $("trendReadout").innerHTML = [`<span>${formatDate(date)}</span>`, ...chips].join("");
}

function toIndexValues(values, baseDate) {
  const base = values.find((row) => row.date === baseDate)?.value || values[0]?.value;
  if (!base) return values.map((row) => ({ ...row, value: 0 }));
  return values.map((row) => ({ ...row, value: (row.value / base) * 100 }));
}

function formatTrendValue(value) {
  if (state.scale === "index") return `${fmt.format(Number(value).toFixed(1))}`;
  return formatValue(value);
}

function drawLineChart(svg, series, activeIndex) {
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 500;
  const margin = { top: 18, right: 22, bottom: 42, left: 70 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const all = series.flatMap((item) => item.values);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";
  if (!all.length) return;

  const dates = [...new Set(all.map((d) => d.date))].sort();
  const safeIndex = Math.min(Math.max(activeIndex ?? dates.length - 1, 0), dates.length - 1);
  const activeDate = dates[safeIndex];
  const min = Math.min(...all.map((d) => d.value));
  const max = Math.max(...all.map((d) => d.value));
  const pad = (max - min) * 0.08 || max * 0.08 || 1;
  const yMin = Math.max(0, min - pad);
  const yMax = max + pad;
  const x = (date) => margin.left + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * innerW;
  const y = (value) => margin.top + (1 - (value - yMin) / (yMax - yMin)) * innerH;

  for (let i = 0; i <= 4; i++) {
    const yy = margin.top + (i / 4) * innerH;
    const value = yMax - (i / 4) * (yMax - yMin);
    line(svg, margin.left, yy, margin.left + innerW, yy, "grid-line");
    text(svg, 10, yy + 4, compact(value), "tick");
  }
  line(svg, margin.left, margin.top, margin.left, margin.top + innerH, "axis");
  line(svg, margin.left, margin.top + innerH, margin.left + innerW, margin.top + innerH, "axis");

  const tickIndexes = [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  for (const index of [...new Set(tickIndexes)]) {
    text(svg, x(dates[index]) - 24, height - 12, formatDate(dates[index]), "tick");
  }

  const markerX = x(activeDate);
  line(svg, markerX, margin.top, markerX, margin.top + innerH, "marker-line");

  for (const item of series) {
    const visibleValues = item.values.filter((d) => dates.indexOf(d.date) <= safeIndex);
    const path = visibleValues.map((d, index) => `${index ? "L" : "M"}${x(d.date)},${y(d.value)}`).join(" ");
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", path);
    el.setAttribute("class", "line");
    el.setAttribute("stroke", item.color);
    svg.append(el);
    const activePoint = item.values.find((d) => d.date === activeDate);
    if (activePoint) {
      circle(svg, x(activeDate), y(activePoint.value), 8, item.color, "marker-dot");
    }
  }

  const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  hit.setAttribute("x", margin.left);
  hit.setAttribute("y", margin.top);
  hit.setAttribute("width", innerW);
  hit.setAttribute("height", innerH);
  hit.setAttribute("class", "hit-area");
  hit.addEventListener("click", (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - margin.left) / innerW));
    state.trendIndex = Math.round(ratio * (dates.length - 1));
    stopTrendPlayback();
    renderKpis();
    renderTrend();
  });
  svg.append(hit);
}

function renderRanking() {
  const metric = metrics[state.metric];
  const rows = [];
  for (const [name, series] of state.data.areaSeries) {
    if (name === "区全体" || !series.length) continue;
    const start = series.find((row) => row.date === state.startDate);
    const end = series.find((row) => row.date === state.endDate);
    if (!start || !end) continue;
    const startValue = metric.get(start);
    const endValue = metric.get(end);
    const change = endValue - startValue;
    const rate = startValue ? (change / startValue) * 100 : null;
    rows.push({
      name,
      change,
      rate,
    });
  }
  const rateMode = state.rankMode === "increaseRate" || state.rankMode === "decreaseRate";
  const ranked = rateMode ? rows.filter((row) => row.rate !== null && Number.isFinite(row.rate)) : rows;
  ranked.sort((a, b) => {
    if (state.rankMode === "decrease" || state.rankMode === "decreaseRate") {
      return (rateMode ? a.rate - b.rate : a.change - b.change);
    }
    return rateMode ? b.rate - a.rate : b.change - a.change;
  });
  const topRows = ranked.slice(0, 10);
  const maxMagnitude = Math.max(...topRows.map((row) => Math.abs(rateMode ? row.rate : row.change)), 1);
  const barColor = state.rankMode === "decrease" || state.rankMode === "decreaseRate" ? "#0cc0df" : "#ff5757";
  $("ranking").innerHTML = topRows.map((row, index) => {
    const value = rateMode ? row.rate : row.change;
    const width = Math.max(4, Math.abs(value) / maxMagnitude * 100);
    return `
    <li style="--rank-bar-width:${width}%; --rank-bar-color:${barColor};">
      <span class="rank-no">${index + 1}</span>
      <span class="rank-name">${row.name}</span>
      <span class="rank-bar" aria-hidden="true"><i></i></span>
      <span class="rank-value">${rateMode ? signedRate(row.rate) : signed(row.change, state.metric)}</span>
    </li>
  `;
  }).join("");
}

function renderAgeOptions() {
  state.ageDates = [...new Set(state.data.age.map((row) => row.date))].sort();
  state.ageIndex = visibleDates().length - 1;
  syncAgeControls();
}

function renderAgeChart() {
  const dates = visibleDates();
  if (state.ageIndex > dates.length - 1) state.ageIndex = Math.max(0, dates.length - 1);
  const activeDate = dates[state.ageIndex] ?? dates.at(-1);
  const series = buildAgeGroupSeries(dates);
  const displaySeries = series.map((item) => ({
    ...item,
    values: state.scale === "index" ? toIndexValues(item.rawValues, state.baseDate) : item.rawValues,
  }));
  document.querySelector(".age-panel h2").textContent = `年齢3区分の推移（${agePopulationTypes[state.agePopulation].label}）${state.scale === "index" ? `（${formatDate(state.baseDate)}=100）` : ""}`;
  $("ageDateLabel").textContent = activeDate ? formatDate(activeDate) : "-";
  renderAgeReadout(displaySeries, activeDate);
  drawLineChart($("ageChart"), displaySeries, state.ageIndex);
}

function syncAgeControls() {
  const dates = visibleDates();
  const date = dates[state.ageIndex] ?? dates.at(-1);
  $("ageSlider").max = Math.max(0, dates.length - 1);
  $("ageSlider").value = state.ageIndex;
  $("ageDateLabel").textContent = date ? formatDate(date) : "-";
}

function buildAgeGroupSeries(dates) {
  const population = agePopulationTypes[state.agePopulation];
  const groups = [
    { name: "年少人口", color: "#56A6F1", test: (age) => age <= 14 },
    { name: "生産年齢人口", color: "#FFD600", test: (age) => age >= 15 && age <= 64 },
    { name: "老年人口", color: "#FF7DAA", test: (age) => age >= 65 },
  ];
  const rowsByDate = new Map();
  for (const row of state.data.age) {
    if (dateInPeriod(row.date)) {
      if (!rowsByDate.has(row.date)) rowsByDate.set(row.date, []);
      rowsByDate.get(row.date).push(row);
    }
  }
  return groups.map((group) => ({
      name: group.name,
      color: group.color,
      rawValues: dates.map((date) => ({
        date,
        value: (rowsByDate.get(date) ?? [])
          .filter((row) => group.test(row.age))
          .reduce((sum, row) => sum + (row[population.field] ?? row[population.fallback] ?? 0), 0),
      })),
    }));
}

function dateInPeriod(date) {
  return date >= state.startDate && date <= state.endDate;
}

function renderAgeReadout(series, date) {
  if (!date) {
    $("ageReadout").innerHTML = "";
    return;
  }
  const chips = series.map((item) => {
    const point = item.values.find((value) => value.date === date);
    const rawPoint = item.rawValues.find((value) => value.date === date);
    const label = point ? formatTrendValue(point.value) : "-";
    const rawLabel = rawPoint && state.scale === "index" ? ` (${formatValue(rawPoint.value, "total")})` : "";
    return `<span><i style="background:${item.color}"></i>${item.name}: ${label}${rawLabel}</span>`;
  });
  $("ageReadout").innerHTML = [`<span>${formatDate(date)}</span>`, ...chips].join("");
}

function line(svg, x1, y1, x2, y2, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
  el.setAttribute("x1", x1);
  el.setAttribute("y1", y1);
  el.setAttribute("x2", x2);
  el.setAttribute("y2", y2);
  el.setAttribute("class", className);
  svg.append(el);
}

function circle(svg, cx, cy, r, fill, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  el.setAttribute("cx", cx);
  el.setAttribute("cy", cy);
  el.setAttribute("r", r);
  el.setAttribute("fill", className === "marker-dot" ? "#fff" : fill);
  if (className === "marker-dot") {
    el.setAttribute("stroke", fill);
  }
  el.setAttribute("class", className);
  svg.append(el);
}

function text(svg, x, y, value, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
  el.setAttribute("x", x);
  el.setAttribute("y", y);
  el.setAttribute("class", className);
  el.textContent = value;
  svg.append(el);
}

function toggleTrendPlayback() {
  if (state.trendTimer) {
    stopTrendPlayback();
    return;
  }
  const dates = visibleDates();
  if (state.trendIndex >= dates.length - 1) {
    state.trendIndex = 0;
    renderKpis();
    renderTrend();
  }
  $("trendPlay").textContent = "停止";
  state.trendTimer = window.setInterval(() => {
    const dates = visibleDates();
    if (state.trendIndex >= dates.length - 1) {
      stopTrendPlayback();
      return;
    }
    state.trendIndex += 1;
    renderKpis();
    renderTrend();
  }, 180);
}

function stopTrendPlayback() {
  if (!state.trendTimer) return;
  window.clearInterval(state.trendTimer);
  state.trendTimer = null;
  $("trendPlay").textContent = "再生";
}

function toggleAgePlayback() {
  if (state.ageTimer) {
    stopAgePlayback();
    return;
  }
  const dates = visibleDates();
  if (state.ageIndex >= dates.length - 1) {
    state.ageIndex = 0;
    syncAgeControls();
    renderAgeChart();
  }
  $("agePlay").textContent = "停止";
  state.ageTimer = window.setInterval(() => {
    const dates = visibleDates();
    if (state.ageIndex >= dates.length - 1) {
      stopAgePlayback();
      return;
    }
    state.ageIndex += 1;
    syncAgeControls();
    renderAgeChart();
  }, 170);
}

function stopAgePlayback() {
  if (!state.ageTimer) return;
  window.clearInterval(state.ageTimer);
  state.ageTimer = null;
  $("agePlay").textContent = "再生";
}

function compact(value) {
  if (state.scale === "index") return fmt.format(Number(value).toFixed(1));
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000) / 10}万`;
  return fmt.format(Math.round(value));
}

function renderSelectionPopup() {
  const popup = $("selectionPopup");
  popup.innerHTML = `
    <h2>表示条件</h2>
    <dl>
      <dt>指標</dt><dd>${metrics[state.metric].label}</dd>
      <dt>人口区分</dt><dd>${agePopulationTypes[state.agePopulation].label}</dd>
      <dt>地域</dt><dd title="${state.area}">${state.area}</dd>
      <dt>期間</dt><dd>${formatDate(state.startDate)} - ${formatDate(state.endDate)}</dd>
    </dl>
  `;
}

function render() {
  renderKpis();
  renderTrend();
  renderRanking();
  renderAgeChart();
  renderSelectionPopup();
}

async function boot() {
  const response = await fetch("data/chuo_population.json");
  const raw = await response.json();
  const areaSeries = addTownSeries(buildAreaSeries(raw.areaChome), raw.areaTown ?? []);
  state.data = {
    ...raw,
    areaSeries,
  };
  state.dates = [...new Set(raw.areaChome.map((row) => row.date))].sort();
  state.startDate = defaultStartDate();
  state.endDate = state.dates.at(-1);
  state.trendIndex = visibleDates().length - 1;
  state.baseDate = state.startDate;
  $("trendSlider").max = Math.max(0, state.dates.length - 1);
  $("dateRange").textContent = `${formatDate(raw.dateRange[0])} - ${formatDate(raw.dateRange[1])}`;
  initNavigation();
  initControls();
  renderDateControls();
  renderBaseDateOptions();
  renderAgeOptions();
  render();
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="app"><h1>データを読み込めませんでした</h1><p>${error.message}</p></main>`;
});
