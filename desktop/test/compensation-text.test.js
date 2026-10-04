import test from 'node:test';
import assert from 'node:assert/strict';
import {compensationText} from '../renderer/compensation.js';

test('an unanswered placeholder reads as not set, a real figure is kept', () => {
  assert.equal(compensationText('Target: ❓'), 'Not set in your Profile');
  assert.equal(compensationText(''), 'Not set in your Profile');
  assert.equal(compensationText(undefined), 'Not set in your Profile');
  assert.equal(compensationText('Target: €90k–110k'), 'Target: €90k–110k');
  assert.equal(compensationText('Target: €90k, floor ❓'), 'Target: €90k, floor ❓');
});
