import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

import { captureScreenshot } from './capture.js';
import { getState as getChartState, setTimeframe } from './chart.js';
import { getClient } from '../connection.js';
import { waitForChartReady } from '../wait.js';
import { getDemarkSnapshot } from './data.js';
import { captureAndDetectDemarkFocusColumn } from './demark_visual.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(__dirname));
const REPORTS_DIR = join(REPO_ROOT, 'reports');
const OCR_SCRIPT = join(REPO_ROOT, 'scripts', 'windows_ocr_image.ps1');

export const DEFAULT_DEMARK_SWEEP_TIMEFRAMES = ['12M', 'M', 'W', 'D', '8h', '4h', '2h', '1h', '30m', '5m', '1m'];

export function normalizeTimeframeList(timeframes) {
  if (Array.isArray(timeframes)) {
    const cleaned = timeframes.map(tf => String(tf || '').trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : DEFAULT_DEMARK_SWEEP_TIMEFRAMES;
  }

  const raw = String(timeframes ?? '').trim();
  if (!raw) return DEFAULT_DEMARK_SWEEP_TIMEFRAMES;
  const cleaned = raw.split(/[,\s]+/).map(tf => String(tf || '').trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : DEFAULT_DEMARK_SWEEP_TIMEFRAMES;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function previewText(value, limit = 180) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function summarizeDemarkSnapshot(snapshot) {
  const labels = Array.isArray(snapshot?.labels) ? snapshot.labels : [];
  if (labels.length === 0) return 'sin conteo';

  const chunks = [];
  const seenMarkers = new Set();

  for (const label of labels) {
    const type = label?.resolved_count_type || label?.count_type || 'indicator';
    const direction = label?.direction === 'buy' || label?.direction === 'sell' ? label.direction : 'unknown';
    const count = label?.count_value != null ? String(label.count_value) : String(label?.text ?? '').trim();

    if (type === 'indicator') {
      if (label?.is_perfect_setup && !seenMarkers.has('perfect_setup')) {
        chunks.push('perfect setup');
        seenMarkers.add('perfect_setup');
      }
      if (label?.is_extension && !seenMarkers.has('extension')) {
        chunks.push('extension');
        seenMarkers.add('extension');
      }
      if (label?.marker_type === 'tdst' && !seenMarkers.has('tdst')) {
        chunks.push('tdst');
        seenMarkers.add('tdst');
      }
      continue;
    }

    let piece = `${type} ${direction}`;
    if (count) piece += ` ${count}`;
    chunks.push(piece);
  }

  return chunks.length > 0 ? chunks.join(' | ') : 'sin conteo';
}

function extractSnapshotTokens(snapshot) {
  const labels = Array.isArray(snapshot?.labels) ? snapshot.labels : [];
  const tokens = [];
  for (const label of labels) {
    const type = label?.resolved_count_type || label?.count_type || 'indicator';
    if (type === 'indicator') {
      if (label?.is_perfect_setup) tokens.push('perfect setup');
      if (label?.is_extension) tokens.push('extension');
      if (label?.marker_type === 'tdst') tokens.push('tdst');
      continue;
    }
    const direction = label?.direction === 'buy' || label?.direction === 'sell' ? label.direction : 'unknown';
    const count = label?.count_value != null ? String(label.count_value) : String(label?.text ?? '').trim();
    const piece = [type, direction, count].filter(Boolean).join(' ').trim();
    if (piece) tokens.push(piece);
  }
  return tokens;
}

function runWindowsOcr(imagePath) {
  if (!imagePath) {
    return { success: false, error: 'image_path is required.' };
  }
  if (!existsSync(OCR_SCRIPT)) {
    return { success: false, error: `OCR script not found: ${OCR_SCRIPT}` };
  }

  try {
    const stdout = execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', OCR_SCRIPT,
      '-Path', imagePath,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(stdout);
    return parsed?.success ? parsed : { success: false, error: parsed?.error || 'OCR failed.' };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}

function buildReadyKey(snapshot) {
  const resolved = snapshot?.resolved_snapshot || snapshot?.indicator_snapshot?.resolved_snapshot || null;
  const selected = snapshot?.selected_bar || snapshot?.indicator_snapshot?.selected_bar || null;
  const barIndex = Number.isFinite(snapshot?.bar_index)
    ? snapshot.bar_index
    : Number.isFinite(resolved?.bar_index)
      ? resolved.bar_index
      : Number.isFinite(selected?.bar_index)
        ? selected.bar_index
        : null;
  const timeRaw = Number.isFinite(snapshot?.time?.raw)
    ? snapshot.time.raw
    : Number.isFinite(resolved?.time?.raw)
      ? resolved.time.raw
      : Number.isFinite(selected?.time?.raw)
        ? selected.time.raw
        : null;
  const labelCount = Number.isFinite(snapshot?.summary?.label_count)
    ? snapshot.summary.label_count
    : Number.isFinite(resolved?.summary?.label_count)
      ? resolved.summary.label_count
      : null;
  const currentLabelCount = Number.isFinite(snapshot?.summary?.current_label_count)
    ? snapshot.summary.current_label_count
    : Number.isFinite(resolved?.summary?.current_label_count)
      ? resolved.summary.current_label_count
      : null;
  const summary = snapshot?.summary?.counts
    || resolved?.summary?.counts
    || snapshot?.indicator_snapshot?.demark?.summary
    || null;
  return JSON.stringify({
    barIndex,
    timeRaw,
    labelCount,
    currentLabelCount,
    summary,
    recognized: !!snapshot?.resolved_snapshot || !!snapshot?.indicator_snapshot?.demark?.recognized,
  });
}

async function waitForDemarkSnapshotReady({
  entity_id,
  selection,
  timeout_ms = 30000,
  poll_ms = 600,
  stable_samples = 2,
} = {}) {
  const startedAt = Date.now();
  let lastKey = null;
  let stableCount = 0;
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeout_ms) {
    try {
      const snapshot = await getDemarkSnapshot({ entity_id, compact: true, selection });
      lastSnapshot = snapshot;
      const key = buildReadyKey(snapshot);
      if (key && key === lastKey) stableCount += 1;
      else stableCount = 0;
      lastKey = key;

      if (stableCount >= stable_samples && (snapshot?.resolved_snapshot || snapshot?.indicator_snapshot?.demark)) {
        return { ready: true, waited_ms: Date.now() - startedAt, snapshot };
      }
    } catch (error) {
      lastSnapshot = { error: error?.message || String(error) };
      lastKey = null;
      stableCount = 0;
    }
    await sleep(poll_ms);
  }

  return { ready: false, waited_ms: Date.now() - startedAt, snapshot: lastSnapshot };
}

function assessComparison(snapshot, ocr, blobs) {
  const tokens = extractSnapshotTokens(snapshot);
  const ocrText = normalizeText(ocr?.text || (Array.isArray(ocr?.lines) ? ocr.lines.map(line => line?.text || '').join(' ') : ''));
  const issues = [];
  const matched = [];
  const missing = [];

  if (tokens.length === 0) {
    if (ocrText) {
      issues.push('MCP says sin conteo, but OCR still sees text in the focus column.');
    }
  } else {
    for (const token of tokens) {
      const needle = normalizeText(token);
      if (!needle) continue;
      if (needle === 'perfect setup' || needle === 'extension' || needle === 'tdst') {
        if (ocrText.includes(needle.split(' ')[0])) matched.push(token);
        else missing.push(token);
        continue;
      }

      const parts = needle.split(' ');
      const count = parts[parts.length - 1];
      const direction = parts[1] || '';
      const type = parts[0] || '';
      const numberOk = count && ocrText.includes(count);
      const directionOk = direction && ocrText.includes(direction);
      const typeOk = type && ocrText.includes(type);
      if (numberOk && directionOk && typeOk) matched.push(token);
      else missing.push(token);
    }
    if (missing.length > 0) {
      issues.push(`OCR did not confirm: ${missing.join(', ')}`);
    }
    if (!ocrText) {
      issues.push('OCR returned empty text.');
    }
    if (Number(blobs?.blob_count) === 0) {
      issues.push('Blob detector found no colored label blobs.');
    }
  }

  const status = issues.length > 0 ? 'mismatch' : 'aligned';
  return {
    status,
    issues,
    matched,
    missing,
    ocr_text: ocrText,
    ocr_preview: previewText(ocr?.text || (Array.isArray(ocr?.lines) ? ocr.lines.map(line => line?.text || '').join(' ') : '')),
  };
}

function formatSweepMarkdown({ symbol, studyName, initialTimeframe, timeframes, options, results, startedAt, finishedAt }) {
  const summary = results.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'aligned') acc.aligned += 1;
    else acc.mismatch += 1;
    return acc;
  }, { total: 0, aligned: 0, mismatch: 0 });

  const lines = [];
  lines.push(`# DeMARK Sweep`);
  lines.push('');
  lines.push(`- symbol: \`${symbol || 'unknown'}\``);
  lines.push(`- study: \`${studyName || 'DeMARK 9-13'}\``);
  lines.push(`- started: \`${startedAt.toISOString()}\``);
  lines.push(`- finished: \`${finishedAt.toISOString()}\``);
  lines.push(`- initial timeframe: \`${initialTimeframe || 'unknown'}\``);
  lines.push(`- timeframes: \`${timeframes.join(', ')}\``);
  lines.push(`- bars_before / bars_after: \`${options.bars_before}\` / \`${options.bars_after}\``);
  lines.push(`- min_bar_spacing: \`${options.min_bar_spacing}\``);
  lines.push(`- column_width: \`${options.column_width}\``);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- aligned: ${summary.aligned}`);
  lines.push(`- mismatched: ${summary.mismatch}`);
  lines.push(`- total: ${summary.total}`);
  lines.push('');
  lines.push(`| TF | bar_index | MCP | OCR | blobs | status | screenshot |`);
  lines.push(`| --- | ---: | --- | --- | ---: | --- | --- |`);
  for (const item of results) {
    const screenshot = item.chart_screenshot_path || item.screenshot_path
      ? relative(REPO_ROOT, item.chart_screenshot_path || item.screenshot_path).replace(/\\/g, '/')
      : '';
    const ocrPreview = previewText(item.ocr_preview || item.ocr_text || '', 80).replace(/\|/g, '\\|');
    const mcpSummary = previewText(item.mcp_summary || 'sin conteo', 80).replace(/\|/g, '\\|');
    const status = item.status === 'aligned' ? 'aligned' : 'mismatch';
    lines.push(`| ${item.timeframe} | ${item.bar_index ?? 'n/a'} | ${mcpSummary} | ${ocrPreview} | ${item.blob_count ?? 0} | ${status} | ${screenshot ? `[open](${screenshot})` : ''} |`);
  }
  lines.push('');
  for (const item of results) {
    lines.push(`### ${item.timeframe}`);
    lines.push('');
    lines.push(`- bar_index: \`${item.bar_index ?? 'n/a'}\``);
    lines.push(`- time: \`${item.time || 'n/a'}\``);
    lines.push(`- MCP: \`${item.mcp_summary || 'sin conteo'}\``);
    lines.push(`- OCR preview: \`${previewText(item.ocr_preview || item.ocr_text || '', 220)}\``);
    lines.push(`- blob count: \`${item.blob_count ?? 0}\``);
    lines.push(`- readiness: \`${item.readiness_ready ? 'ready' : 'timeout'}\` (${item.readiness_wait_ms ?? 0} ms)`);
    lines.push(`- status: \`${item.status}\``);
    if (item.chart_screenshot_path) {
      lines.push(`- chart screenshot: \`${relative(REPO_ROOT, item.chart_screenshot_path).replace(/\\/g, '/')}\``);
    }
    if (item.focus_screenshot_path) {
      lines.push(`- focus screenshot: \`${relative(REPO_ROOT, item.focus_screenshot_path).replace(/\\/g, '/')}\``);
    }
    if (item.issues?.length > 0) {
      lines.push(`- issues:`);
      for (const issue of item.issues) {
        lines.push(`  - ${issue}`);
      }
    }
    if (item.screenshot_path) {
      lines.push(`- screenshot: \`${relative(REPO_ROOT, item.screenshot_path).replace(/\\/g, '/')}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function resolveDemarkStudyId(filter = 'DeMARK 9-13') {
  const state = await getChartState();
  const needle = String(filter || '').toLowerCase();
  const studies = Array.isArray(state?.studies) ? state.studies : [];
  const match = studies.find(study => String(study?.name || '').toLowerCase().includes(needle));
  return {
    entity_id: match?.id || null,
    study_name: match?.name || null,
    chart_state: state || null,
  };
}

export async function runDemarkSweep({
  timeframes = DEFAULT_DEMARK_SWEEP_TIMEFRAMES,
  output = null,
  filter = 'DeMARK 9-13',
  column_width = 96,
  min_bar_spacing = 40,
  bars_before = 29,
  bars_after = 0,
} = {}) {
  const startedAt = new Date();
  const tfList = normalizeTimeframeList(timeframes);
  const initial = await getChartState();
  const { entity_id, study_name } = await resolveDemarkStudyId(filter);
  if (!entity_id) {
    throw new Error(`Study not found: ${filter}`);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = startedAt.toISOString().replace(/[:.]/g, '-');
  const reportName = (output || `demark-sweep-${ts}`).replace(/[\/\\]/g, '_');
  const reportPath = join(REPORTS_DIR, `${reportName}.md`);
  const initialTimeframe = initial?.resolution || null;
  const results = [];

  async function sendAltR() {
    const client = await getClient();
    await client.Input.dispatchKeyEvent({
      type: 'keyDown',
      key: 'r',
      code: 'KeyR',
      windowsVirtualKeyCode: 82,
      modifiers: 1,
    });
    await client.Input.dispatchKeyEvent({
      type: 'keyUp',
      key: 'r',
      code: 'KeyR',
    });
  }

  try {
    for (const timeframe of tfList) {
      process.stderr.write(`[sweep] timeframe=${timeframe} ...\n`);
      let result = {
        timeframe,
        status: 'mismatch',
        bar_index: null,
        time: null,
        mcp_summary: 'sin conteo',
        ocr_preview: '',
        ocr_text: '',
        blob_count: 0,
        issues: ['Sweep did not complete.'],
        chart_screenshot_path: null,
        focus_screenshot_path: null,
        screenshot_path: null,
      };

      try {
        await setTimeframe({ timeframe });
        await waitForChartReady(initial?.symbol || null).catch(() => false);
        await sendAltR();
        await waitForChartReady(initial?.symbol || null).catch(() => false);
        const readiness = await waitForDemarkSnapshotReady({
          entity_id,
          selection: { mode: 'latest', value: null },
        });

        let chartShot = await captureScreenshot({
          region: 'chart',
          method: 'api',
          filename: `demark_sweep_${timeframe}_chart`,
        }).catch(() => null);
        if (!chartShot?.file_path) {
          chartShot = await captureScreenshot({
            region: 'chart',
            filename: `demark_sweep_${timeframe}_chart`,
          }).catch(() => null);
        }
        const chartScreenshotPath = chartShot?.file_path || null;

        const capture = await captureAndDetectDemarkFocusColumn({
          selection: { mode: 'latest', value: null },
          filename_prefix: `demark_sweep_${timeframe}`,
          column_width,
          min_bar_spacing,
          bars_before,
          bars_after,
        });

        const snapshot = await getDemarkSnapshot({ entity_id, compact: true, selection: { mode: 'latest', value: null } });
        const ocr = runWindowsOcr(capture?.capture?.file_path);
        const comparison = assessComparison(snapshot, ocr, capture?.blobs);

        result = {
          timeframe,
          status: comparison.status,
          bar_index: snapshot?.bar_index ?? snapshot?.resolved_snapshot?.bar_index ?? snapshot?.selected_bar?.bar_index ?? null,
          time: snapshot?.time?.israel || snapshot?.time?.utc || null,
          mcp_summary: summarizeDemarkSnapshot(snapshot),
          ocr_preview: comparison.ocr_preview,
          ocr_text: comparison.ocr_text,
          blob_count: capture?.blobs?.blob_count ?? 0,
          issues: comparison.issues,
          chart_screenshot_path: chartScreenshotPath,
          focus_screenshot_path: capture?.capture?.file_path || null,
          screenshot_path: chartScreenshotPath || capture?.capture?.file_path || null,
          matched: comparison.matched,
          missing: comparison.missing,
          readiness_wait_ms: readiness.waited_ms,
          readiness_ready: readiness.ready,
        };

        const suffix = result.status === 'aligned' ? 'ok' : 'mismatch';
        process.stderr.write(`[sweep] timeframe=${timeframe} bar_index=${result.bar_index ?? 'n/a'} ${result.mcp_summary} (${suffix})\n`);
      } catch (error) {
        result = {
          ...result,
          status: 'mismatch',
          issues: [error?.message || String(error)],
        };
        process.stderr.write(`[sweep] timeframe=${timeframe} error=${error?.message || String(error)}\n`);
      }

      results.push(result);
    }
  } finally {
    if (initialTimeframe) {
      try {
        await setTimeframe({ timeframe: initialTimeframe });
      } catch {}
    }
  }

  const finishedAt = new Date();
  const markdown = formatSweepMarkdown({
    symbol: initial?.symbol || null,
    studyName: study_name || filter,
    initialTimeframe,
    timeframes: tfList,
    options: { column_width, min_bar_spacing, bars_before, bars_after },
    results,
    startedAt,
    finishedAt,
  });
  writeFileSync(reportPath, markdown, 'utf8');

  return {
    success: true,
    symbol: initial?.symbol || null,
    study_id: entity_id,
    study_name: study_name || filter,
    initial_timeframe: initialTimeframe,
    timeframes: tfList,
    report_path: reportPath,
    results,
    summary: {
      total: results.length,
      aligned: results.filter(item => item.status === 'aligned').length,
      mismatched: results.filter(item => item.status !== 'aligned').length,
    },
  };
}
