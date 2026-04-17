import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTimeframeList, summarizeDemarkSnapshot } from '../src/core/demark_sweep.js';

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
