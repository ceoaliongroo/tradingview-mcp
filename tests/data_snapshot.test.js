/**
 * Unit tests for study input normalization used by indicator snapshots.
 * No TradingView connection needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeDemarkGraphics,
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
});
