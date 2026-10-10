// The applying report upload (lib/applying-report.mjs): only hosts and fixed words leave the Mac, never from CI or a control run, the key never in the output.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hostOnly, skipReason, upload} from '../lib/applying-report.mjs';

test('never from CI or a control run on an old build; a posting address becomes its host', () => {
  assert.equal(skipReason({CI: '1'}), 'CI');
  assert.match(skipReason({REAL_EXTENSION_DIR: '/tmp/old'}), /control run/);
  assert.equal(skipReason({}), '');
  assert.equal(hostOnly('https://www.jobs.ch/en/vacancies/detail/abc/?x=1'), 'www.jobs.ch');
});

test('the upload sends the rows with the key as a Bearer, and the outcome line never shows the key', async () => {
  let sent;
  const line = await upload('smoke', [{name: 'Lever form', host: 'jobs.lever.co', reached: 'ready'}], {env: {}, key: 'SECRET-KEY', day: '2026-10-12',
    fetcher: async (url, init) => { sent = {url, init}; return {ok: true, json: async () => ({ok: true, stored: 1})}; }});
  assert.equal(sent.init.headers.Authorization, 'Bearer SECRET-KEY');
  assert.deepEqual(JSON.parse(sent.init.body).rows, [{name: 'Lever form', host: 'jobs.lever.co', reached: 'ready'}]);
  assert.match(line, /1 smoke row\(s\) sent/);
  assert.ok(!line.includes('SECRET'));
  assert.match(await upload('smoke', [], {env: {CI: 'true'}}), /not sent \(CI\)/);
});

test('the pool upload: every site with its start host and signature, never a posting address (a path or query fails this)', async () => {
  const {poolRows} = await import('../lib/applying-report.mjs');
  const shapes = [{shape: 'Acme', urls: ['https://job-boards.greenhouse.io/acme/jobs/123?gh_src=secret&token=abc']}, {shape: 'Never run', like: ['%x.com%']}, {shape: 'Local', urls: ['https://a.b.ch/x/y']}];
  const rows = poolRows(shapes, {Acme: 'other>form@job-boards.greenhouse.io#form', Local: 'form@a.b.ch/x?q=1#form'});
  assert.deepEqual(rows, [{name: 'Acme', start_host: 'job-boards.greenhouse.io', signature: 'other>form@job-boards.greenhouse.io#form'}, {name: 'Never run'},
    {name: 'Local', start_host: 'a.b.ch'}]);   // a signature carrying a path is dropped, not sent
  assert.ok(!/[?=]|\/(acme|x)|token|secret/.test(JSON.stringify(rows)));
  let sent; await (await import('../lib/applying-report.mjs')).upload('pool', rows, {env: {}, key: 'K', fetcher: async (url, init) => { sent = init.body; return {ok: true, json: async () => ({stored: 3})}; }});
  assert.equal(JSON.parse(sent).kind, 'pool');
});

test('the running ping: a site starts or ends its run, sent as fixed words and the site name only; never from CI; a failed send never throws', async () => {
  const {ping} = await import('../lib/applying-report.mjs');
  let sent; const fetcher = async (url, init) => { sent = JSON.parse(init.body); return {ok: true, json: async () => ({stored: 1})}; };
  await ping('Lever form', 'start', {env: {}, key: 'K', fetcher});
  assert.deepEqual([sent.kind, sent.rows], ['running', [{name: 'Lever form', state: 'start'}]]);
  await ping('Lever form', 'end', {env: {}, key: 'K', fetcher});
  assert.equal(sent.rows[0].state, 'end');
  sent = null; await ping('Lever form', 'start', {env: {CI: '1'}, key: 'K', fetcher});
  assert.equal(sent, null);   // nothing leaves from CI
  await ping('Lever form', 'start', {env: {}, key: 'K', fetcher: async () => { throw new Error('offline'); }});   // must not throw
});
