import assert from 'node:assert/strict';
import {test} from 'node:test';
import site, {dispatch} from '../src/index.js';

const post = (body, token) => new Request('https://www.jobpilotto.workers.dev/report/fill-failure', {method: 'POST',
  headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(body)});

test('form reports reach the site worker; nothing mechanical is refused before GitHub is called', async () => {
  const response = await site.fetch(post({site: 'jobs.example.com', fields: []}), {GITHUB_REPO: 'o/r'});
  assert.equal(response.status, 400);
});

test('a report starts the intake workflow on the public repo with the dispatch token', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push([url, init]); return new Response(null, {status: 204}); };
  await dispatch({GITHUB_REPO: 'GarryOne/job-pilotto', GITHUB_TOKEN: 'ghp_x'}, {report: '{}', trusted: 'false'}, 'fill-failure-intake.yml', fetcher);
  assert.equal(calls[0][0], 'https://api.github.com/repos/GarryOne/job-pilotto/actions/workflows/fill-failure-intake.yml/dispatches');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer ghp_x');
  assert.deepEqual(JSON.parse(calls[0][1].body), {ref: 'main', inputs: {report: '{}', trusted: 'false'}});
  await assert.rejects(dispatch({GITHUB_REPO: 'o/r'}, {}, 'x.yml', async () => new Response('no', {status: 401})), /401/);
});
