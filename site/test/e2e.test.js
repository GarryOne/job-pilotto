// /admin/e2e (src/e2e.js): the runs and their suites from GitHub, a suite's steps and its trace read out of the run's artifact, admins only.
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {test} from 'node:test';
import {suiteRows, view, zipEntries, zipFile} from '../src/e2e.js';

// A zip as GitHub serves an artifact: local headers, the central directory, the end record. method 0 = stored, 8 = deflated.
function zip(files, method = 0) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = method ? deflateRawSync(raw) : raw, nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data); central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dir, end]));
}
const read = stream => new Response(stream).text();

test('a file is read out of an artifact zip, stored or deflated', async () => {
  for (const method of [0, 8]) {
    const bytes = zip({'steps.json': '{"results":[]}', 'trace-jobs.zip': 'PK…trace bytes'}, method);
    const entries = zipEntries(bytes);
    assert.deepEqual([...entries.keys()], ['steps.json', 'trace-jobs.zip']);
    assert.equal(await read(zipFile(bytes, entries.get('trace-jobs.zip'))), 'PK…trace bytes', `method ${method}`);
  }
  assert.throws(() => zipEntries(new Uint8Array(40)), /not a zip/);
});

test('suites: the jobs that are suites, failed first, each with its view artifact', () => {
  const jobs = [{name: 'plan', status: 'completed', conclusion: 'success'}, {name: 'wizard', status: 'completed', conclusion: 'success', started_at: '2026-10-06T10:00:00Z', completed_at: '2026-10-06T10:03:20Z'},
    {name: 'jobs', status: 'completed', conclusion: 'failure'}, {name: 'activity', status: 'in_progress', conclusion: null}, {name: 'promote', status: 'completed'}];
  const rows = suiteRows(jobs, [{name: 'e2e-view-jobs', id: 7}, {name: 'e2e-view-wizard', id: 8, expired: true}]);
  assert.deepEqual(rows.map(row => row.name), ['jobs', 'activity', 'wizard']);
  assert.equal(rows[0].view, 7);
  assert.equal(rows[2].view, null, 'an expired artifact is not offered');
  assert.equal(rows[2].seconds, 200);
  assert.equal(suiteRows([{name: 'jobs (Windows)', conclusion: 'failure'}], [{name: 'e2e-view-windows-jobs', id: 9}], 'Windows')[0].view, 9);
});

const env = {STATS_KEY: 'k3y', GITHUB_TOKEN: 't0ken', GITHUB_REPO: 'o/r'};
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const artifactZip = zip({'steps.json': JSON.stringify({results: [{name: 'opens', status: 'failed', note: 'no window'}], traces: ['trace-jobs.zip']}), 'trace-jobs.zip': 'TRACE'});
function github(calls = []) {
  return async (url, init) => {
    if (url.startsWith('https://api.github.com/')) calls.push({url, auth: init.headers.Authorization});
    const path = new URL(url).pathname;
    if (path.endsWith('/actions/workflows/e2e.yml/runs')) return Response.json({workflow_runs: [{id: 1, display_title: 'Nightly', event: 'schedule', head_sha: 'abcdef123', status: 'in_progress', created_at: '2026-10-06T10:00:00Z', html_url: 'https://github.com/run/1'}]});
    if (path.endsWith('/actions/workflows/e2e-windows.yml/runs')) return Response.json({workflow_runs: []});
    if (path.endsWith('/runs/1/jobs')) return Response.json({jobs: [{name: 'jobs', status: 'completed', conclusion: 'failure'}]});
    if (path.endsWith('/runs/1/artifacts')) return Response.json({artifacts: [{name: 'e2e-view-jobs', id: 42}]});
    if (path.endsWith('/actions/artifacts/42/zip')) return new Response(null, {status: 302, headers: {Location: 'https://blob.example/42.zip?sig=1'}});
    if (url === 'https://blob.example/42.zip?sig=1') { assert.equal(init?.headers?.Authorization, undefined, 'the token never goes to the storage host'); return new Response(artifactZip); }
    return new Response('nope', {status: 404});
  };
}
const ask = (path, init = {}, fetcher = github(), e = env) => view(new Request(`https://www.jobpilotto.workers.dev${path}`, init), e, fetcher);

test('the runs, the steps and the trace, for an admin only', async () => {
  for (const path of ['/admin/e2e', '/admin/e2e?json=1', '/admin/e2e?steps=42', '/admin/e2e/trace/42/trace-jobs.zip']) assert.equal((await ask(path)).status, 404, path);
  const calls = [];
  const runs = await (await ask('/admin/e2e?json=1', owner, github(calls))).json();
  assert.equal(runs.runs[0].title, 'Nightly');
  assert.deepEqual(runs.runs[0].suites.map(s => [s.name, s.conclusion, s.view]), [['jobs', 'failure', 42]]);
  assert.ok(calls.every(call => call.auth === 'Bearer t0ken' && call.url.startsWith('https://api.github.com/repos/o/r/')));
  const steps = await (await ask('/admin/e2e?steps=42', owner)).json();
  assert.deepEqual(steps.traces, ['trace-jobs.zip']);
  const trace = await ask('/admin/e2e/trace/42/trace-jobs.zip', owner);
  assert.equal(trace.headers.get('Content-Type'), 'application/zip');
  assert.equal(await trace.text(), 'TRACE');
  assert.equal((await ask('/admin/e2e/trace/42/trace-other.zip', owner)).status, 404);
  assert.equal((await ask('/admin/e2e/trace/42/..%2Fsecret.zip', owner)).status, 404, 'only trace-*.zip names');
  assert.equal((await ask('/admin/e2e?steps=x', owner)).status, 404);
});

test('without a GitHub token the page still opens and the data says why', async () => {
  const e = {STATS_KEY: 'k3y'};
  assert.equal((await ask('/admin/e2e', owner, github(), e)).status, 200);
  const answer = await ask('/admin/e2e?json=1', owner, github(), e);
  assert.equal(answer.status, 503);
  assert.match((await answer.json()).error, /GITHUB_TOKEN/);
});
