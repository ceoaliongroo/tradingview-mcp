/**
 * Core streaming logic — real-time JSONL output from TradingView.
 * Uses efficient poll + dedup: only emits when data changes.
 */
import { evaluate } from '../connection.js';
import { getState as getChartState } from './chart.js';
import { getDemarkSnapshot } from './data.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
const MODEL = `${CHART_API}._chartWidget.model()`;

/**
 * Generic poll-and-diff loop.
 * Calls fetcher(), compares to last value, emits JSONL on change.
 * Writes to stdout directly for pipe-friendliness.
 */
async function pollLoop(fetcher, { interval = 500, dedupe = true, label = 'stream' } = {}) {
  let lastHash = null;
  let running = true;

  const cleanup = () => { running = false; };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Emit header with compliance notice
  const start = Date.now();
  process.stderr.write(`\u26A0  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or any AI provider.\n`);
  process.stderr.write(`   Streams from your locally running TradingView Desktop instance only.\n`);
  process.stderr.write(`   Does not connect to TradingView servers. Requires --remote-debugging-port=9222.\n`);
  process.stderr.write(`   Ensure your usage complies with TradingView's Terms of Use.\n`);
  process.stderr.write(`[stream:${label}] started, interval=${interval}ms, Ctrl+C to stop\n`);

  while (running) {
    try {
      const data = await fetcher();
      if (!data) { await sleep(interval); continue; }

      const hash = dedupe ? JSON.stringify(data) : null;
      if (!dedupe || hash !== lastHash) {
        lastHash = hash;
        const line = JSON.stringify({ ...data, _ts: Date.now(), _stream: label });
        process.stdout.write(line + '\n');
      }
    } catch (err) {
      // Connection errors — retry silently
      if (/CDP|ECONNREFUSED/i.test(err.message)) {
        await sleep(2000);
        continue;
      }
      process.stderr.write(`[stream:${label}] error: ${err.message}\n`);
    }
    await sleep(interval);
  }

  process.stderr.write(`[stream:${label}] stopped after ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function useAnsi() {
  return !!process.stdout.isTTY && process.env.NO_COLOR !== '1';
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  brightGreen: '\x1b[92m',
  brightRed: '\x1b[91m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightCyan: '\x1b[96m',
};

function paint(text, code) {
  if (!useAnsi() || !code) return String(text ?? '');
  return `${code}${text}${ANSI.reset}`;
}

function typeColor(type, direction) {
  if (type === 'setup') return direction === 'sell' ? ANSI.brightGreen : ANSI.green;
  if (type === 'sequential') return direction === 'sell' ? ANSI.brightRed : ANSI.red;
  if (type === 'combo') return direction === 'sell' ? ANSI.brightBlue : ANSI.blue;
  if (type === 'indicator') return ANSI.yellow;
  return ANSI.dim;
}

function formatTimeLabel(snapshot) {
  const time = snapshot?.time?.israel || snapshot?.time?.utc || null;
  if (!time) return 'time=?';
  return `time=${time}`;
}

function formatDemarkLine(snapshot) {
  const barIndex = snapshot?.bar_index ?? snapshot?.chart_bar_index ?? '?';
  const labels = Array.isArray(snapshot?.labels) ? snapshot.labels : [];
  const prefix = `${paint('[DMK]', ANSI.bold)} ${paint(formatTimeLabel(snapshot), ANSI.dim)} ${paint(`bar_index=${barIndex}`, ANSI.cyan)}`;

  if (labels.length === 0) {
    return `${prefix} ${paint('sin conteo', ANSI.dim)}`;
  }

  const chunks = [];
  const seenMarkers = new Set();

  for (const label of labels) {
    const type = label?.resolved_count_type || label?.count_type || 'indicator';
    const direction = label?.direction || 'unknown';
    const count = label?.count_value != null ? label.count_value : (label?.text ?? '').trim();

    if (type === 'indicator') {
      if (label?.is_perfect_setup && !seenMarkers.has('perfect_setup')) {
        chunks.push(paint('perfect setup', ANSI.brightYellow));
        seenMarkers.add('perfect_setup');
      }
      if (label?.is_extension && !seenMarkers.has('extension')) {
        chunks.push(paint('extension', ANSI.brightYellow));
        seenMarkers.add('extension');
      }
      continue;
    }

    let piece = `${type} ${direction}`;
    if (count !== '' && count != null) piece += ` ${count}`;
    chunks.push(paint(piece, typeColor(type, direction)));
  }

  return `${prefix} ${chunks.join(paint(' | ', ANSI.dim))}`;
}
async function resolveDemarkStudyId(filter = 'DeMARK 9-13') {
  const state = await getChartState();
  const needle = String(filter || '').toLowerCase();
  const studies = Array.isArray(state?.studies) ? state.studies : [];
  const match = studies.find(study => String(study?.name || '').toLowerCase().includes(needle));
  return match?.id || null;
}

async function resolveLiveSelection(mode = 'hovered', value = null) {
  if (mode === 'latest') return { mode: 'latest', value: null };
  if (mode === 'visible') return { mode: 'visible', value: null };
  if (mode === 'time') return { mode: 'time', value };
  if (mode === 'bar_index') return { mode: 'bar_index', value };

  const focus = await evaluate(`
    (function() {
      try {
        var c = window.TradingViewApi._activeChartWidgetWV.value();
        var m = c._chartWidget.model().m_model;
        var src = m._crossHairSource || {};
        var hover = m._lastHoveredHittestData || {};
        var selected = m._lastSelectedHittestData || {};
        function num(v) {
          var n = Number(v);
          return Number.isFinite(n) ? n : null;
        }
        function timeLike(v) {
          var n = Number(v);
          if (!Number.isFinite(n)) return null;
          return n > 1000000000000 ? Math.floor(n / 1000) : Math.floor(n);
        }
        var hoverTime = timeLike(hover.time);
        var selectedTime = timeLike(selected.time);
        return {
          bar_index: num(src.index) ?? num(hover.index) ?? num(selected.index),
          time: hoverTime ?? selectedTime,
        };
      } catch(e) {
        return { bar_index: null, time: null, error: e.message };
      }
    })()
  `).catch(() => null);

  if (focus?.time != null && Number.isFinite(Number(focus.time))) {
    return { mode: 'time', value: Number(focus.time) };
  }
  return { mode: 'visible', value: null };
}

export async function streamDemark({ interval, filter, mode, value, once = false } = {}) {
  const pollInterval = interval || 1000;
  const studyFilter = filter || 'DeMARK 9-13';
  let lastLine = null;
  let running = true;

  const cleanup = () => { running = false; };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  process.stderr.write(`\u26A0  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or any AI provider.\n`);
  process.stderr.write(`   Live DeMARK terminal watcher from your local TradingView Desktop only.\n`);
  process.stderr.write(`   Ctrl+C to stop | interval=${pollInterval}ms | mode=${mode || 'hovered'} | filter="${studyFilter}"\n`);

  while (running) {
    try {
      const entityId = await resolveDemarkStudyId(studyFilter);
      if (!entityId) {
        const line = `${paint('[DMK]', ANSI.bold)} ${paint(`study not found: ${studyFilter}`, ANSI.brightRed)}`;
        if (line !== lastLine) {
          lastLine = line;
          process.stdout.write(line + '\n');
        }
        await sleep(pollInterval);
        continue;
      }

      const selection = await resolveLiveSelection(mode || 'hovered', value ?? null);
      const snapshot = await getDemarkSnapshot({ entity_id: entityId, compact: true, selection });
      const line = formatDemarkLine(snapshot);

      if (line !== lastLine) {
        lastLine = line;
        process.stdout.write(line + '\n');
        if (once) break;
      }
    } catch (err) {
      if (/CDP|ECONNREFUSED/i.test(err.message)) {
        await sleep(2000);
        continue;
      }
      const line = `${paint('[DMK]', ANSI.bold)} ${paint(`error: ${err.message}`, ANSI.brightRed)}`;
      if (line !== lastLine) {
        lastLine = line;
        process.stdout.write(line + '\n');
        if (once) break;
      }
    }
    await sleep(pollInterval);
  }

  process.stderr.write(`[stream:demark] stopped\n`);
  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);
}

// ── Stream: quote ──

async function fetchQuote() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
      };
    })()
  `);
}

