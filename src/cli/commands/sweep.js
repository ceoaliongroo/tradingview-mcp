import { register } from '../router.js';
import * as core from '../../core/demark_sweep.js';

register('sweep', {
  description: 'Sweep chart timeframes and verify DeMARK snapshots interactively',
  subcommands: new Map([ 
    ['demark', {
      description: 'Run a DeMARK timeframe sweep from higher to lower timeframes and ask for human confirmation',
      options: {
        timeframes: { type: 'string', short: 't', description: 'Comma or space separated timeframe list (default: 12M,M,W,D,8h,4h,2h,1h,30m,5m,1m)' },
        output: { type: 'string', short: 'o', description: 'Report filename prefix (default: timestamped)' },
        filter: { type: 'string', short: 'f', description: 'Study name filter (default "DeMARK 9-13")' },
        compareTraining: { type: 'boolean', short: 'c', description: 'Compare against the latest human training corpus by timeframe' },
        trainingPath: { type: 'string', short: 'p', description: 'Training corpus JSONL path (default: reports/demark-training.jsonl)' },
        trace: { type: 'boolean', short: 'v', description: 'Print phase-by-phase sweep debug output' },
        auto: { type: 'boolean', short: 'a', description: 'Run without interactive yes/no prompts and compare directly against training corpus' },
      },
      handler: (opts) => core.runDemarkSweep({
        timeframes: opts.timeframes,
        output: opts.output,
        filter: opts.filter || 'DeMARK 9-13',
        compare_training: !!opts.compareTraining,
        training_path: opts.trainingPath || null,
        trace: !!opts.trace,
        auto: !!opts.auto,
      }),
    }],
  ]),
});
