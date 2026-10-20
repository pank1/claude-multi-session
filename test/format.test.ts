import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colourFor, colouredBar, windowCell } from '../src/ui/format';
import { WindowUsage } from '../src/core/types';

const NOW = new Date('2026-10-20T09:00:00Z');

function window(percentUsed: number, resetsAt: string | null = '2026-10-20T12:00:00Z'): WindowUsage {
  return {
    percentUsed,
    percentLeft: 100 - percentUsed,
    resetsAt,
    severity: 'normal',
    locked: false,
    lockedReason: null,
  };
}

test('colour comes from the number, not from whatever the server called it', () => {
  assert.equal(colourFor(0), 'normal');
  assert.equal(colourFor(49), 'normal');
  assert.equal(colourFor(50), 'warning');
  assert.equal(colourFor(74), 'warning');
  assert.equal(colourFor(75), 'critical');
  assert.equal(colourFor(89), 'critical');
  assert.equal(colourFor(90), 'exhausted');
  assert.equal(colourFor(100), 'exhausted');
});

test('the bar fills as quota is spent', () => {
  assert.equal(colouredBar(0, 8), '⬜⬜⬜⬜⬜⬜⬜⬜');
  assert.equal(colouredBar(50, 8), '🟨🟨🟨🟨⬜⬜⬜⬜');
  assert.equal(colouredBar(100, 8), '🟥🟥🟥🟥🟥🟥🟥🟥');
});

test('anything spent shows at least one segment', () => {
  const barely = colouredBar(1, 8);
  assert.notEqual(barely, '⬜⬜⬜⬜⬜⬜⬜⬜', '1% must not look identical to untouched');
  assert.equal([...barely].filter((c) => c === '🟩').length, 1);
});

test('every bar is the width asked for, whatever the number', () => {
  for (const percent of [-10, 0, 0.4, 33, 99.6, 100, 140, Number.NaN]) {
    assert.equal([...colouredBar(percent, 8)].length, 8, `width wrong at ${percent}`);
  }
});

test('a cell states what the bar means and when it resets', () => {
  const cell = windowCell(window(25), NOW);
  assert.match(cell, /25%/);
  assert.match(cell, /3h00m/, 'the countdown to the reset is in the cell');
});

test('a cell with no reset time says nothing about one', () => {
  const cell = windowCell(window(25, null), NOW);
  assert.match(cell, /25%/);
  assert.equal(cell.includes('·'), false);
});

test('a locked window says locked rather than a percentage', () => {
  const locked: WindowUsage = { ...window(40), locked: true, lockedReason: 'limit reached' };
  assert.match(windowCell(locked, NOW), /locked/);
});

test('a missing window is a dash, not a zero', () => {
  assert.equal(windowCell(undefined, NOW), '—', 'zero would read as "nothing used"');
});
