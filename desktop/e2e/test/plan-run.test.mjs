// What a run of the e2e workflow does, decided in one place (plan-run.mjs): which suites, which commit, whether the AI reviews screenshots, and, for the run chained after
// the nightly build, which release to promote when everything passes. gh is a stub: no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planRun} from '../plan-run.mjs';
import {reviewNeeded, shouldSkipScheduled, waitingFindings} from '../lib/plan.mjs';

const ALL = ['activity', 'apply', 'jobs', 'settings'];
const HEAD = 'a'.repeat(40), OLD = 'b'.repeat(40);
const issue = (comments = 0, labels = [], kind = 'layout') => ({number: 1, state: 'OPEN', body: `**MEDIUM** · ${kind} · found by the AI screenshot review`, labels: [{name: 'auto-ui'}, ...labels.map(name => ({name}))], comments: Array.from({length: comments}, () => ({body: 'Seen again in run x'}))});

// A gh that answers the calls the plan makes. `files`: what changed between two commits; `runs`: finished e2e runs, newest first; `issues`: open auto-ui issues; `releases`: [tag, sha] newest first.
function gh({files = [], runs = [], issues = [], releases = []} = {}) {
  return args => {
    const text = args.join(' ');
    if (/^api repos\/[^/]+\/[^/]+\/compare\//.test(text)) return files.join('\n');
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(issues);
    if (args[0] === 'release' && args[1] === 'list') return JSON.stringify(releases.map(([tagName]) => ({tagName})));
    const commit = /commits\/(desktop-v\S+)/.exec(text);
    if (commit) return (releases.find(([tag]) => tag === commit[1]) || [])[1] || '';
    throw new Error(`unexpected gh call: ${text}`);
  };
}
const plan = (env, stub) => planRun({env: {REPO: 'o/r', ...env}, gh: gh(stub), all: ALL, minutes: () => 15});

test('findings that wait for a second sighting are counted; parked ones are not', () => {
  assert.equal(waitingFindings([issue(0), issue(1), issue(0, ['needs-human']), issue(0, ['wontfix-auto'])]), 1);
  assert.equal(waitingFindings([issue(0, [], 'test-failure')]), 0, 'a failed step is never fixed automatically: no confirming run for it');
});

test('a scheduled run is skipped only when nothing changed and nothing waits', () => {
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: HEAD, waiting: 0}), true);
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: OLD, waiting: 0}), false);
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: HEAD, waiting: 2}), false);
  assert.equal(shouldSkipScheduled({event: 'schedule', head: HEAD, lastSha: '', waiting: 0}), false);
  assert.equal(shouldSkipScheduled({event: 'workflow_dispatch', head: HEAD, lastSha: HEAD, waiting: 0}), false);
});

test('the AI reviews screenshots only when the UI or its tests changed, or a finding waits', () => {
  assert.equal(reviewNeeded({files: ['desktop/lib/notion.js', 'src/daily.py'], waiting: 0, known: true}), false);
  assert.equal(reviewNeeded({files: ['desktop/renderer/pages/jobs.js'], waiting: 0, known: true}), true);
  assert.equal(reviewNeeded({files: ['desktop/e2e/suites/activity.mjs'], waiting: 0, known: true}), true);
  assert.equal(reviewNeeded({files: [], waiting: 1, known: true}), true);
  assert.equal(reviewNeeded({files: [], waiting: 0, known: false}), true, 'no earlier run to compare with: review');
});

