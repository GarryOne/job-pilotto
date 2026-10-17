// The e2e run's HTML report (src/e2e-report.js): the run link, the signed files, and the old /admin/e2e pages going to /admin/operations/e2e.
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {test} from 'node:test';
import {remoteEntries, reportFile, reportToken, view, zipEntries} from '../src/e2e-report.js';

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

test('a file is read out of an artifact zip, stored or deflated', () => {
  for (const method of [0, 8]) assert.deepEqual([...zipEntries(zip({'index.html': '<html></html>', 'data/a.zip': 'x'}, method)).keys()], ['index.html', 'data/a.zip']);
  assert.throws(() => zipEntries(new Uint8Array(40)), /not a zip/);
});


const env = {STATS_KEY: 'k3y', GITHUB_TOKEN: 't0ken', GITHUB_REPO: 'o/r'};
const owner = {headers: {Cookie: 'jp_stats=k3y'}};
const ask = (path, init = {}, fetcher = async () => new Response('nope', {status: 404}), e = env) => view(new Request(`https://www.jobpilotto.top${path}`, init), e, fetcher);

test('the dropped runs page and its data and trace addresses go to /admin/operations/e2e, for an admin only', async () => {
  for (const path of ['/admin/e2e', '/admin/e2e?json=1', '/admin/e2e?steps=42', '/admin/e2e/trace/42/trace-jobs.zip']) {
    assert.equal((await ask(path)).status, 404, `${path}: signed out`);
    const sent = await ask(path, owner);
    assert.equal(sent.status, 302, path);
    assert.equal(sent.headers.get('Location'), '/admin/operations/e2e', path);
  }
});

test('without a GitHub token the run link says why', async () => {
  const answer = await ask('/admin/e2e/run/5/report', owner, undefined, {STATS_KEY: 'k3y'});
  assert.equal(answer.status, 503);
  assert.match((await answer.json()).error, /GITHUB_TOKEN/);
});

// The HTML report: files read with byte ranges out of the run's e2e-report artifact, behind a signed address.
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
  const get = path => reportFile(new Request(`https://www.jobpilotto.top${path}`), env, reportGithub());
  const page = await get(`/admin/e2e/report/77/${token}/index.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  assert.equal(await page.text(), '<html>the report</html>');
  assert.match((await get(`/admin/e2e/report/77/${token}/trace/sw.bundle.js`)).headers.get('Content-Type'), /javascript/, 'the viewer\'s service worker needs a script type');
  assert.equal((await get(`/admin/e2e/report/77/${token}/missing.js`)).status, 404);
  assert.equal((await get(`/admin/e2e/report/77/${'x'.repeat(43)}/index.html`)).status, 404);
  assert.equal((await get(`/admin/e2e/report/78/${token}/index.html`)).status, 404, 'a token is for one artifact');
});
