// CI alerts on Telegram (ci-alert.mjs): 🔴 on every failure, 🟢 only on the first success after one, nothing without the secrets, never the token in a line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {messageOf, previousConclusion, send} from '../ci-alert.mjs';

const env = {GITHUB_WORKFLOW: 'CI · Replay vs live (offline)', GITHUB_SHA: 'abcdef1234', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42',
  GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/replay-offline.yml@refs/heads/main', GH_TOKEN: 'gh'};
const now = new Date('2026-10-14T00:30:00Z');

test('a failure says which workflow, commit, time, what failed and the run; a success says something only after a failure', () => {
  const red = messageOf({status: 'failure', what: '1 row worse: Join (reached posting, baseline account)', env, now});
  assert.match(red, /^🔴 CI · Replay vs live \(offline\) failed · main abcdef1 · 14 Oct, 02:30\n1 row worse: Join/);
  assert.match(red, /https:\/\/github\.com\/o\/r\/actions\/runs\/42$/);
  assert.match(messageOf({status: 'success', previous: 'failure', env, now}), /^🟢 .* back to green/);
  assert.equal(messageOf({status: 'success', previous: 'success', env, now}), '');
});

test('the previous run is the newest finished one that is not this run', async () => {
  let asked = '';
  const fetcher = async url => { asked = url; return {json: async () => ({workflow_runs: [{id: 42, conclusion: 'success'}, {id: 41, conclusion: 'failure'}]})}; };
  assert.equal(await previousConclusion(env, fetcher), 'failure');
  assert.match(asked, /\/repos\/o\/r\/actions\/workflows\/replay-offline\.yml\/runs\?branch=main&status=completed/);
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
