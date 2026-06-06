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

function createVwapNarrativeRow({
  index,
  time,
  vwap,
  upper,
  lower,
  upperTwo,
  lowerTwo,
  upperHalf,
  lowerHalf,
  upperOneHalf,
  lowerOneHalf,
  bar,
}) {
  return {
    index,
    bar,
    value: [
      time,
      vwap,
      0,
      upper,
      0,
      lower,
      0,
      upperTwo,
      0,
      lowerTwo,
      0,
      upperTwo + 10,
      0,
      lowerTwo - 10,
      0,
      upperHalf,
      0,
      lowerHalf,
      0,
      upperOneHalf,
      0,
      lowerOneHalf,
      0,
      0,
      0,
      0,
    ],
  };
}

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
      currentClose: 260.4453201814728,
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.type, 'annual');
    assert.equal(snapshot.dva.anchor, 'Year');
    assert.equal(snapshot.dva.current.period_start.raw, 1767225600);
    assert.equal(snapshot.dva.current.period_start.utc, '2026-01-01T00:00:00.000Z');
    assert.equal(snapshot.dva.current.period_start.israel, '2026-01-01 02:00');
    assert.equal(snapshot.dva.current.period_end.raw, 1776470400);
    assert.equal(snapshot.dva.current.period_end.utc, '2026-04-18T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_start.raw, 1735689600);
    assert.equal(snapshot.dva.previous.period_start.utc, '2025-01-01T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_start.israel, '2025-01-01 02:00');
    assert.equal(snapshot.dva.previous.period_end.raw, 1767139200);
    assert.equal(snapshot.dva.previous.period_end.utc, '2025-12-31T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_end.israel, '2025-12-31 02:00');
    assert.equal(snapshot.dva.current.period_start_bar_index, 299);
    assert.equal(snapshot.dva.current.period_end_bar_index, 299);
    assert.equal(snapshot.dva.previous.period_start_bar_index, 191);
    assert.equal(snapshot.dva.previous.period_end_bar_index, 191);
    assert.equal(snapshot.dva.current.variables.VWAP, 74316.01121211374);
    assert.equal(snapshot.dva.previous.variables.DVAH, 112554.21780299074);
    assert.equal(snapshot.dva.current.display_values.VWAP, '74,316.011212');
    assert.equal(snapshot.dva.current_value_row.time.utc, '2026-04-18T00:00:00.000Z');
    assert.equal(snapshot.dva.current_value_row.time.israel, '2026-04-18 03:00');
  });

  it('treats 2h as monthly for the DVA snapshot versioned output', () => {
    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '120',
      chartLastIndex: 299,
      studyVisible: true,
      rows: [
        {
          index: -293,
          value: [
            1767222000,
            276.40011897555064,
            4283585279,
            280.989554341645,
            866689954,
            271.8106836094563,
            866689954,
            285.5789897077393,
            866689954,
            267.22124824336197,
            866689954,
            290.16842507383365,
            866689954,
            262.63181287726763,
            866689954,
            278.6948366585978,
            2158535586,
            274.1054012925035,
            2158535586,
            283.28427202469214,
            11051938,
            269.51596592640914,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
        {
          index: 299,
          value: [
            1776722400,
            260.20002047165747,
            4283585279,
            266.68774218371306,
            866689954,
            253.7122987596019,
            866689954,
            273.1754638957686,
            866689954,
            247.22457704754635,
            866689954,
            279.6631856078242,
            866689954,
            240.73685533549076,
            866689954,
            263.4438813276853,
            2158535586,
            256.9561596156297,
            2158535586,
            269.9316030397408,
            11051938,
            250.4684379035741,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
      ],
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.type, 'monthly');
    assert.equal(snapshot.dva.anchor, 'Month');
    assert.equal(snapshot.dva.current.period_key, '2026-04');
    assert.equal(snapshot.dva.current.period_start.utc, '2026-04-01T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_key, '2025-12');
    assert.equal(snapshot.dva.previous.period_end.utc, '2025-12-31T23:00:00.000Z');
    assert.equal(snapshot.dva.current_value_row.time.utc, '2026-04-20T22:00:00.000Z');
    assert.equal(snapshot.dva.previous_value_row.time.utc, '2025-12-31T23:00:00.000Z');
    assert.equal(snapshot.dva.current.variables.VWAP, 260.20002047165747);
    assert.equal(snapshot.dva.previous.variables.DVAH, 280.989554341645);
  });

  it('treats 30m as weekly for the DVA snapshot versioned output', () => {
    const previousTime = Date.UTC(2026, 3, 6) / 1000;
    const currentTime = Date.UTC(2026, 3, 13) / 1000;
    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '30',
      chartLastIndex: 299,
      studyVisible: true,
      rows: [
        {
          index: 290,
          value: [
            previousTime,
            180.5,
            4283585279,
            182.5,
            866689954,
            178.5,
            866689954,
            184.5,
            866689954,
            176.5,
            866689954,
            186.5,
            866689954,
            174.5,
            866689954,
            181.5,
            2158535586,
            179.5,
            2158535586,
            183.5,
            11051938,
            177.5,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
        {
          index: 299,
          value: [
            currentTime,
            190.25,
            4283585279,
            192.25,
            866689954,
            188.25,
            866689954,
            194.25,
            866689954,
            186.25,
            866689954,
            196.25,
            866689954,
            184.25,
            866689954,
            191.25,
            2158535586,
            189.25,
            2158535586,
            193.25,
            11051938,
            187.25,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
      ],
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.type, 'weekly');
    assert.equal(snapshot.dva.anchor, 'Week');
    assert.equal(snapshot.dva.current.period_key, '2026-W16');
    assert.equal(snapshot.dva.current.period_start.utc, '2026-04-13T00:00:00.000Z');
    assert.equal(snapshot.dva.previous.period_key, '2026-W15');
    assert.equal(snapshot.dva.previous.period_start.utc, '2026-04-06T00:00:00.000Z');
    assert.equal(snapshot.dva.current_value_row.time.utc, '2026-04-13T00:00:00.000Z');
    assert.equal(snapshot.dva.previous_value_row.time.utc, '2026-04-06T00:00:00.000Z');
    assert.equal(snapshot.dva.current.variables.VWAP, 190.25);
    assert.equal(snapshot.dva.previous.variables.DVAH, 182.5);
  });

  it('treats 1M as decade-anchored monthly DVA snapshot versioned output', () => {
    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '1M',
      chartLastIndex: 299,
      studyVisible: true,
      rows: [
        {
          index: 290,
          value: [
            1767222000,
            276.40011897555064,
            4283585279,
            280.989554341645,
            866689954,
            271.8106836094563,
            866689954,
            285.5789897077393,
            866689954,
            267.22124824336197,
            866689954,
            290.16842507383365,
            866689954,
            262.63181287726763,
            866689954,
            278.6948366585978,
            2158535586,
            274.1054012925035,
            2158535586,
            283.28427202469214,
            11051938,
            269.51596592640914,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
        {
          index: 299,
          value: [
            1776722400,
            260.20002047165747,
            4283585279,
            266.68774218371306,
            866689954,
            253.7122987596019,
            866689954,
            273.1754638957686,
            866689954,
            247.22457704754635,
            866689954,
            279.6631856078242,
            866689954,
            240.73685533549076,
            866689954,
            263.4438813276853,
            2158535586,
            256.9561596156297,
            2158535586,
            269.9316030397408,
            11051938,
            250.4684379035741,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
      ],
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.type, 'monthly');
    assert.equal(snapshot.dva.anchor, 'Decade');
  });

  it('treats 1W as half-decade anchored weekly DVA snapshot versioned output', () => {
    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '1W',
      chartLastIndex: 299,
      studyVisible: true,
      rows: [
        {
          index: 290,
          value: [
            1776038400,
            180.5,
            4283585279,
            182.5,
            866689954,
            178.5,
            866689954,
            184.5,
            866689954,
            176.5,
            866689954,
            186.5,
            866689954,
            174.5,
            866689954,
            181.5,
            2158535586,
            179.5,
            2158535586,
            183.5,
            11051938,
            177.5,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
        {
          index: 299,
          value: [
            1776643200,
            190.25,
            4283585279,
            192.25,
            866689954,
            188.25,
            866689954,
            194.25,
            866689954,
            186.25,
            866689954,
            196.25,
            866689954,
            184.25,
            866689954,
            191.25,
            2158535586,
            189.25,
            2158535586,
            193.25,
            11051938,
            187.25,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
      ],
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.type, 'weekly');
    assert.equal(snapshot.dva.anchor, 'HalfDecade');
  });

  it('adds a dominant area window for quarterly anchors', () => {
    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '8h',
      chartLastIndex: 299,
      studyVisible: true,
      currentClose: 260.4453201814728,
      rows: [
        {
          index: 152,
          value: [
            1767225600,
            261.12234811558164,
            4283585279,
            269.8271438867708,
            866689954,
            252.41755234439248,
            866689954,
            278.53193965796,
            866689954,
            243.71275657320334,
            866689954,
            287.2367354291491,
            866689954,
            235.00796080201417,
            866689954,
            265.4747460011762,
            2158535586,
            256.76995022998705,
            2158535586,
            274.1795417723654,
            11051938,
            248.0651544587979,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
        {
          index: 299,
          value: [
            1776700800,
            260.4453201814728,
            4283585279,
            266.43719927656775,
            866689954,
            254.4534410863779,
            866689954,
            272.4290783716627,
            866689954,
            248.461561991283,
            866689954,
            278.42095746675756,
            866689954,
            242.46968289618806,
            866689954,
            263.4412597290203,
            2158535586,
            257.44938063392533,
            2158535586,
            269.4331388241152,
            11051938,
            251.45750153883046,
            11051938,
            866689954,
            866689954,
            866689954,
          ],
        },
      ],
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.type, 'quarterly');
    assert.equal(snapshot.dva.anchor, 'Quarter');
    assert.equal(snapshot.dva.dominant_area.active_side, 'previous');
    assert.equal(snapshot.dva.dominant_area.switch_at.utc, '2026-05-01T00:00:00.000Z');
    assert.equal(snapshot.dva.dominant_area.previous_window.end.utc, '2026-05-01T00:00:00.000Z');
    assert.equal(snapshot.dva.dominant_area.current_window.start.utc, '2026-05-01T00:00:00.000Z');
    assert.equal(snapshot.dva.dominant_area.current_window.end.utc, '2026-07-01T00:00:00.000Z');
    assert.equal(snapshot.dva.price_close, 260.4453201814728);
    assert.equal(snapshot.dva.price_position_dominant_area, 'Inside');
  });

  it('resolves a pending BPB narrative while the dominant area is PVA', () => {
    const upper = 110;
    const lower = 90;
    const rows = [
      createVwapNarrativeRow({
        index: 0,
        time: Date.UTC(2026, 3, 17, 18, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 100, high: 108, low: 96, close: 101, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 1,
        time: Date.UTC(2026, 3, 17, 19, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 101, high: 112, low: 100, close: 111, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 2,
        time: Date.UTC(2026, 3, 17, 20, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 111, high: 116, low: 109, close: 115, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 3,
        time: Date.UTC(2026, 3, 17, 21, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 115, high: 117, low: 112, close: 116, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 4,
        time: Date.UTC(2026, 3, 17, 22, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 116, high: 118, low: 113, close: 117, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 5,
        time: Date.UTC(2026, 3, 17, 23, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 117, high: 119, low: 114, close: 118, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 6,
        time: Date.UTC(2026, 3, 18, 0, 0) / 1000,
        vwap: 100,
        upper,
        lower,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 118, high: 120, low: 115, close: 119, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 7,
        time: Date.UTC(2026, 3, 20, 12, 0) / 1000,
        vwap: 101,
        upper: 111,
        lower: 91,
        upperTwo: 121,
        lowerTwo: 81,
        upperHalf: 106,
        lowerHalf: 96,
        upperOneHalf: 116,
        lowerOneHalf: 86,
        bar: { open: 119, high: 121, low: 116, close: 120, volume: 1 },
      }),
    ];

    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '30',
      chartLastIndex: 7,
      studyVisible: true,
      rows,
      currentClose: 120,
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.dominant_area.active_label, 'PVA');
    assert.equal(snapshot.dva.narrative.dominant_area_label, 'PVA');
    assert.equal(snapshot.dva.narrative.direction, 'bullish');
    assert.equal(snapshot.dva.narrative.type, 'imbalance_up');
    assert.equal(snapshot.dva.narrative.pullback_type, 'BPB');
    assert.equal(snapshot.dva.narrative.pullback_state, 'pending');
    assert.equal(snapshot.dva.narrative.fcs_active, true);
  });

  it('resolves a confirmed EF narrative while the dominant area is DVA', () => {
    const rows = [
      createVwapNarrativeRow({
        index: 0,
        time: Date.UTC(2026, 3, 20, 1, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 114, high: 116, low: 112, close: 114, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 1,
        time: Date.UTC(2026, 3, 21, 3, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 114, high: 112, low: 103, close: 104, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 2,
        time: Date.UTC(2026, 3, 21, 4, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 104, high: 106, low: 104, close: 104, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 3,
        time: Date.UTC(2026, 3, 21, 5, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 104, high: 104, low: 96, close: 100, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 4,
        time: Date.UTC(2026, 3, 21, 6, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 100, high: 103, low: 95, close: 99, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 5,
        time: Date.UTC(2026, 3, 21, 7, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 99, high: 102, low: 94, close: 98, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 6,
        time: Date.UTC(2026, 3, 21, 8, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 98, high: 101, low: 93, close: 97, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 7,
        time: Date.UTC(2026, 3, 21, 9, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 97, high: 111, low: 102, close: 108, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 8,
        time: Date.UTC(2026, 3, 21, 10, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 108, high: 100, low: 92, close: 94, volume: 1 },
      }),
    ];

    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '30',
      chartLastIndex: 8,
      studyVisible: true,
      rows,
      currentClose: 94,
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.schema_version, 'v11');
    assert.equal(snapshot.dva.dominant_area.active_label, 'DVA');
    assert.equal(snapshot.dva.narrative.dominant_area_label, 'DVA');
    assert.equal(snapshot.dva.narrative.direction, 'bearish');
    assert.equal(snapshot.dva.narrative.type, 'rotational_down');
    assert.equal(snapshot.dva.narrative.pullback_type, 'EF');
    assert.equal(snapshot.dva.narrative.pullback_state, 'confirmed');
    assert.equal(snapshot.dva.narrative.fcs_active, false);
  });

  it('confirms IPB using the dynamic DVA edge after outside acceptance', () => {
    const rows = [
      createVwapNarrativeRow({
        index: 0,
        time: Date.UTC(2026, 3, 21, 1, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 96, high: 101, low: 94, close: 95, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 1,
        time: Date.UTC(2026, 3, 21, 2, 0) / 1000,
        vwap: 99,
        upper: 109,
        lower: 89,
        upperTwo: 119,
        lowerTwo: 79,
        upperHalf: 104,
        lowerHalf: 94,
        upperOneHalf: 114,
        lowerOneHalf: 84,
        bar: { open: 95, high: 89.2, low: 86, close: 88.8, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 2,
        time: Date.UTC(2026, 3, 21, 3, 0) / 1000,
        vwap: 98,
        upper: 108,
        lower: 88,
        upperTwo: 118,
        lowerTwo: 78,
        upperHalf: 103,
        lowerHalf: 93,
        upperOneHalf: 113,
        lowerOneHalf: 83,
        bar: { open: 88.8, high: 87, low: 77, close: 82, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 3,
        time: Date.UTC(2026, 3, 21, 4, 0) / 1000,
        vwap: 97,
        upper: 107,
        lower: 87,
        upperTwo: 117,
        lowerTwo: 77,
        upperHalf: 102,
        lowerHalf: 92,
        upperOneHalf: 112,
        lowerOneHalf: 82,
        bar: { open: 82, high: 86, low: 76, close: 81, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 4,
        time: Date.UTC(2026, 3, 21, 5, 0) / 1000,
        vwap: 96,
        upper: 106,
        lower: 86,
        upperTwo: 116,
        lowerTwo: 76,
        upperHalf: 101,
        lowerHalf: 91,
        upperOneHalf: 111,
        lowerOneHalf: 81,
        bar: { open: 81, high: 85, low: 75, close: 80, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 5,
        time: Date.UTC(2026, 3, 21, 6, 0) / 1000,
        vwap: 95,
        upper: 105,
        lower: 85,
        upperTwo: 115,
        lowerTwo: 75,
        upperHalf: 100,
        lowerHalf: 90,
        upperOneHalf: 110,
        lowerOneHalf: 80,
        bar: { open: 80, high: 84, low: 74, close: 79, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 6,
        time: Date.UTC(2026, 3, 21, 7, 0) / 1000,
        vwap: 94,
        upper: 104,
        lower: 84,
        upperTwo: 114,
        lowerTwo: 74,
        upperHalf: 99,
        lowerHalf: 89,
        upperOneHalf: 109,
        lowerOneHalf: 79,
        bar: { open: 79, high: 84.2, low: 83.4, close: 83.7, volume: 1 },
      }),
    ];

    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '30',
      chartLastIndex: 6,
      studyVisible: true,
      rows,
      currentClose: 83.7,
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.dva.narrative.type, 'imbalance_down');
    assert.equal(snapshot.dva.narrative.pullback_type, 'IPB');
    assert.equal(snapshot.dva.narrative.pullback_state, 'confirmed');
    assert.equal(snapshot.dva.narrative.fcs_active, true);
    assert.equal(snapshot.dva.narrative.acceptance?.mode, 'outside');
  });

  it('ends the fresh FCS after an outside pullback when migration resumes with a full bar outside', () => {
    const rows = [
      createVwapNarrativeRow({
        index: 0,
        time: Date.UTC(2026, 3, 21, 1, 0) / 1000,
        vwap: 100,
        upper: 110,
        lower: 90,
        upperTwo: 120,
        lowerTwo: 80,
        upperHalf: 105,
        lowerHalf: 95,
        upperOneHalf: 115,
        lowerOneHalf: 85,
        bar: { open: 96, high: 101, low: 94, close: 95, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 1,
        time: Date.UTC(2026, 3, 21, 2, 0) / 1000,
        vwap: 99,
        upper: 109,
        lower: 89,
        upperTwo: 119,
        lowerTwo: 79,
        upperHalf: 104,
        lowerHalf: 94,
        upperOneHalf: 114,
        lowerOneHalf: 84,
        bar: { open: 95, high: 89.2, low: 86, close: 88.8, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 2,
        time: Date.UTC(2026, 3, 21, 3, 0) / 1000,
        vwap: 98,
        upper: 108,
        lower: 88,
        upperTwo: 118,
        lowerTwo: 78,
        upperHalf: 103,
        lowerHalf: 93,
        upperOneHalf: 113,
        lowerOneHalf: 83,
        bar: { open: 88.8, high: 87, low: 77, close: 82, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 3,
        time: Date.UTC(2026, 3, 21, 4, 0) / 1000,
        vwap: 97,
        upper: 107,
        lower: 87,
        upperTwo: 117,
        lowerTwo: 77,
        upperHalf: 102,
        lowerHalf: 92,
        upperOneHalf: 112,
        lowerOneHalf: 82,
        bar: { open: 82, high: 86, low: 76, close: 81, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 4,
        time: Date.UTC(2026, 3, 21, 5, 0) / 1000,
        vwap: 96,
        upper: 106,
        lower: 86,
        upperTwo: 116,
        lowerTwo: 76,
        upperHalf: 101,
        lowerHalf: 91,
        upperOneHalf: 111,
        lowerOneHalf: 81,
        bar: { open: 81, high: 85, low: 75, close: 80, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 5,
        time: Date.UTC(2026, 3, 21, 6, 0) / 1000,
        vwap: 95,
        upper: 105,
        lower: 85,
        upperTwo: 115,
        lowerTwo: 75,
        upperHalf: 100,
        lowerHalf: 90,
        upperOneHalf: 110,
        lowerOneHalf: 80,
        bar: { open: 80, high: 84, low: 74, close: 79, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 6,
        time: Date.UTC(2026, 3, 21, 7, 0) / 1000,
        vwap: 94,
        upper: 104,
        lower: 84,
        upperTwo: 114,
        lowerTwo: 74,
        upperHalf: 99,
        lowerHalf: 89,
        upperOneHalf: 109,
        lowerOneHalf: 79,
        bar: { open: 79, high: 84.2, low: 83.4, close: 83.7, volume: 1 },
      }),
      createVwapNarrativeRow({
        index: 7,
        time: Date.UTC(2026, 3, 21, 8, 0) / 1000,
        vwap: 93,
        upper: 103,
        lower: 83,
        upperTwo: 113,
        lowerTwo: 73,
        upperHalf: 98,
        lowerHalf: 88,
        upperOneHalf: 108,
        lowerOneHalf: 78,
        bar: { open: 83.5, high: 82.5, low: 72, close: 79, volume: 1 },
      }),
    ];

    const snapshot = buildVwapDvaSnapshot({
      symbol: 'BATS:AAPL',
      resolution: '30',
      chartLastIndex: 7,
      studyVisible: true,
      rows,
      currentClose: 79,
    });

    assert.equal(snapshot.source, 'vwap_dva_snapshot_v11');
    assert.equal(snapshot.dva.narrative.acceptance?.mode, 'outside');
    assert.equal(snapshot.dva.narrative.pullback_type, 'IPB');
    assert.equal(snapshot.dva.narrative.pullback_state, 'confirmed');
    assert.equal(snapshot.dva.narrative.fcs_active, false);
  });
});
