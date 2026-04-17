import { register } from '../router.js';
import * as core from '../../core/demark_sweep.js';

register('sweep', {
  description: 'Sweep chart timeframes and compare DeMARK snapshots against focused screenshots',
  subcommands: new Map([ 
    ['demark', {
      description: 'Run a DeMARK timeframe sweep from higher to lower timeframes',
      options: {
        timeframes: { type: 'string', short: 't', description: 'Comma or space separated timeframe list (default: 12M,M,W,D,8h,4h,2h,1h,30m,5m,1m)' },
        output: { type: 'string', short: 'o', description: 'Report filename prefix (default: timestamped)' },
        barsBefore: { type: 'string', short: 'b', description: 'Bars to show before the focus bar (default 29)' },
        barsAfter: { type: 'string', short: 'a', description: 'Bars to show after the focus bar (default 0)' },
        columnWidth: { type: 'string', short: 'w', description: 'Column width in pixels (default 96)' },
        minBarSpacing: { type: 'string', short: 's', description: 'Minimum bar spacing in pixels before capture (default 40)' },
        filter: { type: 'string', short: 'f', description: 'Study name filter (default "DeMARK 9-13")' },
      },
      handler: (opts) => core.runDemarkSweep({
        timeframes: opts.timeframes,
        output: opts.output,
        bars_before: opts.barsBefore ? Number(opts.barsBefore) : undefined,
        bars_after: opts.barsAfter ? Number(opts.barsAfter) : undefined,
        column_width: opts.columnWidth ? Number(opts.columnWidth) : undefined,
        min_bar_spacing: opts.minBarSpacing ? Number(opts.minBarSpacing) : undefined,
        filter: opts.filter || 'DeMARK 9-13',
      }),
    }],
  ]),
});
