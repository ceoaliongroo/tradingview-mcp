/**
 * Core data access logic.
 */
import { evaluate, evaluateAsync, KNOWN_PATHS, safeString } from '../connection.js';

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const MAX_INPUT_PREVIEW = 240;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;
const DEMARK_LABEL_LIMIT = 120;

const DEMARK_COLOR_REFERENCES = {
  setup: {
    dark: { r: 56, g: 142, b: 60 },
    light: { r: 165, g: 214, b: 167 },
  },
  sequential: {
    dark: { r: 178, g: 40, b: 51 },
    light: { r: 250, g: 161, b: 164 },
  },
  combo: {
    dark: { r: 0, g: 151, b: 167 },
    light: { r: 128, g: 222, b: 234 },
  },
  tdst: {
    dark: { r: 245, g: 124, b: 0 },
    light: { r: 255, g: 204, b: 128 },
  },
};

function buildDemarkColorReferencesFromInputs(inputs = []) {
  const byId = new Map((Array.isArray(inputs) ? inputs : []).map(input => [input?.id, input?.value]));
  const pick = (ids) => ids
    .map(id => {
      const rgb = argbToRgb(byId.get(id));
      return rgb ? { id, r: rgb.r, g: rgb.g, b: rgb.b, hex: rgb.hex } : null;
    })
    .filter(Boolean);
  const setup = pick(['in_1', 'in_2']);
  const tdst = pick(['in_4', 'in_5']);
  const sequential = pick(['in_7', 'in_8']);
  const combo = pick(['in_10', 'in_11']);
  const asFamily = (entries, fallback) => {
    if (!entries.length) return fallback;
    return entries.reduce((acc, entry, index) => {
      acc[index === 0 ? 'primary' : `alt_${index}`] = { r: entry.r, g: entry.g, b: entry.b };
      return acc;
    }, {});
  };
  return {
    setup: asFamily(setup, DEMARK_COLOR_REFERENCES.setup),
    sequential: asFamily(sequential, DEMARK_COLOR_REFERENCES.sequential),
    combo: asFamily(combo, DEMARK_COLOR_REFERENCES.combo),
    tdst: asFamily(tdst, DEMARK_COLOR_REFERENCES.tdst),
  };
}

function previewLargeString(value, limit = MAX_INPUT_PREVIEW) {
  if (typeof value !== 'string' || value.length <= limit) return value;
  return {
    preview: value.slice(0, limit),
    length: value.length,
    truncated: true,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function argbToRgb(argb) {
  if (typeof argb !== 'number' || !Number.isFinite(argb)) return null;
  const unsigned = argb >>> 0;
  return {
    a: (unsigned >>> 24) & 255,
    r: (unsigned >>> 16) & 255,
    g: (unsigned >>> 8) & 255,
    b: unsigned & 255,
    hex: `#${[(unsigned >>> 16) & 255, (unsigned >>> 8) & 255, unsigned & 255].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
  };
}

function rgbDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

export function classifyDemarkColor(argb, references = DEMARK_COLOR_REFERENCES) {
  const rgb = argbToRgb(argb);
  if (!rgb) {
    return {
      argb: argb ?? null,
      rgb: null,
      family: 'unknown',
      shade: 'unknown',
      direction: null,
      confidence: 0,
      matched_reference: null,
    };
  }

  let best = null;
  for (const [family, shades] of Object.entries(references || DEMARK_COLOR_REFERENCES)) {
    for (const [shade, ref] of Object.entries(shades)) {
      const distance = rgbDistance(rgb, ref);
      const score = 1 - clamp01(distance / 200);
      if (!best || distance < best.distance) {
        best = { family, shade, ref, distance, score };
      }
    }
  }

  const confidence = best ? clamp01(best.score) : 0;
  return {
    argb: argb ?? null,
    rgb,
    family: best?.family || 'unknown',
    shade: best?.shade || 'unknown',
    direction: best?.shade === 'dark' ? 'buy' : best?.shade === 'light' ? 'sell' : null,
    confidence,
    matched_reference: best
      ? {
          family: best.family,
          shade: best.shade,
          rgb: best.ref,
          hex: `#${[best.ref.r, best.ref.g, best.ref.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
          distance: Math.round(best.distance * 100) / 100,
        }
      : null,
  };
}

export function normalizeDemarkText(rawText) {
  const raw = String(rawText ?? '');
  const compact = raw.replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const hasBullet = /[•\u2022]/.test(raw) || raw.includes('â€¢') || /\.(?=\s|$)/.test(raw);
  const hasPlus = raw.includes('+');
  const numericMatch = compact.match(/\b(1[0-3]|[1-9])\b/);
  const countValue = numericMatch ? Number(numericMatch[1]) : null;
  const cleaned = compact.replace(/[•.+]/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    raw,
    text: compact,
    cleaned_text: cleaned,
    count_value: countValue,
    has_bullet: hasBullet,
    has_plus: hasPlus,
    is_marker_only: !cleaned && (hasBullet || hasPlus),
  };
}

function classifyLabelPosition(price, bar) {
  if (!bar || typeof price !== 'number') {
    return { position: null, confidence: 0, delta: null };
  }
  const high = typeof bar.high === 'number' ? bar.high : null;
  const low = typeof bar.low === 'number' ? bar.low : null;
  if (high == null || low == null) {
    return { position: null, confidence: 0, delta: null };
  }

  if (price >= high) {
    const delta = price - high;
    return { position: 'above_bar', confidence: clamp01(delta / Math.max(Math.abs(high) * 0.002, 1)), delta: Math.round(delta * 100) / 100 };
  }
  if (price <= low) {
    const delta = low - price;
    return { position: 'below_bar', confidence: clamp01(delta / Math.max(Math.abs(low) * 0.002, 1)), delta: Math.round(delta * 100) / 100 };
  }
  return { position: 'on_bar', confidence: 1, delta: 0 };
}

function addLevelCandidate(levels, candidate) {
  if (candidate == null || typeof candidate.price !== 'number' || !Number.isFinite(candidate.price)) return;
  levels.push(candidate);
}

function formatBarTime(time) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const ms = time > 1000000000000 ? time : time * 1000;
  const iso = new Date(ms).toISOString();
  return { raw: time, iso };
}

function formatBarTimeInZone(time, timeZone) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const ms = time > 1000000000000 ? time : time * 1000;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(ms));
  const lookup = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }
  if (!lookup.year || !lookup.month || !lookup.day || !lookup.hour || !lookup.minute) return null;
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

function analyzeRiskHints(label, levels) {
  let best = null;
  for (const level of levels) {
    const price = level?.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    const delta = Math.abs(price - label.price);
    const sameFamily = level.family && label.count_type && level.family === label.count_type ? 1 : 0;
    const sameShade = level.shade && label.shade && level.shade === label.shade ? 1 : 0;
    const xSpan = typeof label.x === 'number' && typeof level.x1 === 'number' && typeof level.x2 === 'number'
      && label.x >= Math.min(level.x1, level.x2) - 2 && label.x <= Math.max(level.x1, level.x2) + 2
      ? 1 : 0;
    const score = delta - (sameFamily * 0.25) - (sameShade * 0.1) - (xSpan * 0.15);
    if (!best || score < best.score) {
      best = {
        price: Math.round(price * 100) / 100,
        source: level.source,
        family: level.family || 'unknown',
        shade: level.shade || 'unknown',
        x1: level.x1 ?? null,
        x2: level.x2 ?? null,
        delta: Math.round(delta * 100) / 100,
        confidence: clamp01(1 - Math.min(1, delta / Math.max(Math.abs(label.price) * 0.01, 1))),
        score,
      };
    }
  }

  return best
    ? {
        level_price: best.price,
        source: best.source,
        family: best.family,
        shade: best.shade,
        x1: best.x1,
        x2: best.x2,
        delta_to_label: best.delta,
        confidence: Math.round(best.confidence * 1000) / 1000,
      }
    : null;
}

function inferDirectionFromLabelStyle(style) {
  const raw = String(style || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('up')) return 'sell';
  if (raw.includes('dn')) return 'buy';
  return null;
}

function resolveDemarkCountType(label, groupHasSetupMarker) {
  const family = label?.color_reference?.family || 'unknown';

  if (label?.is_perfect_setup || label?.is_extension) return 'indicator';
  if (label?.marker_type === 'tdst') return 'indicator';
  if (family === 'setup') return 'setup';
  if (family === 'sequential') return 'sequential';
  if (family === 'combo') return 'combo';

  if (groupHasSetupMarker) {
    if (label?.count_value === 9) return 'setup';
  }

  if (label?.count_value === 1) return 'sequential';
  if (label?.count_value != null) return 'combo';
  return 'indicator';
}

function sanitizePublicLabel(label) {
  return label;
}

function summarizeResolvedLabels(labels) {
  const summary = {
    label_count: Array.isArray(labels) ? labels.length : 0,
    current_label_count: Array.isArray(labels) ? labels.filter(l => l.is_current).length : 0,
    counts: {
      setup: { buy: 0, sell: 0, unknown: 0 },
      sequential: { buy: 0, sell: 0, unknown: 0 },
      combo: { buy: 0, sell: 0, unknown: 0 },
      indicator: { buy: 0, sell: 0, unknown: 0 },
      unknown: { buy: 0, sell: 0, unknown: 0 },
    },
    markers: {
      perfect_setup: 0,
      extensions: 0,
      tdst: 0,
    },
  };

  for (const label of Array.isArray(labels) ? labels : []) {
    const family = Object.prototype.hasOwnProperty.call(summary.counts, label?.resolved_count_type || label?.count_type)
      ? (label?.resolved_count_type || label?.count_type)
      : 'unknown';
    const direction = label?.direction === 'buy' || label?.direction === 'sell' ? label.direction : 'unknown';
    summary.counts[family][direction] += 1;
    if (label?.is_perfect_setup) summary.markers.perfect_setup += 1;
    if (label?.is_extension) summary.markers.extensions += 1;
    if (label?.marker_type === 'tdst') summary.markers.tdst += 1;
  }

  return summary;
}

