import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {groupWarnings, humanError, newDetails} from '../renderer/run-warnings.js';

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

test('a Notion 502 with its HTML error page is one plain sentence, with the words before it kept (#275)', () => {
  const raw = 'cronjob run not opened in Notion: HTTPError: HTTP Error 502: <!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>…</body></html>';
  assert.deepEqual(groupWarnings([raw]), ['cronjob run not opened in Notion: the service was unavailable (HTTP 502). It is usually back within minutes: try again']);
  assert.doesNotMatch(groupWarnings([raw])[0], /<|DOCTYPE|HTTPError/);
  assert.equal(humanError('HTTP Error 429: Too Many Requests'), 'the service is busy right now (HTTP 429). Try again in a few minutes');
  assert.equal(humanError('failed: <html><body>oops</body></html>'), 'failed: the service answered with an error page');
  assert.equal(humanError('plain text without any error code'), 'plain text without any error code');
});
