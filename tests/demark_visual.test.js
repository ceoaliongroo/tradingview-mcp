import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeFocusColumnClip } from '../src/core/demark_visual.js';

describe('computeFocusColumnClip', () => {
  it('keeps the clip inside the pane bounds', () => {
    const clip = computeFocusColumnClip({
      pane_bounds: { x: 100, y: 50, width: 400, height: 600 },
      bar_x_screen: 120,
      column_width: 96,
    });

    assert.equal(clip.y, 50);
    assert.equal(clip.height, 600);
    assert.equal(clip.width, 96);
    assert.equal(clip.x, 100);
  });

  it('centers the clip on the bar when there is enough room', () => {
    const clip = computeFocusColumnClip({
      pane_bounds: { x: 100, y: 50, width: 400, height: 600 },
      bar_x_screen: 300,
      column_width: 80,
    });

    assert.equal(clip.x, 260);
    assert.equal(clip.width, 80);
  });
});
