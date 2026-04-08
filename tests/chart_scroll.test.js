/**
 * Unit tests for chart scrolling logic.
 * No TradingView connection needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleRange, scrollToDate } from '../src/core/chart.js';

describe('chart scrollToDate', () => {
  it('uses a full-year window on daily charts', async () => {
    const calls = [];
    let altRPressed = false;
    const result = await scrollToDate({
      date: '2025-04-04',
      _deps: {
        evaluate: async (code) => {
          calls.push(code);
          if (code.includes('.resolution()')) return 'D';
          if (code.includes('barSpacing()')) {
            return {
              barSpacing: 2.697674418604651,
              visible_from: 1738022400,
              visible_to: 1759363200,
            };
          }
          return null;
        },
        sendAltR: async () => {
          altRPressed = true;
        },
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.resolution, 'D');
    assert.equal(result.window.to - result.window.from, 365 * 86400);
    assert.equal(altRPressed, true);
    assert.equal(calls.filter(code => code.includes('zoomToBarsRange')).length, 2);
    assert.equal(calls.filter(code => code.includes('setBarSpacing(')).length, 1);
  });
});

describe('chart getVisibleRange', () => {
  it('uses the injected evaluate dependency', async () => {
    const result = await getVisibleRange({
      _deps: {
        evaluate: async () => ({
          visible_range: { from: 10, to: 20 },
          bars_range: { from: 1, to: 2 },
        }),
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.visible_range, { from: 10, to: 20 });
    assert.deepEqual(result.bars_range, { from: 1, to: 2 });
  });
});
