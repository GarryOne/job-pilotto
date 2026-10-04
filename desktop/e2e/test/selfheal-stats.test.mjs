// The numbers behind /self-heal: how each issue the loop filed ended, by detector, with precision, the fixer, the cost and the real bugs.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build, classify} from '../lib/selfheal-stats.mjs';

const issue = (number, state, labels, comments = [], extra = {}) => ({number, state, title: `[auto-ui] x: bug ${number}`, url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-10-03T10:00:00Z',
  labels: labels.map(name => ({name})), comments: comments.map(body => ({body, createdAt: '2026-10-03T12:00:00Z'})), ...extra});

test('each way an issue ends is told apart: fixed, queued, false positive, duplicate, harness, unclear, open', () => {
  assert.equal(classify(issue(1, 'CLOSED', ['source:ai-review', 'wontfix-auto'])), 'falsePositive');
  assert.equal(classify(issue(30, 'CLOSED', ['source:suite-failure', 'harness', 'wontfix-auto'])), 'harness', 'the verdict pass: a test problem is not counted as a false positive');
  assert.equal(classify(issue(2, 'CLOSED', ['source:ai-review'], ['Duplicate of #118 (the same sidebar icon).'])), 'duplicate');
  assert.equal(classify(issue(3, 'CLOSED', ['source:layout-check'], ['Not a product bug: the recall benchmark\'s planted broken image leaked.'])), 'harness');
  assert.equal(classify(issue(4, 'OPEN', ['source:ai-review', 'confirmed'])), 'queued');
  assert.equal(classify(issue(5, 'CLOSED', ['source:ai-review', 'confirmed'])), 'fixed');
  assert.equal(classify(issue(6, 'CLOSED', ['source:code-review'], ['Fixed by 258e752'])), 'fixed');
  assert.equal(classify(issue(7, 'CLOSED', ['source:ai-review'], ['Closed: not seen in two runs in a row.'])), 'unclear');
  assert.equal(classify(issue(8, 'OPEN', ['source:ai-review'])), 'open');
});

test('the snapshot: totals, precision, detectors, fixer (landed by hand counts), cost per real bug, recall, real bugs', () => {
  const issues = [issue(1, 'CLOSED', ['source:ai-review', 'wontfix-auto'], ['Closed by the UI loop as a false positive: ticker']), issue(4, 'OPEN', ['source:ai-review', 'confirmed'], ['Judged real by the UI loop\'s verdict pass (no edits made): x']),
    issue(6, 'CLOSED', ['source:code-review', 'severity:medium'], ['Fixed by 258e752'])];
  const prs = [{state: 'MERGED'}, {state: 'CLOSED', closingNote: 'Landed on main as 73de6d0 after review'}, {state: 'CLOSED', closingNote: 'not right'}, {state: 'OPEN'}];
  const data = build({issues, prs, costs: [{job: 'fixer', usd: 0.5}, {job: 'verdict of issue 4', usd: 0.1}], recall: {planted: 13, caught: 12, rows: [{id: 'tiny-text', caught: false}]}, now: new Date('2026-10-04T00:00:00Z')});
  assert.deepEqual([data.totals.filed, data.totals.real, data.totals.fixed, data.totals.queued, data.totals.falsePositive, data.totals.precision], [3, 2, 1, 1, 1, 67]);
  assert.deepEqual(data.fixer, {opened: 4, merged: 1, closed: 2, open: 1, landed: 2});
  assert.deepEqual(data.verdicts, {real: 1, falsePositive: 1});
  assert.deepEqual([data.cost.usd, data.cost.perRealBug, data.cost.byJob], [0.6, 0.3, {fixer: 0.5, verdict: 0.1}]);
  assert.deepEqual(data.recall, {planted: 13, caught: 12, missed: ['tiny-text']});
  assert.deepEqual(data.notable.map(bug => [bug.number, bug.status, bug.detector]), [[6, 'fixed', 'AI code review'], [4, 'queued', 'AI screenshot review']]);
});
