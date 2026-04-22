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

export function classifyDemarkColor(argb) {
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
  for (const [family, shades] of Object.entries(DEMARK_COLOR_REFERENCES)) {
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

  if (price > high) {
    const delta = price - high;
    return { position: 'above_bar', confidence: clamp01(delta / Math.max(Math.abs(high) * 0.002, 1)), delta: Math.round(delta * 100) / 100 };
  }
  if (price < low) {
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

function resolveDemarkCountType(label, groupHasSetupMarker) {
  const family = label?.color_reference?.family || 'unknown';

  if (family === 'tdst') {
    if (label?.is_perfect_setup) return 'setup';
    if (groupHasSetupMarker && label?.count_value === 1) return 'sequential';
    if (groupHasSetupMarker && label?.count_value === 9) return 'combo';
    if (groupHasSetupMarker && label?.count_value != null) return 'combo';
    return 'unknown';
  }

  if (label?.marker_type === 'tdst') return 'unknown';
  if (label?.is_perfect_setup) return 'setup';
  if (groupHasSetupMarker) {
    if (label?.count_value === 1) return 'sequential';
    if (label?.count_value === 9) return 'combo';
  }
  if (family === 'setup') return 'setup';
  if (family === 'sequential') return 'sequential';
  if (family === 'combo') return 'combo';

  if (label?.count_value === 1) return 'sequential';
  if (label?.count_value === 9) return 'combo';
  return 'unknown';
}

export function analyzeDemarkGraphics({ labels = [], lines = [], boxes = [], barLookup = {}, lastIndex = null, studyName = 'DeMARK 9-13' } = {}) {
  const labelRows = Array.isArray(labels) ? labels : [];
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
    const colorInfo = classifyDemarkColor(item?.textColor ?? item?.color ?? item?.rawColor);
    const bar = item?.x != null ? barLookup?.[String(item.x)] ?? barLookup?.[item.x] ?? null : null;
    const positionInfo = classifyLabelPosition(item?.price, bar);
    const countType = colorInfo.family === 'setup' || colorInfo.family === 'sequential' || colorInfo.family === 'combo'
      ? colorInfo.family
      : 'unknown';
    const markerType = colorInfo.family === 'tdst' ? 'tdst' : null;
    const directionFromPosition = positionInfo.position === 'above_bar' ? 'sell'
      : positionInfo.position === 'below_bar' ? 'buy'
      : null;
    const direction = markerType === 'tdst' ? directionFromPosition : (directionFromPosition || colorInfo.direction || null);
    const classificationConfidence = directionFromPosition
      ? Math.round(((positionInfo.confidence * 0.7) + (colorInfo.confidence * 0.3)) * 1000) / 1000
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
      text: textInfo.text,
      cleaned_text: textInfo.cleaned_text,
      count_value: textInfo.count_value,
      count_type: countType,
      marker_type: markerType,
      direction,
      direction_source: directionFromPosition ? 'position' : (colorInfo.direction ? 'color' : null),
      shade: colorInfo.shade,
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

  const labelsByBar = new Map();
  for (const label of labelsSorted) {
    const key = label.bar_index ?? label.x;
    if (key == null) continue;
    if (!labelsByBar.has(key)) labelsByBar.set(key, []);
    labelsByBar.get(key).push(label);
  }

  for (const group of labelsByBar.values()) {
    const hasSetupMarker = group.some(label => label.is_perfect_setup || label.color_reference?.family === 'setup');
    for (const label of group) {
      const resolvedType = resolveDemarkCountType(label, hasSetupMarker);
      label.resolved_count_type = resolvedType;
      if (resolvedType !== 'unknown') label.count_type = resolvedType;
    }
  }

  const summary = {
    label_count: labelsSorted.length,
    current_label_count: labelsSorted.filter(l => l.is_current).length,
    counts: {
      setup: { buy: 0, sell: 0, unknown: 0 },
      sequential: { buy: 0, sell: 0, unknown: 0 },
      combo: { buy: 0, sell: 0, unknown: 0 },
      unknown: { buy: 0, sell: 0, unknown: 0 },
    },
    markers: {
      perfect_setup: 0,
      extensions: 0,
    },
  };

  for (const label of labelsSorted) {
    const family = Object.prototype.hasOwnProperty.call(summary.counts, label.count_type) ? label.count_type : 'unknown';
    const dir = label.direction === 'buy' || label.direction === 'sell' ? label.direction : 'unknown';
    summary.counts[family][dir] += 1;
    if (label.is_perfect_setup) summary.markers.perfect_setup += 1;
    if (label.is_extension) summary.markers.extensions += 1;
  }

  const currentLabels = labelsSorted.filter(l => l.is_current);
  const recentLabels = labelsSorted.slice(-DEMARK_LABEL_LIMIT);
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
      x: label.x,
      bar_index: label.bar_index,
      bar_number: label.bar_number,
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

  const tdstHints = labelsSorted.filter(l => l.marker_type === 'tdst' || l.color_reference?.family === 'tdst').slice(-20);

  return {
    recognized: /demark/i.test(studyName || '') || /de-mark/i.test(studyName || ''),
    study_name: studyName || null,
    label_count: labelRows.length,
    labels_analyzed: labelsSorted.length,
    current_bar_index: lastIndex,
    summary,
    active_signals: activeSignals.slice(0, 12),
    current_labels: currentLabels.slice(-40),
    labels: recentLabels,
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

function decodeVwapDvaRow(row) {
  if (!row || !Array.isArray(row.value)) return null;
  const v = row.value;
  return {
    bar_index: typeof row.index === 'number' ? row.index : null,
    time: typeof v[0] === 'number' ? v[0] : null,
    bar: row.bar && typeof row.bar === 'object' ? {
      open: typeof row.bar.open === 'number' ? row.bar.open : null,
      high: typeof row.bar.high === 'number' ? row.bar.high : null,
      low: typeof row.bar.low === 'number' ? row.bar.low : null,
      close: typeof row.bar.close === 'number' ? row.bar.close : null,
      volume: typeof row.bar.volume === 'number' ? row.bar.volume : null,
    } : null,
    variables: {
      VWAP: typeof v[1] === 'number' ? v[1] : null,
      DVAH: typeof v[3] === 'number' ? v[3] : null,
      DVAL: typeof v[5] === 'number' ? v[5] : null,
      'DVA+2': typeof v[7] === 'number' ? v[7] : null,
      'DVA-2': typeof v[9] === 'number' ? v[9] : null,
      'DVA+3': typeof v[11] === 'number' ? v[11] : null,
      'DVA-3': typeof v[13] === 'number' ? v[13] : null,
      'middle up 0.5': typeof v[15] === 'number' ? v[15] : null,
      'middle down 0.5': typeof v[17] === 'number' ? v[17] : null,
      'Middle up 1.5': typeof v[19] === 'number' ? v[19] : null,
      'Middle down 1.5': typeof v[21] === 'number' ? v[21] : null,
    },
  };
}

function formatVwapDvaValue(value) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function getVwapDvaPeriodType(resolution) {
  const token = String(resolution ?? '').toLowerCase();
  if (token === '480' || token === '8h') return 'quarterly';
  if (token === '120' || token === '2h') return 'monthly';
  if (token === '30' || token === '30m') return 'weekly';
  if (token === 'm' || token === '1m') return 'monthly';
  if (token === 'w' || token === '1w') return 'weekly';
  if (token === 'd' || token === '1d') return 'annual';
  return null;
}

function getVwapDvaAnchorLabel(resolution, periodType) {
  const token = String(resolution ?? '').toLowerCase();
  if (periodType === 'annual') return 'Year';
  if (periodType === 'quarterly') return 'Quarter';
  if (periodType === 'monthly') return token === 'm' || token === '1m' ? 'Decade' : 'Month';
  if (periodType === 'weekly') return token === 'w' || token === '1w' ? 'HalfDecade' : 'Week';
  return null;
}

function getVwapDvaDominanceRule(anchor) {
  switch (anchor) {
    case 'Week':
      return { label: 'previous dominates the first day of the period, then current dominates', duration: { days: 1 } };
    case 'Month':
      return { label: 'previous dominates the first week of the period, then current dominates', duration: { days: 7 } };
    case 'Quarter':
      return { label: 'previous dominates the first month of the period, then current dominates', duration: { months: 1 } };
    case 'Year':
      return { label: 'previous dominates the first quarter of the period, then current dominates', duration: { months: 3 } };
    case 'HalfDecade':
      return { label: 'previous dominates the first year of the period, then current dominates', duration: { years: 1 } };
    case 'Decade':
      return { label: 'previous dominates the first two years of the period, then current dominates', duration: { years: 2 } };
    default:
      return null;
  }
}

function getVwapDvaAnchorSpan(anchor) {
  switch (anchor) {
    case 'Week':
      return { days: 7 };
    case 'Month':
      return { months: 1 };
    case 'Quarter':
      return { months: 3 };
    case 'Year':
      return { years: 1 };
    case 'HalfDecade':
      return { years: 5 };
    case 'Decade':
      return { years: 10 };
    default:
      return null;
  }
}

function addUtcDuration(time, { days = 0, months = 0, years = 0 } = {}) {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  const date = new Date(time * 1000);
  if (years) date.setUTCFullYear(date.getUTCFullYear() + years);
  if (months) date.setUTCMonth(date.getUTCMonth() + months);
  if (days) date.setUTCDate(date.getUTCDate() + days);
  return Math.floor(date.getTime() / 1000);
}

function getUtcIsoWeekParts(time) {
  const date = new Date(time * 1000);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return { weekYear: utcDate.getUTCFullYear(), week };
}

function getVwapDvaPeriodKey(time, periodType) {
  if (typeof time !== 'number' || !isFinite(time)) return null;
  const date = new Date(time * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (periodType === 'annual') return `${year}`;
  if (periodType === 'quarterly') return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  if (periodType === 'monthly') return `${year}-${String(month).padStart(2, '0')}`;
  if (periodType === 'weekly') {
    const { weekYear, week } = getUtcIsoWeekParts(time);
    return `${weekYear}-W${String(week).padStart(2, '0')}`;
  }
  return `${year}`;
}

function getVwapDvaPeriodStartTime(periodKey, periodType) {
  if (!periodKey) return null;
  if (periodType === 'annual') {
    const year = Number(periodKey);
    if (!Number.isFinite(year)) return null;
    return Date.UTC(year, 0, 1) / 1000;
  }
  if (periodType === 'quarterly') {
    const match = String(periodKey).match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    return Date.UTC(year, (quarter - 1) * 3, 1) / 1000;
  }
  if (periodType === 'monthly') {
    const match = String(periodKey).match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    return Date.UTC(year, month - 1, 1) / 1000;
  }
  if (periodType === 'weekly') {
    const match = String(periodKey).match(/^(\d{4})-W(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setUTCDate(jan4.getUTCDate() - (day - 1));
    const start = new Date(mondayWeek1);
    start.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
    return start.getTime() / 1000;
  }
  return null;
}

function groupVwapDvaRows(rows, periodType) {
  const grouped = [];
  const sourceRows = Array.isArray(rows) ? rows.slice() : [];
  sourceRows.sort((a, b) => {
    const at = typeof a?.time === 'number' ? a.time : 0;
    const bt = typeof b?.time === 'number' ? b.time : 0;
    if (at !== bt) return at - bt;
    const ai = typeof a?.bar_index === 'number' ? a.bar_index : 0;
    const bi = typeof b?.bar_index === 'number' ? b.bar_index : 0;
    return ai - bi;
  });

  for (const row of sourceRows) {
    const key = getVwapDvaPeriodKey(row?.time, periodType);
    if (!key) continue;
    const last = grouped[grouped.length - 1];
    if (!last || last.key !== key) {
      grouped.push({ key, rows: [row] });
    } else {
      last.rows.push(row);
    }
  }
  return grouped;
}

function buildVwapDvaTimeInfo(time) {
  if (time == null) return null;
  return {
    raw: time,
    utc: formatBarTime(time)?.iso ?? null,
    israel: formatBarTimeInZone(time, 'Asia/Jerusalem'),
  };
}

function buildVwapDvaArea(group, periodType) {
  if (!group || !Array.isArray(group.rows) || group.rows.length === 0) return null;
  const firstRow = group.rows[0];
  const lastRow = group.rows[group.rows.length - 1];
  const displayValues = {};
  for (const [key, value] of Object.entries(lastRow.variables)) {
    displayValues[key] = formatVwapDvaValue(value);
  }
  const periodStartTime = getVwapDvaPeriodStartTime(group.key, periodType);
  return {
    period_type: periodType,
    period_key: group.key,
    period_start: buildVwapDvaTimeInfo(periodStartTime ?? firstRow.time),
    period_end: buildVwapDvaTimeInfo(lastRow.time),
    period_start_bar_index: firstRow.bar_index ?? null,
    period_end_bar_index: lastRow.bar_index ?? null,
    variables: lastRow.variables,
    display_values: displayValues,
  };
}

const VWAP_NARRATIVE_DEFAULTS = Object.freeze({
  acceptance_bars: 4,
  slope_lookback_bars: 4,
  slope_threshold: 0.25,
});

function normalizeVwapDvaNarrativeConfig(config = {}) {
  const acceptanceBars = Number.isFinite(config?.acceptance_bars) && config.acceptance_bars > 0
    ? Math.max(1, Math.trunc(config.acceptance_bars))
    : VWAP_NARRATIVE_DEFAULTS.acceptance_bars;
  const slopeLookbackBars = Number.isFinite(config?.slope_lookback_bars) && config.slope_lookback_bars > 0
    ? Math.max(1, Math.trunc(config.slope_lookback_bars))
    : VWAP_NARRATIVE_DEFAULTS.slope_lookback_bars;
  const slopeThreshold = Number.isFinite(config?.slope_threshold) && config.slope_threshold > 0
    ? Number(config.slope_threshold)
    : VWAP_NARRATIVE_DEFAULTS.slope_threshold;
  return {
    acceptance_bars: acceptanceBars,
    slope_lookback_bars: slopeLookbackBars,
    slope_threshold: slopeThreshold,
  };
}

function buildVwapDvaNarrativeLevels(areaVariables) {
  if (!areaVariables || typeof areaVariables !== 'object') return null;
  const upper = areaVariables.DVAH;
  const lower = areaVariables.DVAL;
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return null;
  return {
    upper,
    lower,
    vwap: Number.isFinite(areaVariables.VWAP) ? areaVariables.VWAP : null,
    upper_half: Number.isFinite(areaVariables['middle up 0.5']) ? areaVariables['middle up 0.5'] : null,
    lower_half: Number.isFinite(areaVariables['middle down 0.5']) ? areaVariables['middle down 0.5'] : null,
    upper_one_half: Number.isFinite(areaVariables['Middle up 1.5']) ? areaVariables['Middle up 1.5'] : null,
    lower_one_half: Number.isFinite(areaVariables['Middle down 1.5']) ? areaVariables['Middle down 1.5'] : null,
    upper_two: Number.isFinite(areaVariables['DVA+2']) ? areaVariables['DVA+2'] : null,
    lower_two: Number.isFinite(areaVariables['DVA-2']) ? areaVariables['DVA-2'] : null,
  };
}

function buildVwapDvaNarrativeStates(rows, { areaKind, fixedArea } = {}) {
  const fixedLevels = areaKind === 'PVA' ? buildVwapDvaNarrativeLevels(fixedArea?.variables) : null;
  const states = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const bar = row?.bar;
    if (!bar || !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) continue;
    const levels = areaKind === 'PVA' ? fixedLevels : buildVwapDvaNarrativeLevels(row?.variables);
    if (!levels) continue;
    states.push({
      row,
      bar,
      levels,
      fully_above: bar.low > levels.upper,
      fully_below: bar.high < levels.lower,
      fully_inside: bar.high < levels.upper && bar.low > levels.lower,
      close_above: bar.close > levels.upper,
      close_below: bar.close < levels.lower,
      close_inside: bar.close <= levels.upper && bar.close >= levels.lower,
      touched_upper: bar.high >= levels.upper && bar.low <= levels.upper,
      touched_lower: bar.high >= levels.lower && bar.low <= levels.lower,
      touched_upper_half: Number.isFinite(levels.upper_half) && bar.high >= levels.upper_half && bar.low <= levels.upper_half,
      touched_lower_half: Number.isFinite(levels.lower_half) && bar.high >= levels.lower_half && bar.low <= levels.lower_half,
      touched_upper_one_half: Number.isFinite(levels.upper_one_half) && bar.high >= levels.upper_one_half && bar.low <= levels.upper_one_half,
      touched_lower_one_half: Number.isFinite(levels.lower_one_half) && bar.high >= levels.lower_one_half && bar.low <= levels.lower_one_half,
      touched_upper_two: Number.isFinite(levels.upper_two) && bar.high >= levels.upper_two && bar.low <= levels.upper_two,
      touched_lower_two: Number.isFinite(levels.lower_two) && bar.high >= levels.lower_two && bar.low <= levels.lower_two,
    });
  }
  return states;
}

function hasConsecutiveNarrativeStates(states, endIndex, count, predicate) {
  const startIndex = endIndex - count + 1;
  if (startIndex < 0) return -1;
  for (let i = startIndex; i <= endIndex; i += 1) {
    if (!predicate(states[i])) return -1;
  }
  return startIndex;
}

function isCrossToOutside(state, previousState, direction) {
  if (!state || !previousState) return false;
  if (direction === 'up') {
    return state.touched_upper && state.bar.close >= state.levels.upper && previousState.bar.close <= previousState.levels.upper;
  }
  return state.touched_lower && state.bar.close <= state.levels.lower && previousState.bar.close >= previousState.levels.lower;
}

function isCrossToInside(state, previousState, direction) {
  if (!state || !previousState) return false;
  if (direction === 'up') {
    return state.touched_lower && state.bar.close >= state.levels.lower && previousState.bar.close < previousState.levels.lower;
  }
  return state.touched_upper && state.bar.close <= state.levels.upper && previousState.bar.close > previousState.levels.upper;
}

function getWaveExpectedSign(mode, direction) {
  if (mode === 'outside') return direction === 'up' ? 1 : -1;
  return direction === 'up' ? 1 : -1;
}

function getWaveQualifier(mode, direction) {
  if (mode === 'outside') return direction === 'up' ? 'close_above' : 'close_below';
  return 'close_inside';
}

function getTargetTouchKey(areaKind, mode, direction) {
  if (mode === 'outside') {
    if (areaKind === 'PVA') return direction === 'up' ? 'touched_upper_one_half' : 'touched_lower_one_half';
    return direction === 'up' ? 'touched_upper_two' : 'touched_lower_two';
  }
  return direction === 'up' ? 'touched_lower_half' : 'touched_upper_half';
}

function measureWaveParticipation(states, startIndex, endIndex, { mode, direction } = {}) {
  if (!Array.isArray(states) || startIndex < 0 || endIndex <= startIndex) return 0;
  const sign = getWaveExpectedSign(mode, direction);
  const qualifier = getWaveQualifier(mode, direction);
  let trendBars = 0;
  let qualifyingBars = 0;
  for (let i = startIndex + 1; i <= endIndex; i += 1) {
    const previousState = states[i - 1];
    const state = states[i];
    if (!previousState || !state) continue;
    const previousClose = previousState.bar?.close;
    const currentClose = state.bar?.close;
    if (!Number.isFinite(previousClose) || !Number.isFinite(currentClose)) continue;
    const delta = currentClose - previousClose;
    if ((sign > 0 && delta >= 0) || (sign < 0 && delta <= 0)) {
      trendBars += 1;
      if (state[qualifier]) qualifyingBars += 1;
    }
  }
  if (trendBars === 0) return states[endIndex]?.[qualifier] ? 1 : 0;
  return qualifyingBars / trendBars;
}

function computeNormalizedVwapSlope(states, endIndex, lookbackBars) {
  const endState = states[endIndex];
  if (!endState || !Number.isFinite(endState.levels?.vwap)) return null;
  const startIndex = Math.max(0, endIndex - Math.max(1, lookbackBars));
  const startState = states[startIndex];
  if (!startState || !Number.isFinite(startState.levels?.vwap)) return null;
  const sigma = Math.abs((endState.levels.upper ?? NaN) - (endState.levels.vwap ?? NaN));
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  return (endState.levels.vwap - startState.levels.vwap) / sigma;
}

function findTargetTouchIndex(states, crossIndex, endIndex, { areaKind, mode, direction } = {}) {
  const targetKey = getTargetTouchKey(areaKind, mode, direction);
  if (!targetKey) return -1;
  for (let i = crossIndex; i <= endIndex; i += 1) {
    if (states[i]?.[targetKey]) return i;
  }
  return -1;
}

function findLatestAcceptanceByMode(states, { areaKind, mode, direction, config } = {}) {
  if (!Array.isArray(states) || states.length === 0) return null;
  const acceptanceBars = config.acceptance_bars;
  const fullPredicate = mode === 'outside'
    ? (direction === 'up' ? state => state.fully_above : state => state.fully_below)
    : state => state.fully_inside;

  let acceptanceState = null;
  for (let endIndex = states.length - 1; endIndex >= acceptanceBars - 1; endIndex -= 1) {
    const runStart = hasConsecutiveNarrativeStates(states, endIndex, acceptanceBars, fullPredicate);
    if (runStart < 0) continue;
    acceptanceState = states[endIndex];

    for (let crossIndex = endIndex; crossIndex >= 1; crossIndex -= 1) {
      const previousState = states[crossIndex - 1];
      const state = states[crossIndex];
      const crossed = mode === 'outside'
        ? isCrossToOutside(state, previousState, direction)
        : isCrossToInside(state, previousState, direction);
      if (!crossed) continue;
      const targetIndex = findTargetTouchIndex(states, crossIndex, endIndex, { areaKind, mode, direction });
      if (targetIndex < 0) continue;
      const waveRatio = measureWaveParticipation(states, crossIndex, targetIndex, { mode, direction });
      if (waveRatio < 0.5) continue;
      const normalizedSlope = mode === 'outside' && areaKind === 'DVA'
        ? computeNormalizedVwapSlope(states, endIndex, config.slope_lookback_bars)
        : null;
      if (mode === 'outside' && areaKind === 'DVA') {
        if (direction === 'up' && !(normalizedSlope > config.slope_threshold)) continue;
        if (direction === 'down' && !(normalizedSlope < -config.slope_threshold)) continue;
      }
      return {
        mode,
        direction,
        area_kind: areaKind,
        cross_index: crossIndex,
        target_index: targetIndex,
        acceptance_index: endIndex,
        acceptance_bar_index: acceptanceState?.row?.bar_index ?? null,
        acceptance_time: buildVwapDvaTimeInfo(acceptanceState?.row?.time ?? null),
        levels: acceptanceState?.levels ?? state.levels,
        wave_ratio: waveRatio,
        normalized_vwap_slope: normalizedSlope,
      };
    }
  }
  return null;
}

function findLatestAcceptance(states, { areaKind, config } = {}) {
  const candidates = [
    findLatestAcceptanceByMode(states, { areaKind, mode: 'outside', direction: 'up', config }),
    findLatestAcceptanceByMode(states, { areaKind, mode: 'outside', direction: 'down', config }),
    findLatestAcceptanceByMode(states, { areaKind, mode: 'inside', direction: 'up', config }),
    findLatestAcceptanceByMode(states, { areaKind, mode: 'inside', direction: 'down', config }),
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.acceptance_index - a.acceptance_index);
  return candidates[0];
}

function getPullbackType(areaKind, mode) {
  if (areaKind === 'PVA') return mode === 'outside' ? 'BPB' : 'RPB';
  return mode === 'outside' ? 'IPB' : 'EF';
}

function getPullbackAllowance(state, event) {
  const activeLevels = event?.area_kind === 'DVA' ? state?.levels : event?.levels;
  if (!state || !event || !activeLevels) return null;
  if (event.mode === 'outside') {
    if (event.direction === 'up') {
      return {
        edge: activeLevels.upper,
        floor: activeLevels.upper_half,
        ceiling: activeLevels.upper,
        type: 'lower-bounded',
      };
    }
    return {
      edge: activeLevels.lower,
      floor: activeLevels.lower,
      ceiling: activeLevels.lower_half,
      type: 'upper-bounded',
    };
  }
  if (event.direction === 'up') {
    return {
      edge: activeLevels.lower,
      floor: event.area_kind === 'PVA' ? activeLevels.lower_one_half : activeLevels.lower_two,
      ceiling: activeLevels.lower,
      type: 'lower-bounded',
    };
  }
  return {
    edge: activeLevels.upper,
    floor: activeLevels.upper,
    ceiling: event.area_kind === 'PVA' ? activeLevels.upper_one_half : activeLevels.upper_two,
    type: 'upper-bounded',
  };
}

function isValidPullback(state, event) {
  const allowance = getPullbackAllowance(state, event);
  if (!allowance || !Number.isFinite(allowance.edge)) return false;
  if (event.mode === 'outside') {
    if (event.direction === 'up') {
      return state.bar.low <= allowance.edge && (!Number.isFinite(allowance.floor) || state.bar.low >= allowance.floor);
    }
    return state.bar.high >= allowance.edge && (!Number.isFinite(allowance.ceiling) || state.bar.high <= allowance.ceiling);
  }
  if (event.direction === 'up') {
    return state.bar.low <= allowance.edge && (!Number.isFinite(allowance.floor) || state.bar.low >= allowance.floor);
  }
  return state.bar.high >= allowance.edge && (!Number.isFinite(allowance.ceiling) || state.bar.high <= allowance.ceiling);
}

function findFirstPullback(states, event) {
  if (!Array.isArray(states) || !event) return null;
  for (let i = event.acceptance_index + 1; i < states.length; i += 1) {
    const state = states[i];
    if (isValidPullback(state, event)) {
      return {
        index: i,
        bar_index: state.row?.bar_index ?? null,
        time: buildVwapDvaTimeInfo(state.row?.time ?? null),
      };
    }
  }
  return null;
}

function findLatestTouchedExtreme(states, event) {
  if (!Array.isArray(states) || !event) return null;
  let latest = null;
  for (let i = event.acceptance_index + 1; i < states.length; i += 1) {
    const state = states[i];
    if (!state) continue;
    if (state.touched_upper) latest = { side: 'upper', index: i };
    if (state.touched_lower) latest = { side: 'lower', index: i };
  }
  return latest;
}

function buildNarrativeType(areaKind, event, states) {
  if (!event) return null;
  if (event.mode === 'outside') return event.direction === 'up' ? 'imbalance_up' : 'imbalance_down';
  const latestExtreme = findLatestTouchedExtreme(states, event);
  if (latestExtreme?.side === 'upper') return 'rotational_down';
  if (latestExtreme?.side === 'lower') return 'rotational_up';
  return event.direction === 'up' ? 'rotational_up' : 'rotational_down';
}

function buildFallbackNarrative({ areaKind, states, currentClose, dominantArea, config } = {}) {
  const bounds = dominantArea?.reference_bounds;
  const position = getVwapDvaPricePosition(currentClose, bounds);
  if (position === 'Above') {
    return {
      dominant_area_label: areaKind,
      direction: 'bullish',
      type: 'imbalance_up',
      fcs_active: false,
      pullback_type: getPullbackType(areaKind, 'outside'),
      pullback_state: 'confirmed',
      config,
    };
  }
  if (position === 'Below') {
    return {
      dominant_area_label: areaKind,
      direction: 'bearish',
      type: 'imbalance_down',
      fcs_active: false,
      pullback_type: getPullbackType(areaKind, 'outside'),
      pullback_state: 'confirmed',
      config,
    };
  }
  let latestExtreme = null;
  for (let i = (states?.length ?? 0) - 1; i >= 0; i -= 1) {
    const state = states[i];
    if (!state) continue;
    if (state.touched_upper) {
      latestExtreme = 'upper';
      break;
    }
    if (state.touched_lower) {
      latestExtreme = 'lower';
      break;
    }
  }
  if (!latestExtreme) {
    const referenceVwap = areaKind === 'PVA'
      ? dominantArea?.reference_bounds?.lower != null && dominantArea?.reference_bounds?.upper != null
        ? (dominantArea.reference_bounds.upper + dominantArea.reference_bounds.lower) / 2
        : null
      : states?.[states.length - 1]?.levels?.vwap ?? null;
    latestExtreme = Number.isFinite(referenceVwap) && Number.isFinite(currentClose) && currentClose <= referenceVwap ? 'lower' : 'upper';
  }
  return {
    dominant_area_label: areaKind,
    direction: latestExtreme === 'lower' ? 'bullish' : 'bearish',
    type: latestExtreme === 'lower' ? 'rotational_up' : 'rotational_down',
    fcs_active: false,
    pullback_type: getPullbackType(areaKind, 'inside'),
    pullback_state: 'confirmed',
    config,
  };
}

function buildVwapDvaNarrative({ rows, currentGroup, previousGroup, currentArea, previousArea, dominantArea, currentClose, config } = {}) {
  const areaKind = dominantArea?.active_label === 'PVA' ? 'PVA' : 'DVA';
  const sourceRows = areaKind === 'PVA'
    ? [...(previousGroup?.rows ?? []), ...(currentGroup?.rows ?? [])]
    : (currentGroup?.rows ?? []);
  const states = buildVwapDvaNarrativeStates(sourceRows, {
    areaKind,
    fixedArea: areaKind === 'PVA' ? previousArea : currentArea,
  });

  const acceptance = findLatestAcceptance(states, { areaKind, config });
  if (!acceptance) return buildFallbackNarrative({ areaKind, states, currentClose, dominantArea, config });

  const narrativeType = buildNarrativeType(areaKind, acceptance, states);
  const pullback = findFirstPullback(states, acceptance);
  return {
    dominant_area_label: areaKind,
    direction: narrativeType?.endsWith('_up') ? 'bullish' : 'bearish',
    type: narrativeType,
    fcs_active: !pullback,
    pullback_type: getPullbackType(areaKind, acceptance.mode),
    pullback_state: pullback ? 'confirmed' : 'pending',
    config,
    acceptance: {
      mode: acceptance.mode,
      direction: acceptance.direction,
      bar_index: acceptance.acceptance_bar_index,
      time: acceptance.acceptance_time,
      wave_ratio: acceptance.wave_ratio,
      normalized_vwap_slope: acceptance.normalized_vwap_slope,
    },
  };
}

function buildVwapDvaDominantArea({ anchor = null, currentArea = null, previousArea = null, currentValueRow = null } = {}) {
  if (!currentArea || !currentArea.period_start || !currentArea.period_end) return null;
  const rule = getVwapDvaDominanceRule(anchor);
  if (!rule) return null;
  const anchorSpan = getVwapDvaAnchorSpan(anchor);
  if (!anchorSpan) return null;
  const switchAt = addUtcDuration(currentArea.period_start.raw, rule.duration);
  const anchorEnd = addUtcDuration(currentArea.period_start.raw, anchorSpan);
  if (switchAt == null) return null;
  const currentTime = typeof currentValueRow?.time?.raw === 'number' ? currentValueRow.time.raw : null;
  const activeSide = currentTime != null && currentTime < switchAt ? 'previous' : 'current';
  const referenceArea = activeSide === 'previous' ? previousArea : currentArea;

  return {
    anchor,
    active_side: activeSide,
    active_label: activeSide === 'previous' ? 'PVA' : 'DVA',
    rule: rule.label,
    switch_at: buildVwapDvaTimeInfo(switchAt),
    reference_bounds: referenceArea ? {
      upper: referenceArea.variables?.DVAH ?? null,
      lower: referenceArea.variables?.DVAL ?? null,
      upper_label: activeSide === 'previous' ? 'PVAH' : 'DVAH',
      lower_label: activeSide === 'previous' ? 'PVAL' : 'DVAL',
    } : null,
    previous_window: {
      start: currentArea.period_start,
      end: buildVwapDvaTimeInfo(switchAt),
    },
    current_window: {
      start: buildVwapDvaTimeInfo(switchAt),
      end: buildVwapDvaTimeInfo(anchorEnd ?? currentArea.period_end.raw),
    },
  };
}

function getVwapDvaPricePosition(close, bounds) {
  if (typeof close !== 'number' || !Number.isFinite(close)) return null;
  const upper = typeof bounds?.upper === 'number' ? bounds.upper : null;
  const lower = typeof bounds?.lower === 'number' ? bounds.lower : null;
  if (upper == null || lower == null) return null;
  if (close > upper) return 'Above';
  if (close < lower) return 'Below';
  return 'Inside';
}

export function buildVwapDvaSnapshot({ symbol = null, resolution = null, studyVisible = null, studyName = 'Vwap MantillaPB', rows = [], chartLastIndex = null, currentClose = null, narrativeConfig = null } = {}) {
  const normalizedRows = [];
  const sourceRows = Array.isArray(rows) ? rows : [];
  for (const row of sourceRows) {
    const decoded = decodeVwapDvaRow(row);
    if (decoded) normalizedRows.push(decoded);
  }

  const periodType = getVwapDvaPeriodType(resolution);
  const narrativeConfigResolved = normalizeVwapDvaNarrativeConfig(narrativeConfig);
  const groupedRows = groupVwapDvaRows(normalizedRows, periodType);
  const currentGroup = groupedRows.length > 0 ? groupedRows[groupedRows.length - 1] : null;
  const previousGroup = groupedRows.length > 1 ? groupedRows[groupedRows.length - 2] : null;
  const currentArea = buildVwapDvaArea(currentGroup, periodType);
  const previousArea = buildVwapDvaArea(previousGroup, periodType);

  const currentRow = currentGroup?.rows?.[currentGroup.rows.length - 1] ?? (normalizedRows.length > 0 ? normalizedRows[normalizedRows.length - 1] : null);
  const previousRow = previousGroup?.rows?.[previousGroup.rows.length - 1] ?? (normalizedRows.length > 1 ? normalizedRows[normalizedRows.length - 2] : null);
  const dominantArea = buildVwapDvaDominantArea({
    anchor: getVwapDvaAnchorLabel(resolution, periodType),
    currentArea,
    previousArea,
    currentValueRow: currentRow ? {
      bar_index: currentRow.bar_index,
      time: buildVwapDvaTimeInfo(currentRow.time),
      variables: currentRow.variables,
    } : null,
  });
  const narrative = buildVwapDvaNarrative({
    rows: normalizedRows,
    currentGroup,
    previousGroup,
    currentArea,
    previousArea,
    dominantArea,
    currentClose,
    config: narrativeConfigResolved,
  });

  return {
    success: true,
    source: 'vwap_dva_snapshot_v11',
    schema_version: 'v11',
    symbol,
    resolution,
    chart_last_index: chartLastIndex,
    study: {
      name: studyName,
      visible: studyVisible,
    },
    dva: {
      type: periodType,
      anchor: getVwapDvaAnchorLabel(resolution, periodType),
      current: currentArea,
      previous: previousArea,
      dominant_area: dominantArea,
      price_close: typeof currentClose === 'number' && Number.isFinite(currentClose) ? currentClose : null,
      price_position_dominant_area: getVwapDvaPricePosition(currentClose, dominantArea?.reference_bounds),
      narrative,
      current_value_row: currentRow ? {
        bar_index: currentRow.bar_index,
        time: buildVwapDvaTimeInfo(currentRow.time),
        variables: currentRow.variables,
      } : null,
      previous_value_row: previousRow ? {
        bar_index: previousRow.bar_index,
        time: buildVwapDvaTimeInfo(previousRow.time),
        variables: previousRow.variables,
      } : null,
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

export async function getIndicatorSnapshot({ entity_id }) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');

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
      try {
        if (bars && typeof bars.firstIndex === 'function' && typeof bars.lastIndex === 'function') {
          firstIndex = bars.firstIndex();
          lastIndex = bars.lastIndex();
          var requestedIndexes = {};
          if (typeof lastIndex === 'number') {
            requestedIndexes[lastIndex] = true;
            requestedIndexes[lastIndex - 1] = true;
            requestedIndexes[lastIndex - 2] = true;
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

      var verboseLabels = collectVerbose('dwglabels', 'labels', function(v, id) {
        return {
          id: id,
          text: v.t || '',
          price: v.y != null ? Math.round(v.y * 100) / 100 : null,
          x: v.x != null ? v.x : null,
          y: v.y != null ? v.y : null,
          yloc: v.yl != null ? v.yl : null,
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
      };
    })()
  `);

  if (snapshot?.error) throw new Error(snapshot.error);

  const inputs = normalizeStudyInputs(snapshot?.input_definitions || [], snapshot?.current_inputs || []);
  const studyName = snapshot?.study_meta?.description || snapshot?.study_meta?.short_description || snapshot?.study_meta?.shortDescription || null;
  const demark = analyzeDemarkGraphics({
    labels: snapshot?.graphics?.labels || [],
    lines: snapshot?.graphics?.lines || [],
    boxes: snapshot?.graphics?.boxes || [],
    barLookup: snapshot?.graphics?.bars || {},
    lastIndex: snapshot?.graphics?.last_index ?? null,
    studyName,
  });
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
    demark: demark?.recognized ? demark : null,
  };
}

export async function getDemarkSnapshot({ entity_id }) {
  const snapshot = await getIndicatorSnapshot({ entity_id });
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
    };
  }

  const barSnapshots = Array.isArray(demark.bar_snapshots) ? demark.bar_snapshots : [];
  const currentBar = barSnapshots.length > 0 ? barSnapshots[barSnapshots.length - 1] : null;
  const currentLabels = Array.isArray(currentBar?.labels)
    ? currentBar.labels
    : Array.isArray(demark.current_labels)
      ? demark.current_labels
      : Array.isArray(demark.labels)
        ? demark.labels
        : [];

  const labels = currentLabels.map(label => ({
    text: label.text ?? null,
    price: label.price ?? null,
    x: label.x ?? null,
    bar_index: label.bar_index ?? label.x ?? null,
    resolved_count_type: label.resolved_count_type || label.count_type || 'unknown',
    direction: label.direction || null,
    position: label.position || null,
    confidence: label.confidence ?? null,
    count_value: label.count_value ?? null,
    is_current: !!label.is_current,
    is_perfect_setup: !!label.is_perfect_setup,
    is_extension: !!label.is_extension,
    shade: label.shade ?? null,
    marker_type: label.marker_type ?? null,
  }));

  const currentTime = currentBar?.time?.raw ?? demark.recent_bars?.[demark.recent_bars.length - 1]?.time?.raw ?? null;
  const currentBarIndex = currentBar?.bar_index ?? demark.current_bar_index ?? null;
  const currentOhlcv = currentBar
    ? {
        open: currentBar.open ?? null,
        high: currentBar.high ?? null,
        low: currentBar.low ?? null,
        close: currentBar.close ?? null,
        volume: currentBar.volume ?? null,
      }
    : null;

  return {
    success: true,
    entity_id,
    visible: snapshot?.visible ?? null,
    study_meta: snapshot?.study_meta || null,
    bar_index: currentBarIndex,
    x: currentBarIndex,
    time: currentTime != null ? {
      israel: formatBarTimeInZone(currentTime, 'Asia/Jerusalem'),
      utc: currentBar?.time?.iso || formatBarTime(currentTime)?.iso || null,
      raw: currentTime,
    } : null,
    ohlcv: currentOhlcv,
    labels,
    perfect_setup: !!currentBar?.perfect_setup,
    extensions: currentBar?.extensions ?? 0,
    summary: demark.summary || null,
    active_signals: Array.isArray(demark.active_signals) ? demark.active_signals : [],
    risk_level_candidates: Array.isArray(demark.risk_level_candidates) ? demark.risk_level_candidates : [],
    tdst: demark.tdst || null,
    recent_bars: Array.isArray(demark.recent_bars) ? demark.recent_bars : [],
    source: 'indicator_snapshot',
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

export async function getDvaSnapshot() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var api = window.TradingViewApi._activeChartWidgetWV.value();
      var sources = chart.model().model().dataSources();
      var study = null;
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s || !s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (name === 'Vwap MantillaPB') { study = s; break; }
        } catch(e) {}
      }
      if (!study) return { error: 'Vwap MantillaPB study not found.' };

      var resolution = null;
      try { resolution = typeof api.resolution === 'function' ? api.resolution() : null; } catch(e) {}
      var symbol = null;
      try { symbol = typeof api.symbol === 'function' ? api.symbol() : null; } catch(e) {}
      var chartLastIndex = null;
      try { chartLastIndex = chart.model().mainSeries().bars().lastIndex(); } catch(e) {}
      var currentClose = null;
      try {
        var bars = chart.model().mainSeries().bars();
        var currentBar = typeof chartLastIndex === 'number' ? bars.valueAt(chartLastIndex) : null;
        if (currentBar && typeof currentBar[4] === 'number') currentClose = currentBar[4];
      } catch(e) {}
      var studyVisible = null;
      try { studyVisible = typeof study.isVisible === 'function' ? study.isVisible() : null; } catch(e) {}

      var rows = [];
      try {
        var mainBars = chart.model().mainSeries().bars();
        var rawRows = study._data && Array.isArray(study._data._items) ? study._data._items : [];
        for (var i = 0; i < rawRows.length; i++) {
          var row = rawRows[i];
          if (!row || !Array.isArray(row.value)) continue;
          var bar = null;
          try {
            var barIndex = typeof row.index === 'number' ? row.index : null;
            var mainBar = typeof barIndex === 'number' ? mainBars.valueAt(barIndex) : null;
            if (mainBar) {
              bar = {
                open: typeof mainBar[1] === 'number' ? mainBar[1] : null,
                high: typeof mainBar[2] === 'number' ? mainBar[2] : null,
                low: typeof mainBar[3] === 'number' ? mainBar[3] : null,
                close: typeof mainBar[4] === 'number' ? mainBar[4] : null,
                volume: typeof mainBar[5] === 'number' ? mainBar[5] : null,
              };
            }
          } catch(e) {}
          rows.push({ index: typeof row.index === 'number' ? row.index : null, value: row.value, bar: bar });
        }
      } catch(e) {}

      return {
        symbol: symbol,
        resolution: resolution,
        chart_last_index: chartLastIndex,
        study_visible: studyVisible,
        study_name: 'Vwap MantillaPB',
        current_close: currentClose,
        rows: rows,
      };
    })()
  `);

  if (!data || data.error) throw new Error(data?.error || 'Could not resolve Vwap MantillaPB snapshot.');
  return buildVwapDvaSnapshot({
    symbol: data.symbol ?? null,
    resolution: data.resolution ?? null,
    studyVisible: data.study_visible ?? null,
    studyName: data.study_name ?? 'Vwap MantillaPB',
    rows: data.rows ?? [],
    chartLastIndex: data.chart_last_index ?? null,
    currentClose: data.current_close ?? null,
  });
}

export async function getStudyValues() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var resolution = null;
      try {
        var api = window.TradingViewApi._activeChartWidgetWV.value();
        resolution = typeof api.resolution === 'function' ? api.resolution() : null;
      } catch(e) {}

      function formatValue(value) {
        if (typeof value !== 'number' || !isFinite(value)) return null;
        return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
      }

      function decodeVwapRow(row) {
        if (!row || !Array.isArray(row.value)) return null;
        var v = row.value;
        return {
          bar_index: typeof row.index === 'number' ? row.index : null,
          time: typeof v[0] === 'number' ? v[0] : null,
          variables: {
            VWAP: typeof v[1] === 'number' ? v[1] : null,
            DVAH: typeof v[3] === 'number' ? v[3] : null,
            DVAL: typeof v[5] === 'number' ? v[5] : null,
            'DVA+2': typeof v[7] === 'number' ? v[7] : null,
            'DVA-2': typeof v[9] === 'number' ? v[9] : null,
            'DVA+3': typeof v[11] === 'number' ? v[11] : null,
            'DVA-3': typeof v[13] === 'number' ? v[13] : null,
            'middle up 0.5': typeof v[15] === 'number' ? v[15] : null,
            'middle down 0.5': typeof v[17] === 'number' ? v[17] : null,
            'Middle up 1.5': typeof v[19] === 'number' ? v[19] : null,
            'Middle down 1.5': typeof v[21] === 'number' ? v[21] : null,
          },
        };
      }

      function formatDecodedValues(decoded) {
        var out = {};
        if (!decoded || !decoded.variables) return out;
        Object.keys(decoded.variables).forEach(function(key) {
          out[key] = formatValue(decoded.variables[key]);
        });
        return out;
      }

      function findAnnualBoundary(rows) {
        if (!Array.isArray(rows) || rows.length < 2) return null;
        for (var i = 1; i < rows.length; i++) {
          var prevTime = rows[i - 1] && rows[i - 1].time;
          var curTime = rows[i] && rows[i].time;
          if (typeof prevTime !== 'number' || typeof curTime !== 'number') continue;
          var prevYear = new Date(prevTime * 1000).getUTCFullYear();
          var curYear = new Date(curTime * 1000).getUTCFullYear();
          if (prevYear !== curYear) {
            return { previous_index: i - 1, current_index: i, previous_year: prevYear, current_year: curYear };
          }
        }
        return null;
      }

      function getPeriodType(resolution) {
        var token = String(resolution || '').toLowerCase();
        if (token === '480' || token === '8h') return 'quarterly';
        if (token === '30' || token === '30m') return 'weekly';
        if (token === 'm' || token === '1m') return 'monthly';
        if (token === 'w' || token === '1w') return 'weekly';
        if (token === 'd' || token === '1d') return 'annual';
        return null;
      }

      function getIsoWeekParts(time) {
        var date = new Date(time * 1000);
        var utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        var day = utcDate.getUTCDay() || 7;
        utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
        var yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
        var week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
        return { weekYear: utcDate.getUTCFullYear(), week: week };
      }

      function getPeriodKey(time, periodType) {
        if (typeof time !== 'number' || !isFinite(time)) return null;
        var date = new Date(time * 1000);
        var year = date.getUTCFullYear();
        if (periodType === 'annual') return String(year);
        if (periodType === 'quarterly') return year + '-Q' + (Math.floor(date.getUTCMonth() / 3) + 1);
        if (periodType === 'monthly') return year + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
        if (periodType === 'weekly') {
          var parts = getIsoWeekParts(time);
          return parts.weekYear + '-W' + String(parts.week).padStart(2, '0');
        }
        return String(year);
      }

      function groupRowsByPeriod(rows, periodType) {
        var grouped = [];
        var source = Array.isArray(rows) ? rows.slice() : [];
        source.sort(function(a, b) {
          var at = typeof a.time === 'number' ? a.time : 0;
          var bt = typeof b.time === 'number' ? b.time : 0;
          if (at !== bt) return at - bt;
          var ai = typeof a.bar_index === 'number' ? a.bar_index : 0;
          var bi = typeof b.bar_index === 'number' ? b.bar_index : 0;
          return ai - bi;
        });
        for (var i = 0; i < source.length; i++) {
          var row = source[i];
          var key = getPeriodKey(row.time, periodType);
          if (!key) continue;
          var last = grouped[grouped.length - 1];
          if (!last || last.key !== key) grouped.push({ key: key, rows: [row] });
          else last.rows.push(row);
        }
        return grouped;
      }

      function buildTimeInfo(time) {
        if (time == null) return null;
        return {
          raw: time,
          utc: new Date((time > 1000000000000 ? time : time * 1000)).toISOString(),
          israel: (function() {
            var formatter = new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Jerusalem',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });
            var parts = formatter.formatToParts(new Date((time > 1000000000000 ? time : time * 1000)));
            var lookup = {};
            for (var i = 0; i < parts.length; i++) lookup[parts[i].type] = parts[i].value;
            if (!lookup.year || !lookup.month || !lookup.day || !lookup.hour || !lookup.minute) return null;
            return lookup.year + '-' + lookup.month + '-' + lookup.day + ' ' + lookup.hour + ':' + lookup.minute;
          })(),
        };
      }

      function buildArea(group, periodType) {
        if (!group || !Array.isArray(group.rows) || group.rows.length === 0) return null;
        var firstRow = group.rows[0];
        var lastRow = group.rows[group.rows.length - 1];
        return {
          period_type: periodType,
          period_key: group.key,
          period_start: buildTimeInfo(firstRow.time),
          period_end: buildTimeInfo(lastRow.time),
          period_start_bar_index: firstRow.bar_index,
          period_end_bar_index: lastRow.bar_index,
          variables: lastRow.variables,
          display_values: Object.fromEntries(Object.entries(lastRow.variables).map(function(entry) {
            return [entry[0], formatDecodedValues({ variables: { [entry[0]]: entry[1] } })[entry[0]]];
          })),
        };
      }

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
          var result = { name: name, values: values };

          if (name === 'Vwap MantillaPB') {
            var rows = [];
            try {
              var rawRows = s._data && Array.isArray(s._data._items) ? s._data._items : [];
              for (var ri = 0; ri < rawRows.length; ri++) {
                var decoded = decodeVwapRow(rawRows[ri]);
                if (decoded) rows.push(decoded);
              }
            } catch(e) {}

            var periodType = getPeriodType(resolution);
            var groupedRows = groupRowsByPeriod(rows, periodType);
            var currentGroup = groupedRows.length > 0 ? groupedRows[groupedRows.length - 1] : null;
            var previousGroup = groupedRows.length > 1 ? groupedRows[groupedRows.length - 2] : null;
            var currentRow = currentGroup && currentGroup.rows.length > 0 ? currentGroup.rows[currentGroup.rows.length - 1] : (rows.length > 0 ? rows[rows.length - 1] : null);
            var previousRow = previousGroup && previousGroup.rows.length > 0 ? previousGroup.rows[previousGroup.rows.length - 1] : (rows.length > 1 ? rows[rows.length - 2] : null);
            var resolutionToken = String(resolution || '').toLowerCase();

            result.dva = {
              type: periodType,
              anchor: (function() {
                if (periodType === 'annual') return 'Year';
                if (periodType === 'quarterly') return 'Quarter';
                if (periodType === 'monthly') return resolutionToken === 'm' || resolutionToken === '1m' ? 'Decade' : 'Month';
                if (periodType === 'weekly') return resolutionToken === 'w' || resolutionToken === '1w' ? 'HalfDecade' : 'Week';
                return null;
              })(),
              current: buildArea(currentGroup, periodType),
              previous: buildArea(previousGroup, periodType),
              current_value_row: currentRow ? {
                bar_index: currentRow.bar_index,
                time: buildTimeInfo(currentRow.time),
                variables: currentRow.variables,
              } : null,
              previous_value_row: previousRow ? {
                bar_index: previousRow.bar_index,
                time: buildTimeInfo(previousRow.time),
                variables: previousRow.variables,
              } : null,
            };
          }

          if (Object.keys(values).length > 0 || result.dva) results.push(result);
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
      if (verbose) return { id: item.id, text, price, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price };
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
