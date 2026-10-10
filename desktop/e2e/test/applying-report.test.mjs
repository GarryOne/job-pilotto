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
