import { register } from '../router.js';
import * as core from '../../core/capture.js';
import * as demarkVisual from '../../core/demark_visual.js';

register('screenshot', {
  description: 'Take a screenshot of the chart',
  subcommands: new Map([
    ['chart', {
      description: 'Capture a chart screenshot',
      options: {
        region: { type: 'string', short: 'r', description: 'Region: full, chart, strategy_tester' },
        output: { type: 'string', short: 'o', description: 'Custom filename (without .png)' },
      },
      handler: (opts) => core.captureScreenshot({
        region: opts.region,
        filename: opts.output,
      }),
    }],
    ['demark-focus', {
      description: 'Capture the full-height visual column for a focused DeMARK bar',
      options: {
        mode: { type: 'string', short: 'm', description: 'Selection mode: latest, visible, time, bar_index' },
        value: { type: 'string', short: 'v', description: 'Selection value for time or bar_index mode' },
        output: { type: 'string', short: 'o', description: 'Custom filename prefix' },
        columnWidth: { type: 'string', short: 'w', description: 'Column width in pixels (default 96)' },
        minBarSpacing: { type: 'string', short: 's', description: 'Minimum bar spacing in pixels before capture (default 28)' },
      },
      handler: (opts) => demarkVisual.captureDemarkFocusColumn({
        selection: { mode: opts.mode || 'latest', value: opts.value ?? null },
        filename_prefix: opts.output,
        column_width: opts.columnWidth ? Number(opts.columnWidth) : undefined,
        min_bar_spacing: opts.minBarSpacing ? Number(opts.minBarSpacing) : undefined,
      }),
    }],
    ['demark-detect', {
      description: 'Capture a focused DeMARK bar column and detect colored label blobs',
      options: {
        mode: { type: 'string', short: 'm', description: 'Selection mode: latest, visible, time, bar_index' },
        value: { type: 'string', short: 'v', description: 'Selection value for time or bar_index mode' },
        output: { type: 'string', short: 'o', description: 'Custom filename prefix' },
        columnWidth: { type: 'string', short: 'w', description: 'Column width in pixels (default 96)' },
        minBarSpacing: { type: 'string', short: 's', description: 'Minimum bar spacing in pixels before capture (default 28)' },
      },
      handler: (opts) => demarkVisual.captureAndDetectDemarkFocusColumn({
        selection: { mode: opts.mode || 'latest', value: opts.value ?? null },
        filename_prefix: opts.output,
        column_width: opts.columnWidth ? Number(opts.columnWidth) : undefined,
        min_bar_spacing: opts.minBarSpacing ? Number(opts.minBarSpacing) : undefined,
      }),
    }],
  ]),
});
