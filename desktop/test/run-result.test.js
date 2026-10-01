// The result file is the contract with the engine (tests/fixtures/run-result.json, src/run_result.py).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {jobFromResult} from '../lib/job-line.js';
import {mailProblem, readResult} from '../lib/run-result.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/run-result.json');

test('the shared fixture is a result, and a reworded mail sentence no longer decides the reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-result-'));
  const file = path.join(dir, 'result.json');
  fs.copyFileSync(fixture, file);
  const body = readResult(file);
  assert.equal(body.run_id, 'abc123def456');
  assert.equal(body.v, 1);
  assert.equal(mailProblem('Mail check skipped: something we reworded later', body),
    'not checked: the Anthropic API spend limit was reached');
  assert.equal(jobFromResult(body).pageId, 'page-1');
  assert.equal(readResult(path.join(dir, 'missing.json')), null);
});

test('a log with no result file still reads the sentences', () => {
  assert.equal(mailProblem('Mail check skipped: the Anthropic API spend limit is reached (Error code: 400)'),
    'not checked: the Anthropic API spend limit was reached');
  assert.equal(mailProblem('all quiet'), null);
});
