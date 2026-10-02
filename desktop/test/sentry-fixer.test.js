// The Sentry fixer picks only what is real, fresh and not being fixed, and may touch only the app's code and tests (tools/sentry-fixer/lib.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkChange, choose, eventFacts, handled, judge} from '../../tools/sentry-fixer/lib.mjs';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const issue = (shortId, extra = {}) => ({shortId, level: 'error', status: 'unresolved', count: '5', userCount: 2, firstSeen: '2026-10-01T00:00:00Z', lastSeen: '2026-10-03T08:00:00Z', ...extra});

test('an end-to-end run, a warning, a stale or one-off issue is never picked', () => {
  assert.equal(judge(issue('A'), 'alpha', NOW).ok, true);
  assert.match(judge(issue('A'), 'e2e', NOW).why, /e2e run/);
  assert.match(judge(issue('A', {level: 'warning'}), 'alpha', NOW).why, /warning/);
  assert.match(judge(issue('A', {lastSeen: '2026-09-20T00:00:00Z'}), 'alpha', NOW).why, /stale/);
  assert.match(judge(issue('A', {count: '1', userCount: 1}), 'alpha', NOW).why, /one-off/);
  assert.match(judge(issue('A', {status: 'resolved'}), 'alpha', NOW).why, /resolved/);
  assert.equal(judge(issue('A', {count: '1', userCount: 1, level: 'fatal'}), 'alpha', NOW).ok, true, 'a crash counts at once');
});

test('the issue touching most people comes first; one with a pull request is skipped', () => {
  const list = [{issue: issue('LOW', {userCount: 1, count: '9'}), environment: 'alpha'}, {issue: issue('TOP', {userCount: 4}), environment: 'alpha'}, {issue: issue('NOISE', {userCount: 50}), environment: 'e2e'}, {issue: issue('BUSY', {userCount: 3}), environment: 'alpha'}];
  const prs = [{headRefName: 'sentry-fix/busy', state: 'OPEN'}];
  const {pick, left} = choose(list, prs, NOW);
  assert.equal(pick.issue.shortId, 'TOP');
  assert.deepEqual(left.map(item => item.shortId).sort(), ['BUSY', 'NOISE']);
});

test('a pull request keeps its issue out for 14 days after it is merged or closed, not after', () => {
  const closed = (days, state) => [{headRefName: 'sentry-fix/x-1', state, closedAt: new Date(NOW - days * 86400000).toISOString(), mergedAt: state === 'MERGED' ? new Date(NOW - days * 86400000).toISOString() : null}];
  assert.equal(handled('X-1', closed(3, 'MERGED'), NOW), true);
  assert.equal(handled('X-1', closed(3, 'CLOSED'), NOW), true);
  assert.equal(handled('X-1', closed(20, 'CLOSED'), NOW), false);
});

test('a fix may touch code and tests, never reporting, secrets, workflows or config; it needs a test', () => {
  assert.equal(checkChange(['desktop/lib/pipeline.js', 'desktop/test/pipeline.test.js']).ok, true);
  assert.equal(checkChange(['src/daily.py', 'tests/test_daily.py']).ok, true);
  assert.match(checkChange(['desktop/lib/pipeline.js']).why, /test/);
  for (const file of ['.github/workflows/e2e.yml', 'desktop/lib/sentry.js', 'src/crash_reporting.py', 'src/secret_store.py', 'config/analytics.json', 'tools/release-stable.sh', 'desktop/lib/../../x.js'])
    assert.equal(checkChange([file, 'desktop/test/a.test.js']).ok, false, file);
});

test('the event is reduced to the exception, its own frames and the trail, with no user', () => {
  const facts = eventFacts({title: 't', user: {id: 'secret'}, tags: [{key: 'release', value: 'r1'}, {key: 'environment', value: 'alpha'}], entries: [
    {type: 'exception', data: {values: [{type: 'KeyError', value: 'x', stacktrace: {frames: [{filename: 'lib.py', inApp: false, lineNo: 1}, {filename: 'src/a.py', inApp: true, lineNo: 7, function: 'f', context: [[7, '  boom()  ']]}]}}]}},
    {type: 'breadcrumbs', data: {values: [{message: 'opened Jobs'}]}}]});
  assert.deepEqual(facts.exceptions[0].frames, [{file: 'src/a.py', line: 7, function: 'f', code: 'boom()'}]);
  assert.deepEqual(facts.trail, ['opened Jobs']);
  assert.equal(JSON.stringify(facts).includes('secret'), false);
});
