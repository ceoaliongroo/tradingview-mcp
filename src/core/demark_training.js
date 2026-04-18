import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(__dirname));
const DEFAULT_TRAINING_PATH = join(REPO_ROOT, 'reports', 'demark-training.jsonl');

export function appendDemarkTrainingRecord(record, filePath = DEFAULT_TRAINING_PATH) {
  if (!record || typeof record !== 'object') return null;
  const target = filePath || DEFAULT_TRAINING_PATH;
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(record)}\n`, 'utf8');
  return target;
}

export function readDemarkTrainingRecords(filePath = DEFAULT_TRAINING_PATH) {
  const target = filePath || DEFAULT_TRAINING_PATH;
  if (!existsSync(target)) return [];
  const content = readFileSync(target, 'utf8');
  return content
    .split(/\r?\n/)
    .map(line => String(line || '').trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function latestTrainingExpectationByTimeframe(records = []) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const timeframe = String(record.timeframe || '').trim();
    if (!timeframe) continue;
    map.set(timeframe, record);
  }
  return map;
}

export function buildDemarkTrainingArchitecture() {
  return {
    source_of_truth: 'TradingView Desktop via CDP',
    shared_snapshot_path: 'getDemarkSnapshot -> getIndicatorSnapshot -> analyzeDemarkGraphics -> buildResolvedDemarkSnapshot',
    stream: 'formatDemarkLine(snapshot) from the same snapshot object',
    sweep: 'interactive human-in-the-loop verification that records verdicts into a JSONL corpus',
    training_corpus: DEFAULT_TRAINING_PATH,
    feedback_loop: 'human verdicts become regression examples for future heuristics and tests',
  };
}
