import { evaluate, KNOWN_PATHS, safeString } from '../connection.js';
import { captureClip } from './capture.js';
import { getStudyValues } from './data.js';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DETECT_BLOBS_SCRIPT = join(dirname(dirname(__dirname)), 'scripts', 'demark_detect_blobs.py');

function parseNumericStudyValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeEpochSeconds(value) {
  const numeric = parseNumericStudyValue(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1000000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function extractDebugChartReference(studies) {
  const list = Array.isArray(studies) ? studies : [];
  for (const study of list) {
    const values = study?.values && typeof study.values === 'object' ? study.values : null;
    if (!values) continue;
    if (values.debug_chart_bar_index != null && values.debug_chart_time_open_ms != null) {
      return {
        bar_index: parseNumericStudyValue(values.debug_chart_bar_index),
        time_raw: normalizeEpochSeconds(values.debug_chart_time_open_ms),
      };
    }
    if (values.debug_bar_index != null && values.debug_time_open_ms != null) {
      return {
        bar_index: parseNumericStudyValue(values.debug_bar_index),
        time_raw: normalizeEpochSeconds(values.debug_time_open_ms),
      };
    }
  }
  return null;
}

async function getDebugChartReference() {
  const studyValuesSnapshot = await getStudyValues().catch(() => null);
  return extractDebugChartReference(studyValuesSnapshot?.studies || []);
}

function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object') return { mode: 'latest', value: null };
  return {
    mode: typeof selection.mode === 'string' ? selection.mode : 'latest',
    value: selection.value ?? null,
  };
}

function normalizeTargetTimeJs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function buildResolveBarExpression(selection, chartReference = null) {
  const { mode, value } = normalizeSelection(selection);
  return `
    (function() {
      var api = ${CHART_API};
      var bars = ${BARS_PATH};
      var selectionMode = ${safeString(mode)};
      var selectionValue = ${safeString(value)};
      var chartReferenceBarIndex = ${Number.isFinite(chartReference?.bar_index) ? Number(chartReference.bar_index) : 'null'};
      var chartReferenceTimeRaw = ${Number.isFinite(chartReference?.time_raw) ? Number(chartReference.time_raw) : 'null'};
      if (!bars || typeof bars.firstIndex !== 'function' || typeof bars.lastIndex !== 'function') return null;
      var firstIndex = bars.firstIndex();
      var lastIndex = bars.lastIndex();
      var chartResolution = null;
      try { chartResolution = typeof api.resolution === 'function' ? api.resolution() : null; } catch (e) {}

      function buildBarAtIndex(index) {
        if (typeof index !== 'number' || !isFinite(index)) return null;
        if (index < firstIndex || index > lastIndex) return null;
        var v = null;
        try { v = bars.valueAt(index); } catch (e) { v = null; }
        if (!v) return null;
        return { index: index, time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 };
      }

      function normalizeTargetTime(value) {
        if (typeof value === 'number' && isFinite(value)) return value > 1000000000000 ? Math.floor(value / 1000) : Math.floor(value);
        var raw = String(value != null ? value : '').trim();
        if (!raw) return null;
        if (/^\\d+$/.test(raw)) {
          var numeric = Number(raw);
          if (!isFinite(numeric)) return null;
          return numeric > 1000000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
        }
        var parsed = Date.parse(raw);
        return isFinite(parsed) ? Math.floor(parsed / 1000) : null;
      }

      function resolutionToSeconds(resolution) {
        var res = String(resolution || '').trim();
        if (!res) return null;
        if (res === 'D' || res === '1D') return 86400;
        if (res === 'W' || res === '1W') return 604800;
        if (res === 'M' || res === '1M') return 2592000;
        var minutes = Number(res);
        return isFinite(minutes) ? minutes * 60 : null;
      }

      function projectTimeFromGlobalIndex(targetIndex) {
        if (!isFinite(targetIndex) || !isFinite(chartReferenceBarIndex) || !isFinite(chartReferenceTimeRaw)) return null;
        var secsPerBar = resolutionToSeconds(chartResolution);
        if (!isFinite(secsPerBar) || secsPerBar <= 0) return null;
        var deltaBars = Math.round(chartReferenceBarIndex - targetIndex);
        return Math.round(chartReferenceTimeRaw - (deltaBars * secsPerBar));
      }

      function resolveExactBarByTime(targetTime) {
        if (!isFinite(targetTime)) return null;
        for (var index = firstIndex; index <= lastIndex; index++) {
          var v = null;
          try { v = bars.valueAt(index); } catch (e) { v = null; }
          if (!v) continue;
          if (Number(v[0]) === Number(targetTime)) return buildBarAtIndex(index);
        }
        return null;
      }

      if (selectionMode === 'latest') return buildBarAtIndex(lastIndex);
      if (selectionMode === 'bar_index') {
        var targetIndex = Number(selectionValue);
        if (!isFinite(targetIndex)) return null;
        var projectedTime = projectTimeFromGlobalIndex(targetIndex);
        if (isFinite(projectedTime)) return resolveExactBarByTime(projectedTime);
        return buildBarAtIndex(targetIndex);
      }
      if (selectionMode === 'time') return resolveExactBarByTime(normalizeTargetTime(selectionValue));
      if (selectionMode === 'visible') {
        try {
          var range = api.getVisibleRange();
          var target = range ? Math.floor((Number(range.from) + Number(range.to)) / 2) : null;
          if (isFinite(target)) return resolveExactBarByTime(target) || buildBarAtIndex(lastIndex);
        } catch (e) {}
        return buildBarAtIndex(lastIndex);
      }
      return buildBarAtIndex(lastIndex);
    })()
  `;
}

export async function ensureDemarkVisualZoom({ selection = { mode: 'latest', value: null }, min_bar_spacing = 28, bars_before = 2, bars_after = 2, chart_reference = null } = {}) {
  const minimumSpacing = Number(min_bar_spacing);
  const result = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var model = api._chartWidget.model();
      var ts = model.timeScale();
      var bar = ${buildResolveBarExpression(selection, chart_reference)};
      var before = typeof ts.barSpacing === 'function' ? ts.barSpacing() : null;
      if (${Number.isFinite(minimumSpacing) ? minimumSpacing : 'null'} != null && typeof ts.setBarSpacing === 'function' && before != null && before < ${Number.isFinite(minimumSpacing) ? minimumSpacing : 'null'}) {
        ts.setBarSpacing(${Number.isFinite(minimumSpacing) ? minimumSpacing : 'null'});
      }
      if (bar && typeof ts.zoomToBarsRange === 'function') {
        var firstIndex = ${BARS_PATH}.firstIndex();
        var lastIndex = ${BARS_PATH}.lastIndex();
        var fromIndex = Math.max(firstIndex, bar.index - ${Number.isFinite(Number(bars_before)) ? Math.max(1, Number(bars_before)) : 2});
        var toIndex = Math.min(lastIndex, bar.index + ${Number.isFinite(Number(bars_after)) ? Math.max(1, Number(bars_after)) : 2});
        ts.zoomToBarsRange(fromIndex, toIndex);
      }
      var after = typeof ts.barSpacing === 'function' ? ts.barSpacing() : before;
      return { before: before, after: after, selected_bar: bar };
    })()
  `);
  return { success: true, ...result };
}

export async function getDemarkVisualFocusContext({ selection = { mode: 'latest', value: null }, chart_reference = null } = {}) {
  const snapshot = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var model = api._chartWidget.model();
      var ts = model.timeScale();
      var bar = ${buildResolveBarExpression(selection, chart_reference)};
      if (!bar) return { error: 'Unable to resolve selected chart bar.' };

      function pickMainPaneCanvas() {
        var activeChart = api._activeChartWidgetWV && typeof api._activeChartWidgetWV.value === 'function'
          ? api._activeChartWidgetWV.value()
          : null;
        if (activeChart && activeChart._mainDiv && typeof activeChart._mainDiv.querySelector === 'function') {
          var activeCanvas = activeChart._mainDiv.querySelector('[data-name="pane-canvas"], canvas');
          if (activeCanvas && typeof activeCanvas.getBoundingClientRect === 'function') {
            return activeCanvas;
          }
          if (activeChart._mainDiv.getBoundingClientRect) {
            return activeChart._mainDiv;
          }
        }
        var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-name="pane-canvas"], canvas'));
        var best = null;
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!node || typeof node.getBoundingClientRect !== 'function') continue;
          var rect = node.getBoundingClientRect();
          if (!rect || rect.width < 120 || rect.height < 120) continue;
          var area = rect.width * rect.height;
          if (!best || area > best.area) best = { node: node, area: area };
        }
        return best ? best.node : null;
      }

      var pane = pickMainPaneCanvas()
        || document.querySelector('[class*="chart-container"] canvas')
        || document.querySelector('canvas');
      if (!pane) return { error: 'Unable to locate chart pane canvas.' };
      var rect = pane.getBoundingClientRect();

      var priceScale = model.mainSeries && model.mainSeries().priceScale ? model.mainSeries().priceScale() : null;
      var pr = priceScale && typeof priceScale.priceRange === 'function' ? priceScale.priceRange() : priceScale && priceScale._priceRange ? priceScale._priceRange : null;
      var minValue = pr ? (typeof pr.minValue === 'function' ? pr.minValue() : pr._minValue) : null;
      var maxValue = pr ? (typeof pr.maxValue === 'function' ? pr.maxValue() : pr._maxValue) : null;

      var localBarX = null;
      try { localBarX = ts.indexToCoordinate(bar.index); } catch (e) { localBarX = null; }
      var screenBarX = localBarX != null ? rect.x + localBarX : null;

      function priceToScreenY(price) {
        if (price == null || minValue == null || maxValue == null || maxValue === minValue) return null;
        var ratio = (maxValue - price) / (maxValue - minValue);
        return rect.y + (ratio * rect.height);
      }

      return {
        selected_bar: bar,
        pane_bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible_price_range: minValue != null && maxValue != null ? { min: minValue, max: maxValue } : null,
        bar_spacing: typeof ts.barSpacing === 'function' ? ts.barSpacing() : null,
        bar_x_local: localBarX,
        bar_x_screen: screenBarX,
        high_y_screen: priceToScreenY(bar.high),
        low_y_screen: priceToScreenY(bar.low),
        open_y_screen: priceToScreenY(bar.open),
        close_y_screen: priceToScreenY(bar.close),
        resolution: typeof api.resolution === 'function' ? api.resolution() : null,
      };
    })()
  `);

  if (snapshot?.error) throw new Error(snapshot.error);
  return { success: true, ...snapshot };
}

