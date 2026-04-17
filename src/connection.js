import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
const CDP_HOST = process.env.TRADINGVIEW_CDP_HOST || '127.0.0.1';
const CDP_FALLBACK_HOSTS = Array.from(new Set([
  CDP_HOST,
  '127.0.0.1',
  'localhost',
])).filter(Boolean);
const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      const { target: bestTarget } = await findChartTarget();
      if (bestTarget && targetInfo && bestTarget.id !== targetInfo.id) {
        try { await client.close(); } catch {}
        client = null;
        targetInfo = null;
      } else {
        return client;
      }
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const { target, host } = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  let lastError = null;
  for (const host of CDP_FALLBACK_HOSTS) {
    try {
      const resp = await fetch(`http://${host}:${CDP_PORT}/json/list`);
      const targets = await resp.json();
      const candidates = targets.filter(t => t.type === 'page' && /tradingview/i.test(t.url));
      if (candidates.length === 0) continue;

      let best = null;
      for (const target of candidates) {
        let probe = null;
        let probeClient = null;
        try {
          probeClient = await CDP({ host, port: CDP_PORT, target: target.id });
          await probeClient.Runtime.enable();
          probe = await probeClient.Runtime.evaluate({
            expression: `(() => {
              try {
                var api = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV
                  ? window.TradingViewApi._activeChartWidgetWV.value()
                  : null;
                var chart = api && api._chartWidget && api._chartWidget.model ? api._chartWidget.model().mainSeries().bars() : null;
                var lastIndex = chart && typeof chart.lastIndex === 'function' ? chart.lastIndex() : null;
                var firstIndex = chart && typeof chart.firstIndex === 'function' ? chart.firstIndex() : null;
                return {
                  visibility: document.visibilityState || null,
                  hasFocus: !!document.hasFocus(),
                  title: document.title || null,
                  url: location.href || null,
                  lastIndex: lastIndex,
                  firstIndex: firstIndex,
                };
              } catch (e) {
                return { error: e.message, visibility: document.visibilityState || null, hasFocus: !!document.hasFocus(), title: document.title || null, url: location.href || null };
              }
            })()`,
            returnByValue: true,
          });
        } catch (err) {
          lastError = err;
        } finally {
          try { if (probeClient) await probeClient.close(); } catch {}
        }

        const state = probe?.result?.value || probe?.value || probe || {};
        const visible = state.visibility === 'visible' ? 100 : 0;
        const focus = state.hasFocus ? 25 : 0;
        const chartUrl = /\/chart\//i.test(String(target.url || '')) ? 10 : 0;
        const hasSeries = Number.isFinite(state.lastIndex) ? 10 : 0;
        const score = visible + focus + chartUrl + hasSeries;
        const candidate = { target, score, state };
        if (!best || candidate.score > best.score) best = candidate;
      }

      if (best?.target) return { target: best.target, host };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No TradingView chart target found. Is TradingView open with a chart?');
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
