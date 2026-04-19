/**
 * Unit tests for study input normalization used by indicator snapshots.
 * No TradingView connection needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeDemarkGraphics,
  buildVwapDvaSnapshot,
  classifyDemarkColor,
  normalizeDemarkText,
  normalizeStudyInputs,
} from '../src/core/data.js';

describe('normalizeStudyInputs', () => {
  it('keeps structured input metadata and current values', () => {
    const inputs = normalizeStudyInputs([
      {
        id: 'in_14',
        name: 'Bars to Setup',
        localizedName: 'Bars to Setup',
        group: 'Setup',
        type: 'integer',
        display: 0,
        active: true,
        isFake: true,
        isHidden: false,
        min: 1,
        max: 100,
        step: 1,
        options: [1, 2, 3],
        defval: 9,
      },
    ], [
      { id: 'in_14', value: 13 },
    ]);

    assert.equal(inputs.length, 1);
    assert.deepEqual(inputs[0], {
      id: 'in_14',
      name: 'Bars to Setup',
      localized_name: 'Bars to Setup',
      group: 'Setup',
      type: 'integer',
      display: 0,
      active: true,
      is_fake: true,
      hidden: false,
      min: 1,
      max: 100,
      step: 1,
      options: [1, 2, 3],
      default_value: 9,
      value: 13,
    });
  });

  it('truncates very large string values and defaults', () => {
    const long = 'x'.repeat(500);
    const [input] = normalizeStudyInputs([
      {
        id: 'text',
        name: 'ILScript',
        localizedName: 'ILScript',
        type: 'text',
        defval: long,
      },
    ], [
      { id: 'text', value: long },
    ], { previewLimit: 40 });

    assert.equal(input.default_value.truncated, true);
    assert.equal(input.default_value.length, 500);
    assert.equal(input.default_value.preview.length, 40);
    assert.equal(input.value.truncated, true);
    assert.equal(input.value.length, 500);
    assert.equal(input.value.preview.length, 40);
  });

  it('accepts object maps for current values', () => {
    const [input] = normalizeStudyInputs([
      { id: 'in_0', name: 'Setup', type: 'bool', defval: true },
    ], {
      in_0: false,
    });

    assert.equal(input.value, false);
  });

  it('classifies DeMARK colors and shades into families and directions', () => {
    const setupDark = classifyDemarkColor(4281898556);
    const setupLight = classifyDemarkColor(4289050279);
    const tdstDark = classifyDemarkColor(4294276096);

    assert.equal(setupDark.family, 'setup');
    assert.equal(setupDark.shade, 'dark');
    assert.equal(setupDark.direction, 'buy');
    assert.equal(setupLight.family, 'setup');
    assert.equal(setupLight.shade, 'light');
    assert.equal(setupLight.direction, 'sell');
    assert.equal(tdstDark.family, 'tdst');
  });

  it('detects bullet and extension markers in label text', () => {
    const info = normalizeDemarkText('• 3 +');

    assert.equal(info.count_value, 3);
    assert.equal(info.has_bullet, true);
    assert.equal(info.has_plus, true);
  });

  it('infers buy/sell from label position and exposes risk hints', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 10,
      barLookup: {
        9: { index: 9, time: 0, open: 94, high: 99, low: 89, close: 95, volume: 900 },
        10: { index: 10, time: 1, open: 95, high: 100, low: 90, close: 96, volume: 1000 },
      },
      labels: [
        {
          id: 'label-1',
          text: '• 3 +',
          price: 110,
          x: 10,
          textColor: 4281898556,
        },
      ],
      lines: [
        {
          id: 'line-1',
          y1: 109,
          y2: 109,
          x1: 8,
          x2: 12,
          color: 4294276096,
        },
      ],
    });

    assert.equal(result.recognized, true);
    assert.equal(result.summary.counts.tdst, undefined);
    assert.equal(result.summary.counts.setup.sell, 1);
    assert.equal(result.current_labels.length, 1);
    assert.equal(result.current_labels[0].direction, 'sell');
    assert.equal(result.current_labels[0].is_perfect_setup, true);
    assert.equal(result.current_labels[0].is_extension, true);
    assert.equal(result.current_labels[0].is_current, true);
    assert.equal(result.current_labels[0].time.iso, '1970-01-01T00:00:01.000Z');
    assert.equal(result.risk_level_candidates.length, 1);
    assert.equal(result.risk_level_candidates[0].source, 'line');
    assert.equal(result.tdst.line_candidates.length, 1);
    assert.equal(result.recent_bars.length, 2);
  });

  it('resolves numeric labels in a setup cluster even when the color is ambiguous', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 20,
      barLookup: {
        20: { index: 20, time: 2, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
      },
      labels: [
        { id: 'setup-9', text: '• 9', price: 112, x: 20, textColor: 4289189541 },
        { id: 'seq-1', text: '1', price: 113, x: 20, textColor: 4288979450 },
        { id: 'combo-9', text: '9', price: 114, x: 20, textColor: 4293582464 },
      ],
    });

    const types = result.bar_snapshots[0].labels.map(label => label.resolved_count_type);
    assert.deepEqual(types.sort(), ['combo', 'sequential', 'setup']);
    assert.equal(result.summary.counts.setup.sell, 1);
    assert.equal(result.summary.counts.sequential.sell, 1);
    assert.equal(result.summary.counts.combo.sell, 1);
  });

  it('builds a versioned annual DVA snapshot with current and previous areas', () => {
    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BITSTAMP:BTCUSD',
      resolution: '1D',
      chartLastIndex: 299,
      studyVisible: true,
      rows: [
        {
          index: 191,
          value: [
            1767139200,
            100352.74514938725,
            4283585279,
            112554.21780299074,
            866689954,
            88151.27249578376,
            866689954,
            124755.69045659422,
            866689954,
            75949.79984218028,
            866689954,
            136957.1631101977,
            866689954,
            63748.327188576804,
            866689954,
            106453.48147618899,
            2158535586,
            94252.00882258551,
            2158535586,
            118654.95412979249,
            11051938,
            82050.53616898201,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
        {
          index: 299,
          value: [
            1776470400,
            74316.01121211374,
            4283585279,
            83677.7438297834,
            866689954,
            64954.27859444407,
            866689954,
            93039.47644745307,
            866689954,
            55592.5459767744,
            866689954,
            102401.20906512273,
            866689954,
            46230.81335910474,
            866689954,
            78996.87752094856,
            2158535586,
            69635.14490327891,
            2158535586,
            88358.61013861824,
            11051938,
            60273.412285609236,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
      ],
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v2');
    assert.equal(snapshot.schema_version, 'v2');
    assert.equal(snapshot.dva.type, 'annual');
    assert.equal(snapshot.dva.anchor, 'Year');
    assert.equal(snapshot.dva.current.period_start.raw, 1767225600);
    assert.equal(snapshot.dva.current.period_start.utc, '2026-01-01T00:00:00.000Z');
    assert.equal(snapshot.dva.current.period_start.israel, '2026-01-01 02:00');
    assert.equal(snapshot.dva.current.period_end.raw, 1776470400);
    assert.equal(snapshot.dva.current.period_end.utc, '2026-04-19T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_start.raw, 1735689600);
    assert.equal(snapshot.dva.previous.period_start.utc, '2025-01-01T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_start.israel, '2025-01-01 02:00');
    assert.equal(snapshot.dva.previous.period_end.raw, 1767139200);
    assert.equal(snapshot.dva.previous.period_end.utc, '2025-12-31T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_end.israel, '2025-12-31 02:00');
    assert.equal(snapshot.dva.current.period_start_bar_index, 191);
    assert.equal(snapshot.dva.current.period_end_bar_index, 299);
    assert.equal(snapshot.dva.previous.period_start_bar_index, -1000100);
    assert.equal(snapshot.dva.previous.period_end_bar_index, 190);
    assert.equal(snapshot.dva.current.variables.VWAP, 74316.01121211374);
    assert.equal(snapshot.dva.previous.variables.DVAH, 112554.21780299074);
    assert.equal(snapshot.dva.current.display_values.VWAP, '74,316.011212');
    assert.equal(snapshot.dva.current_value_row.time.utc, '2026-04-19T00:00:00.000Z');
    assert.equal(snapshot.dva.current_value_row.time.israel, '2026-04-19 03:00');
  });
});
