import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runWarnings} from '../renderer/run-warnings.js';

test('a run\'s warnings: real problems only, never a "0 failed" report line', () => {
  assert.deepEqual(runWarnings([
    'Enriched 1 of 1 job(s) with claude-haiku-4-5; 0 failed; tokens in 3401, out 185',
    'Scored 1 of 1 job(s) with claude-sonnet-5; 0 failed; tokens in 2645 (+0 cached), out 737',
  ]), []);
  assert.deepEqual(runWarnings([
    'Scored 3 of 5 job(s); 2 failed',
    'Warning: Notion 429 on Job Matches sync',
    'Job Matches sync skipped',
    'Notion failed to answer',
    '0 skipped, 0 failed',
  ]), ['Scored 3 of 5 job(s); 2 failed', 'Notion 429 on Job Matches sync', 'Job Matches sync skipped', 'Notion failed to answer']);
});
