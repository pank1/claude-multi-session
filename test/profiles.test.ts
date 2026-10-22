import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPlaceholderLabel, suggestLabel } from '../src/core/profiles';

test('a stand-in name is recognised so it can be replaced', () => {
  assert.equal(isPlaceholderLabel('Account 1'), true);
  assert.equal(isPlaceholderLabel('account 12'), true);
  assert.equal(isPlaceholderLabel('  Account 3  '), true);
});

test('a name someone chose is never treated as a stand-in', () => {
  assert.equal(isPlaceholderLabel('mike@lv.group'), false);
  assert.equal(isPlaceholderLabel('Account for billing'), false);
  assert.equal(isPlaceholderLabel('Max account 2'), false);
  assert.equal(isPlaceholderLabel('Account'), false);
  assert.equal(isPlaceholderLabel(''), false);
});

test('the label prefers the address, then the name, then the plan', () => {
  assert.equal(suggestLabel({ email: 'a@b.com', fullName: 'A', plan: 'Max 20x' }, 1), 'a@b.com');
  assert.equal(suggestLabel({ fullName: 'A', plan: 'Max 20x' }, 1), 'A');
  assert.equal(suggestLabel({ plan: 'Max 20x' }, 1), 'Max 20x account');
  assert.equal(suggestLabel(undefined, 4), 'Account 4');
});

test('the fallback label is one the code will later recognise as a stand-in', () => {
  assert.equal(isPlaceholderLabel(suggestLabel(undefined, 7)), true);
});
