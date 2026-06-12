/**
 * Contract tests for the Mantilla PB DeMARK 9-13 Pine indicator.
 * These tests verify the deliverable includes the product-spec controls and
 * named implementation sections before TradingView compile/visual calibration.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const indicatorPath = resolve('pine/MantillaPB.DeMARK.9-13.pine');

function source() {
  assert.ok(existsSync(indicatorPath), 'indicator file should exist');
  return readFileSync(indicatorPath, 'utf8');
}

describe('Mantilla PB DeMARK 9-13 indicator contract', () => {
  it('declares the expected Pine indicator identity', () => {
    const pine = source();
    assert.match(pine, /\/\/@version=6/);
    assert.match(pine, /indicator\("Mantilla PB DeMARK 9-13"/);
    assert.match(pine, /shorttitle="MPB D913"/);
  });

  it('exposes required DeMARK configuration groups', () => {
    const pine = source();
    for (const label of [
      'Setup Settings',
      'Sequential Countdown',
      'Combo Countdown',
      'TDST and Risk Levels',
      'Recycle',
      'Display',
      'Colors',
    ]) {
      assert.match(pine, new RegExp(label), `missing config group ${label}`);
    }
  });

  it('contains the required feature switches and calibration controls', () => {
    const pine = source();
    for (const label of [
      'Require Price Flip',
      'Inclusive Setup Comparison',
      'Perfection Mode',
      '13 vs 8 Qualifier',
      '8 vs 5 Qualifier',
      'Enable Sequential Risk Level',
      'Enable Combo Risk Level',
      'Enable Recycle',
      'Recycle Setup Count',
      'Display Mode',
      'Count Label Size',
      'Max Managed Labels',
      'Max Managed Lines',
      'Max Managed Boxes',
    ]) {
      assert.match(pine, new RegExp(label), `missing input ${label}`);
    }
  });

  it('uses the requested default color families for calibration', () => {
    const pine = source();
    for (const [label, rgb] of [
      ['buySetupColor', '0, 200, 83'],
      ['sellSetupColor', '0, 200, 83'],
      ['buySequentialColor', '255, 82, 82'],
      ['sellSequentialColor', '255, 82, 82'],
      ['buyComboColor', '41, 182, 246'],
      ['sellComboColor', '41, 182, 246'],
      ['tdstSupportColor', '0, 200, 83'],
      ['tdstResistanceColor', '255, 82, 82'],
    ]) {
      assert.match(pine, new RegExp(`${label} = input\\.color\\(color\\.rgb\\(${rgb}\\)`), `unexpected default for ${label}`);
    }
  });

  it('separates count families and refreshes active realtime labels', () => {
    const pine = source();
    assert.match(pine, /countLabelSize = input\.string\("Normal"/);
    assert.match(pine, /countY\(isBuy, lane, 0\)/);
    assert.match(pine, /label\.get_x\(nextActive\) == bar_index/);
    assert.match(pine, /buySetup.*buySetupColor.*buySetupComplete, 1/s);
    assert.match(pine, /array<int> buySeqCounts/);
    assert.match(pine, /drewBuySeqThisBar/);
    assert.match(pine, /showSequentialCounts.*buySequentialColor.*candidate == 13, 2/s);
    assert.match(pine, /showComboCounts.*buyComboColor.*buyCombo == 13, 3/s);
  });

  it('keeps sequential recycle optional and non-default for calibration', () => {
    const pine = source();
    assert.match(pine, /recycleSequential = input\.bool\(false/);
    assert.match(pine, /array\.remove\(buySeqCounts, 0\)/);
    assert.match(pine, /array\.remove\(sellSeqCounts, 0\)/);
  });

  it('implements named engines for setup, TDST, countdowns, risk, and recycling', () => {
    const pine = source();
    for (const marker of [
      'calcSetup',
      'isPerfectedSetup',
      'updateTdstLine',
      'sequentialQualifies',
      'comboQualifies',
      'calcRiskLevel',
      'recycleTriggered',
      'renderCount',
    ]) {
      assert.match(pine, new RegExp(marker), `missing implementation marker ${marker}`);
    }
  });

  it('keeps alerts out of phase 1', () => {
    const pine = source();
    assert.doesNotMatch(pine, /alertcondition\s*\(/);
  });
});
