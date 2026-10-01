import assert from 'node:assert/strict';
import {test} from 'node:test';
import {confirmationsToMark, confirmsJob, jobId} from '../lib/confirmation.js';
import {markReportedConfirmations} from '../lib/server.js';

const JOB = 'https://job-boards.greenhouse.io/anthropic/jobs/5114768008';
const CONFIRM = `${JOB}/confirmation`;

test('a Greenhouse confirmation is this job, including a query on the posting', () => {
  assert.equal(jobId(JOB), '5114768008');
  assert.equal(jobId(`${JOB}?gh_src=abc`), '5114768008');
  assert.equal(jobId(`${JOB}/application`), '5114768008');
  assert.equal(confirmsJob(CONFIRM, JOB), true);
  assert.equal(confirmsJob(`${CONFIRM}?submitted=1`, `${JOB}?gh_src=abc`), true);
  assert.equal(confirmsJob('https://jobs.lever.co/acme/abc/thanks', 'https://jobs.lever.co/acme/abc'), true);
});

test('the open form, another role, and a thank-you page are not a submission', () => {
  assert.equal(confirmsJob(JOB, JOB), false);
  assert.equal(confirmsJob('https://job-boards.greenhouse.io/anthropic/jobs/5002072/confirmation', JOB), false);
  assert.equal(confirmsJob('https://www.google.com/search?q=thank+you+for+applying', JOB), false);
  assert.equal(confirmsJob('https://example.com/5114768008/confirmation', JOB), false);
  assert.equal(confirmsJob('', JOB), false);
});

test('an open session is marked from a reported confirmation tab, once', () => {
  const sessions = [
    {url: JOB, outcome: ''},
    {url: 'https://jobs.lever.co/acme/abc', outcome: 'submitted'},
  ];
  assert.deepEqual(confirmationsToMark([CONFIRM, 'https://jobs.lever.co/acme/abc/thanks'], sessions), [JOB]);
  assert.deepEqual(confirmationsToMark([JOB], sessions), []);
});

test('a confirmation tab marks that session Applied once', async () => {
  const calls = [];
  const session = {url: JOB, company: 'Anthropic', outcome: ''};
  const deps = {
    setStatus: async (_storage, job, status) => { calls.push([job, status]); return {ok: true}; },
    submitted: job => { session.outcome = 'submitted'; calls.push(['submitted', job]); },
    sessions: () => [session],
    log: () => {},
  };
  await markReportedConfirmations({}, [CONFIRM], deps);
  await markReportedConfirmations({}, [CONFIRM], deps);
  assert.deepEqual(calls, [[JOB, 'applied'], ['submitted', JOB]]);
});
