import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {groupWarnings, newDetails} from '../renderer/run-warnings.js';

test('a rate-limit detail that only repeats the banner is not listed again', () => {
  const grouped = groupWarnings(['RateLimitError: Error code: 429']);
  assert.deepEqual(newDetails(grouped), []);
});

test('details that name jobs or other problems stay', () => {
  const grouped = groupWarnings(['Skipped job 5: Error code: 429', 'Something else failed']);
  assert.equal(newDetails(grouped).length, 2);
});

test('the Recent activity card lists only new details', () => {
  assert.match(readFileSync(new URL('../renderer/pages/activity.js', import.meta.url), 'utf8'), /newDetails\(/);
});