export async function streamQuote({ interval } = {}) {
  return pollLoop(fetchQuote, { interval: interval || 300, label: 'quote' });
}

// ── Stream: ohlcv (last N bars, emits on new bar) ──

async function fetchLastBar() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        bar_time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
        bar_index: last,
      };
    })()
  `);
}

export async function streamBars({ interval } = {}) {
  return pollLoop(fetchLastBar, { interval: interval || 500, label: 'bars' });
}

// ── Stream: indicator values ──

async function fetchValues() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        try {
          var study = chart.getStudyById(studies[i].id);
          if (!study || !study.isVisible()) continue;
          var src = study._study || study;
          var data = src._lastBarValues || src._data;
          if (!data) continue;
          var vals = {};
          if (typeof data === 'object') {
            for (var k in data) {
              if (typeof data[k] === 'number' && !isNaN(data[k])) vals[k] = data[k];
            }
          }
          if (Object.keys(vals).length > 0) results.push({ name: studies[i].name, values: vals });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamValues({ interval } = {}) {
  return pollLoop(fetchValues, { interval: interval || 500, label: 'values' });
}

// ── Stream: pine lines ──

async function fetchLines(studyFilter) {
  const filter = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evaluate(`
    (function() {
      var filter = ${filter};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.dwglines) continue;
          var linesMap = pc.dwglines.get('lines');
          if (!linesMap) continue;
          var data = linesMap.get(false);
          if (!data || !data._primitivesDataById) continue;
          var levels = [];
          var seen = {};
          data._primitivesDataById.forEach(function(line) {
            var p1 = line.points && line.points[0] ? line.points[0].price : null;
            var p2 = line.points && line.points[1] ? line.points[1].price : null;
            var price = (p1 !== null && p1 === p2) ? p1 : (p1 || p2);
            if (price !== null && !seen[price]) { seen[price] = true; levels.push(price); }
          });
          levels.sort(function(a, b) { return b - a; });
          if (levels.length > 0) results.push({ study: s.name, levels: levels });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamLines({ interval, filter } = {}) {
  return pollLoop(() => fetchLines(filter), { interval: interval || 1000, label: 'lines' });
}

// ── Stream: pine labels ──

async function fetchLabels(studyFilter) {
  const filterStr = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evaluate(`
    (function() {
      var filter = ${filterStr};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.dwglabels) continue;
          var labelsMap = pc.dwglabels.get('labels');
          if (!labelsMap) continue;
          var data = labelsMap.get(false);
          if (!data || !data._primitivesDataById) continue;
          var labels = [];
          data._primitivesDataById.forEach(function(lbl) {
            var text = lbl.text || '';
            var price = lbl.points && lbl.points[0] ? lbl.points[0].price : null;
            if (text) labels.push({ text: text, price: price });
          });
          if (labels.length > 0) results.push({ study: s.name, labels: labels.slice(0, 50) });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamLabels({ interval, filter } = {}) {
  return pollLoop(() => fetchLabels(filter), { interval: interval || 1000, label: 'labels' });
}

// ── Stream: pine tables ──

async function fetchTables(studyFilter) {
  const filterStr = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evaluate(`
    (function() {
      var filter = ${filterStr};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.ownFirstValue) continue;
          var tableMap = pc.ownFirstValue();
          if (!tableMap) continue;
          var tables = [];
          if (typeof tableMap.forEach === 'function') {
            tableMap.forEach(function(table) {
              if (!table || !table.data) return;
              var rows = [];
              for (var r = 0; r < table.data.length; r++) {
                var row = [];
                for (var c = 0; c < table.data[r].length; c++) {
                  row.push(table.data[r][c].text || '');
                }
                rows.push(row);
              }
              tables.push({ rows: rows });
            });
          }
          if (tables.length > 0) results.push({ study: s.name, tables: tables });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamTables({ interval, filter } = {}) {
  return pollLoop(() => fetchTables(filter), { interval: interval || 2000, label: 'tables' });
}

// ── Stream: all panes (multi-symbol) ──

const CWC = 'window.TradingViewApi._chartWidgetCollection';

async function fetchAllPanes() {
  return evaluate(`
    (function() {
      var cwc = ${CWC};
      var all = cwc.getAll();
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var count = cwc.inlineChartsCount;
      if (typeof count === 'object' && count && typeof count.value === 'function') count = count.value();

      var panes = [];
      for (var i = 0; i < Math.min(all.length, count || all.length); i++) {
        try {
          var c = all[i];
          var model = c.model();
          var ms = model.mainSeries();
          var bars = ms.bars();
          var last = bars.lastIndex();
          var v = bars.valueAt(last);
          if (!v) { panes.push({ index: i, symbol: ms.symbol(), error: 'no bars' }); continue; }
          panes.push({
            index: i,
            symbol: ms.symbol(),
            resolution: ms.interval(),
            time: v[0],
            open: v[1],
            high: v[2],
            low: v[3],
            close: v[4],
            volume: v[5] || 0,
          });
        } catch(e) { panes.push({ index: i, error: e.message }); }
      }
      return { layout: layoutType, pane_count: panes.length, panes: panes };
    })()
  `);
}

export async function streamAllPanes({ interval } = {}) {
  return pollLoop(fetchAllPanes, { interval: interval || 500, label: 'all-panes' });
}

