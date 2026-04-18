import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

function normalizeExpectedResolution(tf) {
  const value = String(tf || '').trim();
  const lower = value.toLowerCase();
  if (/^\d+m$/.test(value)) return String(Number(value.replace(/m$/, '')));
  if (/^\d+h$/.test(lower)) return String(Number(lower.replace(/h$/, '')) * 60);
  if (lower === '1d' || lower === 'd') return 'D';
  if (lower === '1w' || lower === 'w') return 'W';
  if (lower === '1m' || lower === 'm') return 'M';
  return value;
}

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastBarCount = -1;
  let lastStudyCount = -1;
  let stableCount = 0;
  const expectedResolution = expectedTf ? normalizeExpectedResolution(expectedTf) : null;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        var chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
          ? window.TradingViewApi._activeChartWidgetWV.value()
          : null;
        var loadingScreenActive = false;
        var dataReady = true;
        var studies = [];
        var resolution = null;
        var currentSymbol = '';
        try {
          if (chart) {
            currentSymbol = chart.symbol ? chart.symbol() : '';
            resolution = chart.resolution ? chart.resolution() : null;
            if (chart.loadingScreenActive) loadingScreenActive = !!chart.loadingScreenActive();
            if (chart.dataReady) dataReady = !!chart.dataReady();
            if (chart.getAllStudies) {
              var allStudies = chart.getAllStudies();
              studies = Array.isArray(allStudies) ? allStudies.map(function(s) {
                return { id: s.id, name: s.name || s.title || 'unknown' };
              }) : [];
            }
          }
        } catch (e) {}

        var barCount = -1;
        try {
          if (chart && chart._chartWidget && chart._chartWidget.model) {
            var bars = chart._chartWidget.model().mainSeries().bars();
            if (bars && typeof bars.lastIndex === 'function' && typeof bars.firstIndex === 'function') {
              barCount = Math.max(0, bars.lastIndex() - bars.firstIndex() + 1);
            }
          }
        } catch {}

        return {
          loadingScreenActive: !!loadingScreenActive,
          dataReady: !!dataReady,
          barCount: barCount,
          currentSymbol: currentSymbol,
          resolution: resolution,
          studyCount: studies.length,
          studies: studies,
        };
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Not ready if chart still shows its own loading screen or data isn't ready.
    if (state.loadingScreenActive || !state.dataReady) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check symbol match if expected
    if (expectedSymbol && state.currentSymbol && !state.currentSymbol.toUpperCase().includes(expectedSymbol.toUpperCase())) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (expectedResolution && String(state.resolution || '') !== String(expectedResolution)) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check chart data/study stability.
    if (state.barCount === lastBarCount && state.studyCount === lastStudyCount && state.barCount > 0) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarCount = state.barCount;
    lastStudyCount = state.studyCount;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return true anyway, caller should verify
  return false;
}