export function computeFocusColumnClip({ pane_bounds, bar_x_screen, column_width = 96 } = {}) {
  const width = Number.isFinite(Number(column_width)) ? Math.max(24, Number(column_width)) : 96;
  const pane = pane_bounds || {};
  const paneX = Number(pane.x);
  const paneY = Number(pane.y);
  const paneWidth = Number(pane.width);
  const paneHeight = Number(pane.height);
  const centerX = Number(bar_x_screen);
  if (!Number.isFinite(paneX) || !Number.isFinite(paneY) || !Number.isFinite(paneWidth) || !Number.isFinite(paneHeight) || !Number.isFinite(centerX)) {
    throw new Error('computeFocusColumnClip requires pane bounds and bar_x_screen.');
  }

  let x = centerX - (width / 2);
  const minX = paneX;
  const maxX = paneX + paneWidth - width;
  if (x < minX) x = minX;
  if (x > maxX) x = maxX;

  return {
    x,
    y: paneY,
    width,
    height: paneHeight,
  };
}

export async function captureDemarkFocusColumn({ selection = { mode: 'latest', value: null }, min_bar_spacing = 28, bars_before = 2, bars_after = 2, column_width = 96, filename_prefix = 'demark_focus' } = {}) {
  const chartReference = await getDebugChartReference();
  await ensureDemarkVisualZoom({ selection, min_bar_spacing, bars_before, bars_after, chart_reference: chartReference });
  await new Promise(resolve => setTimeout(resolve, 250));
  const context = await getDemarkVisualFocusContext({ selection, chart_reference: chartReference });
  const clip = computeFocusColumnClip({
    pane_bounds: context.pane_bounds,
    bar_x_screen: context.bar_x_screen,
    column_width,
  });
  const barIndex = context?.selected_bar?.index ?? 'unknown';
  const capture = await captureClip({
    clip,
    filename: `${filename_prefix}_${barIndex}`,
  });

  return {
    success: true,
    selection: normalizeSelection(selection),
    context,
    capture,
  };
}

export function detectDemarkFocusBlobs({ image_path, min_area = 18, min_height = 6, max_aspect = 4.0 } = {}) {
  if (!image_path) throw new Error('image_path is required.');
  const stdout = execFileSync('python', [
    DETECT_BLOBS_SCRIPT,
    image_path,
    '--min-area', String(min_area),
    '--min-height', String(min_height),
    '--max-aspect', String(max_aspect),
  ], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);
  if (!parsed?.success) {
    throw new Error(parsed?.error || 'Blob detection failed.');
  }
  return parsed;
}

export async function captureAndDetectDemarkFocusColumn(options = {}) {
  const result = await captureDemarkFocusColumn(options);
  const blobs = detectDemarkFocusBlobs({ image_path: result?.capture?.file_path });
  return {
    ...result,
    blobs,
  };
}
