// CI alerts on Telegram (ci-alert.mjs): 🔴 on every failure, 🟢 only on the first success after one, nothing without the secrets, never the token in a line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capMerged, failedJobs, isRepeat, messageOf, previousConclusion, send} from '../ci-alert.mjs';

const env = {GITHUB_WORKFLOW: 'CI · Site replays · all (offline)', GITHUB_SHA: 'abcdef1234', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42',
  GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/site-replays.yml@refs/heads/main', GH_TOKEN: 'gh'};
const now = new Date('2026-10-14T00:30:00Z');

test('a failure says which workflow, commit, time, what failed and the run; a success says something only after a failure', () => {
  const red = messageOf({status: 'failure', what: '1 row worse: Join (reached posting, baseline account)', env, now});
  assert.match(red, /^🔴 1 row worse: Join \(reached posting, baseline account\)\nCI · Site replays · all \(offline\) failed · main abcdef1 · 14 Oct, 02:30\n/);
  assert.match(red, /https:\/\/github\.com\/o\/r\/actions\/runs\/42$/);
  assert.match(messageOf({status: 'success', previous: 'failure', env, now}), /^🟢 .* back to green/);
  assert.equal(messageOf({status: 'success', previous: 'success', env, now}), '');
});

test('a renamed workflow\'s earlier runs are read from its old file name too (until 28 Oct 2026)', async () => {
  const asked = [];
  const fetcher = async url => { asked.push(url); return {json: async () => ({workflow_runs: /replay-offline\.yml/.test(url) ? [{id: 30, conclusion: 'failure'}] : []})}; };
  assert.equal(await previousConclusion(env, fetcher), 'failure', 'nothing under the new name: the old one answers');
  assert.equal(asked.length, 2);
  asked.length = 0;
  assert.equal(await previousConclusion(env, async url => { asked.push(url); return {json: async () => ({workflow_runs: [{id: 40, conclusion: 'success'}]})}; }), 'success');
  assert.equal(asked.length, 1, 'the new name answered: the old one is not asked');
});

test('the previous run is the newest finished one that is not this run', async () => {
  let asked = '';
  const fetcher = async url => { asked = url; return {json: async () => ({workflow_runs: [{id: 42, conclusion: 'success'}, {id: 41, conclusion: 'failure'}]})}; };
  assert.equal(await previousConclusion(env, fetcher), 'failure');
  assert.match(asked, /\/repos\/o\/r\/actions\/workflows\/site-replays\.yml\/runs\?branch=main&status=completed/);
});

test('no secrets: no send; a failed send never prints the token', async () => {
  assert.match(await send('x', {}), /not sent \(CI_ALERTS_TELEGRAM_BOT_TOKEN or CI_ALERTS_TELEGRAM_CHAT_ID not set\)/);
  const secret = {CI_ALERTS_TELEGRAM_BOT_TOKEN: 'TOKEN123', CI_ALERTS_TELEGRAM_CHAT_ID: '7'};
  const line = await send('x', secret, async url => { throw new Error(`fetch failed ${url}`); });
  assert.doesNotMatch(line, /TOKEN123/);
  let body = null;
  assert.equal(await send('hello', secret, async (url, options) => { body = JSON.parse(options.body); return {ok: true}; }), 'ci-alert: sent');
  assert.deepEqual([body.chat_id, body.text], ['7', 'hello']);
});

test('the first line is the cause; the merged-PR list shows the newest 5 and "+N more"', () => {
  const prs = Array.from({length: 80}, (_, i) => `#${859 + i}`).join(', ');
  const what = `Pinned rows no longer same: Join. PRs merged since then: ${prs}. If intended: label the PR replay-accepted`;
  const capped = capMerged(what);
  assert.match(capped, /PRs merged since then: #934, #935, #936, #937, #938 \+75 more\. If intended/);
  assert.equal(capMerged('PRs merged since then: #1, #2.'), 'PRs merged since then: #1, #2.');
  assert.equal(capMerged('plain'), 'plain');
  assert.match(messageOf({status: 'failure', what, env, now}).split('\n')[0], /^🔴 Pinned rows no longer same: Join\.?$/);
});

test('the same failure on the same commit alerts once: a repeat needs a new commit or other failed jobs', async () => {
  const runs = [{id: 42, head_sha: 'abcdef1234', conclusion: 'failure'}, {id: 41, head_sha: 'abcdef1234', conclusion: 'failure'}, {id: 40, head_sha: 'old', conclusion: 'success'}];
  const jobs = {42: ['plan', 'alert'], 41: ['plan']};
  const fetcher = async url => {
    const m = url.match(/runs\/(\d+)\/jobs/);
    if (m) return {json: async () => ({jobs: (jobs[m[1]] || []).map(name => ({name, conclusion: name === 'alert' ? null : 'failure'}))})};
    return {json: async () => ({workflow_runs: runs})};
  };
  assert.deepEqual(await failedJobs('42', env, fetcher), ['plan']);
  assert.equal(await isRepeat(env, fetcher), true);
  assert.equal(await isRepeat({...env, GITHUB_SHA: 'ffff'}, fetcher), false, 'a new commit alerts again');
  jobs[42] = ['plan', 'suite'];
  assert.equal(await isRepeat(env, fetcher), false, 'a new failed job alerts again');
});
