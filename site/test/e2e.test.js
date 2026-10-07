// /admin/e2e (src/e2e.js): the runs and their suites from GitHub, a suite's steps and its trace read out of the run's artifact, admins only.
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {test} from 'node:test';
import {releaseGates, remoteEntries, reportFile, reportToken, suiteRows, view, zipEntries, zipFile} from '../src/e2e.js';

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
    if (path.endsWith('/actions/workflows/desktop.yml/runs')) return Response.json({workflow_runs: []});
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

// The HTML report: files read with byte ranges out of the run's e2e-report artifact, behind a signed address; the run's link redirects an admin to it.
function storageWith(bytes, ranges = []) {
  return async (url, init = {}) => {
    const range = init.headers?.Range;
    if (!range) return new Response(bytes);
    const [, start, end] = range.match(/bytes=(\d+)-(\d+)/).map(Number);
    ranges.push([start, end]);
    return new Response(bytes.subarray(start, end + 1), {status: 206});
  };
}
test('a file of a large report is read by ranges, never the whole artifact', async () => {
  for (const method of [0, 8]) {
    const files = {'index.html': '<html>report</html>', 'data/abc.zip': 'TRACE'.repeat(20000)};
    const bytes = zip(files, method), ranges = [];
    const fetcher = storageWith(bytes, ranges);
    const entries = await remoteEntries(fetcher, 'https://blob/x', bytes.length);
    assert.deepEqual([...entries.keys()], ['index.html', 'data/abc.zip']);
    assert.ok(ranges.every(([start, end]) => end - start < 70000), 'only the tail is read for the directory');
  }
});

