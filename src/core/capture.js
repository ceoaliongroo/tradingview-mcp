/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection } from '../connection.js';
import { writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');
const DOWNLOADS_DIR = join(process.env.USERPROFILE || homedir(), 'Downloads');

function findNewestDownloadedPng(sinceMs) {
  if (!existsSync(DOWNLOADS_DIR)) return null;
  let best = null;
  for (const name of readdirSync(DOWNLOADS_DIR)) {
    if (!/\.png$/i.test(name)) continue;
    const fullPath = join(DOWNLOADS_DIR, name);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stats || stats.mtimeMs < sinceMs) continue;
    if (!best || stats.mtimeMs > best.mtimeMs) {
      best = { path: fullPath, mtimeMs: stats.mtimeMs };
    }
  }
  return best?.path || null;
}

export async function captureScreenshot({ region, filename, method } = {}) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = (filename || `tv_${region}_${ts}`).replace(/[\/\\]/g, '_');
  const filePath = join(SCREENSHOT_DIR, `${fname}.png`);

  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      const startedAt = Date.now();
      await evaluate(`${colPath}.takeScreenshot()`);
      await new Promise(resolve => setTimeout(resolve, 700));
      await evaluate(`
        (function() {
          var nodes = Array.prototype.slice.call(document.querySelectorAll('button,[role="button"],div,span'));
          var btn = nodes.find(function(node) {
            var text = (node && node.textContent ? node.textContent : '').trim();
            var aria = node && node.getAttribute ? node.getAttribute('aria-label') : '';
            return /Download image/i.test(text) || /Download image/i.test(String(aria || ''));
          });
          if (!btn) return false;
          btn.click();
          return true;
        })()
      `);
      await new Promise(resolve => setTimeout(resolve, 1200));
      const newestDownload = findNewestDownloadedPng(startedAt - 1000);
      if (newestDownload) {
        copyFileSync(newestDownload, filePath);
        return {
          success: true,
          method: 'api',
          file_path: filePath,
          downloaded_path: newestDownload,
          size_bytes: readFileSync(filePath).length,
        };
      }
      return {
        success: true,
        method: 'api',
        note: 'takeScreenshot() triggered but no downloaded PNG was found in Downloads.',
      };
    } catch {
      // Fall through to CDP method.
    }
  }

  const client = await getClient();
  let clip = undefined;

  if (region === 'chart') {
    const bounds = await evaluate(`
      (function() {
        var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-name="pane-canvas"], canvas'));
        var best = null;
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!node || typeof node.getBoundingClientRect !== 'function') continue;
          var rect = node.getBoundingClientRect();
          if (!rect || rect.width < 120 || rect.height < 120) continue;
          var area = rect.width * rect.height;
          if (!best || area > best.area) best = { rect: rect, area: area };
        }
        if (!best) return null;
        return { x: best.rect.x, y: best.rect.y, width: best.rect.width, height: best.rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  } else if (region === 'strategy_tester') {
    const bounds = await evaluate(`
      (function() {
        var el = document.querySelector('[data-name="backtesting"]')
          || document.querySelector('[class*="strategyReport"]');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  } else {
    const bounds = await evaluate(`
      (function() {
        var el = document.documentElement;
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
  }

  const params = {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
  };
  if (clip) params.clip = clip;

  const { data } = await client.Page.captureScreenshot(params);
  writeFileSync(filePath, Buffer.from(data, 'base64'));

  return {
    success: true,
    method: 'cdp',
    file_path: filePath,
    region,
    size_bytes: Buffer.from(data, 'base64').length,
  };
}

export async function captureClip({ clip, filename } = {}) {
  if (!clip || !Number.isFinite(clip.x) || !Number.isFinite(clip.y) || !Number.isFinite(clip.width) || !Number.isFinite(clip.height)) {
    throw new Error('captureClip requires finite x, y, width, and height.');
  }
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = (filename || `tv_clip_${ts}`).replace(/[\/\\]/g, '_');
  const filePath = join(SCREENSHOT_DIR, `${fname}.png`);

  const client = await getClient();
  const normalizedClip = {
    x: Math.max(0, Math.round(clip.x)),
    y: Math.max(0, Math.round(clip.y)),
    width: Math.max(1, Math.round(clip.width)),
    height: Math.max(1, Math.round(clip.height)),
    scale: 1,
  };

  const { data } = await client.Page.captureScreenshot({
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
    clip: normalizedClip,
  });
  writeFileSync(filePath, Buffer.from(data, 'base64'));

  return {
    success: true,
    method: 'cdp',
    file_path: filePath,
    clip: normalizedClip,
    size_bytes: Buffer.from(data, 'base64').length,
  };
}
