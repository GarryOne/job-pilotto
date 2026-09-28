import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as cloudRuns from '../lib/cloud-runs.js';

// A storage with a connected GitHub repo, runs.json in a temp folder.
function storage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cloud-'));
  return {
    settings: () => ({cloud: {repo: 'me/job-pilotto-private'}}),
    secret: name => (name === 'GITHUB_TOKEN' ? 'ghu_x' : ''),
    readText: name => fs.readFileSync(path.join(dir, name), 'utf8'),
    writeText: (name, text) => fs.writeFileSync(path.join(dir, name), text),
  };
}
const run = (id, title, status, extra = {}) => ({id, display_title: title, event: 'schedule', status, conclusion: status === 'completed' ? 'success' : null,
  html_url: `https://github.com/me/job-pilotto-private/actions/runs/${id}`, created_at: `2026-09-28T1${id}:00:00Z`, updated_at: `2026-09-28T1${id}:03:00Z`, ...extra});

test('GitHub runs show in Recent activity: what ran, the one in progress with its step, and a finished one\'s result', async () => {
  const s = storage();
  const logs = {
    11: '2026-09-28T11:01:00.1Z ##[group]Run python -m src daily\n2026-09-28T11:01:02.1Z Insight sent: Skills — Go is in 40% of your matches (0.012 USD)\n2026-09-28T11:01:03.1Z Cronjob run logged: https://notion.so/r1',
    12: '2026-09-28T12:01:00.1Z Updates:\n2026-09-28T12:01:00.2Z Grafana Labs: Rejected\n2026-09-28T12:01:00.3Z Mail: 3 new email(s) classified, 1 update(s)',
  };
  let logReads = 0;
  const fetcher = async url => {
    const route = new URL(url).pathname;
    if (route.endsWith('/actions/runs')) {
      return Response.json({workflow_runs: [run(13, 'scheduled', 'in_progress'), run(12, 'mail', 'completed', {event: 'workflow_dispatch'}),
        run(11, 'insight', 'completed', {conclusion: 'success'})]});
    }
    const jobs = route.match(/runs\/(\d+)\/jobs$/);
    if (jobs) return Response.json({jobs: [{id: Number(jobs[1]) * 10, steps: [{name: 'Set up job', status: 'completed'}, {name: 'Search', status: 'in_progress'}]}]});
    const log = route.match(/jobs\/(\d+)\/logs$/);
    if (log) { logReads += 1; return new Response(logs[Number(log[1]) / 10]); }
    throw new Error(`unexpected ${url}`);
  };
  const {running} = await cloudRuns.sync(s, {fetcher});
  assert.equal(running.kind, 'search');
  assert.equal(running.step, 'On GitHub: Search');
  assert.equal(running.trigger, 'schedule');
  const saved = JSON.parse(s.readText('runs.json'));
  assert.deepEqual(saved.map(r => [r.kind, r.ok, r.trigger]), [['mail', true, 'you'], ['insight', true, 'schedule']]);
  assert.equal(saved[1].summary, 'Skills — Go is in 40% of your matches');
  assert.equal(saved[1].notionUrl, 'https://notion.so/r1');
  assert.equal(saved[1].url, 'https://github.com/me/job-pilotto-private/actions/runs/11');
  assert.deepEqual(saved[0].updates, ['Grafana Labs: Rejected']);
  assert.ok(!saved[0].log.some(line => /^##\[group\]|^\d{4}-/.test(line)));
  // A finished run's log is read once.
  await cloudRuns.sync(s, {fetcher});
  assert.equal(logReads, 2);
});

test('a run\'s name is its mode; Telegram button actions are "action"', () => {
  assert.equal(cloudRuns.kindOf('scheduled'), 'search');
  assert.equal(cloudRuns.kindOf('run'), 'search');
  assert.equal(cloudRuns.kindOf('scout 15'), 'scout');
  assert.equal(cloudRuns.kindOf('mail (after 5 min)'), 'mail');
  assert.equal(cloudRuns.kindOf('apply 1a2b3c4d'), 'action');
});

test('without a connected repo nothing is read', async () => {
  const s = {...storage(), settings: () => ({})};
  assert.equal(await cloudRuns.sync(s, {fetcher: async () => { throw new Error('no call expected'); }}), null);
});
