import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {install, script} from '../src/install.js';

test('the installer is valid bash that installs to Applications from the stable release', () => {
  const text = script('https://www.jobpilotto.workers.dev');
  execFileSync('bash', ['-n'], {input: text});  // syntax only, runs nothing
  assert.match(text, /curl -fsSL https:\/\/www\.jobpilotto\.workers\.dev\/install \| bash/);
  assert.match(text, /releases\/latest\/download\/Job-Pilotto-mac-arm64\.zip/);
  assert.match(text, /APP="\/Applications\/Job Pilotto\.app"/);
  assert.match(text, /uname -m\)" = arm64/);
});

test('GET /install serves the script as text and counts a terminal download', async () => {
  const rows = [];
  const response = await install(new Request('https://www.jobpilotto.workers.dev/install', {headers: {'User-Agent': 'curl/8.7.1'}}),
    {}, null, async (request, env, fields) => rows.push(fields));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/plain/);
  assert.match(await response.text(), /^#!\/bin\/bash/);
  assert.deepEqual(rows, [{platform: 'mac', button: 'terminal'}]);
});

test('only GET counts; other methods are refused', async () => {
  const rows = [];
  const count = async (request, env, fields) => rows.push(fields);
  assert.equal((await install(new Request('https://x/install', {method: 'HEAD'}), {}, null, count)).status, 200);
  assert.equal((await install(new Request('https://x/install', {method: 'POST'}), {}, null, count)).status, 405);
  assert.equal(rows.length, 0);
});