const reportGithub = ({status = 'completed', report = true} = {}) => {
  const bytes = zip({'index.html': '<html>the report</html>', 'trace/sw.bundle.js': 'self.x=1'});
  const blob = storageWith(bytes);
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (url.startsWith('https://blob.example/')) return blob(url, init);
    if (path.endsWith('/actions/runs/5')) return Response.json({status, html_url: 'https://github.com/run/5'});
    if (path.endsWith('/actions/runs/5/artifacts')) return Response.json({artifacts: report ? [{name: 'e2e-report', id: 77}] : [{name: 'e2e-artifacts-jobs', id: 78}]});
    if (path.endsWith('/actions/artifacts/77')) return Response.json({size_in_bytes: bytes.length, expired: false});
    if (path.endsWith('/actions/artifacts/77/zip')) return new Response(null, {status: 302, headers: {Location: 'https://blob.example/77.zip?sig=1'}});
    return new Response('nope', {status: 404});
  };
};
test('the run link: an admin is sent to the report (filtered to a suite); not ready and none say so', async () => {
  assert.equal((await ask('/admin/e2e/run/5/report', {}, reportGithub())).status, 404, 'admins only');
  const sent = await ask('/admin/e2e/run/5/report?suite=jobs', owner, reportGithub());
  assert.equal(sent.status, 302);
  assert.equal(sent.headers.get('Location'), `/admin/e2e/report/77/${await reportToken(env, 77)}/index.html#?q=jobs`);
  const waiting = await ask('/admin/e2e/run/5/report', owner, reportGithub({status: 'in_progress', report: false}));
  assert.match(await waiting.text(), /built when the run ends[\s\S]*/);
  assert.match(await (await ask('/admin/e2e/run/5/report', owner, reportGithub({report: false}))).text(), /has no HTML report/);
});
test('report files: the signed address serves them without a cookie; a wrong token or another artifact is a 404', async () => {
  const token = await reportToken(env, 77);
  const get = path => reportFile(new Request(`https://www.jobpilotto.workers.dev${path}`), env, reportGithub());
  const page = await get(`/admin/e2e/report/77/${token}/index.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  assert.equal(await page.text(), '<html>the report</html>');
  assert.match((await get(`/admin/e2e/report/77/${token}/trace/sw.bundle.js`)).headers.get('Content-Type'), /javascript/, 'the viewer\'s service worker needs a script type');
  assert.equal((await get(`/admin/e2e/report/77/${token}/missing.js`)).status, 404);
  assert.equal((await get(`/admin/e2e/report/77/${'x'.repeat(43)}/index.html`)).status, 404);
  assert.equal((await get(`/admin/e2e/report/78/${token}/index.html`)).status, 404, 'a token is for one artifact');
});

test('a run title with a full commit hash shows its 7-character short form', async () => {
  const sha = '639068116d9b15630adce76be8f5f9b7606559ee';
  const fetcher = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/actions/workflows/e2e.yml/runs')) return Response.json({workflow_runs: []});
    if (path.endsWith('/actions/workflows/e2e-windows.yml/runs')) return Response.json({workflow_runs: [{id: 9, display_title: `Windows ${sha} · Windows`, event: 'workflow_dispatch', head_sha: sha, created_at: '2026-10-06T10:00:00Z'}]});
    if (path.endsWith('/actions/workflows/desktop.yml/runs')) return Response.json({workflow_runs: []});
    if (/\/runs\/9\/(jobs|artifacts)$/.test(path)) return Response.json({jobs: [], artifacts: []});
    return new Response('nope', {status: 404});
  };
  const runs = await (await ask('/admin/e2e?json=1', owner, fetcher)).json();
  assert.equal(runs.runs[0].title, 'Windows 6390681 · Windows');
});

// 7 Oct 2026: the release run (desktop.yml) calls both e2e workflows as its gates. One run, two rows: each gate with its own suites, verdict, views and report.
test('a release run shows its Mac + Linux gate and its Windows gate as two rows; a build-only run shows none', async () => {
  const jobs = [
    {name: 'Build · Mac', status: 'completed', conclusion: 'success'},
    {name: 'E2E · Mac + Linux · plan', status: 'completed', conclusion: 'success'},
    {name: 'E2E · Mac + Linux · jobs', status: 'completed', conclusion: 'success'},
    {name: 'E2E · Mac + Linux · promote', status: 'completed', conclusion: 'success'},
    {name: 'E2E · Windows · plan', status: 'completed', conclusion: 'success'},
    {name: 'E2E · Windows · jobs (Windows)', status: 'completed', conclusion: 'failure'},
    {name: 'E2E · Windows · approve-windows', status: 'completed', conclusion: 'skipped'},
  ];
  assert.deepEqual(releaseGates(jobs).map(gate => [gate.os, gate.conclusion, gate.jobs.length]), [['', 'success', 3], ['Windows', 'failure', 3]]);
  assert.deepEqual(releaseGates([{name: 'Build · Mac', status: 'completed', conclusion: 'success'}, {name: 'E2E · Windows · plan', status: 'completed', conclusion: 'skipped'}]), []);
  const fetcher = async url => {
    const path = new URL(url).pathname;
    if (/workflows\/e2e(-windows)?\.yml\/runs$/.test(path)) return Response.json({workflow_runs: []});
    if (path.endsWith('/actions/workflows/desktop.yml/runs')) return Response.json({workflow_runs: [
      {id: 5, display_title: 'Nightly beta', event: 'schedule', head_sha: 'abc1234', status: 'completed', conclusion: 'failure', created_at: '2026-10-07T10:00:00Z'},
      {id: 6, display_title: 'Build only (by hand, not tested)', event: 'workflow_dispatch', head_sha: 'abc1234', status: 'completed', conclusion: 'success', created_at: '2026-10-07T11:00:00Z'}]});
    if (path.endsWith('/runs/5/jobs')) return Response.json({jobs});
    if (path.endsWith('/runs/5/artifacts')) return Response.json({artifacts: [{name: 'e2e-report', id: 1}, {name: 'e2e-view-windows-jobs', id: 2}]});
    return new Response('nope', {status: 404});
  };
  const {runs} = await (await ask('/admin/e2e?json=1', owner, fetcher)).json();
  assert.deepEqual(runs.map(run => [run.title, run.os, run.conclusion, run.report]), [['Nightly beta · Mac + Linux', '', 'success', true], ['Nightly beta · Windows', 'Windows', 'failure', false]]);
  assert.deepEqual(runs[1].suites.map(s => [s.name, s.view]), [['jobs', 2]], 'the Windows suite, its view artifact found by name');
});
