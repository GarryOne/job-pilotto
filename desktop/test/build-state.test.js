// Which build runs (owner, 16 Oct 2026: the app ran a build older than the merged fixes and he tested old code without knowing): lib/build-state.js.
process.env.TZ = 'UTC';   // the label is local time: the same words on every machine and CI runner
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {appBuild, extensionBuild, fixesLabel, labelOf, reloadLabel, restartLabel} from '../lib/build-state.js';

const T = '2026-10-16T14:02:00Z';
// A fake git: answers by the command it is asked.
const fakeGit = (answers = {}) => (cmd, args) => {
  const key = args.slice(2).join(' ');
  const hit = Object.entries(answers).find(([pattern]) => key.startsWith(pattern));
  if (!hit) throw new Error(`unexpected git ${key}`);
  return hit[1];
};

test('a build is told as short sha and time; no sha says nothing', () => {
  assert.equal(labelOf({commit: 'abc1234', time: T}), 'abc1234 · 16 Oct 14:02');
  assert.equal(labelOf({commit: 'abc1234', time: ''}), 'abc1234');
  assert.equal(labelOf({commit: '', time: T}), '');
});

test('the app run from source: its start commit, and how many desktop/extension commits the checkout has gained since', () => {
  const run = fakeGit({'rev-parse --short=7 HEAD': 'abc1234\n', 'log -1 --format=%cI HEAD': `${T}\n`, 'rev-list --count abc1234..HEAD -- desktop extension': '3\n'});
  const state = appBuild({repo: '/r', running: {commit: 'abc1234', time: T}, run, now: 1e6});
  assert.deepEqual({ahead: state.ahead, label: state.label}, {ahead: 3, label: 'abc1234 · 16 Oct 14:02'});
  assert.equal(appBuild({repo: '/r', running: {commit: 'abc1234', time: T}, run: fakeGit({'rev-list --count': '0\n'}), now: 2e6}).ahead, 0);
  assert.equal(appBuild({repo: '/r', running: {commit: 'abc1234', time: T}, run: () => { throw new Error('no git'); }, now: 3e6}).ahead, 0, 'git cannot count: nothing is claimed');
  assert.equal(appBuild({repo: '/r', running: {commit: '', time: ''}, run, now: 4e6}).ahead, 0, 'a build with no commit is never "behind"');
});

test('the extension: its commit from the version a checkout stamps, and how many fixes it lacks', () => {
  const run = fakeGit({'rev-list --reverse HEAD -- extension': 'aaa1111\nbbb2222\nccc3333\n', 'log -1 --format=%cI bbb2222': `${T}\n`, 'log -1 --format=%cI ccc3333': '2026-10-16T15:00:00Z\n'});
  const behind = extensionBuild({repo: '/r', version: '0.9.2', latest: '0.9.3', run, now: 5e6});
  assert.deepEqual({behind: behind.behind, label: behind.label, latest: behind.latestLabel}, {behind: 1, label: 'bbb2222 · 16 Oct 14:02', latest: 'ccc3333 · 16 Oct 15:00'});
  assert.equal(extensionBuild({repo: '/r', version: '0.9.3', latest: '0.9.3', run, now: 6e6}).behind, 0);
  assert.equal(extensionBuild({repo: '/r', version: '0.9', latest: '0.9.3', run, now: 7e6}).behind, null, 'a copy that never reloaded: how many is unknown, but it IS behind');
  assert.equal(extensionBuild({repo: '/r', version: '0.9', latest: '0.9.3', run, now: 8e6}).label, '', 'no commit is invented for a version that names none');
});

test('a packaged app and its extension are one build: the stamped commit, never behind', () => {
  const state = extensionBuild({repo: '/r', version: '0.9.50', latest: '0.9.50', packaged: {commit: 'def5678', time: T}, run: () => { throw new Error('no git in a package'); }});
  assert.deepEqual({behind: state.behind, label: state.label}, {behind: 0, label: 'def5678 · 16 Oct 14:02'});
});

test('the buttons say how many fixes they bring', () => {
  assert.equal(restartLabel(1), 'Restart to get 1 fix');
  assert.equal(restartLabel(4), 'Restart to get 4 fixes');
  assert.equal(reloadLabel(4), 'Reload the extension to get 4 fixes');
  assert.equal(reloadLabel(null), 'Reload the extension to get the latest fixes');
  assert.equal(fixesLabel(2), '2 fixes');
});