test('a schedule with nothing new runs nothing; with new commits it runs every suite on that commit', async () => {
  const unchanged = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [{event: 'schedule', headSha: HEAD, conclusion: 'success'}]});
  assert.equal(unchanged.count, '0');
  const changed = await plan({EVENT: 'schedule', SHA: HEAD}, {runs: [{event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']});
  assert.deepEqual([changed.count, changed.ref, changed.review, changed.tag], ['4', HEAD, '0', '']);
});

test('a push to main runs only the suites its files changed, and a push run is never the last run to compare with', async () => {
  const out = await plan({EVENT: 'push', SHA: HEAD, BEFORE: OLD}, {files: ['desktop/e2e/suites/jobs.mjs'], runs: [{event: 'push', headSha: OLD, conclusion: 'success'}]});
  assert.deepEqual(JSON.parse(out.matrix).include.map(item => item.suite), ['jobs']);
  assert.equal(out.review, '1', 'no earlier non-push run: review');
});

test('every changed file counts, one per line', async () => {
  const out = await plan({EVENT: 'push', SHA: HEAD, BEFORE: OLD}, {files: ['desktop/e2e/suites/jobs.mjs', 'extension/content.js', 'docs/x.md']});
  assert.deepEqual(JSON.parse(out.matrix).include.map(item => item.suite), ['apply', 'jobs']);
});

test('a manual dry run of the promotion runs no suite', async () => {
  const out = await plan({EVENT: 'workflow_dispatch', SHA: HEAD, PROMOTE_TAG: 'desktop-v1.2'}, {});
  assert.equal(out.count, '0');
});

test('a manual run runs what it names', async () => {
  const out = await plan({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: 'jobs,settings'}, {});
  assert.deepEqual(JSON.parse(out.matrix).include.map(item => item.suite), ['jobs', 'settings']);
});

test('the run chained after a build tests the build\'s commit and names the release to promote', async () => {
  const out = await plan({EVENT: 'workflow_run', SHA: OLD, RUN_HEAD_SHA: HEAD, RUN_CONCLUSION: 'success', RUN_EVENT: 'schedule'}, {releases: [['desktop-v1.2', HEAD], ['desktop-v1.1', OLD]]});
  assert.deepEqual([out.count, out.ref, out.tag], ['4', HEAD, 'desktop-v1.2']);
});

test('a build somebody started by hand is not verified or promoted by the pipeline (it is for trying)', async () => {
  const out = await plan({EVENT: 'workflow_run', SHA: OLD, RUN_HEAD_SHA: HEAD, RUN_CONCLUSION: 'success', RUN_EVENT: 'workflow_dispatch'}, {releases: [['desktop-v1.2', HEAD]]});
  assert.deepEqual([out.count, out.tag], ['0', '']);
});

test('a nightly with nothing to build, or a failed build, starts no run', async () => {
  const none = await plan({EVENT: 'workflow_run', SHA: OLD, RUN_HEAD_SHA: HEAD, RUN_CONCLUSION: 'success', RUN_EVENT: 'schedule'}, {releases: [['desktop-v1.1', OLD]]});
  assert.equal(none.count, '0');
  const failed = await plan({EVENT: 'workflow_run', SHA: OLD, RUN_HEAD_SHA: HEAD, RUN_CONCLUSION: 'failure', RUN_EVENT: 'schedule'}, {releases: [['desktop-v1.2', HEAD]]});
  assert.equal(failed.count, '0');
});

test('cadence: always runs on every schedule, nightly only in the nightly gate, manual never by itself', async () => {
  const cadence = {settings: 'always', jobs: 'always', apply: 'nightly', activity: 'manual'};
  const run = (env, stub) => planRun({env: {REPO: 'o/r', ...env}, gh: gh(stub), all: ALL, cadence, minutes: () => 15});
  const names = out => JSON.parse(out.matrix).include.map(item => item.suite);
  const scheduled = await run({EVENT: 'schedule', SHA: HEAD}, {runs: [{event: 'schedule', headSha: OLD, conclusion: 'success'}], files: ['desktop/lib/x.js']});
  assert.deepEqual(names(scheduled), ['jobs', 'settings'], 'the three-a-day schedule: only the always suites');
  const empty = await run({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: ''}, {});
  assert.deepEqual(names(empty), ['apply', 'jobs', 'settings'], 'a manual run with no names: everything that is not manual');
  const named = await run({EVENT: 'workflow_dispatch', SHA: HEAD, ONLY: 'activity'}, {});
  assert.deepEqual(names(named), ['activity'], 'a person can still name a manual suite');
  const pushed = await run({EVENT: 'push', SHA: HEAD, BEFORE: OLD}, {files: ['desktop/e2e/suites/activity.mjs'], runs: [{event: 'push', headSha: OLD, conclusion: 'success'}]});
  assert.equal(pushed.count, '0', 'a push that only touches a manual suite runs nothing');
});

test('cadence: the nightly release gate runs the always and nightly suites, not the manual ones', async () => {
  const cadence = {settings: 'always', jobs: 'always', apply: 'nightly', activity: 'manual'};
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_run', RUN_HEAD_SHA: HEAD, RUN_CONCLUSION: 'success', RUN_EVENT: 'schedule'},
    gh: gh({releases: [['desktop-v1', HEAD]]}), all: ALL, cadence, minutes: () => 15});
  assert.deepEqual(JSON.parse(out.matrix).include.map(item => item.suite), ['apply', 'jobs', 'settings']);
});

test('a manual run with target_ref tests that release\'s commit, not main\'s', async () => {
  const stub = args => (args[0] === 'api' && /commits\/desktop-v0\.4\.0-alpha\.252$/.test(args[1]) ? 'deadbeef00000000000000000000000000000000\n' : '[]');
  const out = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha', TARGET_REF: 'desktop-v0.4.0-alpha.252'}, gh: stub, all: ALL, minutes: () => 15});
  assert.equal(out.ref, 'deadbeef00000000000000000000000000000000');
  const plain = await planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha'}, gh: stub, all: ALL, minutes: () => 15});
  assert.equal(plain.ref, 'mainsha', 'no target_ref: main as before');
  await assert.rejects(planRun({env: {REPO: 'o/r', EVENT: 'workflow_dispatch', SHA: 'mainsha', TARGET_REF: 'nope'}, gh: () => { throw new Error('404'); }, all: ALL, minutes: () => 15}), /not a commit/);
});
