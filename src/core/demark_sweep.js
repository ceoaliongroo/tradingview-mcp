import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline/promises';
import process from 'process';

import { getState as getChartState, setTimeframe } from './chart.js';
import { evaluate, getClient } from '../connection.js';
import { getDemarkSnapshot } from './data.js';
import { formatDemarkLine } from './stream.js';
import { appendDemarkTrainingRecord, latestTrainingExpectationByTimeframe, readDemarkTrainingRecords } from './demark_training.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(__dirname));
const REPORTS_DIR = join(REPO_ROOT, 'reports');

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

function previewText(value, limit = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
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

function buildReadyKey(snapshot) {
  const resolved = snapshot?.resolved_snapshot || null;
  const demark = snapshot?.demark || snapshot?.indicator_snapshot?.demark || null;
  const summary = resolved?.summary?.counts
    || snapshot?.summary?.counts
    || snapshot?.indicator_snapshot?.demark?.summary
    || demark?.summary
    || null;
  const markers = resolved?.summary?.markers
    || snapshot?.summary?.markers
    || null;
  return JSON.stringify({
    barIndex: Number.isFinite(snapshot?.bar_index)
      ? snapshot.bar_index
      : Number.isFinite(resolved?.bar_index)
        ? resolved.bar_index
        : Number.isFinite(demark?.current_bar_index)
          ? demark.current_bar_index
          : null,
    timeRaw: Number.isFinite(snapshot?.time?.raw)
      ? snapshot.time.raw
      : Number.isFinite(resolved?.time?.raw)
        ? resolved.time.raw
        : null,
    summary,
    markers,
  });
}

function normalizeExpectedCount(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compareSnapshotToExpectation(snapshot, expectedRecord) {
  if (!expectedRecord) return { match: null, expected: null };
  const expected = normalizeExpectedCount(expectedRecord.human_correction || expectedRecord.mcp_summary || '');
  const actual = normalizeExpectedCount(summarizeDemarkSnapshot(snapshot));
  return {
    match: expected === actual,
    expected,
    actual,
  };
}

async function readDemarkStudyReadiness(entity_id) {
  if (!entity_id) {
    return { found: false, isLoading: null, hasError: null, anyGraphicsReady: null, graphicsViewsReady: null };
  }

  return evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        var study = chart.getStudyById(${JSON.stringify(String(entity_id))});
        if (!study) {
          return { found: false, isLoading: null, hasError: null, anyGraphicsReady: null, graphicsViewsReady: null };
        }
        var status = null;
        try {
          status = typeof study.status === 'function' ? study.status() : null;
        } catch (e) {}
        return {
          found: true,
          isLoading: typeof study.isLoading === 'function' ? !!study.isLoading() : null,
          hasError: typeof study.hasError === 'function' ? !!study.hasError() : null,
          anyGraphicsReady: typeof study.anyGraphicsReady === 'function' ? !!study.anyGraphicsReady() : null,
          graphicsViewsReady: typeof study.graphicsViewsReady === 'function' ? !!study.graphicsViewsReady() : null,
          dataLength: typeof study.dataLength === 'function' ? study.dataLength() : null,
          statusType: status && typeof status === 'object' && 'type' in status ? status.type : null
        };
      } catch (e) {
        return { found: false, isLoading: null, hasError: null, anyGraphicsReady: null, graphicsViewsReady: null, error: e.message };
      }
    })()
  `);
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
      const studyReadiness = await readDemarkStudyReadiness(entity_id);
      if (!studyReadiness?.found || studyReadiness?.hasError) {
        lastKey = null;
        stableCount = 0;
        lastSnapshot = {
          waiting: true,
          studyReadiness,
        };
        await sleep(poll_ms);
        continue;
      }

      const snapshot = await getDemarkSnapshot({ entity_id, compact: true, selection });
      lastSnapshot = snapshot;
      const key = buildReadyKey(snapshot);
      if (key && key === lastKey) stableCount += 1;
      else stableCount = 0;
      lastKey = key;

      if (stableCount >= stable_samples && snapshot?.resolved_snapshot) {
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

function compactResolvedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    bar_index: snapshot.bar_index ?? null,
    x: snapshot.x ?? null,
    chart_bar_index: snapshot.chart_bar_index ?? null,
    time: snapshot.time || null,
    ohlcv: snapshot.ohlcv || null,
    labels: Array.isArray(snapshot.labels)
      ? snapshot.labels.map(label => ({
          text: label?.text ?? null,
          resolved_count_type: label?.resolved_count_type || label?.count_type || null,
          direction: label?.direction ?? null,
          count_value: label?.count_value ?? null,
          price: label?.price ?? null,
          price_raw: label?.price_raw ?? null,
          position: label?.position ?? null,
          is_current: !!label?.is_current,
          is_perfect_setup: !!label?.is_perfect_setup,
          is_extension: !!label?.is_extension,
          marker_type: label?.marker_type ?? null,
        }))
      : [],
    perfect_setup: !!snapshot.perfect_setup,
    extensions: snapshot.extensions ?? 0,
    summary: snapshot.summary || null,
    source: snapshot.source || null,
  };
}

function compactIndicatorSnapshot(snapshot) {
  const indicator = snapshot?.indicator_snapshot || null;
  if (!indicator || typeof indicator !== 'object') return null;
  return {
    visible: indicator.visible ?? null,
    study_meta: indicator.study_meta || null,
    visible_range: indicator.visible_range || null,
    graphics_summary: indicator.graphics_summary || null,
    demark: indicator.demark ? {
      recognized: !!indicator.demark.recognized,
      study_name: indicator.demark.study_name || null,
      label_count: indicator.demark.label_count ?? null,
      labels_analyzed: indicator.demark.labels_analyzed ?? null,
      current_bar_index: indicator.demark.current_bar_index ?? null,
      summary: indicator.demark.summary || null,
    } : null,
    resolved_snapshot: compactResolvedSnapshot(indicator.resolved_snapshot || null),
  };
}

export function buildTrainingRecord({
  symbol,
  studyName,
  timeframe,
  result,
  reportPath,
  startedAt,
}) {
  return {
    ts: new Date().toISOString(),
    symbol: symbol || null,
    study: studyName || null,
    timeframe: timeframe || null,
    bar_index: result?.bar_index ?? null,
    time: result?.time || null,
    mcp_summary: result?.mcp_summary || 'sin conteo',
    mcp_snapshot: compactResolvedSnapshot(result?.mcp_snapshot || null),
    indicator_snapshot: compactIndicatorSnapshot(result) || null,
    human_verdict: result?.human_verdict || null,
    human_correction: result?.human_correction || null,
    status: result?.status || 'error',
    readiness_ready: !!result?.readiness_ready,
    readiness_wait_ms: result?.readiness_wait_ms ?? null,
    report_path: reportPath || null,
    started_at: startedAt?.toISOString?.() || null,
  };
}

function formatSweepMarkdown({ symbol, studyName, initialTimeframe, timeframes, results, startedAt, finishedAt }) {
  const summary = results.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'ok') acc.ok += 1;
    else if (item.status === 'review') acc.review += 1;
    else acc.error += 1;
    return acc;
  }, { total: 0, ok: 0, review: 0, error: 0 });

  const lines = [];
  lines.push(`# DeMARK Sweep`);
  lines.push('');
  lines.push(`- symbol: \`${symbol || 'unknown'}\``);
  lines.push(`- study: \`${studyName || 'DeMARK 9-13'}\``);
  lines.push(`- started: \`${startedAt.toISOString()}\``);
  lines.push(`- finished: \`${finishedAt.toISOString()}\``);
  lines.push(`- initial timeframe: \`${initialTimeframe || 'unknown'}\``);
  lines.push(`- timeframes: \`${timeframes.join(', ')}\``);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- ok: ${summary.ok}`);
  lines.push(`- review: ${summary.review}`);
  lines.push(`- errors: ${summary.error}`);
  lines.push(`- total: ${summary.total}`);
  lines.push('');
  lines.push(`| TF | bar_index | MCP | human | correction | status | screenshot |`);
  lines.push(`| --- | ---: | --- | --- | --- | --- | --- |`);
  for (const item of results) {
    const screenshot = item.chart_screenshot_path
      ? relative(REPO_ROOT, item.chart_screenshot_path).replace(/\\/g, '/')
      : '';
    const mcpSummary = previewText(item.mcp_summary || 'sin conteo', 80).replace(/\|/g, '\\|');
    const human = previewText(item.human_verdict || '', 40).replace(/\|/g, '\\|');
    const correction = previewText(item.human_correction || '', 60).replace(/\|/g, '\\|');
    lines.push(`| ${item.timeframe} | ${item.bar_index ?? 'n/a'} | ${mcpSummary} | ${human} | ${correction} | ${item.status || 'error'} | ${screenshot ? `[open](${screenshot})` : ''} |`);
  }
  lines.push('');

  for (const item of results) {
    lines.push(`### ${item.timeframe}`);
    lines.push('');
    lines.push(`- bar_index: \`${item.bar_index ?? 'n/a'}\``);
    lines.push(`- time: \`${item.time || 'n/a'}\``);
    lines.push(`- MCP: \`${item.mcp_summary || 'sin conteo'}\``);
    lines.push(`- human verdict: \`${item.human_verdict || 'n/a'}\``);
    if (item.human_correction) {
      lines.push(`- human correction: \`${previewText(item.human_correction || '', 220)}\``);
    }
    lines.push(`- readiness: \`${item.readiness_ready ? 'ready' : 'timeout'}\` (${item.readiness_wait_ms ?? 0} ms)`);
    lines.push(`- status: \`${item.status}\``);
    if (item.chart_screenshot_path) {
      lines.push(`- chart screenshot: \`${relative(REPO_ROOT, item.chart_screenshot_path).replace(/\\/g, '/')}\``);
    }
    if (item.issues?.length > 0) {
      lines.push(`- issues:`);
      for (const issue of item.issues) {
        lines.push(`  - ${issue}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runDemarkSweep({
  timeframes = DEFAULT_DEMARK_SWEEP_TIMEFRAMES,
  output = null,
  filter = 'DeMARK 9-13',
  compare_training = false,
  training_path = null,
  trace = false,
  auto = false,
} = {}) {
  const startedAt = new Date();
  const tfList = normalizeTimeframeList(timeframes);
  const initial = await getChartState();
  const { entity_id, study_name } = await resolveDemarkStudyId(filter);
  if (!entity_id) {
    throw new Error(`Study not found: ${filter}`);
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const trainingPath = join(REPORTS_DIR, 'demark-training.jsonl');
  const loadedTraining = compare_training ? readDemarkTrainingRecords(training_path || trainingPath) : [];
  const expectedByTf = compare_training ? latestTrainingExpectationByTimeframe(loadedTraining) : new Map();
  const ts = startedAt.toISOString().replace(/[:.]/g, '-');
  const reportName = (output || `demark-sweep-${ts}`).replace(/[\\/]/g, '_');
  const reportPath = join(REPORTS_DIR, `${reportName}.md`);
  const initialTimeframe = initial?.resolution || null;
  const results = [];

  const ask = async (question) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Interactive sweep requires a TTY.');
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await rl.question(question);
      return String(answer ?? '').trim();
    } finally {
      rl.close();
    }
  };

  const askYesNo = async (question) => {
    while (true) {
      const answer = (await ask(question)).toLowerCase();
      if (['y', 'yes', 's', 'si', 'sí'].includes(answer)) return 'yes';
      if (['n', 'no'].includes(answer)) return 'no';
      process.stderr.write('[sweep] answer with yes or no.\n');
    }
  };

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
      if (trace) process.stderr.write(`[sweep] phase=change timeframe=${timeframe}\n`);
      let result = {
        timeframe,
        status: 'error',
        bar_index: null,
        time: null,
        mcp_summary: 'sin conteo',
        mcp_snapshot: null,
        indicator_snapshot: null,
        issues: ['Sweep did not complete.'],
        screenshot_path: null,
        human_verdict: null,
        human_correction: null,
      };

      try {
        await setTimeframe({ timeframe });
        await sendAltR();
        if (trace) process.stderr.write(`[sweep] phase=wait timeframe=${timeframe}\n`);

        const readiness = await waitForDemarkSnapshotReady({
          entity_id,
          selection: { mode: 'latest', value: null },
        });
        if (trace) process.stderr.write(`[sweep] phase=snapshot timeframe=${timeframe} ready=${readiness.ready}\n`);

        const snapshot = await getDemarkSnapshot({
          entity_id,
          compact: true,
          selection: { mode: 'latest', value: null },
        });

        const terminalLine = formatDemarkLine(snapshot);
        process.stderr.write(`${terminalLine}\n`);
        const expected = compare_training ? expectedByTf.get(timeframe) || null : null;
        if (compare_training && expected) {
          const cmp = compareSnapshotToExpectation(snapshot, expected);
          process.stderr.write(`[sweep] expected="${normalizeExpectedCount(expected.human_correction || expected.mcp_summary || '')}" actual="${cmp.actual}" match=${cmp.match === true ? 'yes' : cmp.match === false ? 'no' : 'n/a'}\n`);
        }
        let humanVerdict = null;
        let humanCorrection = '';
        if (!auto) {
          humanVerdict = await askYesNo(`[sweep] ${timeframe} correct? (yes/no): `);
          if (humanVerdict === 'no') {
            while (true) {
              humanCorrection = await ask(`[sweep] ${timeframe} type the correct count: `);
              if (humanCorrection) break;
              process.stderr.write('[sweep] please type the correct count.\n');
            }
          }
          process.stderr.write(
            humanVerdict === 'yes'
              ? `[sweep] timeframe=${timeframe} recorded ok\n`
              : `[sweep] timeframe=${timeframe} recorded correction: ${humanCorrection}\n`,
          );
        } else if (compare_training && expected) {
          const cmp = compareSnapshotToExpectation(snapshot, expected);
          humanVerdict = cmp.match === true ? 'yes' : 'no';
          humanCorrection = cmp.match === true ? '' : (expected.human_correction || expected.mcp_summary || '');
        } else {
          humanVerdict = 'yes';
        }

        result = {
          timeframe,
          status: humanVerdict === 'yes' ? 'ok' : 'review',
          bar_index: snapshot?.bar_index ?? snapshot?.resolved_snapshot?.bar_index ?? snapshot?.selected_bar?.bar_index ?? null,
          time: snapshot?.time?.israel || snapshot?.time?.utc || null,
          mcp_summary: summarizeDemarkSnapshot(snapshot),
          mcp_snapshot: compactResolvedSnapshot(snapshot?.resolved_snapshot || null),
          indicator_snapshot: compactIndicatorSnapshot(snapshot),
          issues: readiness.ready ? [] : ['DeMARK snapshot did not stabilize before capture.'],
          screenshot_path: null,
          human_verdict: humanVerdict,
          human_correction: humanCorrection || null,
          readiness_wait_ms: readiness.waited_ms,
          readiness_ready: readiness.ready,
          expected_correction: compare_training && expected ? expected.human_correction || expected.mcp_summary || null : null,
          training_match: compare_training && expected ? compareSnapshotToExpectation(snapshot, expected).match : null,
        };

        appendDemarkTrainingRecord(
          buildTrainingRecord({
            symbol: initial?.symbol || null,
            studyName: study_name || filter,
            timeframe,
            result,
            reportPath,
            startedAt,
          }),
          trainingPath,
        );

        process.stderr.write(`[sweep] timeframe=${timeframe} bar_index=${result.bar_index ?? 'n/a'} ${result.mcp_summary} (${result.status})\n`);
        if (compare_training && expected) {
          const cmp = compareSnapshotToExpectation(snapshot, expected);
          process.stderr.write(`[sweep] compare timeframe=${timeframe} expected="${cmp.expected}" actual="${cmp.actual}" match=${cmp.match === true ? 'yes' : cmp.match === false ? 'no' : 'n/a'}\n`);
        }
      } catch (error) {
        result = {
          ...result,
          status: 'error',
          issues: [error?.message || String(error)],
        };
        appendDemarkTrainingRecord(
          buildTrainingRecord({
            symbol: initial?.symbol || null,
            studyName: study_name || filter,
            timeframe,
            result,
            reportPath,
            startedAt,
          }),
          trainingPath,
        );
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
    training_path: compare_training ? (training_path || trainingPath) : null,
    results,
    summary: {
      total: results.length,
      ok: results.filter(item => item.status === 'ok').length,
      review: results.filter(item => item.status === 'review').length,
      error: results.filter(item => item.status === 'error').length,
    },
  };
}
