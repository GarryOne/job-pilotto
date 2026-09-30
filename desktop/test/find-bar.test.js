// ⌘F: the find bar's logic (renderer/find-bar.js); pages/find.js draws it and highlights the matches in the page.
import assert from 'node:assert/strict';
import test from 'node:test';
import {countText, offsets, step} from '../renderer/find-bar.js';

test('the count says where you are, or that nothing matched', () => {
  assert.equal(countText({active: 3, total: 12}, 'huxley'), '3 of 12');
  assert.equal(countText({active: 0, total: 0}, 'huxley'), 'No matches');
  assert.equal(countText({active: 0, total: 0}, ''), '');
  assert.equal(countText(null, 'x'), '');
});

test('matches ignore case and never overlap', () => {
  assert.deepEqual(offsets('Huxley, huxley and HUXLEY', 'huxley'), [0, 8, 19]);
  assert.deepEqual(offsets('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(offsets('nothing here', 'zzqx'), []);
  assert.deepEqual(offsets('text', '   '), []);
});

test('Enter goes on and wraps; Shift+Enter goes back and wraps', () => {
  assert.equal(step(0, 3, 'next'), 1);
  assert.equal(step(2, 3, 'next'), 0);
  assert.equal(step(0, 3, 'previous'), 2);
  assert.equal(step(5, 3, 'next'), 0);  // the page changed: fewer matches now
  assert.equal(step(0, 0, 'next'), -1);
});
