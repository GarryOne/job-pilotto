// Screen against source: the Jobs list and the Notion rows agree job for job (lib/truth-data.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareJobs} from '../lib/truth-data.mjs';

const row = (url, score, status = 'New', title = 'SRE') => ({properties: {'Job URL': {url}, Score: {number: score}, Status: {select: {name: status}}, Job: {title: [{plain_text: title}]}}});

test('the same jobs with the same scores agree', () => {
  assert.deepEqual(compareJobs([{url: 'https://a/1', title: 'SRE', fit: 80}], [row('https://a/1/', 80)]), []);
});
test('a rescored, an extra and a missing job are each named', () => {
  const problems = compareJobs([{url: 'https://a/1', title: 'SRE', fit: 70}, {url: 'https://a/2', title: 'Ghost', fit: 60}], [row('https://a/1', 80), row('https://a/3', 75, 'New', 'Lost one')]);
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /shows fit 70 but its Notion row says 80/);
  assert.match(problems.join('\n'), /"Ghost" .* no Job Matches row/);
  assert.match(problems.join('\n'), /"Lost one" .* missing from the Jobs list/);
});
test('a dismissed or low-scored row may be absent from the list', () => {
  assert.deepEqual(compareJobs([], [row('https://a/1', 80, 'Dismissed'), row('https://a/2', 30)]), []);
});
