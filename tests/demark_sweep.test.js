import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrainingRecord, normalizeTimeframeList, summarizeDemarkSnapshot } from '../src/core/demark_sweep.js';

describe('normalizeTimeframeList', () => {
  it('returns the default sweep order when empty', () => {
    assert.deepEqual(
      normalizeTimeframeList(''),
      ['12M', 'M', 'W', 'D', '8h', '4h', '2h', '1h', '30m', '5m', '1m'],
    );
  });

  it('splits comma separated timeframes', () => {
    assert.deepEqual(normalizeTimeframeList('D,8h,1h'), ['D', '8h', '1h']);
  });
});

describe('summarizeDemarkSnapshot', () => {
  it('summarizes numeric labels and markers', () => {
    const summary = summarizeDemarkSnapshot({
      labels: [
        { resolved_count_type: 'setup', direction: 'buy', count_value: 1 },
        { resolved_count_type: 'combo', direction: 'buy', count_value: 2 },
        { resolved_count_type: 'indicator', is_perfect_setup: true },
      ],
    });

    assert.equal(summary, 'setup buy 1 | combo buy 2 | perfect setup');
  });

  it('returns sin conteo when there are no labels', () => {
    assert.equal(summarizeDemarkSnapshot({ labels: [] }), 'sin conteo');
  });
});

describe('buildTrainingRecord', () => {
  it('persists compact MCP and indicator snapshots for training', () => {
    const record = buildTrainingRecord({
      symbol: 'TVC:DXY',
      studyName: 'DeMARK 9-13',
      timeframe: '8h',
      result: {
        bar_index: 10749,
        time: { israel: '2026-04-17 18:00', utc: '2026-04-17T15:00:00.000Z', raw: 1776236400 },
        mcp_summary: 'setup sell 9 | perfect setup',
        mcp_snapshot: {
          bar_index: 10749,
          time: { israel: '2026-04-17 18:00', utc: '2026-04-17T15:00:00.000Z', raw: 1776236400 },
          ohlcv: { open: 1, high: 2, low: 3, close: 4, volume: 5 },
          labels: [{ text: '9', resolved_count_type: 'setup', direction: 'sell', count_value: 9 }],
          perfect_setup: true,
          extensions: 0,
          summary: { label_count: 1 },
        },
        indicator_snapshot: {
          visible: true,
          study_meta: { description: 'DeMARK 9-13' },
          graphics_summary: { line_count: 1 },
          demark: {
            recognized: true,
            study_name: 'DeMARK 9-13',
            label_count: 1,
            labels_analyzed: 1,
            current_bar_index: 299,
            summary: { setup: { buy: 0, sell: 1, unknown: 0 } },
          },
          resolved_snapshot: {
            bar_index: 10749,
            time: { israel: '2026-04-17 18:00', utc: '2026-04-17T15:00:00.000Z', raw: 1776236400 },
            labels: [{ text: '9', resolved_count_type: 'setup', direction: 'sell' }],
            summary: { label_count: 1 },
          },
        },
        status: 'ok',
        readiness_ready: true,
        readiness_wait_ms: 1234,
      },
      reportPath: 'C:\\repo\\reports\\demo.md',
      startedAt: new Date('2026-04-18T00:00:00.000Z'),
    });

    assert.equal(record.symbol, 'TVC:DXY');
    assert.equal(record.timeframe, '8h');
    assert.equal(record.mcp_summary, 'setup sell 9 | perfect setup');
    assert.equal(record.mcp_snapshot.bar_index, 10749);
    assert.equal(record.indicator_snapshot.demark.current_bar_index, 299);
    assert.equal(record.indicator_snapshot.resolved_snapshot.bar_index, 10749);
  });
});
