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
    assert.equal(result.summary.counts.setup.sell, 1);
    assert.equal(result.current_labels.length, 1);
    assert.equal(result.current_labels[0].direction, 'sell');
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
    assert.equal(result.current_labels[0].count_type, 'setup');
    assert.equal(result.current_labels[0].is_perfect_setup, true);
    assert.equal(result.current_labels[0].x, 30);
  });

  it('selects the bar closest to the visible range center', () => {
    const selected = selectBarSnapshotByVisibleRange([
      { bar_index: 10, time: { raw: 100 } },
      { bar_index: 11, time: { raw: 140 } },
      { bar_index: 12, time: { raw: 170 } },
    ], { from: 120, to: 180 });

    assert.equal(selected.bar_index, 11);
  });

  it('builds a resolved snapshot from the selected bar and keeps the same bar index in x', () => {
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
    assert.equal(resolved.labels[0].x, 40);
    assert.equal(resolved.labels[0].bar_index, 40);
    assert.equal(resolved.labels[0].direction, 'sell');
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

  it('includes a one-bar historical cluster around the selected bar', () => {
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
    assert.equal(resolved.cluster_bars.length, 2);
    assert.equal(resolved.cluster_labels.length, 2);
    assert.equal(resolved.cluster_labels[0].text, '2');
    assert.equal(resolved.cluster_labels[1].text, '2');
  });
});
