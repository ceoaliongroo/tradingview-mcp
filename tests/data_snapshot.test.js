/**
 * Unit tests for study input normalization used by indicator snapshots.
 * No TradingView connection needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeDemarkGraphics,
  buildResolvedDemarkSnapshot,
  classifyDemarkColor,
  normalizeDemarkText,
  normalizeStudyInputs,
  selectBarSnapshotByVisibleRange,
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
    assert.equal(result.summary.counts.indicator.sell, 1);
    assert.equal(result.current_labels.length, 1);
    assert.equal(result.current_labels[0].direction, 'sell');
    assert.equal(result.current_labels[0].resolved_count_type, 'indicator');
    assert.equal(result.current_labels[0].count_type, 'indicator');
    assert.equal(result.current_labels[0].is_perfect_setup, true);
    assert.equal(result.current_labels[0].is_extension, true);
    assert.equal(result.current_labels[0].is_current, true);
    assert.equal(result.current_labels[0].time.iso, '1970-01-01T00:00:01.000Z');
    assert.equal(result.current_labels[0].x, 10);
    assert.equal(result.active_signals[0].x, 10);
    assert.equal(result.labels[0].x, 10);
    assert.equal(result.bar_snapshots[0].labels[0].x, 10);
    assert.equal(result.risk_level_candidates.length, 1);
    assert.equal(result.risk_level_candidates[0].source, 'line');
    assert.equal(result.tdst.line_candidates.length, 1);
    assert.equal(result.recent_bars.length, 2);
  });

  it('resolves numeric labels and marker labels deterministically', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 20,
      barLookup: {
        20: { index: 20, time: 2, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
      },
      labels: [
        { id: 'setup-1', text: '1', price: 112, x: 20, textColor: 4281898556 },
        { id: 'seq-2', text: '2', price: 113, x: 20, textColor: 4281542834 },
        { id: 'combo-3', text: '3', price: 114, x: 20, textColor: 4289173248 },
      ],
    });

    const types = result.bar_snapshots[0].labels.map(label => label.resolved_count_type);
    assert.deepEqual(types.sort(), ['combo', 'indicator', 'setup']);
    assert.equal(result.summary.counts.setup.sell, 1);
    assert.equal(result.summary.counts.combo.sell, 1);
    assert.equal(result.summary.counts.indicator.sell, 1);
  });

  it('keeps all bar snapshots available for selection', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 12,
      barLookup: {
        1: { index: 1, time: 1, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        2: { index: 2, time: 2, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        3: { index: 3, time: 3, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        4: { index: 4, time: 4, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        5: { index: 5, time: 5, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        6: { index: 6, time: 6, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        7: { index: 7, time: 7, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        8: { index: 8, time: 8, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        9: { index: 9, time: 9, open: 10, high: 11, low: 9, close: 10, volume: 1 },
        10: { index: 10, time: 10, open: 10, high: 11, low: 9, close: 10, volume: 1 },
      },
      labels: Array.from({ length: 10 }, (_, i) => ({
        id: `label-${i + 1}`,
        text: `${i + 1}`,
        price: 12 + i,
        x: i + 1,
        textColor: 4289189541,
      })),
    });

    assert.equal(result.bar_snapshots.length, 10);
    assert.equal(result.bar_snapshots_recent.length, 8);
  });

  it('keeps buy recognition intact for labels below the bar', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 30,
      barLookup: {
        30: { index: 30, time: 30, open: 100, high: 110, low: 90, close: 95, volume: 1000 },
      },
      labels: [
        {
          id: 'buy-setup',
          text: '• 6',
          price: 88,
          x: 30,
          textColor: 4281898556,
        },
      ],
    });

    assert.equal(result.current_labels[0].direction, 'buy');
    assert.equal(result.current_labels[0].count_type, 'indicator');
    assert.equal(result.current_labels[0].resolved_count_type, 'indicator');
    assert.equal(result.current_labels[0].is_perfect_setup, true);
    assert.equal(result.current_labels[0].x, 30);
  });

  it('uses raw label price precision to keep below-bar labels as buy', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 14008,
      barLookup: {
        14008: { index: 14008, time: 1776380400, open: 98.189, high: 98.28, low: 98.189, close: 98.222, volume: 0 },
      },
      labels: [
        {
          id: 'buy-raw',
          text: '9',
          price: 98.19,
          price_raw: 98.189,
          x: 14008,
          textColor: 4281898556,
        },
      ],
    });

    assert.equal(result.current_labels[0].position, 'below_bar');
    assert.equal(result.current_labels[0].direction, 'buy');
    assert.equal(result.current_labels[0].resolved_count_type, 'setup');
    assert.equal(result.summary.counts.setup.buy, 1);
  });

  it('selects the bar closest to the visible range center', () => {
    const selected = selectBarSnapshotByVisibleRange([
      { bar_index: 10, time: { raw: 100 } },
      { bar_index: 11, time: { raw: 140 } },
      { bar_index: 12, time: { raw: 170 } },
    ], { from: 120, to: 180 });

    assert.equal(selected.bar_index, 11);
  });

  it('builds a resolved snapshot from the selected bar and keeps only exact labels', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 40,
      barLookup: {
        39: { index: 39, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        40: { index: 40, time: 1060, open: 105, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'bar-39', text: '5', price: 111, x: 39, textColor: 4289050279 },
        { id: 'bar-40', text: '• 6', price: 113, x: 40, textColor: 4281898556 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, { from: 1030, to: 1090 }, { selection: 'visible' });
    assert.equal(resolved.bar_index, 40);
    assert.equal(resolved.x, 40);
    assert.equal(resolved.time.raw, 1060);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].x, 40);
    assert.equal(resolved.labels[0].bar_index, 40);
    assert.equal(resolved.labels[0].direction, 'sell');
    assert.equal(resolved.labels[0].resolved_count_type, 'indicator');
    assert.equal(resolved.cluster_bars, undefined);
    assert.equal(resolved.cluster_labels, undefined);
    assert.equal(resolved.cluster_summary, undefined);
  });

  it('prefers the latest bar by default and can select a bar by time', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 50,
      barLookup: {
        49: { index: 49, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        50: { index: 50, time: 1060, open: 105, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'bar-49', text: '7', price: 111, x: 49, textColor: 4281898556 },
        { id: 'bar-50', text: '8', price: 113, x: 50, textColor: 4281898556 },
      ],
    });

    const latest = buildResolvedDemarkSnapshot(demark, null);
    const byTime = buildResolvedDemarkSnapshot(demark, null, { selection: { mode: 'time', value: 1000 } });

    assert.equal(latest.bar_index, 50);
    assert.equal(latest.x, 50);
    assert.equal(byTime.bar_index, 49);
    assert.equal(byTime.x, 49);
    assert.equal(byTime.selection_mode, 'time');
  });

  it('merges the latest chart bar with its enriched labels instead of dropping them', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 10,
          bar_number: 10,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 100,
          high: 112,
          low: 96,
          close: 108,
          volume: 11,
          labels: [
            { id: 'setup', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 95, bar_index: 10, bar_number: 10, x: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
            { id: 'combo', text: '1', count_type: 'combo', resolved_count_type: 'combo', direction: 'buy', price: 94, bar_index: 10, bar_number: 10, x: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 10, bar_index: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' }, open: 100, high: 112, low: 96, close: 108, volume: 11 },
    });

    assert.equal(resolved.bar_index, 10);
    assert.equal(resolved.labels.length, 2);
    assert.equal(resolved.labels.some(label => label.resolved_count_type === 'setup'), true);
    assert.equal(resolved.labels.some(label => label.resolved_count_type === 'combo'), true);
  });

  it('keeps the selected latest bar when no chart reference is available', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 10,
          bar_number: 10,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 100,
          high: 112,
          low: 96,
          close: 108,
          volume: 11,
          labels: [
            { id: 'setup', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 95, bar_index: 10, bar_number: 10, x: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 90, bar_index: 90, time: { raw: 2000, iso: '1970-01-01T00:33:20.000Z' }, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    });

    assert.equal(resolved.bar_index, 90);
    assert.equal(resolved.time.raw, 2000);
    assert.equal(resolved.ohlcv.open, 1);
    assert.equal(resolved.labels.length, 0);
  });

  it('prefers the snapshot bar over a mismatched selected bar when chart reference is available', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 10,
          bar_number: 10,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 100,
          high: 112,
          low: 96,
          close: 108,
          volume: 11,
          labels: [
            { id: 'setup', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 95, bar_index: 10, bar_number: 10, x: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 90, bar_index: 90, time: { raw: 2000, iso: '1970-01-01T00:33:20.000Z' }, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      chart_reference: { bar_index: 711, time_raw: 1000 },
    });

    assert.equal(resolved.bar_index, 711);
    assert.equal(resolved.time.raw, 1000);
    assert.equal(resolved.ohlcv.open, 100);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].resolved_count_type, 'setup');
    assert.equal(resolved.labels[0].direction, 'buy');
  });

  it('keeps setup and combo labels together on the same bar', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 10,
      barLookup: {
        10: { index: 10, time: 1000, open: 100, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'setup-1', text: '1', price: 95, x: 10, textColor: 4281898556 },
        { id: 'combo-1', text: '1', price: 94, x: 10, textColor: 4278228903 },
      ],
    });

    assert.equal(result.bar_snapshots.length, 1);
    assert.equal(result.bar_snapshots[0].labels.length, 2);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'setup'), true);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'combo'), true);
    assert.equal(result.summary.counts.setup.buy + result.summary.counts.setup.sell, 1);
    assert.equal(result.summary.counts.combo.buy + result.summary.counts.combo.sell, 1);
  });

  it('does not borrow labels from a mismatched latest bar when chart reference is present', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 10,
          bar_number: 10,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 100,
          high: 112,
          low: 96,
          close: 108,
          volume: 11,
          labels: [
            { id: 'setup', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 95, bar_index: 10, bar_number: 10, x: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 90, bar_index: 90, time: { raw: 2000, iso: '1970-01-01T00:33:20.000Z' }, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      chart_reference: { bar_index: 711, time_raw: 2000 },
    });

    assert.equal(resolved.bar_index, 711);
    assert.equal(resolved.labels.length, 0);
  });

  it('keeps labels when the chart reference time matches even if the public bar index differs', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 10,
          bar_number: 10,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 100,
          high: 112,
          low: 96,
          close: 108,
          volume: 11,
          labels: [
            { id: 'setup', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 95, bar_index: 10, bar_number: 10, x: 10, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 90, bar_index: 90, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' }, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      chart_reference: { bar_index: 711, time_raw: 1000 },
    });

    assert.equal(resolved.bar_index, 711);
    assert.equal(resolved.time.raw, 1000);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].resolved_count_type, 'setup');
    assert.equal(resolved.labels[0].direction, 'buy');
  });

  it('falls back to label time when the focus bar index differs but the bar time matches', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 10,
          bar_number: 10,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 100,
          high: 112,
          low: 96,
          close: 108,
          volume: 11,
          labels: [
            { id: 'setup', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 95, bar_index: 99, bar_number: 99, x: 99, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 90, bar_index: 90, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' }, open: 1, high: 2, low: 0, close: 1, volume: 1 },
      chart_reference: { bar_index: 711, time_raw: 1000 },
    });

    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].resolved_count_type, 'setup');
    assert.equal(resolved.labels[0].direction, 'buy');
  });

  it('keeps setup and combo labels distinct even when text and price match', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 12,
      barLookup: {
        12: { index: 12, time: 1200, open: 100, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'setup-2', text: '2', price: 95, x: 12, textColor: 4281898556 },
        { id: 'combo-2', text: '2', price: 95, x: 12, textColor: 4278220711 },
      ],
    });

    assert.equal(result.bar_snapshots.length, 1);
    assert.equal(result.bar_snapshots[0].labels.length, 2);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'setup'), true);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'combo'), true);
  });

  it('repairs an ambiguous numeric label into combo when setup and sequential are already present', () => {
    const colorReferences = {
      setup: {
        dark: { r: 60, g: 142, b: 56 },
        light: { r: 167, g: 214, b: 165 },
      },
      sequential: {
        dark: { r: 51, g: 40, b: 178 },
        light: { r: 164, g: 161, b: 250 },
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

    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      colorReferences,
      lastIndex: 12,
      barLookup: {
        12: { index: 12, time: 1200, open: 100, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'setup-2', text: '2', price: 95, x: 12, textColor: 4282158648 },
        { id: 'seq-10', text: '10', price: 94, x: 12, textColor: 4281542834 },
        { id: 'ambiguous-2', text: '2', price: 95, x: 12, textColor: 4294276096 },
      ],
    });

    assert.equal(result.bar_snapshots.length, 1);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'setup'), true);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'sequential'), true);
    assert.equal(result.bar_snapshots[0].labels.some(label => label.resolved_count_type === 'combo'), true);
    assert.equal(result.summary.counts.combo.buy + result.summary.counts.combo.sell, 1);
  });

  it('uses the chart reference as the public bar index for live visible snapshots', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 2,
      barLookup: {
        1: { index: 1, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        2: { index: 2, time: 1060, open: 105, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'bar-1', text: '5', price: 111, x: 1, textColor: 4289050279 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, { from: 990, to: 1090 }, {
      selection: { mode: 'visible', value: null },
      chart_reference: { bar_index: 200, time_raw: 1060 },
      chart_resolution: '1',
    });

    assert.equal(resolved.bar_index, 200);
    assert.equal(resolved.x, 200);
    assert.equal(resolved.chart_bar_index, 200);
    assert.equal(resolved.internal_bar_index, undefined);
    assert.equal(resolved.labels[0].bar_index, 200);
  });

  it('uses the chart reference as the public bar index for latest snapshots when available', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 2,
      barLookup: {
        1: { index: 1, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        2: { index: 2, time: 1060, open: 105, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'bar-2', text: '1', price: 111, x: 2, textColor: 4282158648 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, { from: 990, to: 1090 }, {
      selection: { mode: 'latest', value: null },
      chart_reference: { bar_index: 711, time_raw: 1060 },
      chart_resolution: '1',
    });

    assert.equal(resolved.bar_index, 711);
    assert.equal(resolved.x, 711);
    assert.equal(resolved.chart_bar_index, 711);
  });

  it('keeps exact selection stable for a bar_index lookup', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 60,
      barLookup: {
        59: { index: 59, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        60: { index: 60, time: 1060, open: 105, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'bar-59', text: '2', price: 111, x: 59, textColor: 4281898556 },
        { id: 'bar-60', text: '2', price: 113, x: 60, textColor: 4288220711 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, null, { selection: { mode: 'time', value: 1000 } });
    assert.equal(resolved.bar_index, 59);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].text, '2');
  });

  it('does not expose context labels by default', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 70,
      barLookup: {
        59: { index: 59, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        67: { index: 67, time: 1480, open: 106, high: 112, low: 96, close: 110, volume: 11 },
      },
      labels: [
        { id: 'bar-59', text: '9', price: 111, x: 59, textColor: 4289189541 },
        { id: 'bar-67', text: '1', price: 113, x: 67, textColor: 4293582464 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, null, { selection: { mode: 'bar_index', value: 59 } });
    assert.equal(resolved.bar_index, 59);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].resolved_count_type, 'setup');
    assert.equal(resolved.cluster_bars, undefined);
  });

  it('keeps the selected chart bar even when it has no DeMARK label', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 90,
      barLookup: {
        89: { index: 89, time: 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 },
        90: { index: 90, time: 1060, open: 105, high: 112, low: 96, close: 108, volume: 11 },
      },
      labels: [
        { id: 'bar-89', text: '4', price: 111, x: 89, textColor: 4289050279 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'latest', value: null },
      selected_bar: { index: 90, bar_index: 90, time: { raw: 1060, iso: '1970-01-01T00:17:40.000Z' }, open: 105, high: 112, low: 96, close: 108, volume: 11 },
    });

    assert.equal(resolved.bar_index, 90);
    assert.equal(resolved.x, 90);
    assert.equal(resolved.labels.length, 0);
    assert.equal(resolved.time.raw, 1060);
  });

  it('does not borrow a recent time when an exact selected bar has no bar time', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 90,
          bar_number: 90,
          time: null,
          open: null,
          high: null,
          low: null,
          close: null,
          volume: null,
          labels: [
            {
              id: 1,
              text: '9',
              count_type: 'setup',
              resolved_count_type: 'setup',
              direction: 'buy',
              price: 1,
              bar_index: 90,
              bar_number: 90,
              x: 90,
              time: null,
            },
          ],
        },
      ],
      recent_bars: [
        { time: { raw: 2000, iso: '1970-01-01T00:33:20.000Z' } },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'bar_index', value: 90 },
    });

    assert.equal(resolved.bar_index, 90);
    assert.equal(resolved.time, null);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].bar_index, 90);
  });

  it('keeps only labels whose bar_index matches the exact focus bar', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 100,
          bar_number: 100,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 10,
          high: 12,
          low: 9,
          close: 11,
          volume: 1,
          labels: [
            { id: 'focus', text: '3', count_type: 'sequential', resolved_count_type: 'sequential', direction: 'buy', price: 8, bar_index: 100, bar_number: 100, x: 100, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
            { id: 'neighbor', text: '9', count_type: 'setup', resolved_count_type: 'setup', direction: 'buy', price: 7, bar_index: 99, bar_number: 99, x: 99, time: { raw: 940, iso: '1970-01-01T00:15:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'bar_index', value: 100 },
    });

    assert.equal(resolved.bar_index, 100);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].bar_index, 100);
    assert.equal(resolved.labels[0].text, '3');
  });

  it('keeps exact labels even when the raw snapshot bar_index is shifted', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 100,
          bar_number: 100,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 10,
          high: 12,
          low: 9,
          close: 11,
          volume: 1,
          labels: [
            { id: 'shifted', text: '1', count_type: 'setup', resolved_count_type: 'setup', direction: 'sell', price: 13, bar_index: 99, bar_number: 99, x: 99, time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' } },
          ],
        },
      ],
    };

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'bar_index', value: 100 },
    });

    assert.equal(resolved.bar_index, 100);
    assert.equal(resolved.labels.length, 0);
  });

  it('resolves exact loaded times without falling back to a nearby bar', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 404,
      barLookup: {
        339: { index: 339, time: 1776137760, open: 74374, high: 74374, low: 74352, close: 74353, volume: 0.03753677 },
        404: { index: 404, time: 1776141780, open: 74417, high: 74417, low: 74395, close: 74395, volume: 0.19967181 },
      },
      labels: [
        { id: 'bar-339', text: '3', price: 74376, x: 339, textColor: 4281898556 },
        { id: 'bar-404', text: '9', price: 74419, x: 404, textColor: 4281898556 },
      ],
    });

    const resolved339 = buildResolvedDemarkSnapshot(demark, null, { selection: { mode: 'time', value: 1776137760 } });
    const resolved404 = buildResolvedDemarkSnapshot(demark, null, { selection: { mode: 'time', value: 1776141780 } });

    assert.equal(resolved339.bar_index, 339);
    assert.equal(resolved339.time.raw, 1776137760);
    assert.equal(resolved339.labels.length, 1);
    assert.equal(resolved339.labels[0].bar_index, 339);
    assert.equal(resolved339.labels[0].text, '3');

    assert.equal(resolved404.bar_index, 404);
    assert.equal(resolved404.time.raw, 1776141780);
    assert.equal(resolved404.labels.length, 1);
    assert.equal(resolved404.labels[0].bar_index, 404);
    assert.equal(resolved404.labels[0].text, '9');
  });

  it('does not force setup count 1 to sequential when the color family is setup', () => {
    const demark = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 10,
      barLookup: {
        10: { index: 10, time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 1 },
      },
      labels: [
        { id: 'setup-1', text: '1', price: 3, x: 10, textColor: 4281898556 },
      ],
    });

    const resolved = buildResolvedDemarkSnapshot(demark, null, {
      selection: { mode: 'bar_index', value: 10 },
    });

    assert.equal(resolved.bar_index, 10);
    assert.equal(resolved.labels.length, 1);
    assert.equal(resolved.labels[0].text, '1');
    assert.equal(resolved.labels[0].resolved_count_type, 'setup');
  });

  it('fails strict exact snapshots when a label remains unresolved', () => {
    const demark = {
      bar_snapshots: [
        {
          bar_index: 5,
          bar_number: 5,
          time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
          open: 1,
          high: 2,
          low: 0,
          close: 1,
          volume: 1,
          labels: [
            {
              id: 1,
              text: 'x',
              count_type: 'unknown',
              direction: 'buy',
              price: 1,
              bar_index: 5,
              bar_number: 5,
              x: 5,
              time: { raw: 1000, iso: '1970-01-01T00:16:40.000Z' },
            },
          ],
        },
      ],
    };

    assert.throws(
      () => buildResolvedDemarkSnapshot(demark, null, { selection: { mode: 'bar_index', value: 5 } }),
      /Unresolved DeMARK labels/
    );
  });

  it('falls back to a non-unknown count type for numeric TDST-colored labels', () => {
    const result = analyzeDemarkGraphics({
      studyName: 'DeMARK 9-13',
      lastIndex: 80,
      barLookup: {
        80: { index: 80, time: 80, open: 100, high: 110, low: 95, close: 105, volume: 10 },
      },
      labels: [
        { id: 'tdst-10', text: '10', price: 111, x: 80, textColor: 4293582464 },
      ],
    });

    assert.equal(result.current_labels[0].marker_type, 'tdst');
    assert.equal(result.current_labels[0].count_type, 'indicator');
    assert.equal(result.current_labels[0].resolved_count_type, 'indicator');
  });
});