function repairAmbiguousCountFamilies(labels) {
  const grouped = new Map();
  for (const label of Array.isArray(labels) ? labels : []) {
    const key = label?.bar_index ?? label?.x;
    if (!Number.isFinite(Number(key))) continue;
    const numericKey = Number(key);
    if (!grouped.has(numericKey)) grouped.set(numericKey, []);
    grouped.get(numericKey).push(label);
  }

  for (const group of grouped.values()) {
    const hasSetup = group.some(label => (label?.resolved_count_type || label?.count_type) === 'setup');
    const hasSequential = group.some(label => (label?.resolved_count_type || label?.count_type) === 'sequential');
    const hasCombo = group.some(label => (label?.resolved_count_type || label?.count_type) === 'combo');
    if (!hasSetup || !hasSequential || hasCombo) continue;

    const numericCandidates = group.filter(label => {
      const family = label?.resolved_count_type || label?.count_type;
      return (family === 'indicator' || family === 'unknown' || label?.marker_type === 'tdst')
        && label?.count_value != null
        && !label?.is_perfect_setup
        && !label?.is_extension;
    });
    if (numericCandidates.length === 0) continue;

    numericCandidates.sort((a, b) => {
      const confidenceA = Number.isFinite(a?.confidence) ? a.confidence : 0;
      const confidenceB = Number.isFinite(b?.confidence) ? b.confidence : 0;
      if (confidenceA !== confidenceB) return confidenceB - confidenceA;
      const priceA = Number.isFinite(a?.price_raw) ? a.price_raw : (Number.isFinite(a?.price) ? a.price : Number.POSITIVE_INFINITY);
      const priceB = Number.isFinite(b?.price_raw) ? b.price_raw : (Number.isFinite(b?.price) ? b.price : Number.POSITIVE_INFINITY);
      if (priceA !== priceB) return priceA - priceB;
      const textA = String(a?.text ?? '');
      const textB = String(b?.text ?? '');
      return textA.localeCompare(textB);
    });

    const promoted = numericCandidates[0];
    if (promoted) {
      promoted.resolved_count_type = 'combo';
      promoted.count_type = 'combo';
      if (promoted.marker_type === 'tdst') promoted.marker_type = null;
    }
  }

  return labels;
}

function assertNoUnknownResolvedLabels(labels, context) {
  const unknown = Array.isArray(labels) ? labels.filter(label => (label?.resolved_count_type || label?.count_type) === 'unknown') : [];
  if (unknown.length === 0) return;

  const details = unknown.slice(0, 3).map(label => ({
    text: label?.text ?? null,
    bar_index: label?.bar_index ?? null,
    price: label?.price ?? null,
    direction: label?.direction ?? null,
    marker_type: label?.marker_type ?? null,
  }));
  throw new Error(`Unresolved DeMARK labels for bar ${context?.bar_index ?? 'unknown'} (selection=${context?.selection_mode ?? 'latest'}): ${JSON.stringify(details)}`);
}

export function selectBarSnapshotByVisibleRange(barSnapshots, visibleRange) {
  if (!Array.isArray(barSnapshots) || barSnapshots.length === 0) return null;
  const bars = barSnapshots.filter(bar => Number.isFinite(bar?.bar_index));
  if (bars.length === 0) return null;

  const from = Number(visibleRange?.from);
  const to = Number(visibleRange?.to);
  const hasRange = Number.isFinite(from) && Number.isFinite(to) && to >= from;
  if (!hasRange) {
    return bars[bars.length - 1] || null;
  }

  const target = (from + to) / 2;
  let best = null;
  for (const bar of bars) {
    const timeRaw = Number(bar?.time?.raw);
    if (!Number.isFinite(timeRaw)) continue;
    const score = Math.abs(timeRaw - target);
    if (!best || score < best.score || (score === best.score && bar.bar_index > best.bar.bar_index)) {
      best = { bar, score };
    }
  }

  return best?.bar || bars[bars.length - 1] || null;
}

function selectLatestBarSnapshot(barSnapshots) {
  if (!Array.isArray(barSnapshots) || barSnapshots.length === 0) return null;
  return barSnapshots.filter(bar => Number.isFinite(bar?.bar_index)).sort((a, b) => a.bar_index - b.bar_index).at(-1) || null;
}

function selectBarSnapshotByIndex(barSnapshots, index) {
  const target = Number(index);
  if (!Number.isFinite(target)) return null;
  return (Array.isArray(barSnapshots) ? barSnapshots : []).find(bar => Number(bar?.bar_index) === target) || null;
}

function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object') return { mode: 'latest', value: null };
  const mode = typeof selection.mode === 'string' ? selection.mode : 'latest';
  return {
    mode,
    value: selection.value ?? null,
  };
}

function extractBarTimeRaw(bar) {
  if (!bar) return null;
  if (Number.isFinite(bar?.time?.raw)) return bar.time.raw;
  if (Number.isFinite(bar?.time)) return bar.time;
  if (Number.isFinite(bar?.raw)) return bar.raw;
  return null;
}

function barsShareIdentity(a, b) {
  if (!a || !b) return false;
  const indexA = Number(a?.bar_index ?? a?.index);
  const indexB = Number(b?.bar_index ?? b?.index);
  const timeA = extractBarTimeRaw(a);
  const timeB = extractBarTimeRaw(b);
  const hasIndex = Number.isFinite(indexA) && Number.isFinite(indexB);
  const hasTime = Number.isFinite(timeA) && Number.isFinite(timeB);
  if (hasIndex && hasTime) return indexA === indexB && timeA === timeB;
  if (hasIndex) return indexA === indexB;
  if (hasTime) return timeA === timeB;
  return false;
}

function mergeSelectedBarWithSnapshot(selectedBar, snapshotBar, { preferSnapshotOnMismatch = false } = {}) {
  if (!selectedBar && !snapshotBar) return null;
  if (!selectedBar) return snapshotBar || null;
  if (!snapshotBar) return selectedBar || null;

  if (!barsShareIdentity(selectedBar, snapshotBar)) {
    return (preferSnapshotOnMismatch ? snapshotBar : selectedBar) || snapshotBar || selectedBar || null;
  }

  const mergedLabels = Array.isArray(snapshotBar?.labels) ? snapshotBar.labels : Array.isArray(selectedBar?.labels) ? selectedBar.labels : [];
  return {
    ...snapshotBar,
    ...selectedBar,
    labels: mergedLabels,
    perfect_setup: snapshotBar?.perfect_setup ?? selectedBar?.perfect_setup ?? false,
    extensions: snapshotBar?.extensions ?? selectedBar?.extensions ?? 0,
  };
}

function mergeBarDataAndLabels(dataBar, labelBar) {
  if (!dataBar && !labelBar) return null;
  if (!dataBar) return labelBar || null;
  if (!labelBar) return dataBar || null;

  const mergedLabels = Array.isArray(labelBar?.labels) ? labelBar.labels : Array.isArray(dataBar?.labels) ? dataBar.labels : [];
  return {
    ...labelBar,
    ...dataBar,
    labels: mergedLabels,
    perfect_setup: labelBar?.perfect_setup ?? dataBar?.perfect_setup ?? false,
    extensions: labelBar?.extensions ?? dataBar?.extensions ?? 0,
  };
}

function resolveLabelsForFocusBar(labels, focusBarIndex) {
  const list = Array.isArray(labels) ? labels : [];
  if (list.length === 0) return [];
  const numericFocus = Number(focusBarIndex);
  if (!Number.isFinite(numericFocus)) return list.slice();

  const exact = list.filter(label => {
    if (label?.bar_index == null) return true;
    return Number(label.bar_index) === numericFocus;
  });
  return exact;
}

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

function resolutionToSeconds(resolution) {
  const res = String(resolution || '').trim();
  if (!res) return null;
  if (res === 'D' || res === '1D') return 86400;
  if (res === 'W' || res === '1W') return 604800;
  if (res === 'M' || res === '1M') return 2592000;
  const minutes = Number(res);
  return Number.isFinite(minutes) ? minutes * 60 : null;
}

function projectTimeFromChartIndex(reference, targetChartIndex, resolution) {
  const refIndex = parseNumericStudyValue(reference?.bar_index);
  const refTimeRaw = normalizeEpochSeconds(reference?.time_raw);
  const secsPerBar = resolutionToSeconds(resolution);
  if (!Number.isFinite(refIndex) || !Number.isFinite(refTimeRaw) || !Number.isFinite(targetChartIndex) || !Number.isFinite(secsPerBar) || secsPerBar <= 0) {
    return null;
  }
  const deltaBars = Math.round(refIndex - targetChartIndex);
  return Math.round(refTimeRaw - (deltaBars * secsPerBar));
}

function normalizeStudyValueMap(studies) {
  const list = Array.isArray(studies) ? studies : [];
  for (const study of list) {
    if (!study || typeof study !== 'object') continue;
    if (study.values && typeof study.values === 'object') return study.values;
  }
  return null;
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

function selectBarSnapshotBySelection(barSnapshots, visibleRange, selection, chartReference = null, chartResolution = null) {
  const normalized = normalizeSelection(selection);
  const bars = Array.isArray(barSnapshots) ? barSnapshots.filter(bar => Number.isFinite(bar?.bar_index)) : [];
  if (bars.length === 0) return null;

  if (normalized.mode === 'latest') {
    const chartTimeRaw = Number.isFinite(chartReference?.time_raw) ? Number(chartReference.time_raw) : null;
    if (Number.isFinite(chartTimeRaw)) {
      const exactTimeMatch = bars.find(bar => Number(bar?.time?.raw) === Number(chartTimeRaw));
      if (exactTimeMatch) return exactTimeMatch;
    }
  }

  if (normalized.mode === 'visible') {
    return selectBarSnapshotByVisibleRange(bars, visibleRange) || selectLatestBarSnapshot(bars);
  }

  if (normalized.mode === 'bar_index') {
    const targetIndex = Number(normalized.value);
    if (Number.isFinite(targetIndex)) {
      const projectedTimeRaw = projectTimeFromChartIndex(chartReference, targetIndex, chartResolution);
      if (Number.isFinite(projectedTimeRaw)) {
        const match = bars.find(bar => Number(bar?.time?.raw) === projectedTimeRaw);
        if (match) return match;
      }
      return bars.find(bar => Number(bar.bar_index) === targetIndex) || null;
    }
    return null;
  }

  if (normalized.mode === 'time') {
    const targetTime = typeof normalized.value === 'number'
      ? normalized.value
      : /^\d+$/.test(String(normalized.value ?? ''))
        ? Number(normalized.value)
        : Number.isFinite(Date.parse(normalized.value)) ? Math.floor(new Date(normalized.value).getTime() / 1000) : null;
    if (Number.isFinite(targetTime)) {
      return bars.find(bar => Number(bar?.time?.raw) === targetTime) || null;
    }
    return null;
  }

  return selectLatestBarSnapshot(bars) || selectBarSnapshotByVisibleRange(bars, visibleRange);
}

function dedupeLabelsByIdentity(labels) {
  const seen = new Set();
  const result = [];
  for (const label of Array.isArray(labels) ? labels : []) {
    const key = [
      label?.id ?? '',
      label?.bar_index ?? '',
      label?.x ?? '',
      label?.text ?? '',
      label?.price ?? '',
      label?.resolved_count_type ?? label?.count_type ?? '',
      label?.direction ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function summarizeClusterLabels(labels) {
  const summary = {
    setup: { buy: 0, sell: 0, unknown: 0 },
    sequential: { buy: 0, sell: 0, unknown: 0 },
    combo: { buy: 0, sell: 0, unknown: 0 },
    unknown: { buy: 0, sell: 0, unknown: 0 },
  };

  for (const label of Array.isArray(labels) ? labels : []) {
    const family = Object.prototype.hasOwnProperty.call(summary, label?.resolved_count_type || label?.count_type)
      ? (label?.resolved_count_type || label?.count_type)
      : 'unknown';
    const direction = label?.direction === 'buy' || label?.direction === 'sell' ? label.direction : 'unknown';
    summary[family][direction] += 1;
  }

  return summary;
}

export function buildResolvedDemarkSnapshot(demark, visibleRange, { selection = { mode: 'latest', value: null }, selected_bar = null, chart_bar = null, include_context = false, chart_reference = null, chart_resolution = null } = {}) {
  if (!demark) return null;

  const normalizedSelection = normalizeSelection(selection);
  const selectionMode = normalizedSelection.mode;
  const barSnapshots = Array.isArray(demark.bar_snapshots) ? demark.bar_snapshots : [];
  const selectedBarIndex = Number.isFinite(selected_bar?.bar_index)
    ? selected_bar.bar_index
    : Number.isFinite(selected_bar?.index)
      ? selected_bar.index
      : null;
  const labeledBar = Number.isFinite(selectedBarIndex)
    ? barSnapshots.find(bar => Number(bar?.bar_index) === Number(selectedBarIndex)) || null
    : null;
  const demarkCurrentBar = selectBarSnapshotByIndex(barSnapshots, demark?.current_bar_index);
  const baselineBar = selectLatestBarSnapshot(barSnapshots);
  const exactSelectionBar = selectBarSnapshotBySelection(barSnapshots, visibleRange, selection, chart_reference, chart_resolution);
  const demarkRecentBars = Array.isArray(demark?.recent_bars) ? demark.recent_bars : [];
  const demarkCurrentRecentBar = selectBarSnapshotByIndex(demarkRecentBars, demark?.current_bar_index);
  const chartBarIndex = Number.isFinite(chart_reference?.bar_index)
    ? Number(chart_reference.bar_index)
    : null;
  const chartBarTimeRaw = extractBarTimeRaw(chart_bar || selected_bar || null);
  const chartMatchedBar = Number.isFinite(chartBarTimeRaw)
    ? (barSnapshots.find(bar => Number(extractBarTimeRaw(bar)) === Number(chartBarTimeRaw)) || null)
    : null;
  let currentBar = null;

  if (selectionMode === 'latest') {
    const latestDataBar = chart_reference
      ? (demarkCurrentRecentBar || demarkCurrentBar || exactSelectionBar || chart_bar || selected_bar || selectBarSnapshotByVisibleRange(barSnapshots, visibleRange) || baselineBar)
      : (selected_bar || exactSelectionBar || chart_bar || demarkCurrentRecentBar || demarkCurrentBar || selectBarSnapshotByVisibleRange(barSnapshots, visibleRange) || baselineBar);
    const latestLabelBar = exactSelectionBar || labeledBar || selected_bar || chart_bar || baselineBar || demarkCurrentRecentBar || demarkCurrentBar;
    currentBar = mergeBarDataAndLabels(latestDataBar || null, latestLabelBar || null);
    if (!currentBar) {
      currentBar = latestLabelBar || latestDataBar || selected_bar || chart_bar || null;
    }
  } else if (selectionMode === 'visible') {
    currentBar = mergeSelectedBarWithSnapshot(
      selected_bar || null,
      exactSelectionBar || labeledBar || baselineBar || selectLatestBarSnapshot(barSnapshots) || selectBarSnapshotByVisibleRange(barSnapshots, visibleRange)
    );
    if (!currentBar) {
      currentBar = exactSelectionBar || selected_bar || labeledBar || baselineBar || selectLatestBarSnapshot(barSnapshots) || selectBarSnapshotByVisibleRange(barSnapshots, visibleRange);
    }
  } else if (selectionMode === 'bar_index' || selectionMode === 'time') {
    currentBar = mergeSelectedBarWithSnapshot(chart_bar || selected_bar || labeledBar || null, exactSelectionBar || chartMatchedBar || null);
    if (!currentBar) {
      currentBar = chart_bar || selected_bar || labeledBar || exactSelectionBar || chartMatchedBar || null;
    }
  } else {
    currentBar = exactSelectionBar || labeledBar || selected_bar || selectLatestBarSnapshot(barSnapshots) || selectBarSnapshotByVisibleRange(barSnapshots, visibleRange);
  }
  const currentBarIndex = currentBar?.bar_index ?? selectedBarIndex ?? demark.current_bar_index ?? null;
  const currentBarTime = extractBarTimeRaw(currentBar);
  const selectionBarIndex = selectionMode === 'bar_index' && Number.isFinite(Number(normalizedSelection.value))
    ? Number(normalizedSelection.value)
    : null;
  const publicBarIndex = selectionBarIndex
    ?? (selectionMode === 'latest'
      ? (Number.isFinite(chartBarIndex) ? chartBarIndex : currentBarIndex)
      : (Number.isFinite(chartBarIndex) ? chartBarIndex : null))
    ?? currentBarIndex;
  const currentDisplayBarIndex = Number.isFinite(publicBarIndex) ? publicBarIndex : currentBarIndex;
  const labelFocusBarIndex = selectionMode === 'latest' && Number.isFinite(currentDisplayBarIndex)
    ? currentDisplayBarIndex
    : currentBarIndex;
  let currentLabels = resolveLabelsForFocusBar(currentBar?.labels, labelFocusBarIndex);
  if (selectionMode === 'latest' && chart_reference && currentLabels.length === 0 && Array.isArray(currentBar?.labels) && currentBar.labels.length > 0) {
    currentLabels = currentBar.labels.slice();
  }
  const hasSelectionMismatch = Number.isFinite(selectedBarIndex) && Number.isFinite(labelFocusBarIndex) && Number(selectedBarIndex) !== Number(labelFocusBarIndex);
  if ((selectionMode === 'latest' || selectionMode === 'visible') && currentLabels.length === 0 && Array.isArray(currentBar?.labels) && hasSelectionMismatch) {
    currentLabels = currentBar.labels.slice();
  }

  const currentTime = extractBarTimeRaw(currentBar) ?? extractBarTimeRaw(chart_bar);
  const currentOhlcv = currentBar
    ? {
        open: currentBar.open ?? chart_bar?.open ?? null,
        high: currentBar.high ?? chart_bar?.high ?? null,
        low: currentBar.low ?? chart_bar?.low ?? null,
        close: currentBar.close ?? chart_bar?.close ?? null,
        volume: currentBar.volume ?? chart_bar?.volume ?? null,
      }
    : chart_bar
      ? {
          open: chart_bar.open ?? null,
          high: chart_bar.high ?? null,
          low: chart_bar.low ?? null,
          close: chart_bar.close ?? null,
          volume: chart_bar.volume ?? null,
        }
      : null;
  const labels = currentLabels.map(label => {
    const labelPrice = label.price_raw ?? label.price ?? null;
    const positionInfo = classifyLabelPosition(labelPrice, currentOhlcv);
    const directionFromPosition = positionInfo.position === 'above_bar'
      ? 'sell'
      : positionInfo.position === 'below_bar'
        ? 'buy'
        : null;
    return {
      text: label.text ?? null,
      price: label.price ?? null,
      price_raw: label.price_raw ?? null,
      x: currentDisplayBarIndex ?? label.bar_index ?? null,
      bar_index: currentDisplayBarIndex ?? label.bar_index ?? null,
      resolved_count_type: label.resolved_count_type || label.count_type || 'unknown',
      direction: directionFromPosition || label.direction || null,
      position: positionInfo.position || label.position || null,
      confidence: directionFromPosition
        ? Math.max(label.confidence ?? 0, positionInfo.confidence ?? 0)
        : (label.confidence ?? null),
      count_value: label.count_value ?? null,
      is_current: !!label.is_current,
      is_perfect_setup: !!label.is_perfect_setup,
      is_extension: !!label.is_extension,
      shade: label.shade ?? null,
      marker_type: label.marker_type ?? null,
    };
  });

  assertNoUnknownResolvedLabels(labels, { bar_index: currentBarIndex, selection_mode: normalizeSelection(selection).mode });

  const summary = summarizeResolvedLabels(labels);
  const activeSignals = labels.map(label => ({
    label_id: label.id ?? null,
    text: label.text ?? null,
    count_type: label.resolved_count_type || label.count_type || 'indicator',
    direction: label.direction || null,
    is_current: label.is_current,
    is_perfect_setup: label.is_perfect_setup,
    is_extension: label.is_extension,
    price: label.price ?? null,
    bar_index: label.bar_index ?? null,
    bar_number: label.bar_number ?? null,
    x: label.x ?? null,
    time: label.time ?? null,
    confidence: label.confidence ?? null,
  }));
  const riskLevelCandidates = labels
    .filter(label => label.risk_level_hint?.level_price != null)
    .map(label => ({
      level_price: label.risk_level_hint.level_price,
      source: label.risk_level_hint.source,
      family: label.risk_level_hint.family,
      shade: label.risk_level_hint.shade,
      delta_to_label: label.risk_level_hint.delta_to_label,
      confidence: label.risk_level_hint.confidence,
      related_label_id: label.id,
      related_label_text: label.text,
    }));

  return {
    bar_index: currentDisplayBarIndex,
    x: currentDisplayBarIndex,
    chart_bar_index: currentDisplayBarIndex,
    time: currentTime != null ? {
      israel: formatBarTimeInZone(currentTime, 'Asia/Jerusalem'),
      utc: currentBar?.time?.iso || formatBarTime(currentTime)?.iso || null,
      raw: currentTime,
    } : null,
    ohlcv: currentOhlcv,
    labels,
    perfect_setup: !!currentBar?.perfect_setup,
    extensions: currentBar?.extensions ?? 0,
    summary,
    active_signals: activeSignals,
    risk_level_candidates: riskLevelCandidates,
    visible_range: visibleRange && !visibleRange.error ? visibleRange : null,
    current_bar_index: currentDisplayBarIndex,
    chart_bar_index: currentDisplayBarIndex,
    selection_mode: normalizeSelection(selection).mode,
    selection_value: normalizeSelection(selection).value,
    include_context: !!include_context,
    source: 'resolved_demark_snapshot',
  };
}

export function analyzeDemarkGraphics({ labels = [], lines = [], boxes = [], barLookup = {}, lastIndex = null, studyName = 'DeMARK 9-13', colorReferences = DEMARK_COLOR_REFERENCES, visiblePriceRange = null } = {}) {
  const rawLabelRows = Array.isArray(labels) ? labels : [];
  const visibleMin = Number(visiblePriceRange?.min);
  const visibleMax = Number(visiblePriceRange?.max);
  const hasVisiblePriceRange = Number.isFinite(visibleMin) && Number.isFinite(visibleMax) && visibleMax >= visibleMin;
  const visiblePricePadding = hasVisiblePriceRange ? Math.max((visibleMax - visibleMin) * 0.02, 10) : 0;
  const labelRows = rawLabelRows.filter(item => {
    if (!hasVisiblePriceRange) return true;
    const price = Number(item?.price);
    if (!Number.isFinite(price)) return true;
    return price >= (visibleMin - visiblePricePadding) && price <= (visibleMax + visiblePricePadding);
  });
  const lineRows = Array.isArray(lines) ? lines : [];
  const boxRows = Array.isArray(boxes) ? boxes : [];

  const levelCandidates = [];
  for (const line of lineRows) {
    if (line?.y1 == null || line?.y2 == null) continue;
    if (line.y1 !== line.y2) continue;
    const color = classifyDemarkColor(line.color);
    addLevelCandidate(levelCandidates, {
      price: line.y1,
      source: 'line',
      family: color.family,
      shade: color.shade,
      x1: line.x1,
      x2: line.x2,
    });
  }
  for (const box of boxRows) {
    if (box?.high == null || box?.low == null) continue;
    const color = classifyDemarkColor(box.bgColor ?? box.borderColor);
    addLevelCandidate(levelCandidates, {
      price: box.high,
      source: 'box_high',
      family: color.family,
      shade: color.shade,
      x1: box.x1,
      x2: box.x2,
    });
    addLevelCandidate(levelCandidates, {
      price: box.low,
      source: 'box_low',
      family: color.family,
      shade: color.shade,
      x1: box.x1,
      x2: box.x2,
    });
  }

  const labelsAnalyzed = labelRows.map(item => {
    const rawText = item?.text ?? '';
    const textInfo = normalizeDemarkText(rawText);
    const colorInfo = classifyDemarkColor(item?.textColor ?? item?.color ?? item?.rawColor, colorReferences);
    const bar = item?.x != null ? barLookup?.[String(item.x)] ?? barLookup?.[item.x] ?? null : null;
    const priceForPosition = item?.price_raw != null ? item.price_raw : item?.price;
    const positionInfo = classifyLabelPosition(priceForPosition, bar);
    const directionFromStyle = inferDirectionFromLabelStyle(item?.style);
    const countType = colorInfo.family === 'setup' || colorInfo.family === 'sequential' || colorInfo.family === 'combo'
      ? colorInfo.family
      : 'unknown';
    const markerType = colorInfo.family === 'tdst' ? 'tdst' : null;
    const directionFromPosition = positionInfo.position === 'above_bar' ? 'sell'
      : positionInfo.position === 'below_bar' ? 'buy'
      : null;
    const direction = markerType === 'tdst'
      ? (directionFromPosition || directionFromStyle || colorInfo.direction || null)
      : (directionFromPosition || directionFromStyle || colorInfo.direction || null);
    const classificationConfidence = directionFromPosition
      ? Math.round(((positionInfo.confidence * 0.7) + (colorInfo.confidence * 0.3)) * 1000) / 1000
      : directionFromStyle
        ? Math.round(((colorInfo.confidence * 0.6) + 0.4) * 1000) / 1000
        : Math.round(colorInfo.confidence * 1000) / 1000;
    const isCurrent = typeof lastIndex === 'number' && typeof item?.x === 'number'
      ? item.x >= lastIndex - 2
      : false;
    const riskLevelHint = analyzeRiskHints({
      price: item?.price ?? null,
      x: item?.x ?? null,
      count_type: countType,
      shade: colorInfo.shade,
    }, levelCandidates);

    return {
      id: item?.id ?? null,
      x: item?.x ?? null,
      bar_index: bar?.index ?? (item?.x ?? null),
      bar_number: bar?.index ?? (item?.x ?? null),
      time: formatBarTime(bar?.time ?? null),
      price: item?.price ?? null,
      price_raw: item?.price_raw ?? item?.y ?? null,
      text: textInfo.text,
      cleaned_text: textInfo.cleaned_text,
      count_value: textInfo.count_value,
      count_type: countType,
      marker_type: markerType,
      direction,
      direction_source: directionFromPosition ? 'position' : (directionFromStyle ? 'style' : (colorInfo.direction ? 'color' : null)),
      shade: colorInfo.shade,
      style: item?.style ?? null,
      color: colorInfo.rgb,
      color_argb: colorInfo.argb,
      color_family_confidence: Math.round(colorInfo.confidence * 1000) / 1000,
      color_reference: colorInfo.matched_reference,
      position: positionInfo.position,
      position_confidence: Math.round(positionInfo.confidence * 1000) / 1000,
      position_delta: positionInfo.delta,
      confidence: classificationConfidence,
      is_current: isCurrent,
      is_active: isCurrent,
      is_perfect_setup: textInfo.has_bullet,
      is_extension: textInfo.has_plus,
      risk_level_hint: riskLevelHint,
    };
  });

  const labelsSorted = labelsAnalyzed
    .slice()
    .sort((a, b) => {
      if (a.x == null && b.x == null) return 0;
      if (a.x == null) return 1;
      if (b.x == null) return -1;
      return a.x - b.x;
    });

  const labelsByBarPre = new Map();
  for (const label of labelsSorted) {
    const key = label.bar_index ?? label.x;
    if (key == null) continue;
    if (!labelsByBarPre.has(key)) labelsByBarPre.set(key, []);
    labelsByBarPre.get(key).push(label);
  }

  for (const group of labelsByBarPre.values()) {
    const hasSetupMarker = group.some(label => label.is_perfect_setup || label.color_reference?.family === 'setup');
    for (const label of group) {
      const resolvedType = resolveDemarkCountType(label, hasSetupMarker);
      label.resolved_count_type = resolvedType;
      if (resolvedType !== 'unknown') label.count_type = resolvedType;
    }
  }

  repairAmbiguousCountFamilies(labelsSorted);

  const familyPriority = { setup: 4, sequential: 3, combo: 2, indicator: 1, unknown: 0 };
  const dedupedLabels = [];
  const byKey = new Map();
  for (const label of labelsSorted) {
    const key = [
      label.bar_index,
      label.text,
      label.price,
      label.direction,
      label.style,
      label.resolved_count_type || label.count_type || 'unknown',
      label.marker_type || '',
      label.color_reference?.family || '',
      label.shade || '',
    ].join('|');
    const existing = byKey.get(key);
    const score = familyPriority[label.resolved_count_type || label.count_type || 'unknown'] ?? 0;
    if (!existing || score > existing.score) {
      byKey.set(key, { label, score });
    }
  }
  for (const entry of byKey.values()) dedupedLabels.push(entry.label);
  dedupedLabels.sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.price ?? 0) - (b.price ?? 0));

  const labelsByBar = new Map();
  for (const label of dedupedLabels) {
    const key = label.bar_index ?? label.x;
    if (key == null) continue;
    if (!labelsByBar.has(key)) labelsByBar.set(key, []);
    labelsByBar.get(key).push(label);
  }

  const summary = {
    label_count: dedupedLabels.length,
    current_label_count: dedupedLabels.filter(l => l.is_current).length,
    counts: {
      setup: { buy: 0, sell: 0, unknown: 0 },
      sequential: { buy: 0, sell: 0, unknown: 0 },
      combo: { buy: 0, sell: 0, unknown: 0 },
      indicator: { buy: 0, sell: 0, unknown: 0 },
      unknown: { buy: 0, sell: 0, unknown: 0 },
    },
    markers: {
      perfect_setup: 0,
      extensions: 0,
      tdst: 0,
    },
  };

  for (const label of dedupedLabels) {
    const family = Object.prototype.hasOwnProperty.call(summary.counts, label.count_type) ? label.count_type : 'unknown';
    const dir = label.direction === 'buy' || label.direction === 'sell' ? label.direction : 'unknown';
    summary.counts[family][dir] += 1;
    if (label.is_perfect_setup) summary.markers.perfect_setup += 1;
    if (label.is_extension) summary.markers.extensions += 1;
    if (label.marker_type === 'tdst') summary.markers.tdst += 1;
  }

  const currentLabels = dedupedLabels.filter(l => l.is_current);
  const recentLabels = dedupedLabels.slice(-DEMARK_LABEL_LIMIT);
  const activeSignals = [];
  const seenActive = new Set();
  const activeSource = currentLabels.length > 0 ? currentLabels : recentLabels.slice().reverse();
  for (const label of activeSource) {
    const key = `${label.count_type}:${label.direction}`;
    if (seenActive.has(key)) continue;
    seenActive.add(key);
    activeSignals.push({
      label_id: label.id,
      text: label.text,
      count_type: label.count_type,
      direction: label.direction,
      is_current: label.is_current,
      is_perfect_setup: label.is_perfect_setup,
      is_extension: label.is_extension,
      price: label.price,
      bar_index: label.bar_index,
      bar_number: label.bar_number,
      x: label.x,
      time: label.time,
      confidence: label.confidence,
    });
  }
  const uniqueRiskHints = [];
  const seenRisk = new Set();
  for (const label of currentLabels.length > 0 ? currentLabels : recentLabels) {
    if (!label.risk_level_hint?.level_price) continue;
    const key = `${label.risk_level_hint.level_price}:${label.risk_level_hint.source}:${label.risk_level_hint.family}`;
    if (!seenRisk.has(key)) {
      seenRisk.add(key);
      uniqueRiskHints.push({
        level_price: label.risk_level_hint.level_price,
        source: label.risk_level_hint.source,
        family: label.risk_level_hint.family,
        shade: label.risk_level_hint.shade,
        delta_to_label: label.risk_level_hint.delta_to_label,
        confidence: label.risk_level_hint.confidence,
        related_label_id: label.id,
        related_label_text: label.text,
      });
    }
  }

  const tdstHints = dedupedLabels.filter(l => l.marker_type === 'tdst' || l.color_reference?.family === 'tdst').slice(-20);

  return {
    recognized: /demark/i.test(studyName || '') || /de-mark/i.test(studyName || ''),
    study_name: studyName || null,
    label_count: labelRows.length,
    labels_analyzed: dedupedLabels.length,
    current_bar_index: lastIndex,
    summary,
    active_signals: activeSignals.slice(0, 12).map(sanitizePublicLabel),
    current_labels: currentLabels.slice(-40).map(sanitizePublicLabel),
    labels: recentLabels.map(sanitizePublicLabel),
    risk_level_candidates: uniqueRiskHints.slice(0, 20),
    recent_bars: Object.entries(barLookup || {})
      .map(([key, value]) => ({
        bar_index: Number(key),
        bar_number: Number(key),
        time: formatBarTime(value?.time ?? null),
        open: value?.open ?? null,
        high: value?.high ?? null,
        low: value?.low ?? null,
        close: value?.close ?? null,
        volume: value?.volume ?? null,
      }))
      .filter(bar => Number.isFinite(bar.bar_index))
      .sort((a, b) => a.bar_index - b.bar_index)
      .slice(-2),
    bar_snapshots: Array.from(labelsByBar.entries())
      .map(([key, group]) => {
        const sortedGroup = group.slice().sort((a, b) => {
          if (a.price == null && b.price == null) return 0;
          if (a.price == null) return 1;
          if (b.price == null) return -1;
          return a.price - b.price;
        });
        return {
          bar_index: Number(key),
          bar_number: Number(key),
          time: sortedGroup[0]?.time || null,
          open: barLookup?.[key]?.open ?? null,
          high: barLookup?.[key]?.high ?? null,
          low: barLookup?.[key]?.low ?? null,
          close: barLookup?.[key]?.close ?? null,
          volume: barLookup?.[key]?.volume ?? null,
          labels: sortedGroup.map(label => ({
            id: label.id,
            text: label.text,
            count_value: label.count_value,
            count_type: label.count_type,
            resolved_count_type: label.resolved_count_type || label.count_type,
            direction: label.direction,
            is_current: label.is_current,
            is_perfect_setup: label.is_perfect_setup,
            is_extension: label.is_extension,
            confidence: label.confidence,
            price: label.price,
            price_raw: label.price_raw ?? label.y ?? null,
            x: label.x,
            bar_index: label.bar_index,
            bar_number: label.bar_number,
            time: label.time,
          })),
          counts: sortedGroup.reduce((acc, label) => {
            const keyType = label.count_type === 'setup' || label.count_type === 'sequential' || label.count_type === 'combo' ? label.count_type : 'unknown';
            const keyDir = label.direction === 'buy' || label.direction === 'sell' ? label.direction : 'unknown';
            acc[keyType] = acc[keyType] || { buy: 0, sell: 0, unknown: 0 };
            acc[keyType][keyDir] = (acc[keyType][keyDir] || 0) + 1;
            return acc;
          }, { setup: { buy: 0, sell: 0, unknown: 0 }, sequential: { buy: 0, sell: 0, unknown: 0 }, combo: { buy: 0, sell: 0, unknown: 0 }, unknown: { buy: 0, sell: 0, unknown: 0 } }),
          perfect_setup: sortedGroup.some(label => label.is_perfect_setup),
          extensions: sortedGroup.filter(label => label.is_extension).length,
        };
      })
      .sort((a, b) => a.bar_index - b.bar_index)
      ,
    bar_snapshots_recent: Array.from(labelsByBar.entries())
      .map(([key, group]) => {
        const sortedGroup = group.slice().sort((a, b) => {
          if (a.price == null && b.price == null) return 0;
          if (a.price == null) return 1;
          if (b.price == null) return -1;
          return a.price - b.price;
        });
        return {
          bar_index: Number(key),
          bar_number: Number(key),
          time: sortedGroup[0]?.time || null,
          open: barLookup?.[key]?.open ?? null,
          high: barLookup?.[key]?.high ?? null,
          low: barLookup?.[key]?.low ?? null,
          close: barLookup?.[key]?.close ?? null,
          volume: barLookup?.[key]?.volume ?? null,
          labels: sortedGroup.map(label => ({
            id: label.id,
            text: label.text,
            count_value: label.count_value,
            count_type: label.count_type,
            resolved_count_type: label.resolved_count_type || label.count_type,
            direction: label.direction,
            is_current: label.is_current,
            is_perfect_setup: label.is_perfect_setup,
            is_extension: label.is_extension,
            confidence: label.confidence,
            price: label.price,
            price_raw: label.price_raw ?? label.y ?? null,
            x: label.x,
            bar_index: label.bar_index,
            bar_number: label.bar_number,
            time: label.time,
          })),
          counts: sortedGroup.reduce((acc, label) => {
            const keyType = label.count_type === 'setup' || label.count_type === 'sequential' || label.count_type === 'combo' ? label.count_type : 'unknown';
            const keyDir = label.direction === 'buy' || label.direction === 'sell' ? label.direction : 'unknown';
            acc[keyType] = acc[keyType] || { buy: 0, sell: 0, unknown: 0 };
            acc[keyType][keyDir] = (acc[keyType][keyDir] || 0) + 1;
            return acc;
          }, { setup: { buy: 0, sell: 0, unknown: 0 }, sequential: { buy: 0, sell: 0, unknown: 0 }, combo: { buy: 0, sell: 0, unknown: 0 }, unknown: { buy: 0, sell: 0, unknown: 0 } }),
          perfect_setup: sortedGroup.some(label => label.is_perfect_setup),
          extensions: sortedGroup.filter(label => label.is_extension).length,
        };
      })
      .sort((a, b) => a.bar_index - b.bar_index)
      .slice(-8),
    tdst: {
      label_candidates: tdstHints.slice(-20),
      line_candidates: lineRows
        .filter(line => line?.y1 != null && line?.y2 != null && line.y1 === line.y2)
        .map(line => {
          const color = classifyDemarkColor(line.color);
          return {
            id: line.id ?? null,
            price: Math.round(line.y1 * 100) / 100,
            family: color.family,
            shade: color.shade,
            confidence: color.confidence,
            x1: line.x1 ?? null,
            x2: line.x2 ?? null,
          };
        })
        .filter(l => l.family === 'tdst')
        .slice(-20),
      box_candidates: boxRows
        .map(box => {
          const color = classifyDemarkColor(box.bgColor ?? box.borderColor);
          return {
            id: box.id ?? null,
            high: box.high ?? null,
            low: box.low ?? null,
            family: color.family,
            shade: color.shade,
            confidence: color.confidence,
            x1: box.x1 ?? null,
            x2: box.x2 ?? null,
          };
        })
        .filter(b => b.family === 'tdst')
        .slice(-20),
    },
  };
}

export function normalizeStudyInputs(inputDefinitions, currentInputs = [], { previewLimit = MAX_INPUT_PREVIEW } = {}) {
  const currentMap = new Map();

  if (Array.isArray(currentInputs)) {
    for (const item of currentInputs) {
      if (item && item.id !== undefined) currentMap.set(item.id, item.value);
    }
  } else if (currentInputs && typeof currentInputs === 'object') {
    for (const [id, value] of Object.entries(currentInputs)) currentMap.set(id, value);
  }

  const defs = Array.isArray(inputDefinitions) ? inputDefinitions : [];
  return defs.map(def => {
    const normalized = {
      id: def?.id ?? null,
      name: def?.name ?? def?.localizedName ?? '',
      localized_name: def?.localizedName ?? def?.name ?? '',
      group: def?.group ?? null,
      type: def?.type ?? null,
      display: def?.display ?? null,
      active: def?.active ?? null,
      is_fake: !!def?.isFake,
      hidden: !!def?.isHidden,
    };

    if (def?.inline !== undefined) normalized.inline = def.inline;
    if (def?.min !== undefined) normalized.min = def.min;
    if (def?.max !== undefined) normalized.max = def.max;
    if (def?.step !== undefined) normalized.step = def.step;
    if (Array.isArray(def?.options) && def.options.length > 0) normalized.options = def.options;
    if (def?.defval !== undefined) normalized.default_value = previewLargeString(def.defval, previewLimit);
    if (currentMap.has(def?.id)) normalized.value = previewLargeString(currentMap.get(def.id), previewLimit);

    return normalized;
  });
}

function simplifyMetaInfo(meta = {}) {
  return {
    description: meta.description ?? null,
    short_description: meta.shortDescription ?? null,
    id: meta.id ?? null,
    full_id: meta.fullId ?? null,
    package_id: meta.packageId ?? null,
    short_id: meta.shortId ?? null,
    script_id_part: meta.scriptIdPart ?? null,
    version: meta.version ?? null,
    pine: meta.pine ?? null,
    product_id: meta.productId ?? null,
    is_price_study: meta.is_price_study ?? null,
    is_hidden_study: meta.is_hidden_study ?? null,
    is_tv_script: meta.isTVScript ?? null,
    use_version_from_meta_info: meta.useVersionFromMetaInfo ?? null,
  };
}

function buildGraphicsJS(collectionName, mapKey, filter) {
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var filter = ${safeString(filter || '')};
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            } catch(e) {}
          }
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

export async function getOhlcv({ count, summary } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: Math.round((Math.max(...highs) - Math.min(...lows)) * 100) / 100,
      change: Math.round((last.close - first.open) * 100) / 100,
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

export async function getIndicator({ entity_id }) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var result = { name: null, inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      try { result.inputs = study.getInputValues(); } catch(e) { result.inputs_error = e.message; }
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

export async function getIndicatorSnapshot({ entity_id, compact = false, selection = { mode: 'latest', value: null } } = {}) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  const normalizedSelection = normalizeSelection(selection);
  const selectionMode = normalizedSelection.mode;
  const selectionValue = normalizedSelection.value;
  const studyValuesSnapshot = await getStudyValues().catch(() => null);
  const chartReference = extractDebugChartReference(studyValuesSnapshot?.studies || []);

  const snapshot = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };

      var inner = study._study || study;
      var meta = {};
      try { meta = inner && typeof inner.metaInfo === 'function' ? inner.metaInfo() : {}; } catch(e) {}

      var inputDefinitions = [];
      try { inputDefinitions = typeof study.getInputsInfo === 'function' ? study.getInputsInfo() : []; } catch(e) {}

      var currentInputs = [];
      try { currentInputs = typeof study.getInputValues === 'function' ? study.getInputValues() : []; } catch(e) {}

      var styleValues = {};
      try { styleValues = typeof study.getStyleValues === 'function' ? study.getStyleValues() : {}; } catch(e) {}

      function previewLargeString(value, limit) {
        if (typeof value !== 'string' || value.length <= limit) return value;
        return { preview: value.slice(0, limit), length: value.length, truncated: true };
      }

      function simplifyMetaInfo(metaInfo) {
        return {
          description: metaInfo.description || null,
          shortDescription: metaInfo.shortDescription || null,
          id: metaInfo.id || null,
          fullId: metaInfo.fullId || null,
          packageId: metaInfo.packageId || null,
          shortId: metaInfo.shortId || null,
          scriptIdPart: metaInfo.scriptIdPart || null,
          version: metaInfo.version || null,
          pine: metaInfo.pine || null,
          productId: metaInfo.productId || null,
          is_price_study: metaInfo.is_price_study != null ? metaInfo.is_price_study : null,
          is_hidden_study: metaInfo.is_hidden_study != null ? metaInfo.is_hidden_study : null,
          isTVScript: metaInfo.isTVScript != null ? metaInfo.isTVScript : null,
          useVersionFromMetaInfo: metaInfo.useVersionFromMetaInfo != null ? metaInfo.useVersionFromMetaInfo : null,
        };
      }

      function sanitizeInput(def) {
        def = def || {};
        return {
          id: def.id || null,
          name: def.name || def.localizedName || '',
          localizedName: def.localizedName || def.name || '',
          group: def.group || null,
          type: def.type || null,
          display: def.display != null ? def.display : null,
          active: def.active != null ? def.active : null,
          isFake: !!def.isFake,
          isHidden: !!def.isHidden,
          inline: def.inline != null ? def.inline : undefined,
          min: def.min != null ? def.min : undefined,
          max: def.max != null ? def.max : undefined,
          step: def.step != null ? def.step : undefined,
          options: Array.isArray(def.options) ? def.options : undefined,
          defval: previewLargeString(def.defval, ${MAX_INPUT_PREVIEW}),
        };
      }

      function sanitizeCurrentInput(input) {
        return {
          id: input && input.id !== undefined ? input.id : null,
          value: input ? previewLargeString(input.value, ${MAX_INPUT_PREVIEW}) : null,
        };
      }

      function collectItems(collectionName, mapKey) {
        var items = [];
        try {
          var graphics = inner && inner._graphics;
          if (!graphics || !graphics._primitivesCollection) return items;
          var pc = graphics._primitivesCollection;
          var outer = pc[collectionName];
          if (!outer) return items;
          var innerCollection = outer.get(mapKey);
          if (!innerCollection) return items;
          var coll = innerCollection.get(false);
          if (!coll || !coll._primitivesDataById || coll._primitivesDataById.size === 0) return items;
          coll._primitivesDataById.forEach(function(v, id) { items.push({ id: id, raw: v }); });
        } catch(e) {}
        return items;
      }

      var graphicsSummary = {
        line_count: collectItems('dwglines', 'lines').length,
        label_count: collectItems('dwglabels', 'labels').length,
        box_count: collectItems('dwgboxes', 'boxes').length,
        table_cell_count: 0,
      };

      var tableCells = collectItems('dwgtablecells', 'tableCells');
      if (tableCells.length === 0) tableCells = collectItems('dwgtablecells', 'tableCells');
      graphicsSummary.table_cell_count = tableCells.length;

      var bars = ${BARS_PATH};
      var barLookup = {};
      var firstIndex = null;
      var lastIndex = null;
      var visibleRange = null;
      var chartReferenceBarIndex = ${Number.isFinite(chartReference?.bar_index) ? Number(chartReference.bar_index) : 'null'};
      var chartReferenceTimeRaw = ${Number.isFinite(chartReference?.time_raw) ? Number(chartReference.time_raw) : 'null'};
      var chartResolution = null;
      var selectionMode = ${safeString(selectionMode)};
      var selectionValue = ${safeString(selectionValue)};
      try {
        if (bars && typeof bars.firstIndex === 'function' && typeof bars.lastIndex === 'function') {
          firstIndex = bars.firstIndex();
          lastIndex = bars.lastIndex();
        }
      } catch(e) {}

      try {
        var range = api.getVisibleRange();
        if (range) visibleRange = { from: range.from != null ? range.from : null, to: range.to != null ? range.to : null };
      } catch(e) {}
      try {
        chartResolution = typeof api.resolution === 'function' ? api.resolution() : null;
      } catch(e) {}
      var visiblePriceRange = null;
      try {
        var modelForPriceRange = api && api._chartWidget && typeof api._chartWidget.model === 'function'
          ? api._chartWidget.model()
          : null;
        var ps = modelForPriceRange && modelForPriceRange.mainSeries && modelForPriceRange.mainSeries().priceScale
          ? modelForPriceRange.mainSeries().priceScale()
          : null;
        var pr = ps && typeof ps.priceRange === 'function' ? ps.priceRange() : ps && ps._priceRange ? ps._priceRange : null;
        if (pr) {
          var minValue = typeof pr.minValue === 'function' ? pr.minValue() : pr._minValue;
          var maxValue = typeof pr.maxValue === 'function' ? pr.maxValue() : pr._maxValue;
          if (isFinite(minValue) && isFinite(maxValue)) {
            visiblePriceRange = { min: minValue, max: maxValue };
          }
        }
      } catch(e) {}

      function collectVerbose(collectionName, mapKey, mapper) {
        var items = [];
        try {
          var graphics = inner && inner._graphics;
          if (!graphics || !graphics._primitivesCollection) return items;
          var pc = graphics._primitivesCollection;
          var outer = pc[collectionName];
          if (!outer) return items;
          var innerCollection = outer.get(mapKey);
          if (!innerCollection) return items;
          var coll = innerCollection.get(false);
          if (!coll || !coll._primitivesDataById || coll._primitivesDataById.size === 0) return items;
          coll._primitivesDataById.forEach(function(v, id) {
            try { items.push(mapper(v, id)); } catch(e) {}
          });
        } catch(e) {}
        return items;
      }

      function buildBarAtIndex(index) {
        if (!bars || typeof bars.valueAt !== 'function') return null;
        if (typeof index !== 'number' || !isFinite(index)) return null;
        if (firstIndex != null && index < firstIndex) return null;
        if (lastIndex != null && index > lastIndex) return null;
        var v = null;
        try { v = bars.valueAt(index); } catch(e) { v = null; }
        if (!v) return null;
        return { index: index, time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 };
      }

      function normalizeTargetTime(value) {
        if (typeof value === 'number' && isFinite(value)) {
          return value > 1000000000000 ? Math.floor(value / 1000) : Math.floor(value);
        }
        var raw = String(value != null ? value : '').trim();
        if (!raw) return null;
        if (/^\d+$/.test(raw)) {
          var numeric = Number(raw);
          if (!isFinite(numeric)) return null;
          return numeric > 1000000000000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
        }
        var parsed = Date.parse(raw);
        if (!isFinite(parsed)) return null;
        return Math.floor(parsed / 1000);
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
        if (!isFinite(targetTime) || firstIndex == null || lastIndex == null) return null;
        for (var index = firstIndex; index <= lastIndex; index++) {
          var v = null;
          try { v = bars.valueAt(index); } catch(e) { v = null; }
          if (!v) continue;
          var barTime = Number(v[0]);
          if (!isFinite(barTime)) continue;
          if (barTime === targetTime) return buildBarAtIndex(index);
        }
        return null;
      }

      function resolveNearestBarByTime(targetTime) {
        if (!isFinite(targetTime) || firstIndex == null || lastIndex == null) return null;
        var best = null;
        for (var index = firstIndex; index <= lastIndex; index++) {
          var v = null;
          try { v = bars.valueAt(index); } catch(e) { v = null; }
          if (!v) continue;
          var barTime = Number(v[0]);
          if (!isFinite(barTime)) continue;
          var score = Math.abs(barTime - targetTime);
          if (!best || score < best.score || (score === best.score && index > best.index)) {
            best = { index: index, score: score };
          }
        }
        return best ? buildBarAtIndex(best.index) : null;
      }

        function resolveSelectedChartBar() {
          if (!bars || typeof bars.valueAt !== 'function' || firstIndex == null || lastIndex == null) return null;
          if (selectionMode === 'latest') {
            return buildBarAtIndex(lastIndex);
          }
        if (selectionMode === 'bar_index') {
          var targetIndex = Number(selectionValue);
          if (!Number.isFinite(targetIndex)) return null;
          var projectedTime = projectTimeFromGlobalIndex(targetIndex);
          if (isFinite(projectedTime)) {
            return resolveExactBarByTime(projectedTime) || resolveNearestBarByTime(projectedTime) || null;
          }
          return buildBarAtIndex(targetIndex);
        }
        if (selectionMode === 'visible') {
          if (visibleRange && visibleRange.from != null && visibleRange.to != null) {
            var visibleTarget = Math.floor((Number(visibleRange.from) + Number(visibleRange.to)) / 2);
            return resolveNearestBarByTime(visibleTarget) || buildBarAtIndex(lastIndex);
          }
          return buildBarAtIndex(lastIndex);
        }
        if (selectionMode === 'time') {
          var targetTime = normalizeTargetTime(selectionValue);
          return targetTime != null ? resolveExactBarByTime(targetTime) : null;
        }
        return buildBarAtIndex(lastIndex);
      }

      var verboseLabels = collectVerbose('dwglabels', 'labels', function(v, id) {
        return {
          id: id,
          text: v.t || '',
          price: v.y != null ? Math.round(v.y * 100) / 100 : null,
          price_raw: v.y != null ? v.y : null,
          x: v.x != null ? v.x : null,
          y: v.y != null ? v.y : null,
          yloc: v.yl != null ? v.yl : null,
          style: v.st != null ? v.st : null,
          size: v.sz != null ? v.sz : null,
          textColor: v.tci != null ? v.tci : null,
          color: v.ci != null ? v.ci : null,
        };
      });

      var verboseLines = collectVerbose('dwglines', 'lines', function(v, id) {
        return {
          id: id,
          y1: v.y1 != null ? v.y1 : null,
          y2: v.y2 != null ? v.y2 : null,
          x1: v.x1 != null ? v.x1 : null,
          x2: v.x2 != null ? v.x2 : null,
          color: v.ci != null ? v.ci : null,
          style: v.st != null ? v.st : null,
          width: v.w != null ? v.w : null,
        };
      });

      var verboseBoxes = collectVerbose('dwgboxes', 'boxes', function(v, id) {
        return {
          id: id,
          high: v.y1 != null && v.y2 != null ? Math.max(v.y1, v.y2) : null,
          low: v.y1 != null && v.y2 != null ? Math.min(v.y1, v.y2) : null,
          x1: v.x1 != null ? v.x1 : null,
          x2: v.x2 != null ? v.x2 : null,
          borderColor: v.c != null ? v.c : null,
          bgColor: v.bc != null ? v.bc : null,
        };
      });

      try {
        var requestedIndexes = typeof requestedIndexes === 'object' && requestedIndexes ? requestedIndexes : {};
        var selectedChartBar = resolveSelectedChartBar();
        if (selectedChartBar && typeof selectedChartBar.index === 'number' && isFinite(selectedChartBar.index)) {
          requestedIndexes[Math.round(selectedChartBar.index)] = true;
        }
        for (var li = 0; li < verboseLabels.length; li++) {
          var lx = verboseLabels[li].x;
          if (typeof lx === 'number' && isFinite(lx)) requestedIndexes[Math.round(lx)] = true;
        }
        for (var ln = 0; ln < verboseLines.length; ln++) {
          var line = verboseLines[ln];
          if (typeof line.x1 === 'number' && isFinite(line.x1)) requestedIndexes[Math.round(line.x1)] = true;
          if (typeof line.x2 === 'number' && isFinite(line.x2)) requestedIndexes[Math.round(line.x2)] = true;
        }
        for (var bi = 0; bi < verboseBoxes.length; bi++) {
          var box = verboseBoxes[bi];
          if (typeof box.x1 === 'number' && isFinite(box.x1)) requestedIndexes[Math.round(box.x1)] = true;
          if (typeof box.x2 === 'number' && isFinite(box.x2)) requestedIndexes[Math.round(box.x2)] = true;
        }
        Object.keys(requestedIndexes).forEach(function(key) {
          var index = Number(key);
          if (!Number.isFinite(index)) return;
          if (firstIndex != null && index < firstIndex) return;
          if (lastIndex != null && index > lastIndex) return;
          var v = bars.valueAt(index);
          if (!v) return;
          barLookup[index] = { index: index, time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 };
        });
      } catch(e) {}

      var selectedChartBar = resolveSelectedChartBar();

      return {
        entity_id: ${safeString(entity_id)},
        visible: typeof study.isVisible === 'function' ? study.isVisible() : null,
        study_meta: simplifyMetaInfo(meta),
        input_definitions: Array.isArray(inputDefinitions) ? inputDefinitions.map(sanitizeInput) : [],
        current_inputs: Array.isArray(currentInputs) ? currentInputs.map(sanitizeCurrentInput) : [],
        style_values: styleValues,
        graphics_summary: graphicsSummary,
        graphics: {
          first_index: firstIndex,
          last_index: lastIndex,
          bars: barLookup,
          labels: verboseLabels,
          lines: verboseLines,
          boxes: verboseBoxes,
        },
        selected_bar: selectedChartBar,
        visible_range: visibleRange,
        visible_price_range: visiblePriceRange,
        chart_resolution: typeof api.resolution === 'function' ? api.resolution() : null,
      };
    })()
  `);

  if (snapshot?.error) throw new Error(snapshot.error);

  const inputs = normalizeStudyInputs(snapshot?.input_definitions || [], snapshot?.current_inputs || []);
  const colorReferences = buildDemarkColorReferencesFromInputs(inputs);
  const studyName = snapshot?.study_meta?.description || snapshot?.study_meta?.short_description || snapshot?.study_meta?.shortDescription || null;
  const demark = analyzeDemarkGraphics({
    labels: snapshot?.graphics?.labels || [],
    lines: snapshot?.graphics?.lines || [],
    boxes: snapshot?.graphics?.boxes || [],
    barLookup: snapshot?.graphics?.bars || {},
    lastIndex: snapshot?.graphics?.last_index ?? null,
    studyName,
    colorReferences,
    visiblePriceRange: snapshot?.visible_price_range || null,
  });
  const resolvedSnapshot = demark?.recognized ? buildResolvedDemarkSnapshot(demark, snapshot?.visible_range || null, {
    selection,
    chart_bar: snapshot?.selected_bar || null,
    chart_reference: chartReference,
    chart_resolution: snapshot?.chart_resolution || null,
  }) : null;
  const fullResult = {
    success: true,
    entity_id,
    visible: snapshot?.visible,
    study_meta: snapshot?.study_meta || simplifyMetaInfo({}),
    input_count: inputs.length,
    inputs,
    style_values: snapshot?.style_values || {},
    graphics_summary: snapshot?.graphics_summary || { line_count: 0, label_count: 0, box_count: 0, table_cell_count: 0 },
    recent_bars: demark?.recent_bars || [],
    demark: demark?.recognized ? demark : null,
    visible_range: snapshot?.visible_range ?? null,
    ...(resolvedSnapshot || {}),
    resolved_snapshot: resolvedSnapshot,
    source: 'indicator_snapshot',
  };

  if (!compact) return fullResult;

  return {
    success: true,
    entity_id,
    visible: snapshot?.visible,
    study_meta: snapshot?.study_meta || simplifyMetaInfo({}),
    input_count: inputs.length,
    inputs,
    style_values: snapshot?.style_values || {},
    graphics_summary: snapshot?.graphics_summary || { line_count: 0, label_count: 0, box_count: 0, table_cell_count: 0 },
    recent_bars: demark?.recent_bars || [],
    visible_range: snapshot?.visible_range ?? null,
    resolved_snapshot: resolvedSnapshot,
    demark: demark?.recognized ? {
      recognized: true,
      study_name: demark.study_name,
      label_count: demark.label_count,
      labels_analyzed: demark.labels_analyzed,
      current_bar_index: demark.current_bar_index,
      summary: demark.summary,
      recent_bars: demark.recent_bars,
    } : null,
    source: 'indicator_snapshot',
  };
}

export async function getDemarkSnapshot({ entity_id, compact = true, selection = { mode: 'latest', value: null } }) {
  const snapshot = await getIndicatorSnapshot({ entity_id, compact, selection });
  const demark = snapshot?.demark;
  if (!demark) {
    return {
      success: true,
      entity_id,
      recognized: false,
      reason: 'Indicator snapshot did not resolve as DeMARK.',
      visible: snapshot?.visible ?? null,
      study_meta: snapshot?.study_meta ?? null,
      input_count: snapshot?.input_count ?? 0,
      inputs: snapshot?.inputs ?? [],
      style_values: snapshot?.style_values ?? {},
      graphics_summary: snapshot?.graphics_summary ?? { line_count: 0, label_count: 0, box_count: 0, table_cell_count: 0 },
      recent_bars: snapshot?.recent_bars ?? [],
      visible_range: snapshot?.visible_range ?? null,
      resolved_snapshot: null,
      indicator_snapshot: {
        success: snapshot?.success ?? true,
        entity_id: snapshot?.entity_id ?? entity_id,
        visible: snapshot?.visible ?? null,
        study_meta: snapshot?.study_meta ?? null,
        input_count: snapshot?.input_count ?? 0,
        inputs: snapshot?.inputs ?? [],
        style_values: snapshot?.style_values ?? {},
        graphics_summary: snapshot?.graphics_summary ?? { line_count: 0, label_count: 0, box_count: 0, table_cell_count: 0 },
        recent_bars: snapshot?.recent_bars ?? [],
        visible_range: snapshot?.visible_range ?? null,
        demark: null,
      },
    };
  }

  const resolvedSnapshot = snapshot?.resolved_snapshot || buildResolvedDemarkSnapshot(demark, snapshot?.visible_range || null, {
    selection,
    chart_bar: snapshot?.selected_bar || null,
  });

  return {
    success: true,
    entity_id,
    visible: snapshot?.visible ?? null,
    study_meta: snapshot?.study_meta || null,
    ...(resolvedSnapshot || {}),
    resolved_snapshot: resolvedSnapshot,
    indicator_snapshot: {
      success: snapshot?.success ?? true,
      entity_id: snapshot?.entity_id ?? entity_id,
      visible: snapshot?.visible ?? null,
      study_meta: snapshot?.study_meta || null,
      input_count: snapshot?.input_count ?? 0,
      inputs: snapshot?.inputs ?? [],
      style_values: snapshot?.style_values ?? {},
      graphics_summary: snapshot?.graphics_summary ?? { line_count: 0, label_count: 0, box_count: 0, table_cell_count: 0 },
      recent_bars: snapshot?.recent_bars ?? [],
      visible_range: snapshot?.visible_range ?? null,
      demark: snapshot?.demark ?? null,
    },
    visible_range: snapshot?.visible_range ?? null,
    source: 'demark_snapshot',
  };
}

export async function getStrategyResults() {
  const results = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.reportData || s.performance)) { strat = s; break; }
        }
        if (!strat) return {metrics: {}, source: 'internal_api', error: 'No strategy found on chart. Add a strategy indicator first.'};
        var metrics = {};
        if (strat.reportData) {
          var rd = typeof strat.reportData === 'function' ? strat.reportData() : strat.reportData;
          if (rd && typeof rd === 'object') {
            if (typeof rd.value === 'function') rd = rd.value();
            if (rd) { var keys = Object.keys(rd); for (var k = 0; k < keys.length; k++) { var val = rd[keys[k]]; if (val !== null && val !== undefined && typeof val !== 'function') metrics[keys[k]] = val; } }
          }
        }
        if (Object.keys(metrics).length === 0 && strat.performance) {
          var perf = strat.performance();
          if (perf && typeof perf.value === 'function') perf = perf.value();
          if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { var pval = perf[pkeys[p]]; if (pval !== null && pval !== undefined && typeof pval !== 'function') metrics[pkeys[p]] = pval; } }
        }
        return {metrics: metrics, source: 'internal_api'};
      } catch(e) { return {metrics: {}, source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, metric_count: Object.keys(results?.metrics || {}).length, source: results?.source, metrics: results?.metrics || {}, error: results?.error };
}

export async function getTrades({ max_trades } = {}) {
  const limit = Math.min(max_trades || 20, MAX_TRADES);
  const trades = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.ordersData || s.reportData)) { strat = s; break; }
        }
        if (!strat) return {trades: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var orders = null;
        if (strat.ordersData) { orders = typeof strat.ordersData === 'function' ? strat.ordersData() : strat.ordersData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        if (!orders || !Array.isArray(orders)) {
          if (strat._orders) orders = strat._orders;
          else if (strat.tradesData) { orders = typeof strat.tradesData === 'function' ? strat.tradesData() : strat.tradesData; if (orders && typeof orders.value === 'function') orders = orders.value(); }
        }
        if (!orders || !Array.isArray(orders)) return {trades: [], source: 'internal_api', error: 'ordersData() returned non-array.'};
        var result = [];
        for (var t = 0; t < Math.min(orders.length, ${limit}); t++) {
          var o = orders[t];
          if (typeof o === 'object' && o !== null) {
            var trade = {};
            var okeys = Object.keys(o);
            for (var k = 0; k < okeys.length; k++) { var v = o[okeys[k]]; if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') trade[okeys[k]] = v; }
            result.push(trade);
          }
        }
        return {trades: result, source: 'internal_api'};
      } catch(e) { return {trades: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, trade_count: trades?.trades?.length || 0, source: trades?.source, trades: trades?.trades || [], error: trades?.error };
}

export async function getEquity() {
  const equity = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API}._chartWidget;
        var sources = chart.model().model().dataSources();
        var strat = null;
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i];
          if (s.metaInfo && s.metaInfo().is_price_study === false && (s.reportData || s.performance)) { strat = s; break; }
        }
        if (!strat) return {data: [], source: 'internal_api', error: 'No strategy found on chart.'};
        var data = [];
        if (strat.equityData) {
          var eq = typeof strat.equityData === 'function' ? strat.equityData() : strat.equityData;
          if (eq && typeof eq.value === 'function') eq = eq.value();
          if (Array.isArray(eq)) data = eq;
        }
        if (data.length === 0 && strat.bars) {
          var bars = typeof strat.bars === 'function' ? strat.bars() : strat.bars;
          if (bars && typeof bars.lastIndex === 'function') {
            var end = bars.lastIndex(); var start = bars.firstIndex();
            for (var i = start; i <= end; i++) { var v = bars.valueAt(i); if (v) data.push({time: v[0], equity: v[1], drawdown: v[2] || null}); }
          }
        }
        if (data.length === 0) {
          var perfData = {};
          if (strat.performance) {
            var perf = strat.performance();
            if (perf && typeof perf.value === 'function') perf = perf.value();
            if (perf && typeof perf === 'object') { var pkeys = Object.keys(perf); for (var p = 0; p < pkeys.length; p++) { if (/equity|drawdown|profit|net/i.test(pkeys[p])) perfData[pkeys[p]] = perf[pkeys[p]]; } }
          }
          if (Object.keys(perfData).length > 0) return {data: [], equity_summary: perfData, source: 'internal_api', note: 'Full equity curve not available via API; equity summary metrics returned instead.'};
        }
        return {data: data, source: 'internal_api'};
      } catch(e) { return {data: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return { success: true, data_points: equity?.data?.length || 0, source: equity?.source, data: equity?.data || [], equity_summary: equity?.equity_summary, note: equity?.note, error: equity?.error };
}

export async function getQuote({ symbol } = {}) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var sym = ${safeString(symbol || '')};
      if (!sym) { try { sym = api.symbol(); } catch(e) {} }
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        var bidEl = document.querySelector('[class*="bid"] [class*="price"], [class*="dom-"] [class*="bid"]');
        var askEl = document.querySelector('[class*="ask"] [class*="price"], [class*="dom-"] [class*="ask"]');
        if (bidEl) quote.bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
        if (askEl) quote.ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (!data.last && !data.close)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  return { success: true, ...data };
}

export async function getDepth() {
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else if (i < rows.length / 2) asks.push({ price, size });
        else bids.push({ price, size });
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (item._value && item._value !== '∅' && item._title) values[item._title] = item._value;
                }
              }
            }
          } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ name: name, values: values });
        } catch(e) {}
      }
      return results;
    })()
  `);
  return { success: true, study_count: data?.length || 0, studies: data || [] };
}

export async function getPineLines({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglines', 'lines', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    for (const item of s.items) {
      const v = item.raw;
      const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
      const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
      if (verbose) allLines.push({ id: item.id, y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci });
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (verbose) result.all_lines = allLines;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineLabels({ study_filter, max_labels, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglabels', 'labels', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const limit = max_labels || 50;
  const studies = raw.map(s => {
    let labels = s.items.map(item => {
      const v = item.raw;
      const text = v.t || '';
      const price = v.y != null ? Math.round(v.y * 100) / 100 : null;
      const price_raw = v.y != null ? v.y : null;
      if (verbose) return { id: item.id, text, price, price_raw, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price, price_raw };
    }).filter(l => l.text || l.price != null);
    if (labels.length > limit) labels = labels.slice(-limit);
    return { name: s.name, total_labels: s.count, showing: labels.length, labels };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineTables({ study_filter } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgtablecells', 'tableCells', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineBoxes({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
      const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}


